use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{self, Read, Write},
    path::Path,
};

use crate::atomic_write::{create_sibling_temp_file, remove_temp_file};

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub(crate) enum RevisionExpectation {
    Revision { revision: String },
    Missing,
    Any,
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub(crate) enum ConditionalWriteResult {
    Success {
        revision: String,
    },
    Conflict {
        kind: ConflictKind,
        #[serde(rename = "actualRevision")]
        actual_revision: Option<String>,
    },
    IoError {
        operation: &'static str,
        message: String,
    },
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum ConflictKind {
    Changed,
    Missing,
    Exists,
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub(crate) enum ReadRevisionResult {
    Success {
        contents: String,
        revision: String,
    },
    IoError {
        operation: &'static str,
        message: String,
    },
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub(crate) enum ConditionalRenameResult {
    Success {
        revision: String,
    },
    Conflict {
        path: RenameConflictPath,
        kind: ConflictKind,
        #[serde(rename = "actualRevision")]
        actual_revision: Option<String>,
    },
    IoError {
        operation: &'static str,
        message: String,
    },
}

#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum RenameConflictPath {
    Source,
    Destination,
}

pub(crate) fn content_revision(contents: &[u8]) -> String {
    format!("{:x}", Sha256::digest(contents))
}

pub(crate) fn read_bytes_and_revision(path: &Path) -> io::Result<(Vec<u8>, String)> {
    let mut file = File::open(path)?;
    let mut contents = Vec::new();
    file.read_to_end(&mut contents)?;
    let revision = content_revision(&contents);
    Ok((contents, revision))
}

pub(crate) fn current_revision(path: &Path) -> io::Result<Option<String>> {
    match fs::read(path) {
        Ok(contents) => Ok(Some(content_revision(&contents))),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

fn revision_conflict(
    actual: Option<String>,
    expected: &RevisionExpectation,
) -> Option<ConditionalWriteResult> {
    let kind = match expected {
        RevisionExpectation::Any => return None,
        RevisionExpectation::Revision { revision } => match actual.as_deref() {
            Some(actual) if actual == revision => return None,
            Some(_) => ConflictKind::Changed,
            None => ConflictKind::Missing,
        },
        RevisionExpectation::Missing => match actual {
            None => return None,
            Some(_) => ConflictKind::Exists,
        },
    };
    Some(ConditionalWriteResult::Conflict {
        kind,
        actual_revision: actual,
    })
}

pub(crate) fn conditional_atomic_write_with<F>(
    path: &Path,
    expected: &RevisionExpectation,
    contents: &[u8],
    write: F,
) -> Result<ConditionalWriteResult, (&'static str, io::Error)>
where
    F: FnOnce(&mut File) -> io::Result<()>,
{
    let actual = current_revision(path).map_err(|error| ("read", error))?;
    if let Some(conflict) = revision_conflict(actual, expected) {
        return Ok(conflict);
    }

    let (temp_path, mut temp_file) =
        create_sibling_temp_file(path).map_err(|error| ("create-temp", error))?;
    let write_result = write(&mut temp_file).and_then(|_| temp_file.sync_all());
    drop(temp_file);
    if let Err(error) = write_result {
        remove_temp_file(&temp_path);
        return Err(("write-temp", error));
    }

    if let Ok(metadata) = fs::metadata(path) {
        if let Err(error) = fs::set_permissions(&temp_path, metadata.permissions()) {
            remove_temp_file(&temp_path);
            return Err(("copy-permissions", error));
        }
    }

    let actual = match current_revision(path) {
        Ok(actual) => actual,
        Err(error) => {
            remove_temp_file(&temp_path);
            return Err(("recheck", error));
        }
    };
    if let Some(conflict) = revision_conflict(actual, expected) {
        remove_temp_file(&temp_path);
        return Ok(conflict);
    }

    if let Err(error) = fs::rename(&temp_path, path) {
        remove_temp_file(&temp_path);
        return Err(("replace", error));
    }
    Ok(ConditionalWriteResult::Success {
        revision: content_revision(contents),
    })
}

pub(crate) fn conditional_atomic_write(
    path: &Path,
    expected: &RevisionExpectation,
    contents: &[u8],
) -> ConditionalWriteResult {
    match conditional_atomic_write_with(path, expected, contents, |file| file.write_all(contents)) {
        Ok(result) => result,
        Err((operation, error)) => ConditionalWriteResult::IoError {
            operation,
            message: error.to_string(),
        },
    }
}

pub(crate) fn conditional_rename(
    source: &Path,
    destination: &Path,
    source_revision: &str,
) -> ConditionalRenameResult {
    let source_actual = match current_revision(source) {
        Ok(revision) => revision,
        Err(error) => {
            return ConditionalRenameResult::IoError {
                operation: "read-source",
                message: error.to_string(),
            }
        }
    };
    if source_actual.as_deref() != Some(source_revision) {
        return ConditionalRenameResult::Conflict {
            path: RenameConflictPath::Source,
            kind: if source_actual.is_some() {
                ConflictKind::Changed
            } else {
                ConflictKind::Missing
            },
            actual_revision: source_actual,
        };
    }
    let destination_actual = match current_revision(destination) {
        Ok(revision) => revision,
        Err(error) => {
            return ConditionalRenameResult::IoError {
                operation: "read-destination",
                message: error.to_string(),
            }
        }
    };
    if destination_actual.is_some() {
        return ConditionalRenameResult::Conflict {
            path: RenameConflictPath::Destination,
            kind: ConflictKind::Exists,
            actual_revision: destination_actual,
        };
    }

    if let Err(error) = fs::rename(source, destination) {
        return ConditionalRenameResult::IoError {
            operation: "rename",
            message: error.to_string(),
        };
    }
    ConditionalRenameResult::Success {
        revision: source_revision.to_owned(),
    }
}
