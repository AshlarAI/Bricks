//! Where the full text of a transformed output can be read back.
//!
//! Every reduced output names its original. For a file view that is the file
//! itself (read it with `offset`/`limit`); for a command output it is a copy
//! saved by a [`RawStore`] in a session directory, readable with the ordinary
//! `Read` tool. Nothing is promised beyond what was actually saved: when no
//! store is available the header says so.

use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

/// A saved original.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawRef {
    pub path: PathBuf,
    pub lines: usize,
    pub bytes: usize,
}

impl RawRef {
    /// How to read it, in the terms of the `Read` tool.
    pub fn hint(&self) -> String {
        format!(
            "Read file_path=\"{}\" ({} lines; use offset/limit to page)",
            self.path.display(),
            self.lines
        )
    }
}

/// Saves originals as files in one directory.
#[derive(Debug)]
pub struct RawStore {
    dir: PathBuf,
    seq: AtomicU64,
}

impl RawStore {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        let dir = dir.into();
        let max_seq = scan_max_seq(&dir);
        Self {
            dir,
            seq: AtomicU64::new(max_seq),
        }
    }

    /// A per-session directory under the system temporary directory.
    pub fn for_session(session_id: &str) -> Self {
        Self::new(
            std::env::temp_dir()
                .join("bricks")
                .join("raw-outputs")
                .join(sanitize(session_id, 80)),
        )
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// True when `path` is one of this store's files: reading it back must
    /// never be reduced again.
    pub fn contains(&self, path: &str) -> bool {
        let p = Path::new(path);
        p.starts_with(&self.dir)
            || std::fs::canonicalize(p)
                .ok()
                .zip(std::fs::canonicalize(&self.dir).ok())
                .is_some_and(|(a, d)| a.starts_with(d))
    }

    /// Save `content`; the file name carries a sequence number and `label`.
    pub fn put(&self, label: &str, content: &str) -> std::io::Result<RawRef> {
        std::fs::create_dir_all(&self.dir)?;
        let label = sanitize(label, 60);
        loop {
            let n = self.seq.fetch_add(1, Ordering::Relaxed) + 1;
            let path = self.dir.join(format!("{n:05}-{label}.txt"));
            match std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)
            {
                Ok(mut f) => {
                    if let Err(e) = f.write_all(content.as_bytes()) {
                        drop(f);
                        let _ = std::fs::remove_file(&path);
                        return Err(e);
                    }
                    return Ok(RawRef {
                        path,
                        lines: content.lines().count(),
                        bytes: content.len(),
                    });
                }
                Err(e) if e.kind() == ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(e),
            }
        }
    }
}

fn scan_max_seq(dir: &Path) -> u64 {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == ErrorKind::NotFound => return 0,
        Err(_) => return 0,
    };
    let mut max_seq = 0u64;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let Some((prefix, _)) = name.split_once('-') else {
            continue;
        };
        if prefix.len() >= 5
            && prefix.bytes().all(|b| b.is_ascii_digit())
            && let Ok(n) = prefix.parse::<u64>()
        {
            max_seq = max_seq.max(n);
        }
    }
    max_seq
}

fn sanitize(s: &str, max: usize) -> String {
    let out: String = s
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .take(max)
        .collect();
    if out.is_empty() { "output".into() } else { out }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_and_recognises_its_files() {
        let dir = tempfile::tempdir().unwrap();
        let store = RawStore::new(dir.path().join("raw"));
        let r = store.put("Bash toolu_01/../x", "a\nb\nc\n").unwrap();
        assert_eq!((r.lines, r.bytes), (3, 6));
        assert_eq!(std::fs::read_to_string(&r.path).unwrap(), "a\nb\nc\n");
        assert!(
            r.path
                .file_name()
                .unwrap()
                .to_str()
                .unwrap()
                .starts_with("00001-Bash_toolu_01____x")
        );
        assert!(store.contains(r.path.to_str().unwrap()));
        assert!(!store.contains("/etc/hosts"));
        assert!(r.hint().contains("3 lines"));

        // Reopened on the same directory: numbering continues.
        let again = RawStore::new(dir.path().join("raw"));
        let r2 = again.put("Bash", "other").unwrap();
        assert!(
            r2.path
                .file_name()
                .unwrap()
                .to_str()
                .unwrap()
                .starts_with("00002-")
        );
        assert_eq!(std::fs::read_to_string(&r.path).unwrap(), "a\nb\nc\n");
    }

    #[test]
    fn new_scans_highest_existing_prefix_and_does_not_overwrite() {
        let dir = tempfile::tempdir().unwrap();
        let raw_dir = dir.path().join("raw");
        std::fs::create_dir_all(raw_dir.join("web")).unwrap();
        std::fs::write(raw_dir.join("00001-first.txt"), "one").unwrap();
        std::fs::write(raw_dir.join("00007-seventh.txt"), "seven").unwrap();
        std::fs::write(raw_dir.join("notes.txt"), "ignore").unwrap();
        std::fs::write(raw_dir.join("abcde-other.txt"), "ignore").unwrap();

        let store = RawStore::new(&raw_dir);
        let r = store.put("Bash", "eight").unwrap();
        assert!(
            r.path
                .file_name()
                .unwrap()
                .to_str()
                .unwrap()
                .starts_with("00008-Bash"),
            "{}",
            r.path.display()
        );
        assert_eq!(
            std::fs::read_to_string(raw_dir.join("00001-first.txt")).unwrap(),
            "one"
        );
        assert_eq!(
            std::fs::read_to_string(raw_dir.join("00007-seventh.txt")).unwrap(),
            "seven"
        );
        assert_eq!(std::fs::read_to_string(&r.path).unwrap(), "eight");
    }

    #[test]
    fn put_falls_back_on_already_exists_collision() {
        let dir = tempfile::tempdir().unwrap();
        let raw_dir = dir.path().join("raw");
        let store = RawStore::new(&raw_dir);
        std::fs::create_dir_all(&raw_dir).unwrap();
        // Simulate an external writer creating 00001-Bash.txt after RawStore::new.
        let colliding = raw_dir.join("00001-Bash.txt");
        std::fs::write(&colliding, "preexisting").unwrap();

        let r = store.put("Bash", "fresh").unwrap();
        assert_eq!(
            r.path.file_name().unwrap().to_str().unwrap(),
            "00002-Bash.txt"
        );
        assert_eq!(std::fs::read_to_string(&colliding).unwrap(), "preexisting");
        assert_eq!(std::fs::read_to_string(&r.path).unwrap(), "fresh");
    }

    #[test]
    fn concurrent_puts_produce_unique_sequential_files() {
        use std::collections::BTreeSet;

        let dir = tempfile::tempdir().unwrap();
        let store = RawStore::new(dir.path().join("raw"));
        let results: Vec<Vec<RawRef>> = std::thread::scope(|s| {
            let mut handles = Vec::new();
            for t in 0..8 {
                let store = &store;
                handles.push(s.spawn(move || {
                    (0..25)
                        .map(|i| {
                            let body = format!("thread-{t}-item-{i}");
                            store.put("worker", &body).unwrap()
                        })
                        .collect::<Vec<_>>()
                }));
            }
            handles.into_iter().map(|h| h.join().unwrap()).collect()
        });

        let mut names = BTreeSet::new();
        for (t, batch) in results.into_iter().enumerate() {
            for (i, r) in batch.into_iter().enumerate() {
                let name = r.path.file_name().unwrap().to_str().unwrap().to_string();
                assert!(names.insert(name.clone()), "duplicate filename {name}");
                assert_eq!(
                    std::fs::read_to_string(&r.path).unwrap(),
                    format!("thread-{t}-item-{i}")
                );
            }
        }
        assert_eq!(names.len(), 200);
        assert!(names.contains("00001-worker.txt"));
        assert!(names.contains("00200-worker.txt"));
    }
}
