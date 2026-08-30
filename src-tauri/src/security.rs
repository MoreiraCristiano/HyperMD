use std::path::Path;

pub(crate) const DOCUMENT_SESSION_FILE: &str = "session-v2.json";

pub(crate) fn is_internal_session_target(
    path: &Path,
    base_dir: Option<tauri::path::BaseDirectory>,
) -> bool {
    matches!(base_dir, Some(tauri::path::BaseDirectory::AppConfig))
        && path == Path::new(DOCUMENT_SESSION_FILE)
}

pub(crate) fn authorize_atomic_write_target<F>(
    requested_path: &Path,
    base_dir: Option<tauri::path::BaseDirectory>,
    resolved_path: &Path,
    scope_allows: F,
) -> Result<(), String>
where
    F: FnOnce(&Path) -> bool,
{
    if is_internal_session_target(requested_path, base_dir) || scope_allows(resolved_path) {
        Ok(())
    } else {
        Err("Operation denied outside the authorized filesystem scope.".into())
    }
}
