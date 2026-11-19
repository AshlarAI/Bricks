//! `project_file_read` on temporary folders only: whole files from their first
//! line, ranges, refusals (outside the project, symbolic links, binary, large,
//! invalid ranges), the unknown project, and the checks of the SVG save command.

use bricks_desktop_lib::commands::project_file::{
    READ_LIMIT, SVG_LIMIT, check_svg, language_of, read_any_window, read_window, svg_file_name,
};
use bricks_desktop_lib::contract::IpcErrorCode;
use bricks_desktop_lib::engine::AppState;
use std::path::Path;

fn project() -> tempfile::TempDir {
    tempfile::tempdir().expect("temporary project")
}

fn write(root: &Path, rel: &str, bytes: &[u8]) {
    let path = root.join(rel);
    std::fs::create_dir_all(path.parent().expect("parent")).expect("folders");
    std::fs::write(path, bytes).expect("file");
}

/// `ligne 1\nligne 2\n…` with `n` lines.
fn numbered(n: u32) -> Vec<u8> {
    (1..=n)
        .map(|i| format!("ligne {i}\n"))
        .collect::<String>()
        .into_bytes()
}

/// The lines `ligne first` to `ligne first + count - 1`, as the window holds them.
fn expected_lines(first: u32, count: u32) -> Vec<String> {
    (first..first + count)
        .map(|i| format!("ligne {i}"))
        .collect()
}

fn code_of<T: std::fmt::Debug>(
    result: Result<T, bricks_desktop_lib::contract::IpcError>,
) -> (IpcErrorCode, String) {
    let error = result.expect_err("an error is expected");
    (error.code, error.message)
}

#[test]
fn a_small_file_is_returned_whole() {
    let dir = project();
    write(dir.path(), "notes.txt", b"a\nb\n");
    let window = read_window(dir.path(), "notes.txt", None, None).unwrap();
    assert_eq!(window.path, "notes.txt");
    assert_eq!(window.lines, ["a", "b"]);
    assert_eq!((window.start, window.total_lines), (1, 2));
    assert!(!window.truncated);
    assert_eq!(window.language, None);
}

#[test]
fn a_line_gives_the_whole_file_from_its_first_line() {
    let dir = project();
    write(dir.path(), "big.txt", &numbered(1000));
    let window = read_window(dir.path(), "big.txt", Some(500), None).unwrap();
    assert_eq!(
        window.start, 1,
        "a line does not move the start of the file"
    );
    assert_eq!(window.lines.len(), 1000);
    assert_eq!(window.lines[0], "ligne 1");
    assert!(window.lines.contains(&"ligne 500".to_string()));
    assert!(!window.truncated);
    assert_eq!(window.total_lines, 1000);
}

#[test]
fn a_line_near_the_end_still_gives_the_whole_file() {
    let dir = project();
    write(dir.path(), "big.txt", &numbered(1000));
    let window = read_window(dir.path(), "big.txt", Some(999), None).unwrap();
    assert_eq!(window.start, 1);
    assert_eq!(window.lines.len(), 1000);
    assert_eq!(window.lines.last().unwrap(), "ligne 1000");
}

#[test]
fn a_short_range_in_a_short_file_comes_with_its_context() {
    let dir = project();
    write(dir.path(), "src/main.rs", &numbered(10));
    let window = read_window(dir.path(), "src/main.rs", Some(3), Some(5)).unwrap();
    assert_eq!(
        window.lines.len(),
        10,
        "a ten-line file fits the window: whole"
    );
    assert_eq!(window.start, 1);
    assert!(!window.truncated);
    assert_eq!(window.language.as_deref(), Some("rust"));
}

#[test]
fn a_short_range_in_a_big_file_gives_the_whole_file_from_its_first_line() {
    let dir = project();
    write(dir.path(), "big.txt", &numbered(1000));
    let window = read_window(dir.path(), "big.txt", Some(500), Some(510)).unwrap();
    assert_eq!(window.start, 1);
    assert_eq!(window.lines.len(), 1000);
    assert_eq!(window.lines[0], "ligne 1");
    // Index 499 is line 500, index 509 is line 510.
    assert_eq!(window.lines[499..510].to_vec(), expected_lines(500, 11));
    assert!(
        !window.truncated,
        "a file under the read limit is not truncated"
    );
}

#[test]
fn a_short_range_near_either_end_still_gives_the_whole_file() {
    let dir = project();
    write(dir.path(), "big.txt", &numbered(1000));
    let end = read_window(dir.path(), "big.txt", Some(995), Some(1000)).unwrap();
    assert_eq!(end.start, 1);
    assert_eq!(end.lines.len(), 1000);
    assert_eq!(end.lines.last().unwrap(), "ligne 1000");

    let start = read_window(dir.path(), "big.txt", Some(2), Some(4)).unwrap();
    assert_eq!(start.start, 1);
    assert_eq!(start.lines.len(), 1000);
    assert_eq!(start.lines[1], "ligne 2");
}

#[test]
fn a_long_range_still_gives_the_whole_file_from_its_first_line() {
    let dir = project();
    write(dir.path(), "big.txt", &numbered(1000));
    let exact = read_window(dir.path(), "big.txt", Some(100), Some(499)).unwrap();
    assert_eq!(exact.start, 1);
    assert_eq!(exact.lines.len(), 1000);
    let longer = read_window(dir.path(), "big.txt", Some(100), Some(600)).unwrap();
    assert_eq!(longer.start, 1);
    assert_eq!(longer.lines.len(), 1000);
    assert_eq!(longer.lines.last().unwrap(), "ligne 1000");
}

#[test]
fn every_range_gives_the_whole_file_from_its_first_line() {
    for total in [1u32, 2, 401, 500, 1000] {
        let dir = project();
        write(dir.path(), "f.txt", &numbered(total));
        let everything = expected_lines(1, total);
        for line in (1..=total).step_by(37) {
            for end in [
                line,
                line + 1,
                line + 9,
                line + 150,
                line + 399,
                line + 400,
                total,
            ] {
                let end = end.min(total);
                let window = read_window(dir.path(), "f.txt", Some(line), Some(end)).unwrap();
                assert_eq!(window.start, 1, "{total} lines, range {line}..={end}");
                assert_eq!(
                    window.total_lines, total,
                    "{total} lines, range {line}..={end}"
                );
                assert_eq!(
                    window.lines, everything,
                    "{total} lines, range {line}..={end}"
                );
                assert!(!window.truncated, "{total} lines, range {line}..={end}");
            }
        }
    }
}

#[test]
fn a_range_is_clamped_to_the_file_and_gives_the_whole_file() {
    let dir = project();
    write(dir.path(), "big.txt", &numbered(1000));
    let long = read_window(dir.path(), "big.txt", Some(1), Some(1000)).unwrap();
    assert_eq!(long.start, 1);
    assert_eq!(long.lines.len(), 1000);
    assert_eq!(long.lines.last().unwrap(), "ligne 1000");

    write(dir.path(), "short.txt", &numbered(10));
    let clamped = read_window(dir.path(), "short.txt", Some(9), Some(50)).unwrap();
    assert_eq!(clamped.start, 1);
    assert_eq!(clamped.lines.len(), 10, "the end is clamped to the file");
    assert!(!clamped.truncated);
}

#[test]
fn invalid_ranges_are_refused_with_a_clear_message() {
    let dir = project();
    write(dir.path(), "short.txt", &numbered(10));
    let (code, message) = code_of(read_window(dir.path(), "short.txt", Some(20), None));
    assert_eq!(code, IpcErrorCode::Invalid);
    assert!(message.contains("is past the end"), "{message}");

    let (code, message) = code_of(read_window(dir.path(), "short.txt", Some(20), Some(25)));
    assert_eq!(code, IpcErrorCode::Invalid);
    assert!(message.contains("is past the end"), "{message}");

    let (code, message) = code_of(read_window(dir.path(), "short.txt", Some(5), Some(3)));
    assert_eq!(code, IpcErrorCode::Invalid);
    assert!(message.contains("invalid range"), "{message}");

    let (code, _) = code_of(read_window(dir.path(), "short.txt", Some(0), None));
    assert_eq!(code, IpcErrorCode::Invalid);

    let (code, _) = code_of(read_window(dir.path(), "short.txt", None, Some(3)));
    assert_eq!(code, IpcErrorCode::Invalid);

    // Whole files are read too: a line past the end of a long one is refused as well.
    write(dir.path(), "big.txt", &numbered(1000));
    let (code, message) = code_of(read_window(dir.path(), "big.txt", Some(1001), Some(1002)));
    assert_eq!(code, IpcErrorCode::Invalid);
    assert!(message.contains("is past the end"), "{message}");
}

#[test]
fn an_absent_file_is_not_found() {
    let dir = project();
    let (code, message) = code_of(read_window(dir.path(), "src/absent.rs", None, None));
    assert_eq!(code, IpcErrorCode::NotFound);
    assert!(message.contains("doesn’t exist"), "{message}");
}

#[test]
fn paths_outside_the_project_are_refused() {
    let dir = project();
    write(dir.path(), "inside.txt", b"x\n");
    for rel in [
        "../secret.txt",
        "a/../../secret.txt",
        "/etc/hosts",
        "",
        "./inside.txt",
    ] {
        let (code, _) = code_of(read_window(dir.path(), rel, None, None));
        assert_eq!(code, IpcErrorCode::Invalid, "refused: {rel:?}");
    }
}

#[test]
fn a_folder_is_not_a_file() {
    let dir = project();
    std::fs::create_dir_all(dir.path().join("src")).unwrap();
    let (code, message) = code_of(read_window(dir.path(), "src", None, None));
    assert_eq!(code, IpcErrorCode::Invalid);
    assert!(message.contains("isn’t a file"), "{message}");
}

#[cfg(unix)]
#[test]
fn a_symbolic_link_leaving_the_project_is_refused() {
    let project = project();
    let outside = project_outside();
    write(outside.path(), "secret.txt", b"hors projet\n");
    std::os::unix::fs::symlink(
        outside.path().join("secret.txt"),
        project.path().join("link.txt"),
    )
    .unwrap();
    let (code, message) = code_of(read_window(project.path(), "link.txt", None, None));
    assert_eq!(code, IpcErrorCode::Invalid);
    assert!(message.contains("leaves the project"), "{message}");
}

#[cfg(unix)]
#[test]
fn a_symbolic_link_inside_the_project_is_followed() {
    let dir = project();
    write(dir.path(), "real/notes.md", b"# titre\n");
    std::os::unix::fs::symlink(
        dir.path().join("real/notes.md"),
        dir.path().join("alias.md"),
    )
    .unwrap();
    let window = read_window(dir.path(), "alias.md", None, None).unwrap();
    assert_eq!(window.lines, ["# titre"]);
    assert_eq!(window.language.as_deref(), Some("markdown"));
}

#[test]
fn a_binary_file_is_refused() {
    let dir = project();
    write(dir.path(), "image.dat", b"PNG\0\x01\x02 texte");
    let (code, message) = code_of(read_window(dir.path(), "image.dat", None, None));
    assert_eq!(code, IpcErrorCode::Invalid);
    assert!(message.contains("binary file"), "{message}");
}

#[test]
fn invalid_utf8_is_refused_as_not_text() {
    let dir = project();
    write(dir.path(), "latin.txt", b"caf\xe9\n");
    let (code, message) = code_of(read_window(dir.path(), "latin.txt", None, None));
    assert_eq!(code, IpcErrorCode::Invalid);
    assert!(message.contains("UTF-8"), "{message}");
}

#[test]
fn a_large_file_is_read_up_to_the_limit_only() {
    let dir = project();
    // 3 MiB of 100-byte lines: the read stops at the limit, on a line boundary.
    let line = format!("{}\n", "x".repeat(99));
    let content = line.repeat(3 * 1024 * 1024 / line.len());
    assert!(content.len() as u64 > READ_LIMIT);
    write(dir.path(), "large.log", content.as_bytes());
    let window = read_window(dir.path(), "large.log", None, None).unwrap();
    assert!(window.truncated);
    assert_eq!(window.start, 1);
    // 2 MiB hold exactly 20 971 whole lines of 100 bytes: the rest of the read is cut away.
    let read_lines = READ_LIMIT / line.len() as u64;
    assert_eq!(
        u64::from(window.total_lines),
        read_lines,
        "the read stops at the limit"
    );
    assert_eq!(window.lines.len(), usize::try_from(read_lines).unwrap());
}

#[test]
fn spaces_and_unicode_in_names_work() {
    let dir = project();
    write(
        dir.path(),
        "dossier avec espaces/été élève.md",
        "été\n".as_bytes(),
    );
    let window = read_window(dir.path(), "dossier avec espaces/été élève.md", None, None).unwrap();
    assert_eq!(window.lines, ["été"]);
    assert_eq!(window.language.as_deref(), Some("markdown"));
}

#[test]
fn crlf_line_endings_lose_their_carriage_return() {
    let dir = project();
    write(dir.path(), "win.txt", b"un\r\ndeux\r\n");
    let window = read_window(dir.path(), "win.txt", None, None).unwrap();
    assert_eq!(window.lines, ["un", "deux"]);
}

#[test]
fn an_empty_file_has_no_lines() {
    let dir = project();
    write(dir.path(), "vide.txt", b"");
    let window = read_window(dir.path(), "vide.txt", None, None).unwrap();
    assert!(window.lines.is_empty());
    assert_eq!((window.start, window.total_lines), (1, 0));
    let (code, _) = code_of(read_window(dir.path(), "vide.txt", Some(1), None));
    assert_eq!(code, IpcErrorCode::Invalid);
}

#[test]
fn a_last_line_without_a_newline_is_a_line() {
    let dir = project();
    write(dir.path(), "fin.txt", b"premiere\nderniere");
    let window = read_window(dir.path(), "fin.txt", None, None).unwrap();
    assert_eq!(window.lines, ["premiere", "derniere"]);
    assert_eq!(window.total_lines, 2);
    // A short file comes whole, with the range inside it: the last line is still a line.
    let last = read_window(dir.path(), "fin.txt", Some(2), Some(2)).unwrap();
    assert_eq!(last.lines, ["premiere", "derniere"]);
    assert_eq!(last.start, 1);
}

#[test]
fn a_line_equal_to_the_total_is_the_last_line_of_the_file() {
    let dir = project();
    write(dir.path(), "dix.txt", &numbered(10));
    let window = read_window(dir.path(), "dix.txt", Some(10), None).unwrap();
    assert_eq!(window.total_lines, 10);
    assert_eq!(window.start, 1, "a short file is returned whole");
    assert_eq!(window.lines.last().unwrap(), "ligne 10");
    let range = read_window(dir.path(), "dix.txt", Some(10), Some(10)).unwrap();
    assert_eq!(range.lines.len(), 10, "the range is inside the short file");
    assert_eq!(range.start, 1);
    assert_eq!(range.lines.last().unwrap(), "ligne 10");
}

#[test]
fn an_unknown_project_is_not_found() {
    let home = project();
    let state = AppState::assemble(
        home.path().to_path_buf(),
        Err("registre absent".to_string()),
    );
    let (code, _) = code_of(state.project_path("projet-inconnu"));
    assert_eq!(code, IpcErrorCode::NotFound);
}

#[test]
fn languages_follow_the_extension() {
    assert_eq!(language_of("src/a.ts").as_deref(), Some("typescript"));
    assert_eq!(language_of("src/a.svelte").as_deref(), Some("xml"));
    assert_eq!(language_of("Makefile").as_deref(), Some("makefile"));
    assert_eq!(language_of("notes.txt"), None);
    assert_eq!(language_of(".gitignore"), None);
}

#[test]
fn only_svg_documents_of_bounded_size_are_saved() {
    assert!(check_svg("<?xml version=\"1.0\"?><svg></svg>").is_ok());
    assert!(check_svg("  \n<svg xmlns=\"http://www.w3.org/2000/svg\"/>").is_ok());
    assert!(check_svg("<html><script>alert(1)</script></html>").is_err());
    assert!(check_svg("").is_err());
    let big = format!("<svg>{}</svg>", "a".repeat(SVG_LIMIT));
    assert!(check_svg(&big).is_err());
}

#[test]
fn the_proposed_name_is_a_plain_svg_file_name() {
    assert_eq!(svg_file_name("diagramme.svg"), "diagramme.svg");
    assert_eq!(svg_file_name("flux"), "flux.svg");
    assert_eq!(svg_file_name("../../etc/passwd"), "passwd.svg");
    assert_eq!(svg_file_name("  "), "diagramme.svg");
    assert_eq!(svg_file_name("Diagramme.SVG"), "Diagramme.SVG");
}

/// A second temporary folder, outside the project of a test.
fn project_outside() -> tempfile::TempDir {
    tempfile::tempdir().expect("outside folder")
}

#[test]
fn read_any_window_reads_external_absolute_paths_and_normalizes_in_project_paths() {
    let dir = project();
    let outside = project_outside();
    write(dir.path(), "src/main.rs", b"fn main() {}\n");
    write(outside.path(), "other.ts", b"const a = 1\nconst b = 2\n");

    let inside_abs = dir.path().join("src/main.rs");
    let inside = read_any_window(
        Some(dir.path()),
        inside_abs.to_str().expect("utf8 path"),
        Some(1),
        None,
    )
    .expect("reads project file given as absolute path");
    assert_eq!(inside.path, "src/main.rs");
    assert_eq!(inside.lines, ["fn main() {}"]);

    let outside_abs = outside.path().join("other.ts");
    let ext = read_any_window(
        None,
        outside_abs.to_str().expect("utf8 path"),
        Some(2),
        None,
    )
    .expect("reads external file without a project");
    assert_eq!(
        ext.path,
        std::fs::canonicalize(&outside_abs)
            .unwrap()
            .to_string_lossy()
    );
    assert_eq!(ext.lines, ["const a = 1", "const b = 2"]);
    assert_eq!(ext.language.as_deref(), Some("typescript"));

    let traversal = outside.path().join("sub/../other.ts");
    let (code, _) = code_of(read_any_window(
        None,
        traversal.to_str().expect("utf8 path"),
        None,
        None,
    ));
    assert_eq!(code, IpcErrorCode::Invalid);

    let (code, _) = code_of(read_any_window(None, "relative.rs", None, None));
    assert_eq!(code, IpcErrorCode::Invalid);
}
