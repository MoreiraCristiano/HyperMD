#[cfg(feature = "e2e")]
use std::path::PathBuf;

use tauri::Manager;
#[cfg(feature = "e2e")]
use tauri_plugin_fs::FsExt;

use crate::commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }));

    let builder = builder
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

    let builder = commands::register(builder);

    builder
        .run(tauri::generate_context!())
        .expect("error while running HyperMD");
}
