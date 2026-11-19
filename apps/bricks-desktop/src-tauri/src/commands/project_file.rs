//! Read-only windows of files for the file references of messages
//! (`path:line`, `path:line-end`, or `file://` URLs), and the save dialog of
//! SVG / PNG diagrams.
//!
//! Relative paths stay confined to the project folder (`read_window`); absolute
//! paths (`read_any_window`) are canonicalized without `..` and opened in the
//! same read-only window (never reading more than `READ_LIMIT` bytes, refusing
//! binary and non UTF-8 content). A window holds the whole file read.

use crate::contract::{IpcError, IpcErrorCode, IpcResult, ProjectFileWindow};
use crate::engine::AppState;
use crate::git::{is_binary_content, validate_relative_path};
use crate::i18n::{msg, tr};
use crate::services::{invalid, io_error, join_error, not_found};
use std::fs::File;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use tauri::State;
use tauri_plugin_dialog::DialogExt;

/// Longest path accepted by `read_any_window`, matching the other path commands.
const PATH_LIMIT: usize = 4096;

/// Bytes read from one file at most; the rest of a larger file is not read.
pub const READ_LIMIT: u64 = 2 * 1024 * 1024;
/// Largest SVG document saved.
pub const SVG_LIMIT: usize = 5 * 1024 * 1024;

/// The window of `rel` (a path relative to the project folder `root`) asked
/// by `line` and `end_line` (1-based, inclusive), which are checked against the
/// file: the window is always the whole file read, from line 1.
pub fn read_window(
    root: &Path,
    rel: &str,
    line: Option<u32>,
    end_line: Option<u32>,
) -> IpcResult<ProjectFileWindow> {
    validate_relative_path(rel)?;
    let root = canonical_root(root, &tr!(msg::THE_PROJECT_FOLDER))?;
    let target = canonical_or_missing(&root.join(rel), rel)?
        .ok_or_else(|| not_found(tr!(msg::DOESNT_EXIST_IN_THE_PROJECT, rel = rel)))?;
    if !target.starts_with(&root) {
        return Err(invalid(tr!(
            msg::LEAVES_THE_PROJECT_THE_SYMBOLIC_LINK,
            rel = rel
        )));
    }
    read_target(&target, rel, line, end_line)
}

/// The canonical form of the folder `root`, every link followed. `what` names
/// the folder in the error when it cannot be read any more.
pub(crate) fn canonical_root(root: &Path, what: &str) -> IpcResult<PathBuf> {
    std::fs::canonicalize(root).map_err(|e| IpcError {
        code: IpcErrorCode::FolderMissing,
        message: tr!(msg::IS_NO_LONGER_ACCESSIBLE, what = what, e = e),
    })
}

/// The canonical form of `candidate` (every link followed), `None` when nothing
/// is there: a missing entry, a parent that is not a folder, a broken link.
/// `shown` names the file in the error of any other failure.
pub(crate) fn canonical_or_missing(candidate: &Path, shown: &str) -> IpcResult<Option<PathBuf>> {
    match std::fs::canonicalize(candidate) {
        Ok(path) => Ok(Some(path)),
        Err(e) if is_missing_entry(&e) => Ok(None),
        Err(e) => Err(io_error(&tr!(msg::READING_2, shown = shown), e)),
    }
}

/// Whether an I/O error says that nothing is at the path (missing entry, or a
/// parent that is a file).
fn is_missing_entry(e: &std::io::Error) -> bool {
    matches!(
        e.kind(),
        std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory
    )
}

/// The window of `target`, a canonical path of a regular file, asked by `line`
/// and `end_line` (see `read_window`). `shown` is the path the caller knows the
/// file by: it is the name in the messages and in the window.
pub(crate) fn read_target(
    target: &Path,
    shown: &str,
    line: Option<u32>,
    end_line: Option<u32>,
) -> IpcResult<ProjectFileWindow> {
    let meta =
        std::fs::metadata(target).map_err(|e| io_error(&tr!(msg::READING_2, shown = shown), e))?;
    if !meta.is_file() {
        return Err(invalid(tr!(msg::ISNT_A_FILE, shown = shown)));
    }

    let mut bytes = Vec::new();
    File::open(target)
        .and_then(|file| file.take(READ_LIMIT + 1).read_to_end(&mut bytes))
        .map_err(|e| io_error(&tr!(msg::READING_2, shown = shown), e))?;
    let truncated = bytes.len() as u64 > READ_LIMIT;
    if truncated {
        // Cut after the last newline: no half line, no half UTF-8 character.
        bytes.truncate(READ_LIMIT as usize);
        match bytes.iter().rposition(|b| *b == b'\n') {
            Some(pos) => bytes.truncate(pos + 1),
            None => bytes.clear(),
        }
    }
    if is_binary_content(&bytes) {
        return Err(invalid(tr!(
            msg::IS_A_BINARY_FILE_NO_PREVIEW,
            shown = shown
        )));
    }
    let text = std::str::from_utf8(&bytes)
        .map_err(|_| invalid(tr!(msg::ISNT_UTF_8_TEXT, shown = shown)))?;

    let mut lines: Vec<String> = text
        .split('\n')
        .map(|line| line.strip_suffix('\r').unwrap_or(line).to_string())
        .collect();
    if text.is_empty() || text.ends_with('\n') {
        lines.pop();
    }
    let total = u32::try_from(lines.len()).unwrap_or(u32::MAX);

    let (first, last) = window_bounds(total, line, end_line)?;
    let window = if first <= last {
        lines[(first - 1) as usize..last as usize].to_vec()
    } else {
        Vec::new()
    };

    Ok(ProjectFileWindow {
        path: shown.to_string(),
        start: first,
        lines: window,
        total_lines: total,
        truncated,
        language: language_of(shown),
    })
}

/// First and last line (1-based, inclusive) of the window of a file of
/// `total` lines, once `line` and `end_line` are checked. An empty file gives `(1, 0)`.
fn window_bounds(total: u32, line: Option<u32>, end_line: Option<u32>) -> IpcResult<(u32, u32)> {
    match (line, end_line) {
        (None, Some(_)) => return Err(invalid(tr!(msg::A_RANGE_END_WITH_NO_START))),
        (Some(0), _) => return Err(invalid(tr!(msg::LINES_START_AT_1))),
        (Some(line), _) if line > total => return Err(beyond_end(line, total)),
        (Some(line), Some(end)) if end < line => {
            return Err(invalid(tr!(
                msg::INVALID_RANGE_THE_END_COMES_BEFORE,
                end = end,
                line = line
            )));
        }
        _ => {}
    }
    Ok((1, total))
}

fn beyond_end(line: u32, total: u32) -> IpcError {
    invalid(tr!(
        msg::LINE_IS_PAST_THE_END_OF,
        line = line,
        total = total
    ))
}

/// Highlight.js language of a file name, from its extension (`None` when
/// unknown). The frontend still checks that the language is registered.
pub fn language_of(rel: &str) -> Option<String> {
    let name = Path::new(rel).file_name()?.to_str()?.to_ascii_lowercase();
    if name == "makefile" {
        return Some("makefile".into());
    }
    let (stem, ext) = name.rsplit_once('.')?;
    if stem.is_empty() {
        return None;
    }
    let language = match ext {
        "rs" => "rust",
        "ts" | "mts" | "cts" | "tsx" => "typescript",
        "js" | "mjs" | "cjs" | "jsx" => "javascript",
        "json" => "json",
        "svelte" | "html" | "htm" | "vue" | "xml" | "svg" => "xml",
        "css" => "css",
        "scss" => "scss",
        "md" | "markdown" => "markdown",
        "py" => "python",
        "rb" => "ruby",
        "go" => "go",
        "java" => "java",
        "kt" | "kts" => "kotlin",
        "swift" => "swift",
        "c" | "h" => "c",
        "cc" | "cpp" | "cxx" | "hpp" | "hh" => "cpp",
        "cs" => "csharp",
        "php" => "php",
        "sh" | "bash" | "zsh" => "bash",
        "sql" => "sql",
        "yml" | "yaml" => "yaml",
        "toml" | "ini" | "cfg" => "ini",
        "diff" | "patch" => "diff",
        "lua" => "lua",
        _ => return None,
    };
    Some(language.into())
}

/// Validates an absolute path for read-only inspection (`read_any_window`):
/// rejects empty/oversized/NUL strings, drive-relative paths (`C:foo.txt`), and
/// `.` / `..` components.
fn validate_absolute_path(path: &str) -> IpcResult<()> {
    if path.is_empty() || path.len() > PATH_LIMIT || path.contains('\0') {
        return Err(invalid(tr!(msg::INVALID_PATH)));
    }
    let mut components = Path::new(path).components();
    if matches!(components.next(), Some(Component::Prefix(_)))
        && !matches!(components.next(), Some(Component::RootDir))
    {
        return Err(invalid(tr!(msg::INVALID_PATH)));
    }
    let escapes = Path::new(path).components().any(|c| {
        !matches!(
            c,
            Component::Prefix(_) | Component::RootDir | Component::Normal(_)
        )
    });
    if escapes {
        return Err(invalid(tr!(msg::INVALID_PATH)));
    }
    Ok(())
}

/// Normalizes a canonical file `target` for display: project-relative when it
/// sits inside `root`, otherwise the canonical absolute path.
fn normalize_shown_path(root: Option<&Path>, target: &Path) -> String {
    if let Some(canon_root) = root.and_then(|r| std::fs::canonicalize(r).ok())
        && let Ok(rel) = target.strip_prefix(&canon_root)
        && !rel.as_os_str().is_empty()
    {
        return rel.to_string_lossy().replace('\\', "/");
    }
    target.to_string_lossy().into_owned()
}

/// Reads a window of a relative project file (`read_window`) or a read-only
/// canonical absolute path.
pub fn read_any_window(
    root: Option<&Path>,
    path: &str,
    line: Option<u32>,
    end_line: Option<u32>,
) -> IpcResult<ProjectFileWindow> {
    if Path::new(path).is_absolute() {
        validate_absolute_path(path)?;
        let target = canonical_or_missing(Path::new(path), path)?
            .ok_or_else(|| not_found(tr!(msg::NO_LONGER_EXISTS, path = path)))?;
        let shown = normalize_shown_path(root, &target);
        return read_target(&target, &shown, line, end_line);
    }
    let root = root.ok_or_else(|| invalid(tr!(msg::INVALID_PATH_IT_MUST_BE_RELATIVE)))?;
    read_window(root, path, line, end_line)
}

/// Reads the window of a file in the project `project_id`, or an absolute path
/// for multi-path references (see `read_any_window`).
#[tauri::command]
pub async fn project_file_read(
    state: State<'_, AppState>,
    project_id: String,
    path: String,
    line: Option<u32>,
    end_line: Option<u32>,
) -> IpcResult<ProjectFileWindow> {
    let root = if Path::new(&path).is_absolute() {
        if project_id.is_empty() {
            None
        } else {
            state.project_path(&project_id).ok()
        }
    } else {
        Some(state.project_path(&project_id)?)
    };
    tokio::task::spawn_blocking(move || read_any_window(root.as_deref(), &path, line, end_line))
        .await
        .map_err(join_error)?
}

/// What `save_svg_file` accepts: an SVG document of at most `SVG_LIMIT` bytes.
pub fn check_svg(contents: &str) -> IpcResult<()> {
    if contents.len() > SVG_LIMIT {
        return Err(invalid(tr!(msg::DIAGRAM_TOO_LARGE_TO_SAVE_5)));
    }
    let head = contents.trim_start();
    if !(head.starts_with("<?xml") || head.starts_with("<svg")) {
        return Err(invalid(tr!(msg::THE_CONTENT_ISNT_AN_SVG_DOCUMENT)));
    }
    Ok(())
}

/// The file name proposed by the save dialog: no folder, always `.svg`.
pub fn svg_file_name(requested: &str) -> String {
    let cleaned = requested.replace('\0', "");
    let base = Path::new(cleaned.trim())
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .unwrap_or("diagramme");
    if base.to_ascii_lowercase().ends_with(".svg") {
        base.to_string()
    } else {
        format!("{base}.svg")
    }
}

/// Shows the native save dialog and writes `contents` to the file the user
/// picked. `None` when the dialog is cancelled; otherwise the path written.
#[tauri::command]
pub async fn save_svg_file(
    app: tauri::AppHandle,
    default_name: String,
    contents: String,
) -> IpcResult<Option<String>> {
    check_svg(&contents)?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("SVG", &["svg"])
        .set_file_name(svg_file_name(&default_name))
        .save_file(move |picked| {
            let _ = tx.send(picked);
        });
    let picked = rx.await.map_err(|_| IpcError {
        code: IpcErrorCode::Internal,
        message: tr!(msg::THE_SAVE_DIALOG_CLOSED_WITHOUT_AN),
    })?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|e| io_error(&tr!(msg::SAVE_PATH), e))?;
    let shown = path.display().to_string();
    tokio::task::spawn_blocking(move || std::fs::write(&path, contents.as_bytes()))
        .await
        .map_err(join_error)?
        .map_err(|e| io_error(&tr!(msg::WRITING_THE_DIAGRAM), e))?;
    Ok(Some(shown))
}

/// A diagram image too large to be written (32 MiB).
const PNG_LIMIT: usize = 32 * 1024 * 1024;

/// A PNG to write: its signature, within the limit.
pub fn check_png(contents: &[u8]) -> IpcResult<()> {
    if contents.len() > PNG_LIMIT {
        return Err(invalid(tr!(msg::IMAGE_TOO_LARGE_TO_SAVE_32)));
    }
    if !contents.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err(invalid(tr!(msg::THE_CONTENT_ISNT_A_PNG_IMAGE)));
    }
    Ok(())
}

/// The file name proposed by the save dialog: no folder, always `.png`.
pub fn png_file_name(requested: &str) -> String {
    let name = svg_file_name(requested);
    let lower = name.to_ascii_lowercase();
    let base = if lower.ends_with(".png.svg") {
        &name[..name.len() - 8]
    } else if lower.ends_with(".svg") {
        &name[..name.len() - 4]
    } else {
        &name
    };
    format!("{base}.png")
}

/// Shows the native save dialog and writes the PNG `contents` to the file
/// the user picked. `None` when the dialog is cancelled; otherwise the path.
#[tauri::command]
pub async fn save_png_file(
    app: tauri::AppHandle,
    default_name: String,
    contents: Vec<u8>,
) -> IpcResult<Option<String>> {
    check_png(&contents)?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("PNG", &["png"])
        .set_file_name(png_file_name(&default_name))
        .save_file(move |picked| {
            let _ = tx.send(picked);
        });
    let picked = rx.await.map_err(|_| IpcError {
        code: IpcErrorCode::Internal,
        message: tr!(msg::THE_SAVE_DIALOG_CLOSED_WITHOUT_AN),
    })?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|e| io_error(&tr!(msg::SAVE_PATH), e))?;
    let shown = path.display().to_string();
    tokio::task::spawn_blocking(move || std::fs::write(&path, contents))
        .await
        .map_err(join_error)?
        .map_err(|e| io_error(&tr!(msg::WRITING_THE_IMAGE), e))?;
    Ok(Some(shown))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contract::IpcErrorCode;

    const SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";

    #[test]
    fn a_png_with_its_signature_is_accepted() {
        assert!(check_png(SIGNATURE).is_ok());
        let mut bytes = SIGNATURE.to_vec();
        bytes.extend_from_slice(b"\0\0\0\rIHDR");
        assert!(check_png(&bytes).is_ok());
    }

    #[test]
    fn content_without_the_png_signature_is_refused_as_invalid() {
        let cases: [&[u8]; 6] = [
            b"",
            b"<svg/>",
            b"\xff\xd8\xff\xe0JFIF",
            b"\x89PNG\n\r\x1a\n",
            b"\x89PNG\r\n\x1a",
            b"xx\x89PNG\r\n\x1a\n",
        ];
        for bytes in cases {
            let err = check_png(bytes).unwrap_err();
            assert_eq!(err.code, IpcErrorCode::Invalid, "{bytes:?}");
            assert!(err.message.contains("PNG"), "{}", err.message);
        }
    }

    #[test]
    fn an_image_of_exactly_the_limit_is_accepted_and_one_byte_more_is_refused() {
        let mut at_limit = SIGNATURE.to_vec();
        at_limit.resize(PNG_LIMIT, 0);
        assert!(check_png(&at_limit).is_ok());
        at_limit.push(0);
        let err = check_png(&at_limit).unwrap_err();
        assert_eq!(err.code, IpcErrorCode::Invalid);
        assert!(err.message.contains("32 MiB"), "{}", err.message);
    }

    #[test]
    fn the_size_is_checked_before_the_signature() {
        let oversized = vec![0u8; PNG_LIMIT + 1];
        let err = check_png(&oversized).unwrap_err();
        assert!(err.message.contains("32 MiB"), "{}", err.message);
    }

    #[test]
    fn the_png_file_name_is_one_png_name_with_no_folder() {
        assert_eq!(png_file_name("x"), "x.png");
        assert_eq!(png_file_name("x.svg"), "x.png");
        assert_eq!(png_file_name("x.png"), "x.png");
        assert_eq!(png_file_name("X.SVG"), "X.png");
        assert_eq!(png_file_name("x.PNG.SVG"), "x.png");
        assert_eq!(png_file_name("a.svg.png"), "a.svg.png");
        assert_eq!(png_file_name("é.SVG"), "é.png");
    }

    #[test]
    fn the_png_file_name_keeps_only_the_last_component() {
        assert_eq!(png_file_name("dossier/sous/diagramme.svg"), "diagramme.png");
        assert_eq!(png_file_name("/abs/chemin/y.svg"), "y.png");
        assert_eq!(png_file_name("  c.svg  "), "c.png");
    }

    #[test]
    fn the_png_file_name_falls_back_and_drops_nul_bytes() {
        assert_eq!(png_file_name(""), "diagramme.png");
        assert_eq!(png_file_name("a\0b.svg"), "ab.png");
    }
}
