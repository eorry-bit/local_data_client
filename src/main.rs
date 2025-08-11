mod database;
mod api;

use axum::Router;
use tower::ServiceBuilder;
use tower_http::{cors::CorsLayer, services::ServeDir};
use std::net::SocketAddr;

use database::DatabaseManager;
use api::create_router;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // 初始化数据库连接
    let db_manager = DatabaseManager::new("data.db")?;
    println!("Database connection established");

    // 创建API路由
    let api_router = create_router(db_manager);

    // 创建完整的应用路由
    let app = Router::new()
        .nest("/", api_router)
        .nest_service("/", ServeDir::new("static"))
        .layer(
            ServiceBuilder::new()
                .layer(CorsLayer::permissive())
        );

    // 启动服务器
    let addr = SocketAddr::from(([127, 0, 0, 1], 3000));
    println!("Server running on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
