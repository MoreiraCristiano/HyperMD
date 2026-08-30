use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

use crate::{
    atomic_write::{atomic_write, atomic_write_with},
    path_locks::path_lock_key,
    revision::{
        conditional_atomic_write, conditional_atomic_write_with, conditional_rename,
        content_revision, ConditionalRenameResult, ConditionalWriteResult, ConflictKind,
        RenameConflictPath, RevisionExpectation,
    },
    security::{authorize_atomic_write_target, is_internal_session_target},
};

static TEST_FILE_ID: AtomicU64 = AtomicU64::new(0);

fn test_directory(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "hypermd-{name}-{}-{}",
        std::process::id(),
        TEST_FILE_ID.fetch_add(1, Ordering::Relaxed)
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
fn conditional_write_requires_the_current_content_revision() {
    let directory = test_directory("conditional-revision");
    fs::create_dir(&directory).unwrap();
    let path = directory.join("note.md");
    fs::write(&path, b"old\r\nbytes").unwrap();
    let expected = RevisionExpectation::Revision {
        revision: content_revision(b"old\r\nbytes"),
    };

    let result = conditional_atomic_write(&path, &expected, b"new\nbytes");

    assert_eq!(
        result,
        ConditionalWriteResult::Success {
            revision: content_revision(b"new\nbytes")
        }
    );
    assert_eq!(fs::read(&path).unwrap(), b"new\nbytes");
    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn conditional_write_distinguishes_changed_missing_and_existing_files() {
    let directory = test_directory("conditional-conflicts");
    fs::create_dir(&directory).unwrap();
    let path = directory.join("note.md");
    fs::write(&path, b"external").unwrap();

    assert!(matches!(
        conditional_atomic_write(
            &path,
            &RevisionExpectation::Revision {
                revision: content_revision(b"known")
            },
            b"editor"
        ),
        ConditionalWriteResult::Conflict {
            kind: ConflictKind::Changed,
            ..
        }
    ));
    assert_eq!(fs::read(&path).unwrap(), b"external");

    assert!(matches!(
        conditional_atomic_write(&path, &RevisionExpectation::Missing, b"editor"),
        ConditionalWriteResult::Conflict {
            kind: ConflictKind::Exists,
            ..
        }
    ));
    fs::remove_file(&path).unwrap();
    assert_eq!(
        conditional_atomic_write(
            &path,
            &RevisionExpectation::Revision {
                revision: content_revision(b"known")
            },
            b"editor"
        ),
        ConditionalWriteResult::Conflict {
            kind: ConflictKind::Missing,
            actual_revision: None
        }
    );
    assert!(!path.exists());
    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn failed_conditional_write_preserves_the_original_file() {
    let directory = test_directory("conditional-failure");
    fs::create_dir(&directory).unwrap();
    let path = directory.join("note.md");
    fs::write(&path, b"stable").unwrap();
    let expected = RevisionExpectation::Revision {
        revision: content_revision(b"stable"),
    };

    let result = conditional_atomic_write_with(&path, &expected, b"partial", |file| {
        file.write_all(b"partial")?;
        Err(io::Error::other("injected failure"))
    });

    assert!(matches!(result, Err(("write-temp", _))));
    assert_eq!(fs::read(&path).unwrap(), b"stable");
    assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);
    fs::remove_dir_all(directory).unwrap();
}

#[test]
fn conditional_rename_preserves_changed_sources_and_occupied_destinations() {
    let directory = test_directory("conditional-rename");
    fs::create_dir(&directory).unwrap();
    let source = directory.join("image.png");
    let destination = directory.join("renamed.png");
    fs::write(&source, b"image-v2").unwrap();

    assert!(matches!(
        conditional_rename(&source, &destination, &content_revision(b"image-v1")),
        ConditionalRenameResult::Conflict {
            path: RenameConflictPath::Source,
            kind: ConflictKind::Changed,
            ..
        }
    ));
    assert_eq!(fs::read(&source).unwrap(), b"image-v2");

    fs::write(&destination, b"occupied").unwrap();
    assert!(matches!(
        conditional_rename(&source, &destination, &content_revision(b"image-v2")),
        ConditionalRenameResult::Conflict {
            path: RenameConflictPath::Destination,
            kind: ConflictKind::Exists,
            ..
        }
    ));
    assert_eq!(fs::read(&source).unwrap(), b"image-v2");
    assert_eq!(fs::read(&destination).unwrap(), b"occupied");

    fs::remove_file(&destination).unwrap();
    assert!(matches!(
        conditional_rename(&source, &destination, &content_revision(b"image-v2")),
        ConditionalRenameResult::Success { .. }
    ));
    assert!(!source.exists());
    assert_eq!(fs::read(&destination).unwrap(), b"image-v2");
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

#[test]
fn path_lock_key_resolves_aliases_to_the_same_target() {
    let directory = test_directory("lock-key");
    fs::create_dir(&directory).unwrap();
    let path = directory.join("note.md");
    fs::write(&path, b"content").unwrap();

    assert_eq!(
        path_lock_key(&path),
        path_lock_key(&directory.join(".").join("note.md"))
    );

    fs::remove_dir_all(directory).unwrap();
}
