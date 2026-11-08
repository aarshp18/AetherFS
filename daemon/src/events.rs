use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tokio::sync::broadcast;
use tracing::{debug, warn};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub struct FsEvent {
    pub kind: String, // "create", "modify", "remove", or "other"
    pub path: String, // workspace-relative path string
}

pub fn map_event_kind(kind: &notify::EventKind) -> &'static str {
    match kind {
        notify::EventKind::Create(_) => "create",
        notify::EventKind::Modify(_) => "modify",
        notify::EventKind::Remove(_) => "remove",
        _ => "other",
    }
}

pub fn normalize_relative_path(root: &Path, path: &Path) -> String {
    let canonical_root = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());

    let rel_path = if let Ok(stripped) = path.strip_prefix(&canonical_root) {
        stripped
    } else if let Ok(stripped) = path.strip_prefix(root) {
        stripped
    } else {
        path
    };

    let path_str = rel_path.to_string_lossy().replace('\\', "/");
    let cleaned = path_str.trim_start_matches('/');
    cleaned.to_string()
}

pub struct EventEngine {
    tx: broadcast::Sender<FsEvent>,
    _watcher: RecommendedWatcher,
}

impl EventEngine {
    pub fn new(root: impl AsRef<Path>) -> Result<Self, notify::Error> {
        let (tx, _) = broadcast::channel(1024);
        Self::with_sender(root, tx)
    }

    pub fn with_sender(
        root: impl AsRef<Path>,
        tx: broadcast::Sender<FsEvent>,
    ) -> Result<Self, notify::Error> {
        let root = root.as_ref();
        let canonical_root = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
        let root_for_callback = canonical_root.clone();
        let tx_for_callback = tx.clone();

        let mut watcher = RecommendedWatcher::new(
            move |res: Result<notify::Event, notify::Error>| match res {
                Ok(event) => {
                    let kind = map_event_kind(&event.kind).to_string();
                    if event.paths.is_empty() {
                        let fs_event = FsEvent {
                            kind,
                            path: String::new(),
                        };
                        let _ = tx_for_callback.send(fs_event);
                    } else {
                        for p in &event.paths {
                            let rel = normalize_relative_path(&root_for_callback, p);
                            let fs_event = FsEvent {
                                kind: kind.clone(),
                                path: rel,
                            };
                            let _ = tx_for_callback.send(fs_event);
                        }
                    }
                }
                Err(err) => {
                    warn!("Filesystem watcher error: {:?}", err);
                }
            },
            notify::Config::default(),
        )?;

        watcher.watch(&canonical_root, RecursiveMode::Recursive)?;

        debug!("EventEngine watching {:?} (canonical: {:?})", root, canonical_root);

        Ok(Self {
            tx,
            _watcher: watcher,
        })
    }

    pub fn sender(&self) -> broadcast::Sender<FsEvent> {
        self.tx.clone()
    }

    pub fn subscribe(&self) -> broadcast::Receiver<FsEvent> {
        self.tx.subscribe()
    }
}

pub fn setup_watcher(
    root: impl AsRef<Path>,
) -> Result<(broadcast::Sender<FsEvent>, RecommendedWatcher), notify::Error> {
    let engine = EventEngine::new(root)?;
    Ok((engine.tx, engine._watcher))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::Duration;
    use tempfile::tempdir;

    #[test]
    fn test_event_serialization() {
        let event = FsEvent {
            kind: "create".to_string(),
            path: "sub/test.txt".to_string(),
        };
        let serialized = serde_json::to_string(&event).unwrap();
        let deserialized: FsEvent = serde_json::from_str(&serialized).unwrap();
        assert_eq!(event, deserialized);
        assert_eq!(serialized, r#"{"kind":"create","path":"sub/test.txt"}"#);
    }

    #[test]
    fn test_map_event_kind() {
        use notify::event::*;
        assert_eq!(map_event_kind(&EventKind::Create(CreateKind::File)), "create");
        assert_eq!(map_event_kind(&EventKind::Modify(ModifyKind::Data(DataChange::Content))), "modify");
        assert_eq!(map_event_kind(&EventKind::Remove(RemoveKind::File)), "remove");
        assert_eq!(map_event_kind(&EventKind::Access(AccessKind::Read)), "other");
        assert_eq!(map_event_kind(&EventKind::Any), "other");
        assert_eq!(map_event_kind(&EventKind::Other), "other");
    }

    #[test]
    fn test_normalize_relative_path() {
        let root = Path::new("/var/workspace");
        assert_eq!(
            normalize_relative_path(root, Path::new("/var/workspace/foo/bar.txt")),
            "foo/bar.txt"
        );
        assert_eq!(
            normalize_relative_path(root, Path::new("/var/workspace/test.txt")),
            "test.txt"
        );
        assert_eq!(
            normalize_relative_path(root, Path::new("/var/workspace")),
            ""
        );
        assert_eq!(
            normalize_relative_path(root, Path::new("/var/workspace/")),
            ""
        );
    }

    #[tokio::test]
    async fn test_event_engine_file_operations() {
        let dir = tempdir().unwrap();
        let root = dir.path();

        let engine = EventEngine::new(root).expect("Failed to initialize EventEngine");
        let mut rx = engine.subscribe();

        // Perform file creation
        let test_file = root.join("hello.txt");
        fs::write(&test_file, "hello world").unwrap();

        // Wait for an event related to hello.txt
        let mut found_create_or_modify = false;
        let start = std::time::Instant::now();
        while start.elapsed() < Duration::from_secs(3) {
            if let Ok(Ok(ev)) = tokio::time::timeout(Duration::from_millis(500), rx.recv()).await {
                if ev.path == "hello.txt" && (ev.kind == "create" || ev.kind == "modify") {
                    found_create_or_modify = true;
                    break;
                }
            }
        }
        assert!(found_create_or_modify, "Should receive create/modify event for hello.txt");

        // Perform file removal
        fs::remove_file(&test_file).unwrap();

        let mut found_remove = false;
        let start = std::time::Instant::now();
        while start.elapsed() < Duration::from_secs(3) {
            if let Ok(Ok(ev)) = tokio::time::timeout(Duration::from_millis(500), rx.recv()).await {
                if ev.path == "hello.txt" && ev.kind == "remove" {
                    found_remove = true;
                    break;
                }
            }
        }
        assert!(found_remove, "Should receive remove event for hello.txt");
    }
}
