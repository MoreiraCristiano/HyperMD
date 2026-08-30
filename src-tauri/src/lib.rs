use std::{
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};
use tauri::Manager;
use tauri_plugin_fs::FsExt;

static TEMP_FILE_ID: AtomicU64 = AtomicU64::new(0);
const DOCUMENT_SESSION_FILE: &str = "session-v2.json";

fn is_internal_session_target(path: &Path, base_dir: Option<tauri::path::BaseDirectory>) -> bool {
    matches!(base_dir, Some(tauri::path::BaseDirectory::AppConfig))
        && path == Path::new(DOCUMENT_SESSION_FILE)
}

fn authorize_atomic_write_target<F>(
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

fn create_sibling_temp_file(path: &Path) -> io::Result<(PathBuf, File)> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidInput, "file has no parent directory")
        })?;
    let name = path
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "file has no name"))?
        .to_string_lossy();

    for _ in 0..100 {
        let id = TEMP_FILE_ID.fetch_add(1, Ordering::Relaxed);
        let temp_path = parent.join(format!(".{name}.{}.{}.tmp", std::process::id(), id));
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
        {
            Ok(file) => return Ok((temp_path, file)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }

    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "could not create a unique temporary file",
    ))
}

#[allow(clippy::permissions_set_readonly_false)]
fn remove_temp_file(path: &Path) {
    #[cfg(windows)]
    if let Ok(metadata) = fs::metadata(path) {
        let mut permissions = metadata.permissions();
        if permissions.readonly() {
            permissions.set_readonly(false);
            let _ = fs::set_permissions(path, permissions);
        }
    }
    let _ = fs::remove_file(path);
}

fn atomic_write_with<F>(path: &Path, write: F) -> io::Result<()>
where
    F: FnOnce(&mut File) -> io::Result<()>,
{
    let (temp_path, mut temp_file) = create_sibling_temp_file(path)?;
    let write_result = write(&mut temp_file).and_then(|_| temp_file.sync_all());
    drop(temp_file);
    if let Err(error) = write_result {
        remove_temp_file(&temp_path);
        return Err(error);
    }

    if let Ok(metadata) = fs::metadata(path) {
        if let Err(error) = fs::set_permissions(&temp_path, metadata.permissions()) {
            remove_temp_file(&temp_path);
            return Err(error);
        }
    }

    if let Err(error) = fs::rename(&temp_path, path) {
        remove_temp_file(&temp_path);
        return Err(error);
    }
    Ok(())
}

fn atomic_write(path: &Path, contents: &[u8]) -> io::Result<()> {
    atomic_write_with(path, |file| file.write_all(contents))
}

#[cfg(feature = "e2e")]
fn remove_e2e_config_file(app: &tauri::AppHandle, name: &str) -> Result<(), String> {
    let path = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Could not resolve the E2E config directory: {error}"))?
        .join(name);
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Could not reset E2E state: {error}")),
    }
}

#[cfg(feature = "e2e")]
#[tauri::command]
fn e2e_reset_state(app: tauri::AppHandle) -> Result<(), String> {
    remove_e2e_config_file(&app, "session-v2.json")?;
    remove_e2e_config_file(&app, "settings.json")
}

#[tauri::command]
async fn atomic_write_text(
    app: tauri::AppHandle,
    path: PathBuf,
    contents: String,
    base_dir: Option<tauri::path::BaseDirectory>,
) -> Result<(), String> {
    let requested_path = path;
    let path = match base_dir {
        Some(base_dir) => app
            .path()
            .resolve(&requested_path, base_dir)
            .map_err(|error| format!("Could not resolve the target path: {error}"))?,
        None => requested_path.clone(),
    };
    authorize_atomic_write_target(&requested_path, base_dir, &path, |target| {
        app.fs_scope().is_allowed(target)
    })?;
    tauri::async_runtime::spawn_blocking(move || atomic_write(&path, contents.as_bytes()))
        .await
        .map_err(|error| format!("Atomic write task failed: {error}"))?
        .map_err(|error| format!("Could not write file atomically: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init());

    #[cfg(feature = "e2e")]
    let builder = builder.setup(|app| {
        let workspace = std::env::var_os("HYPERMD_E2E_WORKSPACE")
            .ok_or("HYPERMD_E2E_WORKSPACE must be set for an E2E build")?;
        app.fs_scope()
            .allow_directory(PathBuf::from(workspace), true)?;
        Ok(())
    });

    #[cfg(feature = "e2e")]
    let builder =
        builder.invoke_handler(tauri::generate_handler![atomic_write_text, e2e_reset_state]);
    #[cfg(not(feature = "e2e"))]
    let builder = builder.invoke_handler(tauri::generate_handler![atomic_write_text]);

    builder
        .run(tauri::generate_context!())
        .expect("error while running HyperMD");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_directory(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "hypermd-{name}-{}-{}",
            std::process::id(),
            TEMP_FILE_ID.fetch_add(1, Ordering::Relaxed)
        ))
    }

    #[test]
    fn atomic_write_replaces_the_complete_file() {
        let directory = test_directory("atomic-success");
        fs::create_dir(&directory).unwrap();
        let path = directory.join("note.md");
        fs::write(&path, "old").unwrap();

        atomic_write(&path, b"new content").unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "new content");
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn failed_atomic_write_preserves_the_original_file() {
        let directory = test_directory("atomic-failure");
        fs::create_dir(&directory).unwrap();
        let path = directory.join("note.md");
        fs::write(&path, "stable").unwrap();

        let result = atomic_write_with(&path, |file| {
            file.write_all(b"partial")?;
            Err(io::Error::other("injected failure"))
        });

        assert!(result.is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "stable");
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn only_the_internal_app_config_session_bypasses_dynamic_scope() {
        use tauri::path::BaseDirectory;

        assert!(is_internal_session_target(
            Path::new("session-v2.json"),
            Some(BaseDirectory::AppConfig),
        ));
        assert!(!is_internal_session_target(
            Path::new("../session-v2.json"),
            Some(BaseDirectory::AppConfig),
        ));
        assert!(!is_internal_session_target(
            Path::new("settings.json"),
            Some(BaseDirectory::AppConfig),
        ));
        assert!(!is_internal_session_target(
            Path::new("session-v2.json"),
            Some(BaseDirectory::AppData),
        ));
        assert!(!is_internal_session_target(
            Path::new("session-v2.json"),
            None,
        ));
    }

    #[test]
    fn atomic_write_authorization_rejects_paths_outside_the_dynamic_scope() {
        let root = test_directory("scope");
        let workspace = root.join("workspace");
        let outside = root.join("outside");
        fs::create_dir_all(&workspace).unwrap();
        fs::create_dir_all(&outside).unwrap();

        assert!(authorize_atomic_write_target(
            &workspace.join("note.md"),
            None,
            &workspace.join("note.md"),
            |path| path.starts_with(&workspace),
        )
        .is_ok());
        assert_eq!(
            authorize_atomic_write_target(
                &outside.join("note.md"),
                None,
                &outside.join("note.md"),
                |path| path.starts_with(&workspace),
            )
            .unwrap_err(),
            "Operation denied outside the authorized filesystem scope."
        );

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn security_configuration_keeps_local_and_external_scopes_narrow() {
        let capability: serde_json::Value =
            serde_json::from_str(include_str!("../capabilities/default.json")).unwrap();
        let permissions = capability["permissions"].as_array().unwrap();
        let permission_names = permissions
            .iter()
            .filter_map(serde_json::Value::as_str)
            .collect::<Vec<_>>();

        assert!(!permission_names.contains(&"core:default"));
        assert!(!permission_names.contains(&"dialog:allow-message"));

        let opener = permissions
            .iter()
            .find(|permission| permission["identifier"] == "opener:allow-open-url")
            .unwrap();
        let opener_urls = opener["allow"]
            .as_array()
            .unwrap()
            .iter()
            .map(|entry| entry["url"].as_str().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(opener_urls, ["http://*", "https://*", "mailto:*"]);

        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert_eq!(
            config["app"]["security"]["assetProtocol"]["scope"],
            serde_json::json!([])
        );
    }
}
