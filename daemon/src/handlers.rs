use axum::{
    extract::{Multipart, Query, State},
    http::{header, HeaderMap, StatusCode},
    Json,
};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tokio::fs::File;
use tokio::io::AsyncWriteExt;

use crate::{
    routes::AppState,
    security::{self, SecurityError},
};

#[derive(Deserialize)]
pub struct UploadQuery {
    #[serde(default)]
    pub path: String,
}

#[derive(Serialize, Deserialize, Debug, PartialEq)]
pub struct UploadResponse {
    pub status: String,
    pub files: Vec<String>,
}

/// Processes a `Multipart` stream and writes each field's chunk stream directly to disk
/// using `tokio::fs::File` and `AsyncWriteExt` without loading the entire file into memory.
pub async fn upload_file(
    State(state): State<AppState>,
    Query(query): Query<UploadQuery>,
    mut multipart: Multipart,
) -> Result<Json<UploadResponse>, StatusCode> {
    let target_dir = security::validate_safe_path(&state.config.root, &query.path).map_err(|e| match e {
        SecurityError::NotFound => StatusCode::NOT_FOUND,
        SecurityError::AccessDenied => StatusCode::FORBIDDEN,
        SecurityError::InvalidPath => StatusCode::BAD_REQUEST,
    })?;

    let metadata = tokio::fs::metadata(&target_dir)
        .await
        .map_err(|_| StatusCode::NOT_FOUND)?;
    if !metadata.is_dir() {
        return Err(StatusCode::BAD_REQUEST);
    }

    let mut uploaded_files = Vec::new();

    while let Some(mut field) = multipart
        .next_field()
        .await
        .map_err(|_| StatusCode::BAD_REQUEST)?
    {
        let raw_name = match field.file_name() {
            Some(name) if !name.is_empty() => name.to_string(),
            _ => continue,
        };

        let safe_name = Path::new(&raw_name)
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or(StatusCode::BAD_REQUEST)?
            .to_string();

        if safe_name.is_empty() || safe_name == "." || safe_name == ".." {
            return Err(StatusCode::BAD_REQUEST);
        }

        let file_path = target_dir.join(&safe_name);
        let mut file = File::create(&file_path)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        while let Some(chunk) = field
            .chunk()
            .await
            .map_err(|_| StatusCode::BAD_REQUEST)?
        {
            file.write_all(&chunk)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        }

        file.flush()
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        uploaded_files.push(safe_name);
    }

    Ok(Json(UploadResponse {
        status: "ok".to_string(),
        files: uploaded_files,
    }))
}

/// Returns the current network clipboard string stored in shared `AppState`.
pub async fn get_clipboard(State(state): State<AppState>) -> String {
    let clipboard = state.clipboard.read().await;
    clipboard.clone()
}

/// Overwrites the current network clipboard string in shared `AppState`.
pub async fn set_clipboard(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: String,
) -> StatusCode {
    let new_text = if headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|ct| ct.starts_with("application/json"))
        .unwrap_or(false)
    {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&body) {
            if let Some(s) = val.as_str() {
                s.to_string()
            } else if let Some(s) = val.get("text").and_then(|v| v.as_str()) {
                s.to_string()
            } else if let Some(s) = val.get("content").and_then(|v| v.as_str()) {
                s.to_string()
            } else {
                body
            }
        } else {
            body
        }
    } else {
        body
    };

    let mut clipboard = state.clipboard.write().await;
    *clipboard = new_text;
    StatusCode::OK
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Config;
    use crate::routes::create_router;
    use axum::body::Body;
    use axum::extract::FromRequest;
    use axum::http::{HeaderMap, Method, Request, StatusCode};
    use std::sync::Arc;
    use tempfile::tempdir;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::{TcpListener, TcpStream};
    use tokio::sync::{broadcast, RwLock};

    #[tokio::test]
    async fn test_clipboard_get_and_post() {
        let dir = tempdir().unwrap();
        let config = Config {
            bind: "127.0.0.1:0".parse().unwrap(),
            root: dir.path().to_path_buf(),
            token: None,
        };
        let (tx, _) = broadcast::channel(16);
        let state = AppState {
            config,
            event_tx: tx,
            engine: None,
            clipboard: Arc::new(RwLock::new(String::new())),
        };

        // Initial GET returns empty string
        let initial = get_clipboard(State(state.clone())).await;
        assert_eq!(initial, "");

        // POST overwrites state
        let status = set_clipboard(
            State(state.clone()),
            HeaderMap::new(),
            "shared snippet from workstation".to_string(),
        )
        .await;
        assert_eq!(status, StatusCode::OK);

        // Subsequent GET returns updated string
        let updated = get_clipboard(State(state)).await;
        assert_eq!(updated, "shared snippet from workstation");
    }

    #[tokio::test]
    async fn test_streaming_multipart_upload_route() {
        let dir = tempdir().unwrap();
        let sub_dir = dir.path().join("uploads");
        std::fs::create_dir(&sub_dir).unwrap();

        let config = Config {
            bind: "127.0.0.1:0".parse().unwrap(),
            root: dir.path().to_path_buf(),
            token: None,
        };
        let router = create_router(config.clone());
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });

        // Test payload > 2MB (DefaultBodyLimit default) over HTTP to verify limit is disabled on route
        let large_content = vec![b'A'; 3 * 1024 * 1024];
        let boundary = "----AetherFSBoundary7MA4YWxkTrZu0gW";
        let mut body = Vec::new();
        body.extend_from_slice(
            format!(
                "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"large_test.bin\"\r\nContent-Type: application/octet-stream\r\n\r\n"
            )
            .as_bytes(),
        );
        body.extend_from_slice(&large_content);
        body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());

        let mut stream = TcpStream::connect(addr).await.unwrap();
        let req_headers = format!(
            "POST /api/v1/fs/upload?path=uploads HTTP/1.1\r\nHost: {addr}\r\nContent-Type: multipart/form-data; boundary={boundary}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        stream.write_all(req_headers.as_bytes()).await.unwrap();
        stream.write_all(&body).await.unwrap();

        let mut response = String::new();
        stream.read_to_string(&mut response).await.unwrap();
        assert!(response.starts_with("HTTP/1.1 200 OK"), "Unexpected response: {response}");

        let uploaded_path = sub_dir.join("large_test.bin");
        assert!(uploaded_path.exists());
        let saved_bytes = std::fs::read(&uploaded_path).unwrap();
        assert_eq!(saved_bytes.len(), 3 * 1024 * 1024);
        assert!(saved_bytes.iter().all(|&b| b == b'A'));

        // Also verify direct handler call with Multipart extractor
        let small_body = format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"direct.txt\"\r\nContent-Type: text/plain\r\n\r\nhello stream\r\n--{boundary}--\r\n"
        );
        let req = Request::builder()
            .method(Method::POST)
            .uri("/api/v1/fs/upload?path=uploads")
            .header(
                "content-type",
                format!("multipart/form-data; boundary={boundary}"),
            )
            .body(Body::from(small_body))
            .unwrap();
        let (tx, _) = broadcast::channel(16);
        let state = AppState {
            config,
            event_tx: tx,
            engine: None,
            clipboard: Arc::new(RwLock::new(String::new())),
        };
        let multipart = Multipart::from_request(req, &state).await.unwrap();
        let res = upload_file(
            State(state),
            Query(UploadQuery {
                path: "uploads".to_string(),
            }),
            multipart,
        )
        .await
        .unwrap();
        assert_eq!(res.0.files, vec!["direct.txt".to_string()]);
        assert_eq!(
            std::fs::read_to_string(sub_dir.join("direct.txt")).unwrap(),
            "hello stream"
        );
    }
}

