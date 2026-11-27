//! Per-session read file state memoization.
//!
//! Tracks `(canonical_path, offset, limit) -> (mtime_nanos, size, sha256)` so
//! repeated identical `Read` calls in a session return a short `[file_unchanged]`
//! notice while the file is unchanged on disk and has not been invalidated by a
//! write, edit, patch, or `clear()`.

use parking_lot::Mutex;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::Read as _;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::UNIX_EPOCH;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct ReadKey {
    canonical_path: PathBuf,
    offset: usize,
    limit: usize,
}

/// Content fingerprint of a file on disk: modification timestamp, size, and SHA-256 digest.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReadStamp {
    pub mtime_nanos: u128,
    pub size: u64,
    pub sha256: [u8; 32],
}

/// Thread-safe per-session cache of files read by `Read`.
#[derive(Debug, Default)]
pub struct ReadFileState {
    entries: Mutex<HashMap<ReadKey, ReadStamp>>,
}

impl ReadFileState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Retrieve `Arc<ReadFileState>` from `Extensions` (supporting either
    /// `Arc<ReadFileState>` or `ReadFileState` inserted directly).
    pub(crate) fn from_extensions(ext: &crate::Extensions) -> Option<Arc<Self>> {
        ext.get::<Arc<Self>>()
            .map(|wrapped| Arc::clone(&*wrapped))
            .or_else(|| ext.get::<Self>())
    }

    /// Invalidate `path` in `ctx`'s `ReadFileState`, if one is attached.
    pub(crate) fn invalidate_in_ctx(ctx: &crate::ToolContext, path: &Path) {
        if let Some(state) = Self::from_extensions(&ctx.extensions) {
            state.invalidate_path(path);
        }
    }

    /// Returns `true` if `(path, offset, limit)` was previously recorded with the
    /// exact same fingerprint.
    pub fn check_unchanged(
        &self,
        path: &Path,
        offset: usize,
        limit: usize,
        current: &ReadStamp,
    ) -> bool {
        let key = ReadKey {
            canonical_path: canonical_key_path(path),
            offset,
            limit,
        };
        self.entries
            .lock()
            .get(&key)
            .is_some_and(|prev| prev == current)
    }

    /// Record the fingerprint for `(path, offset, limit)`.
    pub fn record(&self, path: &Path, offset: usize, limit: usize, stamp: ReadStamp) {
        let key = ReadKey {
            canonical_path: canonical_key_path(path),
            offset,
            limit,
        };
        self.entries.lock().insert(key, stamp);
    }

    /// Remove all cached windows for `path`.
    pub fn invalidate_path(&self, path: &Path) {
        let target = canonical_key_path(path);
        self.entries
            .lock()
            .retain(|k, _| k.canonical_path != target);
    }

    /// Clear all memoized entries (for example after history compaction).
    pub fn clear(&self) {
        self.entries.lock().clear();
    }
}

fn canonical_key_path(path: &Path) -> PathBuf {
    if let Ok(canon) = std::fs::canonicalize(path) {
        return canon;
    }
    let abs = std::path::absolute(path).unwrap_or_else(|_| path.to_path_buf());
    crate::tool_primitives::fs::canonical_or_missing(&abs)
}

/// Compute `(mtime_nanos, size, sha256)` for `path` using streaming I/O.
pub fn file_fingerprint(path: &Path) -> Option<ReadStamp> {
    let meta = std::fs::metadata(path).ok()?;
    let mtime_nanos = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let size = meta.len();

    let mut file = std::fs::File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    let sha256: [u8; 32] = hasher.finalize().into();

    Some(ReadStamp {
        mtime_nanos,
        size,
        sha256,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn record_check_invalidate_and_clear() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("a.txt");
        std::fs::write(&file, "hello\n").unwrap();

        let state = ReadFileState::default();
        let stamp = file_fingerprint(&file).unwrap();

        assert!(!state.check_unchanged(&file, 0, 100, &stamp));
        state.record(&file, 0, 100, stamp.clone());
        state.record(&file, 10, 50, stamp.clone());

        assert!(state.check_unchanged(&file, 0, 100, &stamp));
        assert!(state.check_unchanged(&file, 10, 50, &stamp));
        assert!(!state.check_unchanged(&file, 0, 50, &stamp));

        std::fs::write(&file, "changed\n").unwrap();
        let stamp2 = file_fingerprint(&file).unwrap();
        assert!(!state.check_unchanged(&file, 0, 100, &stamp2));

        state.invalidate_path(&file);
        assert!(!state.check_unchanged(&file, 0, 100, &stamp));
        assert!(!state.check_unchanged(&file, 10, 50, &stamp));

        state.record(&file, 0, 100, stamp2.clone());
        assert!(state.check_unchanged(&file, 0, 100, &stamp2));
        state.clear();
        assert!(!state.check_unchanged(&file, 0, 100, &stamp2));
    }
}
