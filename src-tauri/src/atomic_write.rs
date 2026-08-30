use std::{
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

static TEMP_FILE_ID: AtomicU64 = AtomicU64::new(0);

pub(crate) fn create_sibling_temp_file(path: &Path) -> io::Result<(PathBuf, File)> {
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
pub(crate) fn remove_temp_file(path: &Path) {
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

pub(crate) fn atomic_write_with<F>(path: &Path, write: F) -> io::Result<()>
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

pub(crate) fn atomic_write(path: &Path, contents: &[u8]) -> io::Result<()> {
    atomic_write_with(path, |file| file.write_all(contents))
}
