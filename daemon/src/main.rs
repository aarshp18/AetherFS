mod config;
mod routes;
mod security;

use clap::Parser;
use config::Config;
use tracing::{info, warn};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt::init();

    let config = Config::parse();

    if config.token.is_none() {
        warn!("Auth token is not configured. Authentication is disabled for local testing.");
    }

    let bind_addr = config.bind;
    let router = routes::create_router(config);

    info!("Starting AetherFS daemon on {}", bind_addr);
    
    let listener = tokio::net::TcpListener::bind(bind_addr).await?;
    axum::serve(listener, router).await?;

    Ok(())
}
