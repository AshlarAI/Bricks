//! Grep tool: search file contents with regex or exact text.

use super::*;
use crate::tool_primitives::search as psearch;
use serde::Deserialize;

/// Matches (or files) returned when the call gives no `limit`.
pub const DEFAULT_LIMIT: usize = 100;

/// Lines of context a call may ask for around each match.
pub const MAX_CONTEXT: usize = 10;

/// What a call returns.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
enum OutputMode {
    #[default]
    Content,
    FilesWithMatches,
    Count,
}

pub struct GrepTool;

#[async_trait]
impl Tool for GrepTool {
    fn name(&self) -> &str {
        "Grep"
    }
    fn description(&self) -> &str {
        "Recursively search file contents by regex (or exact text with `literal`), in-process \
         (ripgrep-powered). Respects .gitignore and skips hidden files by default; a file with \
         a NUL byte in the part read is treated as binary and none of its lines are returned. \
         Prefer this over running `rg`/`grep` in Bash — no external tools are required."
    }
    fn permission_level(&self) -> PermissionLevel {
        PermissionLevel::ReadOnly
    }
    fn category(&self) -> ToolCategory {
        ToolCategory::FileSystem
    }

    fn input_schema(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "pattern": { "type": "string", "description": "Regex pattern to search for (exact text when `literal` is true)" },
                "path": { "type": "string", "description": "File or directory to search in, relative to the working directory or absolute (defaults to the working directory)" },
                "glob": { "type": "string", "description": "Whitelist glob to filter files, e.g. *.rs" },
                "type": { "type": "string", "description": "Filter files by language/file type (e.g. rust, py, ts, js, go, md)" },
                "case_insensitive": { "type": "boolean", "description": "Case-insensitive matching", "default": false },
                "hidden": { "type": "boolean", "description": "Include hidden files/directories", "default": false },
                "literal": { "type": "boolean", "description": "Match `pattern` as exact text, without regex syntax", "default": false },
                "multiline": { "type": "boolean", "description": "Enable multi-line matching so patterns can match across line breaks (\\n)", "default": false },
                "no_ignore": { "type": "boolean", "description": "Also search files excluded by .gitignore/.ignore (e.g. target/, node_modules/)", "default": false },
                "output_mode": { "type": "string", "enum": ["content", "files_with_matches", "count"], "description": "content: matching lines as file:line:text; files_with_matches: the paths of the files that match; count: file:number of matching lines", "default": "content" },
                "context": { "type": "integer", "minimum": 0, "maximum": MAX_CONTEXT, "description": "Lines shown before and after each match (content only), as file-line-text, with -- between separate groups", "default": 0 },
                "before_context": { "type": "integer", "minimum": 0, "maximum": MAX_CONTEXT, "description": "Lines shown before each match (content only). Overrides `context` for leading lines" },
                "after_context": { "type": "integer", "minimum": 0, "maximum": MAX_CONTEXT, "description": "Lines shown after each match (content only). Overrides `context` for trailing lines" },
                "only_matching": { "type": "boolean", "description": "In `content` mode, print only the matched substring(s) instead of full lines", "default": false },
                "limit": { "type": "integer", "minimum": 0, "description": "Max matching lines (content) or files (files_with_matches, count) to return (default 100). 0 checks the pattern and path and returns nothing", "default": DEFAULT_LIMIT },
                "offset": { "type": "integer", "minimum": 0, "description": "Number of leading matches (content) or files (files_with_matches, count) to skip before applying `limit`", "default": 0 }
            },
            "required": ["pattern"]
        })
    }

    async fn execute(&self, input: Value, ctx: &ToolContext) -> ToolResult {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Input {
            pattern: String,
            path: Option<String>,
            glob: Option<String>,
            #[serde(rename = "type")]
            file_type: Option<String>,
            #[serde(default)]
            case_insensitive: bool,
            #[serde(default)]
            hidden: bool,
            #[serde(default)]
            literal: bool,
            #[serde(default)]
            multiline: bool,
            #[serde(default)]
            no_ignore: bool,
            #[serde(default)]
            output_mode: OutputMode,
            #[serde(default)]
            context: usize,
            before_context: Option<usize>,
            after_context: Option<usize>,
            #[serde(default)]
            only_matching: bool,
            limit: Option<usize>,
            #[serde(default)]
            offset: usize,
        }

        let input: Input = match crate::tool_feedback::parse_input(self, &input) {
            Ok(i) => i,
            Err(e) => return e,
        };
        if input.context > MAX_CONTEXT {
            return ToolResult::error(format!(
                "`context` is {}; at most {MAX_CONTEXT} lines are shown around a match.",
                input.context
            ));
        }
        if let Some(before) = input.before_context
            && before > MAX_CONTEXT
        {
            return ToolResult::error(format!(
                "`before_context` is {before}; at most {MAX_CONTEXT} lines are shown before a match."
            ));
        }
        if let Some(after) = input.after_context
            && after > MAX_CONTEXT
        {
            return ToolResult::error(format!(
                "`after_context` is {after}; at most {MAX_CONTEXT} lines are shown after a match."
            ));
        }
        let before = input.before_context.unwrap_or(input.context);
        let after = input.after_context.unwrap_or(input.context);
        if (input.context > 0 || before > 0 || after > 0) && input.output_mode != OutputMode::Content
        {
            return ToolResult::error(
                "`context`/`before_context`/`after_context` applies to output_mode \"content\" only; drop it or use content.",
            );
        }
        if input.only_matching && input.output_mode != OutputMode::Content {
            return ToolResult::error(
                "`only_matching` applies to output_mode \"content\" only; drop it or use content.",
            );
        }

        // A relative path is relative to the working directory.
        let search_path = input
            .path
            .as_ref()
            .map(|p| ctx.working_dir.join(p))
            .unwrap_or_else(|| ctx.working_dir.clone());
        if !search_path.exists() {
            return ToolResult::error(format!("Path does not exist: {}", search_path.display()));
        }

        let limit = input.limit.unwrap_or(DEFAULT_LIMIT);
        let mode = match input.output_mode {
            OutputMode::Content => psearch::GrepMode::Lines,
            OutputMode::FilesWithMatches => psearch::GrepMode::Files,
            OutputMode::Count => psearch::GrepMode::Count,
        };
        let opts = psearch::GrepOptions {
            glob_filter: input.glob,
            file_type: input.file_type,
            max_results: Some(limit),
            offset: input.offset,
            case_insensitive: input.case_insensitive,
            no_ignore: input.no_ignore,
            hidden: input.hidden,
            literal: input.literal,
            multiline: input.multiline,
            mode,
            context: input.context,
            before_context: input.before_context,
            after_context: input.after_context,
            only_matching: input.only_matching,
        };

        match psearch::grep_search(&input.pattern, &search_path, opts).await {
            Ok(found) => {
                if limit == 0 {
                    return ToolResult::success("Limit is 0: no match listed.");
                }
                if found.matches.is_empty() && found.files.is_empty() {
                    if input.offset > 0 {
                        return ToolResult::success(format!(
                            "No matches found after offset {}.",
                            input.offset
                        ));
                    }
                    return ToolResult::success("No matches found.");
                }
                let (mut output, shown, unit) = match mode {
                    psearch::GrepMode::Lines => (
                        render_lines(&found.matches, before > 0 || after > 0),
                        found.matches.iter().filter(|m| !m.is_context).count(),
                        "matches",
                    ),
                    psearch::GrepMode::Files => (
                        found
                            .files
                            .iter()
                            .map(|f| f.file.display().to_string())
                            .collect::<Vec<_>>()
                            .join("\n"),
                        found.files.len(),
                        "files",
                    ),
                    psearch::GrepMode::Count => (
                        found
                            .files
                            .iter()
                            .map(|f| format!("{}:{}", f.file.display(), f.count))
                            .collect::<Vec<_>>()
                            .join("\n"),
                        found.files.len(),
                        "files",
                    ),
                };
                // The total is not counted past the limit, never invented.
                if found.more {
                    let singular = if unit == "matches" { "match" } else { "file" };
                    let noun = if shown == 1 { singular } else { unit };
                    if input.offset == 0 {
                        output.push_str(&format!(
                            "\n\n[Showing the first {shown} {noun}; more {unit} exist. Narrow the search with a more specific pattern, `path`, `glob`, or `type`, or raise `limit`.]"
                        ));
                    } else {
                        let start = input.offset + 1;
                        let end = input.offset + shown;
                        let range_label = if shown == 1 {
                            format!("{singular} {start}")
                        } else {
                            format!("{unit} {start}-{end}")
                        };
                        output.push_str(&format!(
                            "\n\n[Showing {range_label} (offset {}, limit {limit}); more {unit} exist. Narrow the search with a more specific pattern, `path`, `glob`, or `type`, or pass `offset: {end}` to continue.]",
                            input.offset
                        ));
                    }
                }
                ToolResult::success(output)
            }
            Err(e) => ToolResult::error(format!("Search failed: {}", e)),
        }
    }
}

/// Matching lines as `file:line:text`, as ripgrep prints them; with context,
/// context lines as `file-line-text` and `--` between groups that are not
/// contiguous.
fn render_lines(lines: &[psearch::SearchMatch], with_context: bool) -> String {
    let mut out = String::new();
    let mut prev_end: Option<(&std::path::Path, usize)> = None;
    for l in lines {
        if with_context
            && let Some((file, end_line)) = prev_end
            && (file != l.file.as_path() || l.line_number > end_line + 1)
        {
            out.push_str("--\n");
        }
        let sep = if l.is_context { '-' } else { ':' };
        out.push_str(&format!(
            "{}{sep}{}{sep}{}\n",
            l.file.display(),
            l.line_number,
            l.line_content
        ));
        let extra_lines = l.line_content.bytes().filter(|&b| b == b'\n').count();
        prev_end = Some((l.file.as_path(), l.line_number + extra_lines));
    }
    out.pop();
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::permissions::AllowAll;
    use std::fs;
    use std::sync::Arc;

    fn ctx_in(dir: &std::path::Path) -> ToolContext {
        ToolContext {
            working_dir: dir.to_path_buf(),
            session_id: "grep-test".into(),
            permissions: Arc::new(AllowAll),
            cost_tracker: Arc::new(CostTracker::new()),
            mcp_manager: None,
            extensions: Extensions::default(),
        }
    }

    #[tokio::test]
    async fn emits_file_line_content_format() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("a.txt"), "one\nTARGET two\nthree\n").unwrap();

        let res = GrepTool
            .execute(
                serde_json::json!({ "pattern": "TARGET", "path": tmp.path().to_str().unwrap() }),
                &ctx_in(tmp.path()),
            )
            .await;

        assert!(!res.is_error, "got: {}", res.content);
        // Format is `file:line:content`.
        let line = res.content.lines().next().unwrap();
        assert!(line.ends_with("a.txt:2:TARGET two"), "line was: {line}");
    }

    #[tokio::test]
    async fn defaults_path_to_working_dir() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("a.txt"), "FINDME\n").unwrap();

        // No `path` provided — should search ctx.working_dir.
        let res = GrepTool
            .execute(
                serde_json::json!({ "pattern": "FINDME" }),
                &ctx_in(tmp.path()),
            )
            .await;

        assert!(!res.is_error, "got: {}", res.content);
        assert!(res.content.contains("a.txt"));
    }

    #[tokio::test]
    async fn reports_no_matches() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("a.txt"), "nothing here\n").unwrap();

        let res = GrepTool
            .execute(
                serde_json::json!({ "pattern": "ABSENT", "path": tmp.path().to_str().unwrap() }),
                &ctx_in(tmp.path()),
            )
            .await;

        assert!(!res.is_error);
        assert_eq!(res.content, "No matches found.");
    }

    #[tokio::test]
    async fn case_insensitive_flag_is_honored() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("a.txt"), "Hello World\n").unwrap();
        let path = tmp.path().to_str().unwrap();

        let off = GrepTool
            .execute(
                serde_json::json!({ "pattern": "hello", "path": path }),
                &ctx_in(tmp.path()),
            )
            .await;
        assert_eq!(off.content, "No matches found.");

        let on = GrepTool
            .execute(
                serde_json::json!({ "pattern": "hello", "path": path, "case_insensitive": true }),
                &ctx_in(tmp.path()),
            )
            .await;
        assert!(on.content.contains("Hello World"));
    }

    #[tokio::test]
    async fn glob_filter_restricts_files() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("a.rs"), "MATCH\n").unwrap();
        fs::write(tmp.path().join("b.txt"), "MATCH\n").unwrap();

        let res = GrepTool
            .execute(
                serde_json::json!({
                    "pattern": "MATCH",
                    "path": tmp.path().to_str().unwrap(),
                    "glob": "*.rs"
                }),
                &ctx_in(tmp.path()),
            )
            .await;

        assert!(!res.is_error);
        assert!(res.content.contains("a.rs"));
        assert!(!res.content.contains("b.txt"));
    }

    #[tokio::test]
    async fn respects_gitignore_unless_hidden_requested() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join(".gitignore"), "build/\n").unwrap();
        fs::create_dir(tmp.path().join("build")).unwrap();
        fs::write(tmp.path().join("src.rs"), "TOKEN\n").unwrap();
        fs::write(tmp.path().join("build/gen.rs"), "TOKEN\n").unwrap();

        let res = GrepTool
            .execute(
                serde_json::json!({ "pattern": "TOKEN", "path": tmp.path().to_str().unwrap() }),
                &ctx_in(tmp.path()),
            )
            .await;

        assert!(!res.is_error);
        // The gitignored build/ dir is skipped; only src.rs matches.
        assert!(res.content.contains("src.rs"));
        assert!(!res.content.contains("gen.rs"), "got: {}", res.content);
    }

    #[tokio::test]
    async fn invalid_regex_is_reported_as_error() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("a.txt"), "x\n").unwrap();

        let res = GrepTool
            .execute(
                serde_json::json!({ "pattern": "(unclosed", "path": tmp.path().to_str().unwrap() }),
                &ctx_in(tmp.path()),
            )
            .await;

        assert!(res.is_error);
        assert!(res.content.contains("Search failed"));
    }

    async fn grep(dir: &std::path::Path, args: serde_json::Value) -> ToolResult {
        GrepTool.execute(args, &ctx_in(dir)).await
    }

    #[tokio::test]
    async fn files_with_matches_lists_each_file_once() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("a.rs"), "hit\nhit\nhit\n").unwrap();
        fs::write(tmp.path().join("b.rs"), "hit\n").unwrap();
        fs::write(tmp.path().join("c.rs"), "miss\n").unwrap();
        let r = grep(
            tmp.path(),
            serde_json::json!({ "pattern": "hit", "output_mode": "files_with_matches" }),
        )
        .await;
        assert!(!r.is_error, "{}", r.content);
        let lines: Vec<&str> = r.content.lines().collect();
        assert_eq!(lines.len(), 2, "{}", r.content);
        assert!(
            lines[0].ends_with("a.rs") && lines[1].ends_with("b.rs"),
            "{}",
            r.content
        );
    }

    #[tokio::test]
    async fn count_gives_matching_lines_per_file_and_limit_counts_files() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("a.rs"), "hit\nhit\nhit\n").unwrap();
        fs::write(tmp.path().join("b.rs"), "hit\n").unwrap();
        let r = grep(
            tmp.path(),
            serde_json::json!({ "pattern": "hit", "output_mode": "count" }),
        )
        .await;
        assert!(
            r.content.contains("a.rs:3") && r.content.contains("b.rs:1"),
            "{}",
            r.content
        );

        let one = grep(
            tmp.path(),
            serde_json::json!({ "pattern": "hit", "output_mode": "count", "limit": 1 }),
        )
        .await;
        assert_eq!(
            one.content.lines().filter(|l| l.contains(".rs:")).count(),
            1,
            "{}",
            one.content
        );
        assert!(
            one.content
                .contains("Showing the first 1 file; more files exist"),
            "{}",
            one.content
        );
    }

    #[tokio::test]
    async fn context_shows_neighbouring_lines_in_groups() {
        let tmp = tempfile::tempdir().unwrap();
        let body: String = (1..=20)
            .map(|i| {
                if i == 5 || i == 15 {
                    "HIT\n".to_string()
                } else {
                    format!("l{i}\n")
                }
            })
            .collect();
        fs::write(tmp.path().join("a.txt"), body).unwrap();
        let r = grep(
            tmp.path(),
            serde_json::json!({ "pattern": "HIT", "context": 1 }),
        )
        .await;
        assert!(!r.is_error, "{}", r.content);
        let lines: Vec<&str> = r.content.lines().collect();
        assert_eq!(lines.len(), 7, "{}", r.content);
        assert!(lines[0].ends_with("a.txt-4-l4"), "{}", r.content);
        assert!(lines[1].ends_with("a.txt:5:HIT"), "{}", r.content);
        assert!(lines[2].ends_with("a.txt-6-l6"), "{}", r.content);
        assert_eq!(lines[3], "--");
        assert!(lines[5].ends_with("a.txt:15:HIT"), "{}", r.content);
    }

    /// `limit` counts matches, not context lines; the context of a dropped
    /// match is dropped with it.
    #[tokio::test]
    async fn context_lines_do_not_count_toward_the_limit() {
        let tmp = tempfile::tempdir().unwrap();
        let body: String = (1..=20)
            .map(|i| {
                if i % 5 == 0 {
                    "HIT\n".to_string()
                } else {
                    format!("l{i}\n")
                }
            })
            .collect();
        fs::write(tmp.path().join("a.txt"), body).unwrap();
        let r = grep(
            tmp.path(),
            serde_json::json!({ "pattern": "HIT", "context": 2, "limit": 2 }),
        )
        .await;
        assert_eq!(r.content.matches(":HIT").count(), 2, "{}", r.content);
        assert!(r.content.contains("a.txt-8-l8"), "{}", r.content);
        assert!(
            !r.content.contains("-13-") && !r.content.contains("-14-"),
            "{}",
            r.content
        );
        assert!(
            r.content
                .contains("Showing the first 2 matches; more matches exist"),
            "{}",
            r.content
        );
    }

    #[tokio::test]
    async fn context_is_bounded_and_only_for_content() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("a.txt"), "HIT\n").unwrap();
        let big = grep(
            tmp.path(),
            serde_json::json!({ "pattern": "HIT", "context": 11 }),
        )
        .await;
        assert!(
            big.is_error && big.content.contains("at most 10"),
            "{}",
            big.content
        );
        let files = grep(
            tmp.path(),
            serde_json::json!({ "pattern": "HIT", "context": 1, "output_mode": "files_with_matches" }),
        )
        .await;
        assert!(
            files.is_error && files.content.contains("content"),
            "{}",
            files.content
        );
        let bad = grep(
            tmp.path(),
            serde_json::json!({ "pattern": "HIT", "output_mode": "lines" }),
        )
        .await;
        assert!(
            bad.is_error && bad.content.contains("output_mode"),
            "{}",
            bad.content
        );
    }

    #[tokio::test]
    async fn no_ignore_searches_ignored_files_but_not_hidden_ones() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join(".gitignore"), "build/\n").unwrap();
        fs::create_dir(tmp.path().join("build")).unwrap();
        fs::write(tmp.path().join("build/gen.rs"), "TOKEN\n").unwrap();
        fs::create_dir(tmp.path().join(".cache")).unwrap();
        fs::write(tmp.path().join(".cache/x.rs"), "TOKEN\n").unwrap();
        let r = grep(
            tmp.path(),
            serde_json::json!({ "pattern": "TOKEN", "no_ignore": true }),
        )
        .await;
        assert!(r.content.contains("gen.rs"), "{}", r.content);
        assert!(!r.content.contains(".cache"), "{}", r.content);
    }
    /// A matching line that is not UTF-8 is shown, not the whole file lost.
    #[tokio::test]
    async fn a_line_in_another_encoding_still_matches() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("a.txt"), b"HIT ok\nHIT caf\xe9\n").unwrap();
        let r = grep(tmp.path(), serde_json::json!({ "pattern": "HIT" })).await;
        assert!(r.content.contains("a.txt:1:HIT ok"), "{}", r.content);
        assert!(
            r.content.contains("a.txt:2:HIT caf\u{fffd}"),
            "{}",
            r.content
        );
    }

    #[tokio::test]
    async fn type_filter_restricts_language_and_rejects_invalid_type() {
        let tmp = tempfile::tempdir().unwrap();
        let rs = tmp.path().join("main.rs");
        let py = tmp.path().join("script.py");
        fs::write(&rs, "NEEDLE\n").unwrap();
        fs::write(&py, "NEEDLE\n").unwrap();

        let rust_only = grep(
            tmp.path(),
            serde_json::json!({ "pattern": "NEEDLE", "type": "rust" }),
        )
        .await;
        assert!(!rust_only.is_error, "{}", rust_only.content);
        assert!(rust_only.content.contains("main.rs"), "{}", rust_only.content);
        assert!(!rust_only.content.contains("script.py"), "{}", rust_only.content);

        // Single-file path with non-matching type yields no matches.
        let single_mismatch = grep(
            tmp.path(),
            serde_json::json!({
                "pattern": "NEEDLE",
                "path": py.to_str().unwrap(),
                "type": "rust"
            }),
        )
        .await;
        assert!(!single_mismatch.is_error, "{}", single_mismatch.content);
        assert_eq!(single_mismatch.content, "No matches found.");

        let invalid = grep(
            tmp.path(),
            serde_json::json!({ "pattern": "NEEDLE", "type": "unknown_lang_xyz" }),
        )
        .await;
        assert!(invalid.is_error);
        assert!(
            invalid.content.contains("unknown_lang_xyz"),
            "{}",
            invalid.content
        );
    }

    #[tokio::test]
    async fn multiline_matches_across_line_breaks() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("a.txt"), "start\nfn foo(\n    x: i32,\n)\nend\n").unwrap();

        let off = grep(
            tmp.path(),
            serde_json::json!({ "pattern": r"fn foo\(\s+x: i32" }),
        )
        .await;
        assert!(!off.is_error, "{}", off.content);
        assert_eq!(off.content, "No matches found.");

        let off_nl = grep(
            tmp.path(),
            serde_json::json!({ "pattern": r"fn foo\(\n\s+x: i32" }),
        )
        .await;
        assert!(off_nl.is_error);

        let on = grep(
            tmp.path(),
            serde_json::json!({
                "pattern": r"fn foo\(\n\s+x: i32,\n\)",
                "multiline": true
            }),
        )
        .await;
        assert!(!on.is_error, "{}", on.content);
        assert!(
            on.content.contains("a.txt:2:fn foo(\n    x: i32,\n)"),
            "{}",
            on.content
        );
    }

    #[tokio::test]
    async fn offset_paginates_across_all_output_modes() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("a.rs"), "HIT 1\nHIT 2\n").unwrap();
        fs::write(tmp.path().join("b.rs"), "HIT 3\n").unwrap();
        fs::write(tmp.path().join("c.rs"), "HIT 4\nHIT 5\n").unwrap();

        // content mode
        let content = grep(
            tmp.path(),
            serde_json::json!({ "pattern": "HIT", "offset": 1, "limit": 2 }),
        )
        .await;
        assert!(!content.is_error, "{}", content.content);
        assert!(content.content.contains("a.rs:2:HIT 2"), "{}", content.content);
        assert!(content.content.contains("b.rs:1:HIT 3"), "{}", content.content);
        assert!(!content.content.contains("HIT 1"), "{}", content.content);
        assert!(
            content
                .content
                .contains("Showing matches 2-3 (offset 1, limit 2); more matches exist"),
            "{}",
            content.content
        );
        assert!(content.content.contains("`offset: 3`"), "{}", content.content);

        // files_with_matches mode
        let files = grep(
            tmp.path(),
            serde_json::json!({
                "pattern": "HIT",
                "output_mode": "files_with_matches",
                "offset": 1,
                "limit": 1
            }),
        )
        .await;
        assert!(!files.is_error, "{}", files.content);
        assert!(files.content.contains("b.rs"), "{}", files.content);
        assert!(!files.content.contains("a.rs"), "{}", files.content);
        assert!(
            files
                .content
                .contains("Showing file 2 (offset 1, limit 1); more files exist"),
            "{}",
            files.content
        );

        // count mode
        let count = grep(
            tmp.path(),
            serde_json::json!({
                "pattern": "HIT",
                "output_mode": "count",
                "offset": 2,
                "limit": 2
            }),
        )
        .await;
        assert!(!count.is_error, "{}", count.content);
        assert_eq!(count.content.lines().count(), 1, "{}", count.content);
        assert!(count.content.ends_with("c.rs:2"), "{}", count.content);

        // past end
        let past = grep(
            tmp.path(),
            serde_json::json!({ "pattern": "HIT", "offset": 10 }),
        )
        .await;
        assert!(!past.is_error);
        assert!(past.content.contains("No matches found"), "{}", past.content);
    }

    #[tokio::test]
    async fn asymmetric_context_works_and_validates_bounds_and_mode() {
        let tmp = tempfile::tempdir().unwrap();
        let body: String = (1..=10)
            .map(|i| {
                if i == 5 {
                    "TARGET\n".to_string()
                } else {
                    format!("l{i}\n")
                }
            })
            .collect();
        fs::write(tmp.path().join("a.txt"), body).unwrap();

        let r = grep(
            tmp.path(),
            serde_json::json!({
                "pattern": "TARGET",
                "before_context": 2,
                "after_context": 1
            }),
        )
        .await;
        assert!(!r.is_error, "{}", r.content);
        let lines: Vec<&str> = r.content.lines().collect();
        assert_eq!(lines.len(), 4, "{}", r.content);
        assert!(lines[0].ends_with("a.txt-3-l3"), "{}", r.content);
        assert!(lines[1].ends_with("a.txt-4-l4"), "{}", r.content);
        assert!(lines[2].ends_with("a.txt:5:TARGET"), "{}", r.content);
        assert!(lines[3].ends_with("a.txt-6-l6"), "{}", r.content);

        let too_before = grep(
            tmp.path(),
            serde_json::json!({ "pattern": "TARGET", "before_context": 11 }),
        )
        .await;
        assert!(too_before.is_error && too_before.content.contains("at most 10"));

        let too_after = grep(
            tmp.path(),
            serde_json::json!({ "pattern": "TARGET", "after_context": 11 }),
        )
        .await;
        assert!(too_after.is_error && too_after.content.contains("at most 10"));

        let bad_mode_before = grep(
            tmp.path(),
            serde_json::json!({
                "pattern": "TARGET",
                "before_context": 1,
                "output_mode": "files_with_matches"
            }),
        )
        .await;
        assert!(bad_mode_before.is_error && bad_mode_before.content.contains("content"));

        let bad_mode_after = grep(
            tmp.path(),
            serde_json::json!({
                "pattern": "TARGET",
                "after_context": 1,
                "output_mode": "count"
            }),
        )
        .await;
        assert!(bad_mode_after.is_error && bad_mode_after.content.contains("content"));
    }

    #[tokio::test]
    async fn only_matching_prints_matched_substrings_and_rejects_non_content() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(
            tmp.path().join("a.txt"),
            "head\nalpha=12 and beta=34\ntail\n",
        )
        .unwrap();

        let r = grep(
            tmp.path(),
            serde_json::json!({
                "pattern": r"\w+=\d+",
                "only_matching": true,
                "context": 1
            }),
        )
        .await;
        assert!(!r.is_error, "{}", r.content);
        let lines: Vec<&str> = r.content.lines().collect();
        assert_eq!(lines.len(), 4, "{}", r.content);
        assert!(lines[0].ends_with("a.txt-1-head"), "{}", r.content);
        assert!(lines[1].ends_with("a.txt:2:alpha=12"), "{}", r.content);
        assert!(lines[2].ends_with("a.txt:2:beta=34"), "{}", r.content);
        assert!(lines[3].ends_with("a.txt-3-tail"), "{}", r.content);

        for mode in ["files_with_matches", "count"] {
            let err = grep(
                tmp.path(),
                serde_json::json!({
                    "pattern": r"\w+=\d+",
                    "only_matching": true,
                    "output_mode": mode
                }),
            )
            .await;
            assert!(
                err.is_error && err.content.contains("content"),
                "mode {mode}: {}",
                err.content
            );
        }
    }
}
