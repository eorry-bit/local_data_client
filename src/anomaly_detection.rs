use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::database::{DatabaseManager, TelemetryData, DataOperation, OperationType};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnomalyDetectionConfig {
    /// 突变检测的敏感度 (标准差倍数)
    pub sensitivity: f64,
    /// 最小窗口大小（用于计算基线）
    pub min_window_size: usize,
    /// 最大突变幅度（超过此值认为是突变）
    pub max_jump_threshold: f64,
    /// 连续异常点数量阈值
    pub consecutive_anomaly_threshold: usize,
    /// 是否启用自动纠正
    pub auto_correction: bool,
}

impl Default for AnomalyDetectionConfig {
    fn default() -> Self {
        Self {
            sensitivity: 3.0,
            min_window_size: 50,
            max_jump_threshold: 5.0, // 5个标准差
            consecutive_anomaly_threshold: 3,
            auto_correction: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectedAnomaly {
    pub target_name: String,
    pub key_name: String,
    pub anomaly_type: AnomalyType,
    pub start_time: DateTime<Utc>,
    pub end_time: Option<DateTime<Utc>>,
    pub baseline_value: f64,
    pub anomaly_value: f64,
    pub jump_magnitude: f64,
    pub confidence: f64,
    pub suggested_correction: Option<DataOperation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AnomalyType {
    /// 突然跳跃（阳光干扰等）
    SuddenJump,
    /// 持续偏移
    PersistentOffset,
    /// 噪声增加
    IncreasedNoise,
    /// 数据缺失
    DataGap,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnomalyDetectionResult {
    pub anomalies: Vec<DetectedAnomaly>,
    pub suggested_operations: Vec<DataOperation>,
    pub summary: AnomalyDetectionSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnomalyDetectionSummary {
    pub total_anomalies: usize,
    pub targets_affected: usize,
    pub time_range_analyzed: (DateTime<Utc>, DateTime<Utc>),
    pub confidence_distribution: HashMap<String, usize>,
}

pub struct AnomalyDetector {
    config: AnomalyDetectionConfig,
}

impl AnomalyDetector {
    pub fn new(config: AnomalyDetectionConfig) -> Self {
        Self { config }
    }

    /// 检测指定标靶和指标的异常
    pub async fn detect_anomalies(
        &self,
        db: &DatabaseManager,
        target_name: &str,
        key_name: &str,
        start_time: Option<DateTime<Utc>>,
        end_time: Option<DateTime<Utc>>,
    ) -> Result<Vec<DetectedAnomaly>> {
        // 获取数据
        let data = self.fetch_data(db, target_name, key_name, start_time, end_time).await?;
        
        if data.len() < self.config.min_window_size {
            return Ok(Vec::new());
        }

        let mut anomalies = Vec::new();

        // 1. 检测突然跳跃
        anomalies.extend(self.detect_sudden_jumps(&data)?);

        // 2. 检测持续偏移
        anomalies.extend(self.detect_persistent_offsets(&data)?);

        // 3. 检测噪声增加
        anomalies.extend(self.detect_increased_noise(&data)?);

        // 4. 检测数据缺失
        anomalies.extend(self.detect_data_gaps(&data)?);

        Ok(anomalies)
    }

    /// 为所有标靶和指标检测异常
    pub async fn detect_all_anomalies(
        &self,
        db: &DatabaseManager,
        start_time: Option<DateTime<Utc>>,
        end_time: Option<DateTime<Utc>>,
    ) -> Result<AnomalyDetectionResult> {
        // 获取所有标靶和指标组合
        let targets_keys = self.get_all_target_key_combinations(db).await?;
        
        let mut all_anomalies = Vec::new();
        let mut suggested_operations = Vec::new();

        for (target_name, key_name) in targets_keys {
            let anomalies = self.detect_anomalies(db, &target_name, &key_name, start_time, end_time).await?;
            
            for anomaly in anomalies {
                // 生成建议的纠正操作
                if let Some(operation) = self.generate_correction_operation(&anomaly) {
                    suggested_operations.push(operation);
                }
                all_anomalies.push(anomaly);
            }
        }

        // 生成摘要
        let summary = self.generate_summary(&all_anomalies, start_time, end_time);

        Ok(AnomalyDetectionResult {
            anomalies: all_anomalies,
            suggested_operations,
            summary,
        })
    }

    /// 获取数据
    async fn fetch_data(
        &self,
        db: &DatabaseManager,
        target_name: &str,
        key_name: &str,
        start_time: Option<DateTime<Utc>>,
        end_time: Option<DateTime<Utc>>,
    ) -> Result<Vec<TelemetryData>> {
        use crate::database::QueryParams;

        let params = QueryParams {
            asset_name: None,
            device_name: None,
            target_names: vec![target_name.to_string()],
            key_names: vec![key_name.to_string()],
            start_time,
            end_time,
            remove_outliers: false, // 我们要检测异常，所以不预先过滤
            outlier_method: "iqr".to_string(),
            custom_filter: None,
            limit: Some(100000), // 大量数据用于分析
            sampling_config: None,
            reference_values: None,
            time_of_day_filter: None,
        };

        let response = db.query_telemetry_data(&params)?;
        Ok(response.data)
    }

    /// 检测突然跳跃
    fn detect_sudden_jumps(&self, data: &[TelemetryData]) -> Result<Vec<DetectedAnomaly>> {
        let mut anomalies = Vec::new();
        
        if data.len() < self.config.min_window_size {
            return Ok(anomalies);
        }

        let values: Vec<f64> = data.iter().map(|d| d.value).collect();
        
        // 计算移动窗口的统计信息
        let window_size = self.config.min_window_size;
        
        for i in window_size..values.len() {
            let window = &values[i-window_size..i];
            let mean = window.iter().sum::<f64>() / window.len() as f64;
            let variance = window.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / window.len() as f64;
            let std_dev = variance.sqrt();
            
            let current_value = values[i];
            let z_score = (current_value - mean) / std_dev;
            
            // 检测突然跳跃
            if z_score.abs() > self.config.max_jump_threshold {
                let confidence = (z_score.abs() / self.config.max_jump_threshold).min(1.0);
                
                anomalies.push(DetectedAnomaly {
                    target_name: data[i].target_name.clone(),
                    key_name: data[i].key_name.clone(),
                    anomaly_type: AnomalyType::SuddenJump,
                    start_time: data[i].timestamp,
                    end_time: None,
                    baseline_value: mean,
                    anomaly_value: current_value,
                    jump_magnitude: z_score.abs(),
                    confidence,
                    suggested_correction: None,
                });
            }
        }

        Ok(anomalies)
    }

    /// 检测持续偏移
    fn detect_persistent_offsets(&self, _data: &[TelemetryData]) -> Result<Vec<DetectedAnomaly>> {
        let anomalies = Vec::new();
        
        // 实现持续偏移检测逻辑
        // 这里可以使用CUSUM算法或类似的变化点检测方法
        
        Ok(anomalies)
    }

    /// 检测噪声增加
    fn detect_increased_noise(&self, _data: &[TelemetryData]) -> Result<Vec<DetectedAnomaly>> {
        let anomalies = Vec::new();
        
        // 实现噪声增加检测逻辑
        // 比较不同时间窗口的方差
        
        Ok(anomalies)
    }

    /// 检测数据缺失
    fn detect_data_gaps(&self, data: &[TelemetryData]) -> Result<Vec<DetectedAnomaly>> {
        let mut anomalies = Vec::new();
        
        // 检测时间间隔异常大的情况
        for i in 1..data.len() {
            let time_diff = data[i].timestamp.timestamp_millis() - data[i-1].timestamp.timestamp_millis();
            
            // 如果时间间隔超过预期（比如超过1小时），认为是数据缺失
            if time_diff > 3600000 { // 1小时
                anomalies.push(DetectedAnomaly {
                    target_name: data[i].target_name.clone(),
                    key_name: data[i].key_name.clone(),
                    anomaly_type: AnomalyType::DataGap,
                    start_time: data[i-1].timestamp,
                    end_time: Some(data[i].timestamp),
                    baseline_value: data[i-1].value,
                    anomaly_value: data[i].value,
                    jump_magnitude: 0.0,
                    confidence: 1.0,
                    suggested_correction: None,
                });
            }
        }
        
        Ok(anomalies)
    }

    /// 获取所有标靶和指标组合
    async fn get_all_target_key_combinations(&self, _db: &DatabaseManager) -> Result<Vec<(String, String)>> {
        use crate::database::QueryParams;

        // 获取所有唯一的target_name和key_name组合
        let _params = QueryParams {
            asset_name: None,
            device_name: None,
            target_names: vec![],
            key_names: vec![],
            start_time: None,
            end_time: None,
            remove_outliers: false,
            outlier_method: "iqr".to_string(),
            custom_filter: None,
            limit: Some(1), // 只需要获取组合，不需要实际数据
            sampling_config: None,
            reference_values: None,
            time_of_day_filter: None,
        };

        // 这里需要一个专门的方法来获取所有target_name和key_name组合
        // 暂时返回一些示例数据，实际应该查询数据库
        let combinations = vec![
            ("Target1".to_string(), "displacement_x".to_string()),
            ("Target1".to_string(), "displacement_y".to_string()),
            ("Target2".to_string(), "displacement_x".to_string()),
            ("Target2".to_string(), "displacement_y".to_string()),
        ];

        Ok(combinations)
    }

    /// 生成纠正操作建议
    fn generate_correction_operation(&self, anomaly: &DetectedAnomaly) -> Option<DataOperation> {
        if !self.config.auto_correction {
            return None;
        }

        match anomaly.anomaly_type {
            AnomalyType::SuddenJump => {
                // 对于突然跳跃，建议添加偏移纠正
                let correction_value = anomaly.baseline_value - anomaly.anomaly_value;
                
                Some(DataOperation {
                    id: None,
                    name: Some(format!("自动纠正-突变-{}-{}", anomaly.target_name, anomaly.key_name)),
                    description: Some(format!(
                        "检测到突变，从 {:.3} 跳跃到 {:.3}，建议纠正 {:.3}",
                        anomaly.baseline_value, anomaly.anomaly_value, correction_value
                    )),
                    target_name: anomaly.target_name.clone(),
                    key_name: anomaly.key_name.clone(),
                    operation_type: OperationType::Offset,
                    value: correction_value,
                    start_time: Some(anomaly.start_time),
                    end_time: anomaly.end_time,
                    is_active: false, // 默认不激活，需要用户确认
                    created_at: Utc::now(),
                    updated_at: Utc::now(),
                })
            },
            _ => None, // 其他类型的异常暂时不自动生成纠正操作
        }
    }

    /// 生成检测摘要
    fn generate_summary(
        &self,
        anomalies: &[DetectedAnomaly],
        start_time: Option<DateTime<Utc>>,
        end_time: Option<DateTime<Utc>>,
    ) -> AnomalyDetectionSummary {
        let mut targets_affected = std::collections::HashSet::new();
        let mut confidence_distribution = HashMap::new();

        for anomaly in anomalies {
            targets_affected.insert(anomaly.target_name.clone());
            
            let confidence_level = if anomaly.confidence > 0.8 {
                "高"
            } else if anomaly.confidence > 0.5 {
                "中"
            } else {
                "低"
            };
            
            *confidence_distribution.entry(confidence_level.to_string()).or_insert(0) += 1;
        }

        let time_range = (
            start_time.unwrap_or_else(|| Utc::now()),
            end_time.unwrap_or_else(|| Utc::now()),
        );

        AnomalyDetectionSummary {
            total_anomalies: anomalies.len(),
            targets_affected: targets_affected.len(),
            time_range_analyzed: time_range,
            confidence_distribution,
        }
    }
}
