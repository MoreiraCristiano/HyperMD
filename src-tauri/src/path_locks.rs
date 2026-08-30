use std::{
    collections::HashMap,
    fs, io,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
};

static PATH_LOCKS: OnceLock<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>> = OnceLock::new();

pub(crate) fn path_lock_key(path: &Path) -> PathBuf {
    let resolved = fs::canonicalize(path).or_else(|_| {
        let parent = path.parent().ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidInput, "file has no parent directory")
        })?;
        Ok::<PathBuf, io::Error>(
            fs::canonicalize(parent)?.join(path.file_name().unwrap_or_default()),
        )
    });
    let key = resolved.unwrap_or_else(|_| path.to_path_buf());
    #[cfg(windows)]
    return PathBuf::from(key.to_string_lossy().to_lowercase());
    #[cfg(not(windows))]
    key
}

fn path_lock(path: &Path) -> Arc<Mutex<()>> {
    let locks = PATH_LOCKS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut locks = locks
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    locks
        .entry(path_lock_key(path))
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}

pub(crate) fn with_path_lock<T>(path: &Path, action: impl FnOnce() -> T) -> T {
    let lock = path_lock(path);
    let _guard = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    action()
}

pub(crate) fn with_ordered_path_locks<T>(
    source: &Path,
    destination: &Path,
    action: impl FnOnce() -> T,
) -> T {
    let source_key = path_lock_key(source);
    let destination_key = path_lock_key(destination);
    let source_lock = path_lock(source);
    let destination_lock = path_lock(destination);
    if source_key <= destination_key {
        let _source_guard = source_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let _destination_guard = destination_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        action()
    } else {
        let _destination_guard = destination_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let _source_guard = source_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        action()
    }
}
