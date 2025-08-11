use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{Json, sse::{Event, Sse}},
    routing::{get, post, put, delete},
    Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use futures::stream::Stream;
use std::convert::Infallible;
use tokio_stream::StreamExt;

use crate::database::{DatabaseManager, FilterOptions, QueryParams, TelemetryResponse, CustomFilter, SamplingConfig, SamplingMethod, ReferenceValue, TimeOfDayFilter, TimeRange, DataOperation, OperationType};

pub type AppState = Arc<DatabaseManager>;

#[derive(Debug, Deserialize)]
pub struct FilterQuery {
    asset_name: Option<String>,
    device_name: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateOperationRequest {
    pub name: Option<String>,  // 可选，不填则自动生成
    pub description: Option<String>,
    pub target_name: String,
    pub key_name: String,
    pub operation_type: String, // "add", "subtract", "multiply", "divide"
    pub value: f64,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateOperationRequest {
    pub id: i64,
    pub name: Option<String>,
    pub description: Option<String>,
    pub target_name: String,
    pub key_name: String,
    pub operation_type: String,
    pub value: f64,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub is_active: bool,
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
        .route("/api/telemetry/stream", get(get_telemetry_data_stream))
        .route("/api/operations", get(get_operations).post(create_operation))
        .route("/api/operations/export", get(export_operations))
        .route("/api/operations/import", post(import_operations))
        .route("/api/operations/:id", put(update_operation).delete(delete_operation))
        .route("/api/operations/:id/toggle", post(toggle_operation))
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

async fn get_operations(
    State(db): State<AppState>,
) -> Result<Json<ApiResponse<Vec<DataOperation>>>, StatusCode> {
    match db.get_operations(false) {
        Ok(operations) => Ok(Json(ApiResponse::success(operations))),
        Err(e) => {
            eprintln!("Error getting operations: {}", e);
            Ok(Json(ApiResponse::error(format!("Database error: {}", e))))
        }
    }
}

async fn create_operation(
    State(db): State<AppState>,
    Json(request): Json<CreateOperationRequest>,
) -> Result<Json<ApiResponse<i64>>, StatusCode> {
    let operation_type = match OperationType::from_str(&request.operation_type) {
        Some(op_type) => op_type,
        None => return Ok(Json(ApiResponse::error(format!("Invalid operation type: {}", request.operation_type))))
    };

    let start_time = if let Some(time_str) = request.start_time {
        match DateTime::parse_from_rfc3339(&time_str) {
            Ok(dt) => Some(dt.with_timezone(&Utc)),
            Err(_) => return Ok(Json(ApiResponse::error("Invalid start_time format".to_string()))),
        }
    } else {
        None
    };

    let end_time = if let Some(time_str) = request.end_time {
        match DateTime::parse_from_rfc3339(&time_str) {
            Ok(dt) => Some(dt.with_timezone(&Utc)),
            Err(_) => return Ok(Json(ApiResponse::error("Invalid end_time format".to_string()))),
        }
    } else {
        None
    };

    let now = Utc::now();
    
    // 自动生成默认名称（如果未提供）
    let name = request.name.or_else(|| {
        let op_symbol = match &operation_type {
            OperationType::Add => "+",
            OperationType::Subtract => "-",
            OperationType::Multiply => "×",
            OperationType::Divide => "÷",
        };
        Some(format!("{} {} {}", request.key_name, op_symbol, request.value))
    });
    
    let operation = DataOperation {
        id: None,
        name,
        description: request.description,
        target_name: request.target_name,
        key_name: request.key_name,
        operation_type,
        value: request.value,
        start_time,
        end_time,
        is_active: true,
        created_at: now,
        updated_at: now,
    };

    match db.create_operation(&operation) {
        Ok(id) => Ok(Json(ApiResponse::success(id))),
        Err(e) => {
            eprintln!("Error creating operation: {}", e);
            Ok(Json(ApiResponse::error(format!("Database error: {}", e))))
        }
    }
}

async fn update_operation(
    State(db): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<i64>,
    Json(request): Json<UpdateOperationRequest>,
) -> Result<Json<ApiResponse<()>>, StatusCode> {
    let operation_type = match OperationType::from_str(&request.operation_type) {
        Some(op_type) => op_type,
        None => return Ok(Json(ApiResponse::error(format!("Invalid operation type: {}", request.operation_type))))
    };

    let start_time = if let Some(time_str) = request.start_time {
        match DateTime::parse_from_rfc3339(&time_str) {
            Ok(dt) => Some(dt.with_timezone(&Utc)),
            Err(_) => return Ok(Json(ApiResponse::error("Invalid start_time format".to_string()))),
        }
    } else {
        None
    };

    let end_time = if let Some(time_str) = request.end_time {
        match DateTime::parse_from_rfc3339(&time_str) {
            Ok(dt) => Some(dt.with_timezone(&Utc)),
            Err(_) => return Ok(Json(ApiResponse::error("Invalid end_time format".to_string()))),
        }
    } else {
        None
    };

    let operation = DataOperation {
        id: Some(id),
        name: request.name,
        description: request.description,
        target_name: request.target_name,
        key_name: request.key_name,
        operation_type,
        value: request.value,
        start_time,
        end_time,
        is_active: request.is_active,
        created_at: Utc::now(), // This will be ignored in update
        updated_at: Utc::now(),
    };

    match db.update_operation(&operation) {
        Ok(()) => Ok(Json(ApiResponse::success(()))),
        Err(e) => {
            eprintln!("Error updating operation: {}", e);
            Ok(Json(ApiResponse::error(format!("Database error: {}", e))))
        }
    }
}

async fn delete_operation(
    State(db): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<i64>,
) -> Result<Json<ApiResponse<()>>, StatusCode> {
    match db.delete_operation(id) {
        Ok(()) => Ok(Json(ApiResponse::success(()))),
        Err(e) => {
            eprintln!("Error deleting operation: {}", e);
            Ok(Json(ApiResponse::error(format!("Database error: {}", e))))
        }
    }
}

async fn toggle_operation(
    State(db): State<AppState>,
    axum::extract::Path(id): axum::extract::Path<i64>,
) -> Result<Json<ApiResponse<()>>, StatusCode> {
    match db.toggle_operation(id) {
        Ok(()) => Ok(Json(ApiResponse::success(()))),
        Err(e) => {
            eprintln!("Error toggling operation: {}", e);
            Ok(Json(ApiResponse::error(format!("Database error: {}", e))))
        }
    }
}

#[derive(Debug, Serialize)]
pub struct ExportData {
    pub target_name: String,
    pub operations: Vec<DataOperation>,
    pub export_time: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct ImportData {
    pub target_name: String,
    pub operations: Vec<ImportOperation>,
}

#[derive(Debug, Deserialize)]
pub struct ImportOperation {
    pub name: Option<String>,  // 可选
    pub description: Option<String>,
    pub key_name: String,
    pub operation_type: String,
    pub value: f64,
    pub start_time: Option<String>,
    pub end_time: Option<String>,
    pub is_active: bool,
}

async fn export_operations(
    State(db): State<AppState>,
) -> Result<Json<ApiResponse<Vec<ExportData>>>, StatusCode> {
    match db.get_operations(false) {
        Ok(operations) => {
            // 按标靶分组
            let mut grouped: std::collections::HashMap<String, Vec<DataOperation>> = std::collections::HashMap::new();
            
            for op in operations {
                grouped.entry(op.target_name.clone())
                    .or_insert_with(Vec::new)
                    .push(op);
            }
            
            let export_time = Utc::now();
            let export_data: Vec<ExportData> = grouped.into_iter()
                .map(|(target_name, operations)| ExportData {
                    target_name,
                    operations,
                    export_time,
                })
                .collect();
            
            Ok(Json(ApiResponse::success(export_data)))
        }
        Err(e) => {
            eprintln!("Error exporting operations: {}", e);
            Ok(Json(ApiResponse::error(format!("Database error: {}", e))))
        }
    }
}

async fn import_operations(
    State(db): State<AppState>,
    Json(import_data): Json<Vec<ImportData>>,
) -> Result<Json<ApiResponse<Vec<i64>>>, StatusCode> {
    let mut created_ids = Vec::new();
    
    for data in import_data {
        for import_op in data.operations {
            let operation_type = match OperationType::from_str(&import_op.operation_type) {
                Some(op_type) => op_type,
                None => {
                    return Ok(Json(ApiResponse::error(format!(
                        "Invalid operation type: {}", 
                        import_op.operation_type
                    ))));
                }
            };
            
            let start_time = if let Some(time_str) = import_op.start_time {
                match DateTime::parse_from_rfc3339(&time_str) {
                    Ok(dt) => Some(dt.with_timezone(&Utc)),
                    Err(_) => return Ok(Json(ApiResponse::error("Invalid start_time format".to_string()))),
                }
            } else {
                None
            };
            
            let end_time = if let Some(time_str) = import_op.end_time {
                match DateTime::parse_from_rfc3339(&time_str) {
                    Ok(dt) => Some(dt.with_timezone(&Utc)),
                    Err(_) => return Ok(Json(ApiResponse::error("Invalid end_time format".to_string()))),
                }
            } else {
                None
            };
            
            let now = Utc::now();
            
            // 自动生成默认名称（如果未提供）
            let name = import_op.name.or_else(|| {
                let op_symbol = match &operation_type {
                    OperationType::Add => "+",
                    OperationType::Subtract => "-",
                    OperationType::Multiply => "×",
                    OperationType::Divide => "÷",
                };
                Some(format!("{} {} {}", import_op.key_name, op_symbol, import_op.value))
            });
            
            let operation = DataOperation {
                id: None,
                name,
                description: import_op.description,
                target_name: data.target_name.clone(),
                key_name: import_op.key_name.clone(),
                operation_type,
                value: import_op.value,
                start_time,
                end_time,
                is_active: import_op.is_active,
                created_at: now,
                updated_at: now,
            };
            
            match db.create_operation(&operation) {
                Ok(id) => created_ids.push(id),
                Err(e) => {
                    return Ok(Json(ApiResponse::error(format!(
                        "Failed to create operation: {}", 
                        e
                    ))));
                }
            }
        }
    }
    
    Ok(Json(ApiResponse::success(created_ids)))
}

// 流式查询端点
async fn get_telemetry_data_stream(
    State(db): State<AppState>,
    Query(params): Query<TelemetryQuery>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    // 解析查询参数
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

    let start_time = params.start_time.and_then(|time_str| {
        DateTime::parse_from_rfc3339(&time_str)
            .ok()
            .map(|dt| dt.with_timezone(&Utc))
    });

    let end_time = params.end_time.and_then(|time_str| {
        DateTime::parse_from_rfc3339(&time_str)
            .ok()
            .map(|dt| dt.with_timezone(&Utc))
    });

    // 构建查询参数
    let query_params = QueryParams {
        asset_name: params.asset_name,
        device_name: params.device_name,
        target_names,
        key_names,
        start_time,
        end_time,
        remove_outliers: params.remove_outliers.unwrap_or(false),
        outlier_method: params.outlier_method.unwrap_or_else(|| "iqr".to_string()),
        custom_filter: None,
        limit: params.limit,
        sampling_config: None,
        reference_values: None,
        time_of_day_filter: None,
    };

    // 创建流
    let stream = async_stream::stream! {
        // 分批查询数据
        let batch_size = 1000;
        let mut offset = 0;
        let mut total_sent = 0;
        let max_limit = query_params.limit.unwrap_or(50000);
        
        loop {
            // 查询一批数据
            match db.query_telemetry_data_batch(&query_params, offset, batch_size) {
                Ok(batch_data) => {
                    if batch_data.is_empty() {
                        // 没有更多数据，发送统计信息
                        let stats = serde_json::json!({
                            "type": "stats",
                            "total": total_sent,
                            "completed": true
                        });
                        yield Ok(Event::default().data(stats.to_string()));
                        break;
                    }
                    
                    // 发送这批数据
                    for item in batch_data {
                        if total_sent >= max_limit {
                            break;
                        }
                        
                        let data = serde_json::json!({
                            "type": "data",
                            "item": item
                        });
                        
                        yield Ok(Event::default().data(data.to_string()));
                        total_sent += 1;
                    }
                    
                    if total_sent >= max_limit {
                        // 达到限制，发送完成信息
                        let stats = serde_json::json!({
                            "type": "stats",
                            "total": total_sent,
                            "completed": true,
                            "limited": true
                        });
                        yield Ok(Event::default().data(stats.to_string()));
                        break;
                    }
                    
                    offset += batch_size;
                    
                    // 发送进度更新
                    if total_sent % 5000 == 0 {
                        let progress = serde_json::json!({
                            "type": "progress",
                            "loaded": total_sent
                        });
                        yield Ok(Event::default().data(progress.to_string()));
                    }
                }
                Err(e) => {
                    // 发送错误信息
                    let error = serde_json::json!({
                        "type": "error",
                        "message": e.to_string()
                    });
                    yield Ok(Event::default().data(error.to_string()));
                    break;
                }
            }
        }
    };

    Sse::new(stream)
}
