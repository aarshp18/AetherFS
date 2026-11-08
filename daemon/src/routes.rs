use axum::{
    body::Body,
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    http::{header, Request, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::fs::{self, File};
use tokio_util::io::ReaderStream;
use tower_http::cors::CorsLayer;

use crate::{
    config::Config,
    events::{EventEngine, FsEvent},
    security::{self, SecurityError},
};

#[derive(Clone)]
pub struct AppState {
    pub config: Config,
    pub event_tx: tokio::sync::broadcast::Sender<FsEvent>,
    #[allow(dead_code)]
    pub(crate) engine: Option<Arc<std::sync::Mutex<EventEngine>>>,
}

pub fn create_router(config: Config) -> Router {
    let (event_tx, engine) = match EventEngine::new(&config.root) {
        Ok(engine) => {
            let tx = engine.sender();
            (tx, Some(Arc::new(std::sync::Mutex::new(engine))))
        }
        Err(e) => {
            tracing::warn!("Failed to initialize EventEngine on {:?}: {}", config.root, e);
            let (tx, _) = tokio::sync::broadcast::channel(1024);
            (tx, None)
        }
    };

    let state = AppState {
        config,
        event_tx,
        engine,
    };

    build_router(state)
}

#[allow(dead_code)]
pub fn create_router_with_sender(
    config: Config,
    event_tx: tokio::sync::broadcast::Sender<FsEvent>,
) -> Router {
    let state = AppState {
        config,
        event_tx,
        engine: None,
    };

    build_router(state)
}

fn build_router(state: AppState) -> Router {
    let api_routes = Router::new()
        .route("/ping", get(ping))
        .route("/fs/ls", get(ls))
        .route("/fs/cat", get(cat))
        .route("/fs/events", get(ws_events_handler))
        .route("/events", get(ws_events_handler));

    Router::new()
        .nest("/api/v1", api_routes)
        .layer(middleware::from_fn_with_state(state.clone(), auth_middleware))
        .layer(CorsLayer::permissive())
        .with_state(state)
}

async fn ws_events_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws_socket(socket, state))
}

async fn handle_ws_socket(socket: WebSocket, state: AppState) {
    let mut rx = state.event_tx.subscribe();
    let (mut ws_sender, mut ws_receiver) = socket.split();

    loop {
        tokio::select! {
            event_res = rx.recv() => {
                match event_res {
                    Ok(event) => {
                        let json = match serde_json::to_string(&event) {
                            Ok(j) => j,
                            Err(e) => {
                                tracing::error!("Failed to serialize FsEvent: {}", e);
                                continue;
                            }
                        };
                        if let Err(e) = ws_sender.send(Message::Text(json)).await {
                            tracing::debug!("WebSocket client disconnected during send: {}", e);
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                        tracing::warn!("WebSocket subscriber lagged by {} messages", skipped);
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                        tracing::info!("Event broadcast channel closed");
                        break;
                    }
                }
            }
            client_msg = ws_receiver.next() => {
                match client_msg {
                    Some(Ok(Message::Close(_))) | None => {
                        break;
                    }
                    Some(Ok(Message::Ping(payload))) => {
                        if ws_sender.send(Message::Pong(payload)).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(_)) => {
                        // Ignore other messages from client
                    }
                    Some(Err(e)) => {
                        tracing::debug!("WebSocket error from client: {}", e);
                        break;
                    }
                }
            }
        }
    }
}

async fn auth_middleware(
    State(state): State<AppState>,
    req: Request<Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    if let Some(expected_token) = &state.config.token {
        let auth_header = req.headers().get(header::AUTHORIZATION)
            .and_then(|h| h.to_str().ok());

        let token_from_header = auth_header.and_then(|auth| {
            if auth.starts_with("Bearer ") {
                Some(auth.trim_start_matches("Bearer "))
            } else {
                None
            }
        });

        let token_from_query = req.uri().query().and_then(|q| {
            q.split('&').find_map(|pair| {
                let (k, v) = pair.split_once('=')?;
                if k == "token" {
                    Some(v)
                } else {
                    None
                }
            })
        });

        let is_valid = match (token_from_header, token_from_query) {
            (Some(token), _) if token == expected_token => true,
            (_, Some(token)) if token == expected_token => true,
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    use tempfile::tempdir;
    use tokio::net::TcpListener;
    use tokio::sync::broadcast;
    use tokio_tungstenite::connect_async;
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;

    #[tokio::test]
    async fn test_ws_events_stream() {
        let dir = tempdir().unwrap();
        let config = Config {
            bind: "127.0.0.1:0".parse().unwrap(),
            root: dir.path().to_path_buf(),
            token: None,
        };

        let (tx, _) = broadcast::channel(16);
        let router = create_router_with_sender(config, tx.clone());

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });

        let ws_url = format!("ws://{}/api/v1/fs/events", addr);
        let (ws_stream, _) = connect_async(ws_url).await.expect("Failed to connect");
        let (_, mut read) = ws_stream.split();

        // Broadcast an event
        let sent_event = FsEvent {
            kind: "modify".to_string(),
            path: "sub/document.txt".to_string(),
        };
        tx.send(sent_event.clone()).unwrap();

        // Receive from WebSocket
        let msg = tokio::time::timeout(Duration::from_secs(2), read.next())
            .await
            .expect("Timeout waiting for WS message")
            .expect("Stream closed unexpectedly")
            .expect("Error reading WS message");

        let text = msg.to_text().unwrap();
        let received_event: FsEvent = serde_json::from_str(text).unwrap();
        assert_eq!(received_event, sent_event);
    }

    #[tokio::test]
    async fn test_ws_events_auth() {
        let dir = tempdir().unwrap();
        let config = Config {
            bind: "127.0.0.1:0".parse().unwrap(),
            root: dir.path().to_path_buf(),
            token: Some("auth-token-123".to_string()),
        };

        let (tx, _) = broadcast::channel(16);
        let router = create_router_with_sender(config, tx.clone());

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });

        // 1. Unauthenticated request should fail
        let ws_url = format!("ws://{}/api/v1/fs/events", addr);
        let unauth_res = connect_async(&ws_url).await;
        assert!(unauth_res.is_err(), "Expected connection without auth to be rejected");

        // 2. Authenticated via query parameter
        let ws_url_query = format!("ws://{}/api/v1/fs/events?token=auth-token-123", addr);
        let (ws_stream, _) = connect_async(ws_url_query)
            .await
            .expect("Connection with valid query token should succeed");
        let (_, mut read) = ws_stream.split();

        tx.send(FsEvent {
            kind: "create".to_string(),
            path: "query_test.txt".to_string(),
        }).unwrap();

        let msg = tokio::time::timeout(Duration::from_secs(2), read.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let received: FsEvent = serde_json::from_str(msg.to_text().unwrap()).unwrap();
        assert_eq!(received.path, "query_test.txt");

        // 3. Authenticated via Authorization header
        let mut req = ws_url.into_client_request().unwrap();
        req.headers_mut().insert(
            "Authorization",
            "Bearer auth-token-123".parse().unwrap(),
        );
        let (ws_stream_header, _) = connect_async(req)
            .await
            .expect("Connection with valid Bearer header should succeed");
        let (_, mut read_header) = ws_stream_header.split();

        tx.send(FsEvent {
            kind: "remove".to_string(),
            path: "header_test.txt".to_string(),
        }).unwrap();

        let msg_header = tokio::time::timeout(Duration::from_secs(2), read_header.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        let received_header: FsEvent = serde_json::from_str(msg_header.to_text().unwrap()).unwrap();
        assert_eq!(received_header.path, "header_test.txt");
    }

    #[tokio::test]
    async fn test_ws_real_watcher() {
        let dir = tempdir().unwrap();
        let config = Config {
            bind: "127.0.0.1:0".parse().unwrap(),
            root: dir.path().to_path_buf(),
            token: None,
        };

        let router = create_router(config);

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });

        let ws_url = format!("ws://{}/api/v1/fs/events", addr);
        let (ws_stream, _) = connect_async(ws_url).await.expect("Failed to connect to WS");
        let (_, mut read) = ws_stream.split();

        // Write a real file to trigger notify
        let target_file = dir.path().join("real_event.txt");
        std::fs::write(&target_file, "real content").unwrap();

        // Loop to find our event
        let mut matched = false;
        let start = std::time::Instant::now();
        while start.elapsed() < Duration::from_secs(3) {
            if let Ok(Some(Ok(msg))) = tokio::time::timeout(Duration::from_millis(500), read.next()).await {
                if let Ok(text) = msg.to_text() {
                    if let Ok(ev) = serde_json::from_str::<FsEvent>(text) {
                        if ev.path == "real_event.txt" && (ev.kind == "create" || ev.kind == "modify") {
                            matched = true;
                            break;
                        }
                    }
                }
            }
        }

        assert!(matched, "Expected real file event over WebSocket for real_event.txt");
    }
}
