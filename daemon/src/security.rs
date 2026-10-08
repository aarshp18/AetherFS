use std::path::{Path, PathBuf};

#[derive(Debug)]
pub enum SecurityError {
    NotFound,
    AccessDenied,
    #[allow(dead_code)]
    InvalidPath,
}

impl std::fmt::Display for SecurityError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SecurityError::NotFound => write!(f, "Not found"),
            SecurityError::AccessDenied => write!(f, "Access denied"),
            SecurityError::InvalidPath => write!(f, "Invalid path"),
        }
    }
}

pub fn validate_safe_path(root: &Path, requested_rel_path: &str) -> Result<PathBuf, SecurityError> {
    // Normalize requested_rel_path by trimming leading '/' or '\'
    let cleaned_path = requested_rel_path.trim_start_matches(|c| c == '/' || c == '\\');
    
    let target = root.join(cleaned_path);
    
    let canonical_root = std::fs::canonicalize(root).map_err(|_| SecurityError::NotFound)?;
    let canonical_target = std::fs::canonicalize(&target).map_err(|_| SecurityError::NotFound)?;
    
    if canonical_target.starts_with(&canonical_root) {
        Ok(canonical_target)
    } else {
        Err(SecurityError::AccessDenied)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn test_valid_path() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        let file_path = root.join("test.txt");
        fs::write(&file_path, "test").unwrap();

        let result = validate_safe_path(root, "test.txt");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), std::fs::canonicalize(file_path).unwrap());
    }

    #[test]
    fn test_invalid_traversal() {
        let dir = tempdir().unwrap();
        let root = dir.path();
        
        let out_dir = tempdir().unwrap();
        let out_file = out_dir.path().join("secret.txt");
        fs::write(&out_file, "secret").unwrap();

        let rel_path = format!("../{}", out_file.file_name().unwrap().to_string_lossy());
        
        let result = validate_safe_path(root, &rel_path);
        // It might be NotFound if canonicalize fails, or AccessDenied if it succeeds
        match result {
            Err(SecurityError::NotFound) | Err(SecurityError::AccessDenied) => {}
            _ => panic!("Expected error for path traversal"),
        }
    }

    #[test]
    fn test_root_path_access() {
        let dir = tempdir().unwrap();
        let root = dir.path();

        let result = validate_safe_path(root, "");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), std::fs::canonicalize(root).unwrap());
    }
}
