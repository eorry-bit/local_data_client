use anyhow::Result;
use chrono::{DateTime, Utc};
use duckdb::{Connection, Result as DuckResult};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelemetryData {
    pub timestamp: DateTime<Utc>,
    pub asset_name: String,
    pub device_name: String,
    pub target_name: String,
    pub key_name: String,
    pub value: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelemetryResponse {
    pub data: Vec<TelemetryData>,
    pub stats: DataStats,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataStats {
    pub total_points: usize,
    pub target_count: usize,
    pub time_range: Option<(DateTime<Utc>, DateTime<Utc>)>,
    pub outliers_removed: Option<usize>,
    pub outlier_method: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterOptions {
    pub assets: Vec<String>,
    pub devices: Vec<String>,
    pub targets: Vec<String>,
    pub key_names: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryParams {
    pub asset_name: Option<String>,
    pub device_name: Option<String>,
    pub target_names: Vec<String>,
    pub key_names: Vec<String>, // 改为支持多个数据类型
    pub start_time: Option<DateTime<Utc>>,
    pub end_time: Option<DateTime<Utc>>,
    pub remove_outliers: bool,
    pub outlier_method: String,
    pub custom_filter: Option<CustomFilter>,
    pub limit: Option<usize>, // 限制返回数据量
    pub sampling_config: Option<SamplingConfig>, // 采样配置
    pub reference_values: Option<Vec<ReferenceValue>>, // 参考值配置
    pub time_of_day_filter: Option<TimeOfDayFilter>, // 每日时间段过滤
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeOfDayFilter {
    pub time_ranges: Vec<TimeRange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimeRange {
    pub start_hour: u8,    // 开始小时 (0-23)
    pub start_minute: u8,  // 开始分钟 (0-59)
    pub end_hour: u8,      // 结束小时 (0-23)
    pub end_minute: u8,    // 结束分钟 (0-59)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReferenceValue {
    pub target_name: String,
    pub key_name: String,
    pub reference_value: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SamplingConfig {
    pub interval_ms: i64, // 采样间隔（毫秒）
    pub method: SamplingMethod, // 采样方法
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SamplingMethod {
    First,  // 取时间窗口内第一个值
    Last,   // 取时间窗口内最后一个值
    Avg,    // 取时间窗口内平均值
    Max,    // 取时间窗口内最大值
    Min,    // 取时间窗口内最小值
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomFilter {
    pub min_value: Option<f64>,
    pub max_value: Option<f64>,
    pub exclude_values: Vec<f64>, // 排除特定值
}

pub struct DatabaseManager {
    connection: Arc<Mutex<Connection>>,
}

impl DatabaseManager {
    pub fn new(db_path: &str) -> Result<Self> {
        let conn = Connection::open(db_path)?;
        Ok(DatabaseManager {
            connection: Arc::new(Mutex::new(conn)),
        })
    }

    pub fn get_filter_options(&self) -> Result<FilterOptions> {
        let conn = self.connection.lock().unwrap();

        // 获取所有资产名称
        let mut stmt = conn.prepare("SELECT DISTINCT asset_name FROM a_d_t_telemetry ORDER BY asset_name")?;
        let assets: Vec<String> = stmt.query_map([], |row| {
            Ok(row.get::<_, String>(0)?)
        })?.collect::<DuckResult<Vec<_>>>()?;

        // 获取所有设备名称 (使用d_name字段)
        let mut stmt = conn.prepare("SELECT DISTINCT d_name FROM a_d_t_telemetry ORDER BY d_name")?;
        let devices: Vec<String> = stmt.query_map([], |row| {
            Ok(row.get::<_, String>(0)?)
        })?.collect::<DuckResult<Vec<_>>>()?;

        // 获取所有标靶名称
        let mut stmt = conn.prepare("SELECT DISTINCT target_name FROM a_d_t_telemetry ORDER BY target_name")?;
        let targets: Vec<String> = stmt.query_map([], |row| {
            Ok(row.get::<_, String>(0)?)
        })?.collect::<DuckResult<Vec<_>>>()?;

        // 获取所有key_name
        let mut stmt = conn.prepare("SELECT DISTINCT key_name FROM a_d_t_telemetry ORDER BY key_name")?;
        let key_names: Vec<String> = stmt.query_map([], |row| {
            Ok(row.get::<_, String>(0)?)
        })?.collect::<DuckResult<Vec<_>>>()?;

        Ok(FilterOptions {
            assets,
            devices,
            targets,
            key_names,
        })
    }

    pub fn get_devices_by_asset(&self, asset_name: &str) -> Result<Vec<String>> {
        let conn = self.connection.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT DISTINCT d_name FROM a_d_t_telemetry WHERE asset_name = ? ORDER BY d_name"
        )?;
        let devices: Vec<String> = stmt.query_map([asset_name], |row| {
            Ok(row.get::<_, String>(0)?)
        })?.collect::<DuckResult<Vec<_>>>()?;
        Ok(devices)
    }

    pub fn get_targets_by_device(&self, asset_name: &str, device_name: &str) -> Result<Vec<String>> {
        let conn = self.connection.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT DISTINCT target_name FROM a_d_t_telemetry WHERE asset_name = ? AND d_name = ? ORDER BY target_name"
        )?;
        let targets: Vec<String> = stmt.query_map([asset_name, device_name], |row| {
            Ok(row.get::<_, String>(0)?)
        })?.collect::<DuckResult<Vec<_>>>()?;
        Ok(targets)
    }

    pub fn query_telemetry_data(&self, params: &QueryParams) -> Result<TelemetryResponse> {
        let conn = self.connection.lock().unwrap();

        // 如果需要异常值统计，先获取原始数据量
        let original_count = if params.remove_outliers {
            Some(self.get_filtered_count(params, false)?)
        } else {
            None
        };

        // 构建查询（包含异常值过滤）
        let (query, bind_params) = self.build_complete_query(params);

        // 执行查询
        let mut stmt = conn.prepare(&query)?;
        let mut rows = if bind_params.is_empty() {
            stmt.query([])?
        } else {
            let params_refs: Vec<&dyn duckdb::ToSql> = bind_params.iter().map(|p| p.as_ref()).collect();
            stmt.query(params_refs.as_slice())?
        };

        let mut data = Vec::new();
        while let Some(row) = rows.next()? {
            let ts_millis: i64 = row.get(0)?;
            let timestamp = DateTime::from_timestamp_millis(ts_millis)
                .ok_or_else(|| anyhow::anyhow!("Invalid timestamp: {}", ts_millis))?;

            // 处理可能为NULL的dbl_v字段
            let value: Option<f64> = row.get(5)?;
            if let Some(val) = value {
                data.push(TelemetryData {
                    timestamp,
                    asset_name: row.get(1)?,
                    device_name: row.get(2)?,
                    target_name: row.get(3)?,
                    key_name: row.get(4)?,
                    value: val,
                });
            }
            // 如果value为NULL，跳过这条记录
        }

        // 计算统计信息
        let stats = self.calculate_stats(&data, params, original_count)?;

        Ok(TelemetryResponse { data, stats })
    }

    fn build_complete_query(&self, params: &QueryParams) -> (String, Vec<Box<dyn duckdb::ToSql>>) {
        let mut bind_params: Vec<Box<dyn duckdb::ToSql>> = Vec::new();

        if params.remove_outliers {
            // 异常值过滤查询已经包含了所有筛选条件
            let mut query = self.build_outlier_filtered_query_with_conditions(params);

            // 添加参数绑定（顺序要与查询中的?占位符一致）
            self.add_basic_params(&mut bind_params, params);

            // 添加自定义过滤条件
            if let Some(custom_filter) = &params.custom_filter {
                let (custom_conditions, custom_params) = self.build_custom_filter_conditions(custom_filter);
                if !custom_conditions.is_empty() {
                    query = format!("SELECT * FROM ({}) filtered WHERE {}", query, custom_conditions.join(" AND "));
                    bind_params.extend(custom_params);
                }
            }

            let final_query = self.apply_sampling_and_limit(&query, params);
            (final_query, bind_params)
        } else {
            // 普通查询
            let mut query = "SELECT ts, asset_name, d_name, target_name, key_name, dbl_v FROM a_d_t_telemetry".to_string();
            let mut where_conditions = Vec::new();

            // 添加基础筛选条件
            self.add_basic_conditions(&mut where_conditions, &mut bind_params, params);

            // 添加自定义过滤条件
            if let Some(custom_filter) = &params.custom_filter {
                let (custom_conditions, custom_params) = self.build_custom_filter_conditions(custom_filter);
                where_conditions.extend(custom_conditions);
                bind_params.extend(custom_params);
            }

            if !where_conditions.is_empty() {
                query.push_str(&format!(" WHERE {}", where_conditions.join(" AND ")));
            }

            let final_query = self.apply_sampling_and_limit(&query, params);
            (final_query, bind_params)
        }
    }

    fn add_basic_params(&self, bind_params: &mut Vec<Box<dyn duckdb::ToSql>>, params: &QueryParams) {
        if let Some(asset) = &params.asset_name {
            bind_params.push(Box::new(asset.clone()));
        }
        if let Some(device) = &params.device_name {
            bind_params.push(Box::new(device.clone()));
        }
        for target in &params.target_names {
            bind_params.push(Box::new(target.clone()));
        }
        for key_name in &params.key_names {
            bind_params.push(Box::new(key_name.clone()));
        }
        if let Some(start_time) = &params.start_time {
            bind_params.push(Box::new(start_time.timestamp_millis()));
        }
        if let Some(end_time) = &params.end_time {
            bind_params.push(Box::new(end_time.timestamp_millis()));
        }
    }

    fn add_basic_conditions(&self, conditions: &mut Vec<String>, bind_params: &mut Vec<Box<dyn duckdb::ToSql>>, params: &QueryParams) {
        if let Some(asset) = &params.asset_name {
            conditions.push("asset_name = ?".to_string());
            bind_params.push(Box::new(asset.clone()));
        }
        if let Some(device) = &params.device_name {
            conditions.push("d_name = ?".to_string());
            bind_params.push(Box::new(device.clone()));
        }
        if !params.target_names.is_empty() {
            let placeholders = params.target_names.iter().map(|_| "?").collect::<Vec<_>>().join(",");
            conditions.push(format!("target_name IN ({})", placeholders));
            for target in &params.target_names {
                bind_params.push(Box::new(target.clone()));
            }
        }
        if !params.key_names.is_empty() {
            let placeholders = params.key_names.iter().map(|_| "?").collect::<Vec<_>>().join(",");
            conditions.push(format!("key_name IN ({})", placeholders));
            for key_name in &params.key_names {
                bind_params.push(Box::new(key_name.clone()));
            }
        }
        if let Some(start_time) = &params.start_time {
            conditions.push("ts >= ?".to_string());
            bind_params.push(Box::new(start_time.timestamp_millis()));
        }
        if let Some(end_time) = &params.end_time {
            conditions.push("ts <= ?".to_string());
            bind_params.push(Box::new(end_time.timestamp_millis()));
        }
    }

    fn build_custom_filter_conditions(&self, custom_filter: &CustomFilter) -> (Vec<String>, Vec<Box<dyn duckdb::ToSql>>) {
        let mut conditions = Vec::new();
        let mut params = Vec::new();

        if let Some(min_val) = custom_filter.min_value {
            conditions.push("dbl_v >= ?".to_string());
            params.push(Box::new(min_val) as Box<dyn duckdb::ToSql>);
        }

        if let Some(max_val) = custom_filter.max_value {
            conditions.push("dbl_v <= ?".to_string());
            params.push(Box::new(max_val) as Box<dyn duckdb::ToSql>);
        }

        if !custom_filter.exclude_values.is_empty() {
            let placeholders = custom_filter.exclude_values.iter().map(|_| "?").collect::<Vec<_>>().join(",");
            conditions.push(format!("dbl_v NOT IN ({})", placeholders));
            for val in &custom_filter.exclude_values {
                params.push(Box::new(*val) as Box<dyn duckdb::ToSql>);
            }
        }

        (conditions, params)
    }

    fn calculate_stats(&self, data: &[TelemetryData], params: &QueryParams, original_count: Option<usize>) -> Result<DataStats> {
        let total_points = data.len();

        // 计算唯一标靶数量
        let mut targets = std::collections::HashSet::new();
        for item in data {
            targets.insert(&item.target_name);
        }
        let target_count = targets.len();

        // 计算时间范围
        let time_range = if !data.is_empty() {
            let min_time = data.iter().map(|d| d.timestamp).min().unwrap();
            let max_time = data.iter().map(|d| d.timestamp).max().unwrap();
            Some((min_time, max_time))
        } else {
            None
        };

        // 如果启用了异常值过滤，计算移除的异常值数量
        let (outliers_removed, outlier_method) = if params.remove_outliers {
            if let Some(orig_count) = original_count {
                let removed = orig_count.saturating_sub(total_points);
                (Some(removed), Some(params.outlier_method.clone()))
            } else {
                (Some(0), Some(params.outlier_method.clone()))
            }
        } else {
            (None, None)
        };

        Ok(DataStats {
            total_points,
            target_count,
            time_range,
            outliers_removed,
            outlier_method,
        })
    }

    fn get_filtered_count(&self, params: &QueryParams, include_outlier_filter: bool) -> Result<usize> {
        let conn = self.connection.lock().unwrap();

        // 简化计数查询 - 直接计算基础筛选条件的数量，不进行复杂的异常值计算
        let base_query = "SELECT COUNT(*) FROM a_d_t_telemetry WHERE 1=1".to_string();

        let mut query = base_query;
        let mut bind_params: Vec<Box<dyn duckdb::ToSql>> = Vec::new();

        // 添加相同的过滤条件（除了异常值过滤）
        if let Some(asset) = &params.asset_name {
            query.push_str(" AND asset_name = ?");
            bind_params.push(Box::new(asset.clone()));
        }

        if let Some(device) = &params.device_name {
            query.push_str(" AND d_name = ?");
            bind_params.push(Box::new(device.clone()));
        }

        if !params.target_names.is_empty() {
            let placeholders = params.target_names.iter().map(|_| "?").collect::<Vec<_>>().join(",");
            query.push_str(&format!(" AND target_name IN ({})", placeholders));
            for target in &params.target_names {
                bind_params.push(Box::new(target.clone()));
            }
        }

        if !params.key_names.is_empty() {
            let placeholders = params.key_names.iter().map(|_| "?").collect::<Vec<_>>().join(",");
            query.push_str(&format!(" AND key_name IN ({})", placeholders));
            for key_name in &params.key_names {
                bind_params.push(Box::new(key_name.clone()));
            }
        }

        if let Some(start_time) = &params.start_time {
            let start_ts = start_time.timestamp_millis();
            query.push_str(" AND ts >= ?");
            bind_params.push(Box::new(start_ts));
        }

        if let Some(end_time) = &params.end_time {
            let end_ts = end_time.timestamp_millis();
            query.push_str(" AND ts <= ?");
            bind_params.push(Box::new(end_ts));
        }

        let mut stmt = conn.prepare(&query)?;
        let mut rows = if bind_params.is_empty() {
            stmt.query([])?
        } else {
            let params_refs: Vec<&dyn duckdb::ToSql> = bind_params.iter().map(|p| p.as_ref()).collect();
            stmt.query(params_refs.as_slice())?
        };

        if let Some(row) = rows.next()? {
            let count: i64 = row.get(0)?;
            Ok(count as usize)
        } else {
            Ok(0)
        }
    }

    fn build_outlier_filtered_query_with_conditions(&self, params: &QueryParams) -> String {
        // 构建基础筛选条件，用于优化统计计算范围
        let mut base_conditions = Vec::new();

        if params.asset_name.is_some() {
            base_conditions.push("asset_name = ?".to_string());
        }
        if params.device_name.is_some() {
            base_conditions.push("d_name = ?".to_string());
        }
        if !params.target_names.is_empty() {
            let placeholders = params.target_names.iter().map(|_| "?").collect::<Vec<_>>().join(",");
            base_conditions.push(format!("target_name IN ({})", placeholders));
        }
        if !params.key_names.is_empty() {
            let placeholders = params.key_names.iter().map(|_| "?").collect::<Vec<_>>().join(",");
            base_conditions.push(format!("key_name IN ({})", placeholders));
        }
        if params.start_time.is_some() {
            base_conditions.push("ts >= ?".to_string());
        }
        if params.end_time.is_some() {
            base_conditions.push("ts <= ?".to_string());
        }

        let where_clause = if base_conditions.is_empty() {
            "".to_string()
        } else {
            format!("WHERE {}", base_conditions.join(" AND "))
        };

        match params.outlier_method.as_str() {
            "zscore" => {
                // 优化的Z-Score方法：先筛选再计算统计值
                format!(
                    "WITH base_data AS (
                        SELECT ts, asset_name, d_name, target_name, key_name, dbl_v
                        FROM a_d_t_telemetry
                        {}
                    ),
                    stats AS (
                        SELECT
                            AVG(dbl_v) as mean_val,
                            STDDEV(dbl_v) as std_val
                        FROM base_data
                    )
                    SELECT b.ts, b.asset_name, b.d_name, b.target_name, b.key_name, b.dbl_v
                    FROM base_data b, stats s
                    WHERE ABS(b.dbl_v - s.mean_val) / NULLIF(s.std_val, 0) <= 3.0",
                    where_clause
                )
            },
            _ => {
                // 优化的IQR方法：先筛选再计算四分位数
                format!(
                    "WITH base_data AS (
                        SELECT ts, asset_name, d_name, target_name, key_name, dbl_v
                        FROM a_d_t_telemetry
                        {}
                    ),
                    quartiles AS (
                        SELECT
                            PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY dbl_v) as q1,
                            PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY dbl_v) as q3
                        FROM base_data
                    ),
                    bounds AS (
                        SELECT
                            q1 - 1.5 * (q3 - q1) as lower_bound,
                            q3 + 1.5 * (q3 - q1) as upper_bound
                        FROM quartiles
                    )
                    SELECT b.ts, b.asset_name, b.d_name, b.target_name, b.key_name, b.dbl_v
                    FROM base_data b, bounds bo
                    WHERE b.dbl_v >= bo.lower_bound AND b.dbl_v <= bo.upper_bound",
                    where_clause
                )
            }
        }
    }

    fn apply_sampling_and_limit(&self, base_query: &str, params: &QueryParams) -> String {
        let mut query = base_query.to_string();

        // 如果设置了参考值，应用参考值减法
        if let Some(ref_values) = &params.reference_values {
            query = self.apply_reference_values(&query, ref_values);
        }

        // 如果设置了每日时间段过滤，应用时间段过滤
        if let Some(time_filter) = &params.time_of_day_filter {
            query = self.apply_time_of_day_filter(&query, time_filter);
        }

        // 如果设置了采样配置，使用时间窗口采样
        if let Some(sampling_config) = &params.sampling_config {
            let interval_ms = sampling_config.interval_ms;

            // 使用DuckDB原生聚合函数，统一处理所有采样方法
            let (aggregation_func, _ts_func) = match sampling_config.method {
                SamplingMethod::First => ("FIRST(dbl_v ORDER BY ts)", "MIN(ts)"),
                SamplingMethod::Last => ("LAST(dbl_v ORDER BY ts)", "MAX(ts)"),
                SamplingMethod::Avg => ("AVG(dbl_v)", "MIN(ts)"),
                SamplingMethod::Max => ("MAX(dbl_v)", "MIN(ts)"),
                SamplingMethod::Min => ("MIN(dbl_v)", "MIN(ts)"),
            };

            // 使用简化的时间分组策略，直接基于毫秒时间戳
            let time_bucket_expr = format!(
                "FLOOR(ts / {}) * {}",
                interval_ms, interval_ms
            );

            query = format!(
                "WITH time_bucketed AS (
                    SELECT *,
                           {} as time_bucket
                    FROM ({}) base
                    WHERE dbl_v IS NOT NULL
                )
                SELECT
                    MIN(time_bucket) as ts,
                    FIRST(asset_name ORDER BY ts) as asset_name,
                    FIRST(d_name ORDER BY ts) as d_name,
                    target_name,
                    key_name,
                    {} as dbl_v
                FROM time_bucketed
                GROUP BY target_name, key_name, time_bucket
                HAVING COUNT(*) > 0
                ORDER BY ts",
                time_bucket_expr, query, aggregation_func
            );
        }

        // 如果设置了限制，添加LIMIT子句
        if let Some(limit) = params.limit {
            query = format!("SELECT * FROM ({}) limited LIMIT {}", query, limit);
        }

        // 确保有ORDER BY子句
        if !query.to_lowercase().contains("order by") {
            query.push_str(" ORDER BY ts");
        }

        query
    }

    fn apply_reference_values(&self, base_query: &str, reference_values: &[ReferenceValue]) -> String {
        // 构建参考值的CASE WHEN语句
        let mut case_when_parts = Vec::new();

        for ref_val in reference_values {
            case_when_parts.push(format!(
                "WHEN target_name = '{}' AND key_name = '{}' THEN dbl_v - {}",
                ref_val.target_name.replace("'", "''"), // 转义单引号
                ref_val.key_name.replace("'", "''"),
                ref_val.reference_value
            ));
        }

        if case_when_parts.is_empty() {
            return base_query.to_string();
        }

        let case_when_clause = format!(
            "CASE {} ELSE dbl_v END",
            case_when_parts.join(" ")
        );

        // 将原查询包装，应用参考值减法
        format!(
            "SELECT
                ts,
                asset_name,
                d_name,
                target_name,
                key_name,
                {} as dbl_v
            FROM ({}) base",
            case_when_clause, base_query
        )
    }

    fn apply_time_of_day_filter(&self, base_query: &str, time_filter: &TimeOfDayFilter) -> String {
        if time_filter.time_ranges.is_empty() {
            return base_query.to_string();
        }

        let mut conditions = Vec::new();

        for range in &time_filter.time_ranges {
            let start_minutes = range.start_hour as u32 * 60 + range.start_minute as u32;
            let end_minutes = range.end_hour as u32 * 60 + range.end_minute as u32;

            let condition = if start_minutes <= end_minutes {
                // 正常情况：如 09:00 到 12:00
                format!(
                    "(EXTRACT(hour FROM to_timestamp(ts / 1000)) * 60 + EXTRACT(minute FROM to_timestamp(ts / 1000))) BETWEEN {} AND {}",
                    start_minutes, end_minutes
                )
            } else {
                // 跨午夜情况：如 22:00 到 06:00
                format!(
                    "((EXTRACT(hour FROM to_timestamp(ts / 1000)) * 60 + EXTRACT(minute FROM to_timestamp(ts / 1000))) >= {} OR (EXTRACT(hour FROM to_timestamp(ts / 1000)) * 60 + EXTRACT(minute FROM to_timestamp(ts / 1000))) <= {})",
                    start_minutes, end_minutes
                )
            };

            conditions.push(condition);
        }

        format!(
            "SELECT ts, asset_name, d_name, target_name, key_name, dbl_v
            FROM ({}) base
            WHERE {}",
            base_query,
            conditions.join(" OR ")
        )
    }
}
