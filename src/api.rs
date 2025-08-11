use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::Json,
    routing::get,
    Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use std::sync::Arc;

use crate::database::{DatabaseManager, FilterOptions, QueryParams, TelemetryResponse, CustomFilter, SamplingConfig, SamplingMethod, ReferenceValue, TimeOfDayFilter, TimeRange};

pub type AppState = Arc<DatabaseManager>;

#[derive(Debug, Deserialize)]
pub struct FilterQuery {
    asset_name: Option<String>,
    device_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TelemetryQuery {
    asset_name: Option<String>,
    device_name: Option<String>,
    target_names: Option<String>, // 逗号分隔的字符串
    key_names: Option<String>, // 改为支持多个数据类型，逗号分隔
    start_time: Option<String>,
    end_time: Option<String>,
    remove_outliers: Option<bool>, // 是否去除异常值
    outlier_method: Option<String>, // 异常值检测方法: "iqr" 或 "zscore"
    min_value: Option<f64>, // 最小值过滤
    max_value: Option<f64>, // 最大值过滤
    exclude_values: Option<String>, // 排除的值，逗号分隔
    limit: Option<usize>, // 限制返回数据量
    sampling_interval: Option<i64>, // 采样间隔（毫秒）
    sampling_method: Option<String>, // 采样方法: "first", "last", "avg", "max", "min"
    reference_values: Option<String>, // 参考值配置，JSON格式
    time_ranges: Option<String>, // 时间段配置，JSON格式: [{"start":"HH:MM","end":"HH:MM"}]
}

#[derive(Debug, Serialize)]
pub struct ApiResponse<T> {
    success: bool,
    data: Option<T>,
    error: Option<String>,
}

impl<T> ApiResponse<T> {
    pub fn success(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
        }
    }

    pub fn error(error: String) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(error),
        }
    }
}

pub fn create_router(db_manager: DatabaseManager) -> Router {
    let state = Arc::new(db_manager);
    
    Router::new()
        .route("/api/filters", get(get_filter_options))
        .route("/api/devices", get(get_devices_by_asset))
        .route("/api/targets", get(get_targets_by_device))
        .route("/api/telemetry", get(get_telemetry_data))
        .with_state(state)
}

async fn get_filter_options(
    State(db): State<AppState>,
) -> Result<Json<ApiResponse<FilterOptions>>, StatusCode> {
    match db.get_filter_options() {
        Ok(options) => Ok(Json(ApiResponse::success(options))),
        Err(e) => {
            eprintln!("Error getting filter options: {}", e);
            Ok(Json(ApiResponse::error(format!("Database error: {}", e))))
        }
    }
}

async fn get_devices_by_asset(
    State(db): State<AppState>,
    Query(params): Query<FilterQuery>,
) -> Result<Json<ApiResponse<Vec<String>>>, StatusCode> {
    let asset_name = match params.asset_name {
        Some(name) => name,
        None => return Ok(Json(ApiResponse::error("asset_name parameter is required".to_string()))),
    };

    match db.get_devices_by_asset(&asset_name) {
        Ok(devices) => Ok(Json(ApiResponse::success(devices))),
        Err(e) => {
            eprintln!("Error getting devices: {}", e);
            Ok(Json(ApiResponse::error(format!("Database error: {}", e))))
        }
    }
}

async fn get_targets_by_device(
    State(db): State<AppState>,
    Query(params): Query<FilterQuery>,
) -> Result<Json<ApiResponse<Vec<String>>>, StatusCode> {
    let asset_name = match params.asset_name {
        Some(name) => name,
        None => return Ok(Json(ApiResponse::error("asset_name parameter is required".to_string()))),
    };

    let device_name = match params.device_name {
        Some(name) => name,
        None => return Ok(Json(ApiResponse::error("device_name parameter is required".to_string()))),
    };

    match db.get_targets_by_device(&asset_name, &device_name) {
        Ok(targets) => Ok(Json(ApiResponse::success(targets))),
        Err(e) => {
            eprintln!("Error getting targets: {}", e);
            Ok(Json(ApiResponse::error(format!("Database error: {}", e))))
        }
    }
}

async fn get_telemetry_data(
    State(db): State<AppState>,
    Query(params): Query<TelemetryQuery>,
) -> Result<Json<ApiResponse<TelemetryResponse>>, StatusCode> {
    let target_names = if let Some(targets_str) = params.target_names {
        targets_str.split(',').map(|s| s.trim().to_string()).collect()
    } else {
        Vec::new()
    };

    let key_names = if let Some(keys_str) = params.key_names {
        keys_str.split(',').map(|s| s.trim().to_string()).collect()
    } else {
        Vec::new()
    };

    let start_time = if let Some(time_str) = params.start_time {
        match DateTime::parse_from_rfc3339(&time_str) {
            Ok(dt) => Some(dt.with_timezone(&Utc)),
            Err(_) => return Ok(Json(ApiResponse::error("Invalid start_time format".to_string()))),
        }
    } else {
        None
    };

    let end_time = if let Some(time_str) = params.end_time {
        match DateTime::parse_from_rfc3339(&time_str) {
            Ok(dt) => Some(dt.with_timezone(&Utc)),
            Err(_) => return Ok(Json(ApiResponse::error("Invalid end_time format".to_string()))),
        }
    } else {
        None
    };

    // 解析自定义过滤参数
    let custom_filter = if params.min_value.is_some() || params.max_value.is_some() || params.exclude_values.is_some() {
        let exclude_values = if let Some(exclude_str) = &params.exclude_values {
            exclude_str.split(',')
                .filter_map(|s| s.trim().parse::<f64>().ok())
                .collect()
        } else {
            Vec::new()
        };

        Some(CustomFilter {
            min_value: params.min_value,
            max_value: params.max_value,
            exclude_values,
        })
    } else {
        None
    };

    // 构建采样配置
    let sampling_config = if let Some(interval) = params.sampling_interval {
        let method = match params.sampling_method.as_deref().unwrap_or("first") {
            "last" => SamplingMethod::Last,
            "avg" => SamplingMethod::Avg,
            "max" => SamplingMethod::Max,
            "min" => SamplingMethod::Min,
            _ => SamplingMethod::First,
        };
        Some(SamplingConfig {
            interval_ms: interval,
            method,
        })
    } else {
        None
    };

    // 解析参考值配置
    let reference_values = if let Some(ref_str) = &params.reference_values {
        match serde_json::from_str::<Vec<ReferenceValue>>(ref_str) {
            Ok(refs) => Some(refs),
            Err(_) => {
                return Ok(Json(ApiResponse::error("Invalid reference_values format".to_string())));
            }
        }
    } else {
        None
    };

    // 解析每日时间段过滤
    let time_of_day_filter = if let Some(time_ranges_str) = &params.time_ranges {
        match parse_time_ranges(time_ranges_str) {
            Ok(time_ranges) => {
                if time_ranges.is_empty() {
                    None
                } else {
                    Some(TimeOfDayFilter { time_ranges })
                }
            },
            Err(e) => {
                return Ok(Json(ApiResponse::error(format!("Invalid time ranges format: {}", e))));
            }
        }
    } else {
        None
    };

    let query_params = QueryParams {
        asset_name: params.asset_name,
        device_name: params.device_name,
        target_names,
        key_names,
        start_time,
        end_time,
        remove_outliers: params.remove_outliers.unwrap_or(false),
        outlier_method: params.outlier_method.unwrap_or_else(|| "iqr".to_string()),
        custom_filter,
        limit: params.limit,
        sampling_config,
        reference_values,
        time_of_day_filter,
    };

    match db.query_telemetry_data(&query_params) {
        Ok(data) => Ok(Json(ApiResponse::success(data))),
        Err(e) => {
            eprintln!("Error querying telemetry data: {}", e);
            Ok(Json(ApiResponse::error(format!("Database error: {}", e))))
        }
    }
}

// 解析时间字符串 "HH:MM" 格式
fn parse_time_string(time_str: &str) -> Option<(u8, u8)> {
    let parts: Vec<&str> = time_str.split(':').collect();
    if parts.len() != 2 {
        return None;
    }

    let hour = parts[0].parse::<u8>().ok()?;
    let minute = parts[1].parse::<u8>().ok()?;

    if hour > 23 || minute > 59 {
        return None;
    }

    Some((hour, minute))
}

// 解析时间段数组 JSON格式
fn parse_time_ranges(time_ranges_str: &str) -> Result<Vec<TimeRange>, String> {
    #[derive(serde::Deserialize)]
    struct TimeRangeInput {
        start: String,
        end: String,
    }

    let input_ranges: Vec<TimeRangeInput> = serde_json::from_str(time_ranges_str)
        .map_err(|e| format!("JSON parse error: {}", e))?;

    let mut time_ranges = Vec::new();

    for input_range in input_ranges {
        let (start_hour, start_minute) = parse_time_string(&input_range.start)
            .ok_or_else(|| format!("Invalid start time format: {}", input_range.start))?;
        let (end_hour, end_minute) = parse_time_string(&input_range.end)
            .ok_or_else(|| format!("Invalid end time format: {}", input_range.end))?;

        time_ranges.push(TimeRange {
            start_hour,
            start_minute,
            end_hour,
            end_minute,
        });
    }

    Ok(time_ranges)
}
