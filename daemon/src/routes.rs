use axum::{
    body::Body,
    extract::{Query, State},
    http::{header, Request, StatusCode},
    middleware::{self, Next},
    response::Response,
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tokio::fs::{self, File};
use tokio_util::io::ReaderStream;
use tower_http::cors::CorsLayer;

use crate::{config::Config, security::{self, SecurityError}};

#[derive(Clone)]
pub struct AppState {
    pub config: Config,
}

pub fn create_router(config: Config) -> Router {
    let state = AppState { config: config.clone() };

    let api_routes = Router::new()
        .route("/ping", get(ping))
        .route("/fs/ls", get(ls))
        .route("/fs/cat", get(cat));

    Router::new()
        .nest("/api/v1", api_routes)
        .layer(middleware::from_fn_with_state(state.clone(), auth_middleware))
        .layer(CorsLayer::permissive())
        .with_state(state)
}

async fn auth_middleware(
    State(state): State<AppState>,
    req: Request<Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    if let Some(expected_token) = &state.config.token {
        let auth_header = req.headers().get(header::AUTHORIZATION)
            .and_then(|h| h.to_str().ok());

        let is_valid = match auth_header {
            Some(auth) if auth.starts_with("Bearer ") => {
                let token = auth.trim_start_matches("Bearer ");
                token == expected_token
            }
            _ => false,
        };

        if !is_valid {
            return Err(StatusCode::UNAUTHORIZED);
        }
    }

    Ok(next.run(req).await)
}

#[derive(Serialize)]
struct PingResponse {
    status: &'static str,
    name: &'static str,
    version: &'static str,
}

async fn ping() -> Json<PingResponse> {
    Json(PingResponse {
        status: "ok",
        name: "aetherfs",
        version: "0.1.0",
    })
}

#[derive(Deserialize)]
struct FsQuery {
    #[serde(default)]
    path: String,
}

#[derive(Serialize)]
struct LsEntry {
    name: String,
    is_dir: bool,
    size: u64,
    modified: u64,
}

#[derive(Serialize)]
struct LsResponse {
    path: String,
    entries: Vec<LsEntry>,
}

async fn ls(
    State(state): State<AppState>,
    Query(query): Query<FsQuery>,
) -> Result<Json<LsResponse>, StatusCode> {
    let safe_path = security::validate_safe_path(&state.config.root, &query.path).map_err(|e| match e {
        SecurityError::NotFound => StatusCode::NOT_FOUND,
        SecurityError::AccessDenied => StatusCode::FORBIDDEN,
        SecurityError::InvalidPath => StatusCode::BAD_REQUEST,
    })?;

    let mut dir = fs::read_dir(&safe_path).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut entries = Vec::new();

    while let Ok(Some(entry)) = dir.next_entry().await {
        let metadata = entry.metadata().await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let name = entry.file_name().to_string_lossy().to_string();
        let is_dir = metadata.is_dir();
        let size = metadata.len();
        let modified = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        entries.push(LsEntry {
            name,
            is_dir,
            size,
            modified,
        });
    }

    Ok(Json(LsResponse {
        path: query.path,
        entries,
    }))
}

async fn cat(
    State(state): State<AppState>,
    Query(query): Query<FsQuery>,
) -> Result<Response, StatusCode> {
    let safe_path = security::validate_safe_path(&state.config.root, &query.path).map_err(|e| match e {
        SecurityError::NotFound => StatusCode::NOT_FOUND,
        SecurityError::AccessDenied => StatusCode::FORBIDDEN,
        SecurityError::InvalidPath => StatusCode::BAD_REQUEST,
    })?;

    let metadata = fs::metadata(&safe_path).await.map_err(|_| StatusCode::NOT_FOUND)?;
    if metadata.is_dir() {
        return Err(StatusCode::BAD_REQUEST);
    }

    let file = File::open(&safe_path).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let stream = ReaderStream::new(file);
    let body = Body::from_stream(stream);

    let mime = mime_guess::from_path(&safe_path).first_or_octet_stream();

    let response = Response::builder()
        .header(header::CONTENT_TYPE, mime.as_ref())
        .header(header::ACCEPT_RANGES, "bytes")
        .body(body)
        .unwrap();

    Ok(response)
}
