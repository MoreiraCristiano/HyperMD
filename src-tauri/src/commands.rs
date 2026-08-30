use std::path::PathBuf;
#[cfg(feature = "e2e")]
use std::{fs, io};

use tauri::Manager;
use tauri_plugin_fs::FsExt;

use crate::{
    atomic_write::atomic_write,
    path_locks::{path_lock_key, with_ordered_path_locks, with_path_lock},
    revision::{
        conditional_atomic_write, conditional_rename, current_revision, read_bytes_and_revision,
        ConditionalRenameResult, ConditionalWriteResult, ReadRevisionResult, RevisionExpectation,
    },
    security::authorize_atomic_write_target,
};

pub(crate) fn register(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    #[cfg(feature = "e2e")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        atomic_write_text,
        read_text_with_revision,
        conditional_atomic_write_text,
        read_file_revision,
        conditional_rename_file,
        e2e_reset_state
    ]);
    #[cfg(not(feature = "e2e"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        atomic_write_text,
        read_text_with_revision,
        conditional_atomic_write_text,
        read_file_revision,
        conditional_rename_file
    ]);
    builder
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
pub(crate) fn e2e_reset_state(app: tauri::AppHandle) -> Result<(), String> {
    remove_e2e_config_file(&app, "session-v2.json")?;
    remove_e2e_config_file(&app, "settings.json")
}

#[tauri::command]
pub(crate) async fn atomic_write_text(
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
    tauri::async_runtime::spawn_blocking(move || {
        with_path_lock(&path, || atomic_write(&path, contents.as_bytes()))
    })
    .await
    .map_err(|error| format!("Atomic write task failed: {error}"))?
    .map_err(|error| format!("Could not write file atomically: {error}"))
}

#[tauri::command]
pub(crate) async fn read_text_with_revision(
    app: tauri::AppHandle,
    path: PathBuf,
) -> Result<ReadRevisionResult, String> {
    authorize_atomic_write_target(&path, None, &path, |target| {
        app.fs_scope().is_allowed(target)
    })?;
    tauri::async_runtime::spawn_blocking(move || {
        with_path_lock(&path, || match read_bytes_and_revision(&path) {
            Ok((contents, revision)) => match String::from_utf8(contents) {
                Ok(contents) => ReadRevisionResult::Success { contents, revision },
                Err(error) => ReadRevisionResult::IoError {
                    operation: "decode-utf8",
                    message: error.to_string(),
                },
            },
            Err(error) => ReadRevisionResult::IoError {
                operation: "read",
                message: error.to_string(),
            },
        })
    })
    .await
    .map_err(|error| format!("Revision read task failed: {error}"))
}

#[tauri::command]
pub(crate) async fn conditional_atomic_write_text(
    app: tauri::AppHandle,
    path: PathBuf,
    contents: String,
    expected: RevisionExpectation,
) -> Result<ConditionalWriteResult, String> {
    authorize_atomic_write_target(&path, None, &path, |target| {
        app.fs_scope().is_allowed(target)
    })?;
    tauri::async_runtime::spawn_blocking(move || {
        with_path_lock(&path, || {
            conditional_atomic_write(&path, &expected, contents.as_bytes())
        })
    })
    .await
    .map_err(|error| format!("Conditional write task failed: {error}"))
}

#[tauri::command]
pub(crate) async fn read_file_revision(
    app: tauri::AppHandle,
    path: PathBuf,
) -> Result<ReadRevisionResult, String> {
    authorize_atomic_write_target(&path, None, &path, |target| {
        app.fs_scope().is_allowed(target)
    })?;
    tauri::async_runtime::spawn_blocking(move || {
        with_path_lock(&path, || match current_revision(&path) {
            Ok(Some(revision)) => ReadRevisionResult::Success {
                contents: String::new(),
                revision,
            },
            Ok(None) => ReadRevisionResult::IoError {
                operation: "read",
                message: "File does not exist.".into(),
            },
            Err(error) => ReadRevisionResult::IoError {
                operation: "read",
                message: error.to_string(),
            },
        })
    })
    .await
    .map_err(|error| format!("Revision read task failed: {error}"))
}

#[tauri::command]
pub(crate) async fn conditional_rename_file(
    app: tauri::AppHandle,
    source: PathBuf,
    destination: PathBuf,
    source_revision: String,
) -> Result<ConditionalRenameResult, String> {
    authorize_atomic_write_target(&source, None, &source, |target| {
        app.fs_scope().is_allowed(target)
    })?;
    authorize_atomic_write_target(&destination, None, &destination, |target| {
        app.fs_scope().is_allowed(target)
    })?;
    if path_lock_key(&source) == path_lock_key(&destination) {
        return Ok(ConditionalRenameResult::IoError {
            operation: "rename",
            message: "Source and destination must differ.".into(),
        });
    }
    tauri::async_runtime::spawn_blocking(move || {
        with_ordered_path_locks(&source, &destination, || {
            conditional_rename(&source, &destination, &source_revision)
        })
    })
    .await
    .map_err(|error| format!("Conditional rename task failed: {error}"))
}
