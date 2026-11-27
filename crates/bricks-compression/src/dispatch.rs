//! Route a tool output to the right reduction, and say what was done.
//!
//! Every reduced output starts with a one-line `[bricks: …]` header naming
//! the transformation and where the original can be read. Outputs that are
//! values asked for exactly (a file read with `offset`/`limit`, `cat`,
//! `git diff`, a saved original) are never filtered; when they exceed the
//! hard cap they are cut with paging instructions or a reference to the full
//! text. The hard cap applies at every level, `off` included.
//!
//! Each call emits one `tracing::info!` event on the `bricks_compression`
//! target with the before/after sizes and the strategy.

use crate::command::{self, Analysis};
use crate::config::CompressionConfig;
use crate::json_view::{self, JsonViewError};
use crate::level::CompressionLevel;
use crate::log::{self, LogReport};
use crate::raw::{RawRef, RawStore};
use crate::rules::{Rule, RuleMode, RuleSet};
use crate::skeleton::{self, SkeletonLanguage};
use bricks_types::tokens::estimate_text;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;

/// Before/after metrics of one tool output.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct CompressionStats {
    pub before_bytes: usize,
    pub after_bytes: usize,
    pub before_lines: usize,
    pub after_lines: usize,
    /// Percentage of bytes removed (0.0 when nothing was removed).
    pub savings_pct: f64,
    /// Local token estimates ([`bricks_types::tokens::ESTIMATION_METHOD`]).
    pub before_tokens_estimate: u64,
    pub after_tokens_estimate: u64,
}

impl CompressionStats {
    pub fn measure(before: &str, after: &str) -> Self {
        let before_bytes = before.len();
        let after_bytes = after.len();
        let savings_pct = if before_bytes > 0 {
            100.0 * (before_bytes as f64 - after_bytes as f64) / before_bytes as f64
        } else {
            0.0
        };
        Self {
            before_bytes,
            after_bytes,
            before_lines: before.lines().count(),
            after_lines: after.lines().count(),
            savings_pct,
            before_tokens_estimate: estimate_text(before).tokens,
            after_tokens_estimate: estimate_text(after).tokens,
        }
    }
}

/// One tool result to process.
#[derive(Debug, Clone, Copy)]
pub struct ToolOutput<'a> {
    pub tool: &'a str,
    pub input: &'a Value,
    pub content: &'a str,
    pub is_error: bool,
    /// Tool-call id, used to name the saved original.
    pub call_id: &'a str,
    /// Exit code of a process that exited normally, when known (a failure
    /// is never reduced to a summary that hides it).
    pub exit_code: Option<i32>,
}

/// The processed output.
#[derive(Debug, Clone, PartialEq)]
pub struct Processed {
    pub text: String,
    pub stats: CompressionStats,
    /// The text differs from the tool's output.
    pub transformed: bool,
    /// The text is a partial view of a file (skeleton, JSON summary): it does
    /// not show the file's exact text, so a change must not be prepared from it.
    pub partial_view: bool,
    /// The saved original, when one was saved.
    pub raw: Option<RawRef>,
    pub strategy: &'static str,
    pub detail: String,
}

/// Reduces tool outputs with a rule set, settings and an optional store for
/// the originals.
#[derive(Debug)]
pub struct Compressor {
    config: CompressionConfig,
    rules: Arc<RuleSet>,
    raw: Option<RawStore>,
}

struct Outcome {
    text: String,
    transformed: bool,
    partial_view: bool,
    strategy: &'static str,
    detail: String,
    notes: Vec<String>,
    /// Where the original is: `Some(None)` = save the content to the store,
    /// `Some(Some(hint))` = it is elsewhere (the file itself).
    original: Option<Option<String>>,
    /// Header headline, e.g. "output reduced by rule `cargo-test`".
    headline: String,
    /// The header carries a diagnostic and must be shown even when the text
    /// itself is unchanged.
    diagnostic: bool,
}

impl Outcome {
    fn unchanged(content: &str, strategy: &'static str) -> Self {
        Outcome {
            text: content.to_string(),
            transformed: false,
            partial_view: false,
            strategy,
            detail: String::new(),
            notes: Vec::new(),
            original: None,
            headline: String::new(),
            diagnostic: false,
        }
    }
}

impl Compressor {
    pub fn new(config: CompressionConfig, rules: Arc<RuleSet>, raw: Option<RawStore>) -> Self {
        Self { config, rules, raw }
    }

    pub fn config(&self) -> &CompressionConfig {
        &self.config
    }

    pub fn rules(&self) -> &RuleSet {
        &self.rules
    }

    pub fn raw_store(&self) -> Option<&RawStore> {
        self.raw.as_ref()
    }

    pub fn process(&self, out: &ToolOutput, level: CompressionLevel) -> Processed {
        let content = out.content;
        let tool = out.tool.to_ascii_lowercase();
        let outcome = if content.is_empty() {
            Outcome::unchanged(content, "empty")
        } else if matches!(tool.as_str(), "read" | "readfile" | "read_file" | "view") {
            self.read(out.input, content, level, out.is_error)
        } else if is_protected_tool(&tool) || has_protected_marker(content, self.raw.as_ref()) {
            Outcome::unchanged(content, "protected")
        } else {
            match tool.as_str() {
                "bash" | "exec" | "execshell" | "shell" | "run" | "runshell" | "powershell" => {
                    let command = out
                        .input
                        .get("command")
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    self.shell(command, content, level, out.exit_code, out.is_error)
                }
                // Bricks' web tools page and select their own output: a page
                // window must stay in document order and whole, so only the
                // hard size cap applies.
                "webfetch" | "web_fetch" | "websearch" | "web_search" => {
                    self.web_page(content, out.is_error)
                }
                "fetch" | "http" => self.web(content, level, out.is_error),
                _ => self.other(content, level, out.is_error),
            }
        };
        self.finish(out, content, outcome)
    }

    // ── shell ──

    fn shell(
        &self,
        command: &str,
        content: &str,
        level: CompressionLevel,
        exit_code: Option<i32>,
        is_error: bool,
    ) -> Outcome {
        if level.is_off() {
            return self.cap_exact(content, "shell-off", "", is_error);
        }
        let analysis = command::analyze(command);
        let (rule, mut notes) = self.choose_rule(&analysis);
        let Some(rule) = rule else {
            return self.cap_exact(content, "shell", "no rule", is_error);
        };

        if !is_error
            && json_view::looks_like_json(content)
            && content.len() >= self.json_threshold(level)
            && let Some(o) = self.json(content, None, &rule.id)
        {
            return o;
        }
        if rule.mode == RuleMode::Exact {
            let mut o = self.cap_exact(content, "shell-exact", &rule.id, is_error);
            o.notes.splice(0..0, notes);
            return o;
        }
        let report = log::compress_log_with_exit(content, Some(rule), &self.config.log, exit_code);
        if is_error
            && content.len() > self.config.max_output_chars
            && log_lost_error_detail(&report, content, &self.config)
        {
            return self.error_head_tail(content, "shell", &rule.id, notes);
        }
        if !report.changed {
            let mut o = Outcome::unchanged(content, "shell");
            o.detail = rule.id.clone();
            return o;
        }
        notes.extend(report.notes.iter().cloned());
        Outcome {
            headline: log_headline(&report, &rule.id, content),
            text: report.text,
            transformed: true,
            partial_view: false,
            strategy: "shell",
            detail: rule.id.clone(),
            notes,
            diagnostic: false,
            original: Some(None),
        }
    }

    /// The rule for a command line, with notes on any conservative choice.
    fn choose_rule(&self, analysis: &Analysis) -> (Option<&Rule>, Vec<String>) {
        let fallback = self.rules.fallback();
        if let Some(why) = &analysis.ambiguous {
            return (
                fallback,
                vec![format!("command not analysed ({why}): generic handling")],
            );
        }
        if let Some(p) = analysis.primary() {
            let inv = p.producer().expect("a pipeline has a stage");
            if p.is_filtered() {
                let stages: Vec<String> =
                    p.stages.iter().skip(1).map(|s| s.program.clone()).collect();
                return (
                    fallback,
                    vec![format!(
                        "output already transformed by `| {}`: generic handling",
                        stages.join(" | ")
                    )],
                );
            }
            let rule = self.rules.find(inv);
            let mut notes = Vec::new();
            if rule
                .map(|r| r.matchers.iter().all(|m| m.program == "*"))
                .unwrap_or(true)
            {
                notes.push(format!("no specific rule for `{}`", inv.display()));
            }
            return (rule, notes);
        }
        if analysis.pipelines.is_empty() {
            return (fallback, Vec::new());
        }
        // Several commands: one rule only if they all agree.
        let ids: Vec<Option<&Rule>> = analysis
            .pipelines
            .iter()
            .map(|p| p.producer().and_then(|inv| self.rules.find(inv)))
            .collect();
        let first = ids[0].map(|r| r.id.as_str());
        if !p_is_filtered(analysis) && ids.iter().all(|r| r.map(|r| r.id.as_str()) == first) {
            return (ids[0], Vec::new());
        }
        let names: Vec<String> = analysis
            .pipelines
            .iter()
            .filter_map(|p| p.producer().map(|i| i.display()))
            .collect();
        (
            fallback,
            vec![format!(
                "several commands ({}): generic handling",
                names.join(", ")
            )],
        )
    }

    // ── read ──

    fn read(
        &self,
        input: &Value,
        content: &str,
        level: CompressionLevel,
        is_error: bool,
    ) -> Outcome {
        let path = input
            .get("file_path")
            .or_else(|| input.get("path"))
            .and_then(Value::as_str)
            .unwrap_or("");
        if is_error {
            if content.len() <= self.config.max_output_chars {
                return Outcome::unchanged(content, "read-error");
            }
            return self.error_head_tail(content, "read-error", path, Vec::new());
        }
        let explicit_window = input.get("offset").is_some_and(|v| !v.is_null())
            || input.get("limit").is_some_and(|v| !v.is_null());
        let saved_original = self.raw.as_ref().is_some_and(|s| s.contains(path));
        if level.is_off()
            || explicit_window
            || saved_original
            || is_skill_path(path)
            || has_protected_marker(content, self.raw.as_ref())
        {
            return self.page_exact(content, path);
        }

        let numbered = strip_line_numbers(content);
        let is_json = path.to_ascii_lowercase().ends_with(".json")
            || numbered
                .as_ref()
                .is_some_and(|n| json_view::looks_like_json(&n.text));
        if is_json {
            let full = self.whole_file(path, numbered.as_ref());
            if let Some(text) = full
                && text.len() >= self.json_threshold(level)
            {
                let hint = format!(
                    "Read file_path=\"{path}\" with offset/limit (offset = first line − 1)"
                );
                match json_view::summarize(&text, &self.config.json, &hint) {
                    Ok(s) => {
                        return Outcome {
                            headline: format!(
                                "JSON summary of {path} ({} bytes, root {}) — a view, not the document",
                                text.len(),
                                s.root_type
                            ),
                            text: s.text,
                            transformed: true,
                            partial_view: true,
                            strategy: "json",
                            detail: path.to_string(),
                            notes: Vec::new(),
                            diagnostic: false,
                            original: Some(Some(hint)),
                        };
                    }
                    Err(e @ JsonViewError::Invalid { .. }) => {
                        let mut o = self.page_exact(content, path);
                        o.notes.push(format!("not valid JSON ({e}); shown as text"));
                        if o.headline.is_empty() {
                            o.headline = format!("{path} shown as text");
                            o.text = content.to_string();
                            o.transformed = true;
                        }
                        o.diagnostic = true;
                        return o;
                    }
                    Err(_) => {}
                }
            }
        }

        if level == CompressionLevel::Aggressive
            && let Some(lang) = SkeletonLanguage::from_path(path)
            && let Some(o) = self.skeleton_view(path, lang, numbered.as_ref())
        {
            return o;
        }
        self.page_exact(content, path)
    }

    fn skeleton_view(
        &self,
        path: &str,
        lang: SkeletonLanguage,
        numbered: Option<&Numbered>,
    ) -> Option<Outcome> {
        // The whole file when it is readable, else the window that was read.
        let (source, first_line) = match self.whole_file(path, numbered) {
            Some(text) => (text, 1),
            None => (numbered?.text.clone(), numbered?.first_line),
        };
        let total = source.lines().count();
        if total < self.config.skeleton_min_lines {
            return None;
        }
        let sk = skeleton::skeleton(&source, lang, first_line).ok()?;
        let mut notes = Vec::new();
        if sk.uncertain_regions > 0 {
            notes.push(format!(
                "{} region(s) did not parse cleanly and are shown in full",
                sk.uncertain_regions
            ));
        }
        let last = first_line + total - 1;
        Some(Outcome {
            headline: format!(
                "skeleton view of {path} ({}, Tree-sitter) — an exploration aid, NOT the file's text: \
                 do not edit from it. {} of {} lines shown (L{first_line}–L{last}); each `⋯` marker gives \
                 the omitted range. Read a range with Read file_path=\"{path}\" offset=<first line − 1> \
                 limit=<count>; before editing, read the exact lines a change needs",
                lang.name(),
                sk.shown_lines,
                sk.total_lines
            ),
            text: sk.text,
            transformed: true,
            partial_view: true,
            strategy: "skeleton",
            detail: lang.name().to_string(),
            notes,
            diagnostic: false,
            original: Some(Some(format!(
                "Read file_path=\"{path}\" offset=0 limit={total}"
            ))),
        })
    }

    /// Exact text, cut only to fit, with paging instructions (no loss: the
    /// rest is one `Read` away).
    fn page_exact(&self, content: &str, path: &str) -> Outcome {
        let max = self.config.max_output_chars;
        if content.len() <= max {
            return Outcome::unchanged(content, "read-exact");
        }
        let mut kept = String::new();
        let mut last_line = None;
        for line in content.lines() {
            if kept.len() + line.len() + 1 > max {
                break;
            }
            kept.push_str(line);
            kept.push('\n');
            last_line = parse_line_number(line).or(last_line);
        }
        if kept.is_empty() && !content.is_empty() {
            let cut = floor_char_boundary(content, max);
            kept.push_str(&content[..cut]);
            last_line = parse_line_number(&kept);
        }
        let next = last_line.unwrap_or(0);
        Outcome {
            headline: format!("{path}: cut to fit the output limit ({max} characters)"),
            text: kept,
            transformed: true,
            partial_view: true,
            strategy: "read-paged",
            detail: path.to_string(),
            notes: vec![format!(
                "continue with Read file_path=\"{path}\" offset={next} and a smaller limit"
            )],
            diagnostic: false,
            original: Some(Some(format!("Read file_path=\"{path}\" offset={next}"))),
        }
    }

    fn whole_file(&self, path: &str, numbered: Option<&Numbered>) -> Option<String> {
        if let Some(n) = numbered
            && n.first_line == 1
            && !n.windowed
        {
            return Some(n.text.clone());
        }
        let meta = std::fs::metadata(path).ok()?;
        if !meta.is_file() || meta.len() as usize > self.config.max_file_bytes {
            return None;
        }
        std::fs::read_to_string(path).ok()
    }

    // ── web and other tools ──

    /// Output of the web tools: unchanged, or cut once at the hard cap on a
    /// line end — never thinned out line by line, so what is shown stays a
    /// contiguous, in-order part of the page.
    fn web_page(&self, content: &str, is_error: bool) -> Outcome {
        let cap = self.config.max_output_chars;
        if content.len() <= cap {
            return Outcome::unchanged(content, "web-page");
        }
        if is_error {
            return self.error_head_tail(content, "web-page", "", Vec::new());
        }
        let mut end = cap;
        while !content.is_char_boundary(end) {
            end -= 1;
        }
        if let Some(nl) = content[..end].rfind('\n') {
            end = nl + 1;
        }
        let shown = content[..end].chars().count();
        Outcome {
            headline: format!(
                "web output cut at the {cap}-character cap after {shown} characters; ask for a \
                 smaller max_chars window to read the rest in order"
            ),
            text: content[..end].to_string(),
            transformed: true,
            partial_view: true,
            strategy: "web-page",
            detail: String::new(),
            notes: Vec::new(),
            diagnostic: false,
            original: Some(None),
        }
    }

    fn web(&self, content: &str, level: CompressionLevel, is_error: bool) -> Outcome {
        if level.is_off() {
            return self.cap_exact(content, "web-off", "", is_error);
        }
        if !is_error
            && json_view::looks_like_json(content)
            && content.len() >= self.json_threshold(level)
            && let Some(o) = self.json(content, None, "web")
        {
            return o;
        }
        let rule = self.rules.fallback();
        let report = log::compress_log(content, rule, &self.config.log);
        if is_error
            && content.len() > self.config.max_output_chars
            && log_lost_error_detail(&report, content, &self.config)
        {
            return self.error_head_tail(content, "web", "", Vec::new());
        }
        if !report.changed {
            return Outcome::unchanged(content, "web");
        }
        Outcome {
            headline: log_headline(
                &report,
                rule.map(|r| r.id.as_str()).unwrap_or("generic"),
                content,
            ),
            text: report.text,
            transformed: true,
            partial_view: false,
            strategy: "web",
            detail: String::new(),
            notes: report.notes,
            diagnostic: false,
            original: Some(None),
        }
    }

    fn other(&self, content: &str, level: CompressionLevel, is_error: bool) -> Outcome {
        if !is_error
            && !level.is_off()
            && json_view::looks_like_json(content)
            && content.len() >= self.json_threshold(level)
            && let Some(o) = self.json(content, None, "tool")
        {
            return o;
        }
        self.cap_exact(content, "passthrough", "", is_error)
    }

    fn json(&self, content: &str, file: Option<&str>, detail: &str) -> Option<Outcome> {
        let hint = file
            .map(|p| format!("Read file_path=\"{p}\""))
            .unwrap_or_else(|| "the full output (see the header)".to_string());
        match json_view::summarize(content, &self.config.json, &hint) {
            Ok(s) => Some(Outcome {
                headline: format!(
                    "JSON summary ({} bytes, root {}) — a view, not the document",
                    content.len(),
                    s.root_type
                ),
                text: s.text,
                transformed: true,
                partial_view: true,
                strategy: "json",
                detail: detail.to_string(),
                notes: Vec::new(),
                diagnostic: false,
                original: Some(None),
            }),
            Err(JsonViewError::Invalid { .. }) | Err(JsonViewError::TooLarge { .. }) => None,
        }
    }

    /// Values: unchanged when they fit, else cut keeping diagnostics.
    fn cap_exact(
        &self,
        content: &str,
        strategy: &'static str,
        detail: &str,
        is_error: bool,
    ) -> Outcome {
        let limits = &self.config.log;
        let lines = content.lines().count();
        let fits = content.len() <= self.config.max_output_chars
            && lines <= limits.max_lines + limits.max_error_lines;
        if fits {
            let mut o = Outcome::unchanged(content, strategy);
            o.detail = detail.to_string();
            return o;
        }
        let report = log::compress_log(content, None, limits);
        if is_error
            && content.len() > self.config.max_output_chars
            && log_lost_error_detail(&report, content, &self.config)
        {
            return self.error_head_tail(content, strategy, detail, Vec::new());
        }
        Outcome {
            headline: format!(
                "output cut to fit ({} → {} lines), diagnostics kept",
                lines,
                report.text.lines().count()
            ),
            text: report.text,
            transformed: true,
            partial_view: false,
            strategy,
            detail: detail.to_string(),
            notes: report.notes,
            diagnostic: false,
            original: Some(None),
        }
    }

    fn error_head_tail(
        &self,
        content: &str,
        strategy: &'static str,
        detail: &str,
        notes: Vec<String>,
    ) -> Outcome {
        let max = self.config.max_output_chars;
        let truncated = truncate_head_tail(content, max);
        Outcome {
            headline: format!(
                "error output truncated head+tail to fit ({} → {} chars)",
                content.chars().count(),
                truncated.chars().count()
            ),
            text: truncated,
            transformed: true,
            partial_view: false,
            strategy,
            detail: detail.to_string(),
            notes,
            diagnostic: true,
            original: Some(None),
        }
    }

    fn json_threshold(&self, level: CompressionLevel) -> usize {
        match level {
            CompressionLevel::Aggressive => self.config.json_summary_min_bytes / 4,
            _ => self.config.json_summary_min_bytes,
        }
    }

    // ── header, raw store, hard cap ──

    fn finish(&self, out: &ToolOutput, content: &str, mut o: Outcome) -> Processed {
        // A reduction that saves less than a tenth, header included, is not
        // worth a lossy view: the original is returned when it fits the limits.
        let fits = content.len() <= self.config.max_output_chars
            && content.lines().count()
                <= self.config.log.max_lines + self.config.log.max_error_lines;
        let worth_it = |len: usize| len * 10 < content.len() * 9;
        // Rough size of the header before the original is saved.
        let header_estimate =
            o.headline.len() + o.notes.iter().map(|n| n.len() + 2).sum::<usize>() + 160;
        if o.transformed && !o.diagnostic && fits && !worth_it(o.text.len() + header_estimate) {
            o = Outcome {
                strategy: o.strategy,
                detail: o.detail,
                ..Outcome::unchanged(content, "unchanged")
            };
        }
        let mut raw = None;
        let mut text = if o.transformed {
            let where_ = match o.original.take() {
                Some(Some(hint)) => format!("full text: {hint}"),
                Some(None) => match self.save(out, content) {
                    Ok(r) => {
                        let h = format!("full output: {}", r.hint());
                        raw = Some(r);
                        h
                    }
                    Err(why) => format!("the full output was NOT saved ({why})"),
                },
                None => String::new(),
            };
            let mut parts = vec![o.headline.clone()];
            parts.extend(o.notes.iter().cloned());
            if !where_.is_empty() {
                parts.push(where_);
            }
            format!("[bricks: {}]\n{}", parts.join("; "), o.text)
        } else {
            o.text
        };
        if fits && !o.diagnostic && text != content && !worth_it(text.len()) {
            // The estimate was too low: undo, and drop the copy just saved.
            if let Some(r) = raw.take() {
                let _ = std::fs::remove_file(&r.path);
            }
            text = content.to_string();
        }

        // Last resort: a hard cut at the output limit.
        let max = self.config.max_output_chars;
        let slack = if o.transformed {
            (max / 10).clamp(300, 2000)
        } else {
            0
        };
        if text.len() > max.saturating_add(slack) {
            if out.is_error {
                text = truncate_head_tail(&text, max);
            } else {
                let mut cut = 0;
                for (i, _) in text.match_indices('\n') {
                    if i > max {
                        break;
                    }
                    cut = i;
                }
                if cut == 0 {
                    cut = floor_char_boundary(&text, max);
                }
                let removed = text.len() - cut;
                text.truncate(cut);
                text.push_str(&format!(
                    "\n… [{removed} more characters cut at the output limit]"
                ));
            }
            o.transformed = true;
        }

        let stats = CompressionStats::measure(content, &text);
        tracing::info!(
            target: "bricks_compression",
            tool = out.tool,
            strategy = o.strategy,
            detail = o.detail.as_str(),
            before_bytes = stats.before_bytes,
            after_bytes = stats.after_bytes,
            before_lines = stats.before_lines,
            after_lines = stats.after_lines,
            savings_pct = format!("{:.1}", stats.savings_pct),
            "tool output processed"
        );
        Processed {
            transformed: text != content,
            text,
            stats,
            partial_view: o.partial_view,
            raw,
            strategy: o.strategy,
            detail: o.detail,
        }
    }

    fn save(&self, out: &ToolOutput, content: &str) -> Result<RawRef, String> {
        let store = self.raw.as_ref().ok_or("no output store is configured")?;
        let label = format!("{}-{}", out.tool, out.call_id);
        store.put(&label, content).map_err(|e| e.to_string())
    }
}

fn p_is_filtered(a: &Analysis) -> bool {
    a.pipelines.iter().any(|p| p.is_filtered())
}

fn is_protected_tool(tool: &str) -> bool {
    matches!(tool, "skill" | "loadtools" | "load_tools")
}

fn is_skill_path(path: &str) -> bool {
    let p = path.trim();
    p == "SKILL.md" || p.ends_with("/SKILL.md") || p.ends_with("\\SKILL.md")
}

fn has_raw_store_ref(content: &str, raw: Option<&RawStore>) -> bool {
    if content.contains("full output: Read file_path=\"")
        || content.contains("full text: Read file_path=\"")
    {
        return true;
    }
    let needle = "Read file_path=\"";
    let mut rest = content;
    while let Some(idx) = rest.find(needle) {
        let after = &rest[idx + needle.len()..];
        if let Some(end) = after.find('"') {
            let path = &after[..end];
            if path.contains("raw-outputs") || raw.is_some_and(|s| s.contains(path)) {
                return true;
            }
            rest = &after[end + 1..];
        } else {
            break;
        }
    }
    false
}

fn has_protected_marker(content: &str, raw: Option<&RawStore>) -> bool {
    content.starts_with("[bricks: ")
        || content.contains("[tool result removed")
        || content.contains("<skill_activation")
        || content.contains("<skill>")
        || has_raw_store_ref(content, raw)
}

fn log_lost_error_detail(report: &LogReport, content: &str, config: &CompressionConfig) -> bool {
    report.text.len() > config.max_output_chars
        || !report.changed
        || content
            .lines()
            .any(|l| l.len() > config.log.max_diagnostic_line_chars)
}

fn floor_char_boundary(s: &str, mut idx: usize) -> usize {
    idx = idx.min(s.len());
    while idx > 0 && !s.is_char_boundary(idx) {
        idx -= 1;
    }
    idx
}

fn ceil_char_boundary(s: &str, mut idx: usize) -> usize {
    idx = idx.min(s.len());
    while idx < s.len() && !s.is_char_boundary(idx) {
        idx += 1;
    }
    idx
}

/// Truncate `text` to at most `max` bytes by keeping ~40% head and ~60% tail
/// on valid UTF-8 char (and line, when available) boundaries.
fn truncate_head_tail(text: &str, max: usize) -> String {
    if text.len() <= max {
        return text.to_string();
    }
    if max < 80 {
        let cut = floor_char_boundary(text, max);
        return text[..cut].to_string();
    }
    let marker_reserve = 48.min(max / 3);
    let budget = max - marker_reserve;
    let head_budget = (budget * 2) / 5;
    let tail_budget = budget - head_budget;

    let mut head_end = floor_char_boundary(text, head_budget);
    if let Some(nl) = text[..head_end].rfind('\n')
        && nl >= head_budget / 2
    {
        head_end = nl;
    }

    let raw_tail = text.len().saturating_sub(tail_budget).max(head_end);
    let mut tail_start = ceil_char_boundary(text, raw_tail);
    if let Some(nl) = text[tail_start..].find('\n') {
        let candidate = tail_start + nl + 1;
        if text.len().saturating_sub(candidate) >= tail_budget / 2 {
            tail_start = candidate;
        }
    }

    let omitted = text[head_end..tail_start].chars().count();
    format!(
        "{}\n... [{omitted} chars truncated] ...\n{}",
        &text[..head_end],
        &text[tail_start..]
    )
}

fn log_headline(report: &LogReport, rule: &str, original: &str) -> String {
    let before = original.lines().count();
    let after = report.text.lines().count();
    let mut h = format!("output reduced by rule `{rule}` ({before} → {after} lines");
    if report.error_blocks > 0 {
        h.push_str(&format!(
            ", {} error block(s) kept",
            report.error_blocks - report.omitted_blocks.min(report.error_blocks)
        ));
    }
    if report.warning_blocks > 0 {
        h.push_str(&format!(", {} warning block(s)", report.warning_blocks));
    }
    if let Some(code) = report.exit_code {
        h.push_str(&format!(", exit code {code}"));
    }
    h.push(')');
    h
}

/// A `Read` output without its line-number column.
#[derive(Debug, Clone)]
struct Numbered {
    text: String,
    first_line: usize,
    /// The tool said the file continues beyond this window.
    windowed: bool,
}

/// `"  12 | text"` → `(12, "text")` (the `Read` tool's format).
fn split_numbered(line: &str) -> Option<(usize, &str)> {
    let (num, rest) = line
        .split_once(" | ")
        .or_else(|| line.split_once(" |").filter(|(_, r)| r.is_empty()))?;
    let n = num.trim_start().parse().ok()?;
    Some((n, rest))
}

fn parse_line_number(line: &str) -> Option<usize> {
    split_numbered(line).map(|(n, _)| n)
}

fn strip_line_numbers(content: &str) -> Option<Numbered> {
    let mut text = String::with_capacity(content.len());
    let mut first = None;
    let mut windowed = false;
    for line in content.lines() {
        match split_numbered(line) {
            Some((n, rest)) => {
                first.get_or_insert(n);
                text.push_str(rest);
                text.push('\n');
            }
            _ if line.starts_with('[') => {
                windowed |=
                    line.contains("NOT the end of the file") || line.contains("Showing lines");
            }
            _ => return None,
        }
    }
    Some(Numbered {
        text,
        first_line: first?,
        windowed,
    })
}

// ─── Convenience API ─────────────────────────────────────────────────────────

static DEFAULT: Lazy<Compressor> = Lazy::new(|| {
    Compressor::new(
        CompressionConfig::default(),
        Arc::new(RuleSet::builtin()),
        None,
    )
});

/// Process with the built-in rules and default settings, without saving
/// originals (the header says so when something was reduced).
pub fn compress_tool_output(
    tool_name: &str,
    tool_input: &Value,
    content: &str,
    level: CompressionLevel,
) -> String {
    compress_tool_output_with_stats(tool_name, tool_input, content, level).0
}

/// Like [`compress_tool_output`], with the [`CompressionStats`].
pub fn compress_tool_output_with_stats(
    tool_name: &str,
    tool_input: &Value,
    content: &str,
    level: CompressionLevel,
) -> (String, CompressionStats) {
    let p = DEFAULT.process(
        &ToolOutput {
            tool: tool_name,
            input: tool_input,
            content,
            is_error: false,
            call_id: "",
            exit_code: None,
        },
        level,
    );
    (p.text, p.stats)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn compressor(dir: &std::path::Path) -> Compressor {
        Compressor::new(
            CompressionConfig::default(),
            Arc::new(RuleSet::builtin()),
            Some(RawStore::new(dir.join("raw"))),
        )
    }

    fn bash<'a>(command: &'a Value, content: &'a str) -> ToolOutput<'a> {
        ToolOutput {
            tool: "Bash",
            input: command,
            content,
            is_error: false,
            call_id: "call_1",
            exit_code: None,
        }
    }

    #[test]
    fn web_pages_keep_their_order_and_lines() {
        let dir = tempfile::tempdir().unwrap();
        let c = compressor(dir.path());
        // Repetitive lines a log compressor would fold: a page keeps them.
        let page: String = (0..900).map(|i| format!("| row | {} |\n", i % 3)).collect();
        let input = json!({"url": "https://x.example"});
        fn out<'a>(input: &'a Value, content: &'a str) -> ToolOutput<'a> {
            ToolOutput {
                tool: "WebFetch",
                input,
                content,
                is_error: false,
                call_id: "c",
                exit_code: None,
            }
        }
        let p = c.process(&out(&input, &page), CompressionLevel::Aggressive);
        assert_eq!(p.text, page);
        // Over the hard cap: one cut on a line end, nothing removed before it.
        let huge: String = (0..9000)
            .map(|i| format!("line {i} of the page\n"))
            .collect();
        let p = c.process(&out(&input, &huge), CompressionLevel::Minimal);
        assert!(p.text.len() < huge.len());
        let body = p
            .text
            .lines()
            .filter(|l| l.starts_with("line "))
            .collect::<Vec<_>>();
        for (i, l) in body.iter().enumerate() {
            assert_eq!(*l, format!("line {i} of the page"));
        }
    }

    #[test]
    fn off_is_noop_for_small_outputs() {
        let raw = "\x1b[31mhello\x1b[0m";
        assert_eq!(
            compress_tool_output("Bash", &json!({}), raw, CompressionLevel::Off),
            raw
        );
    }

    #[test]
    fn off_still_caps_huge_outputs_and_keeps_errors() {
        let dir = tempfile::tempdir().unwrap();
        let c = compressor(dir.path());
        let big: String = (0..3000)
            .map(|i| {
                if i == 1500 {
                    "error: the important failure\n".to_string()
                } else {
                    format!("line {i}\n")
                }
            })
            .collect();
        let input = json!({"command": "./build.sh"});
        let p = c.process(&bash(&input, &big), CompressionLevel::Off);
        assert!(p.transformed);
        assert!(p.text.contains("error: the important failure"));
        let raw = p.raw.expect("original saved");
        assert_eq!(std::fs::read_to_string(&raw.path).unwrap(), big);
        assert!(
            p.text.starts_with("[bricks: output cut to fit"),
            "{}",
            &p.text[..200]
        );
        assert!(p.text.contains(&raw.path.display().to_string()));
    }

    #[test]
    fn reduced_output_names_its_original() {
        let dir = tempfile::tempdir().unwrap();
        let c = compressor(dir.path());
        let log: String = (0..200)
            .map(|i| format!("   Compiling crate{i} v0.1.0\n"))
            .collect::<String>()
            + "error[E0425]: cannot find value `x`\n  --> src/a.rs:1:1\n";
        let input = json!({"command": "cargo build"});
        let p = c.process(&bash(&input, &log), CompressionLevel::Minimal);
        assert!(
            p.text
                .starts_with("[bricks: output reduced by rule `cargo-build`"),
            "{}",
            p.text
        );
        assert!(p.text.contains("error[E0425]"));
        assert!(!p.text.contains("Compiling crate5 "));
        assert_eq!(std::fs::read_to_string(p.raw.unwrap().path).unwrap(), log);
    }

    #[test]
    fn without_a_store_the_header_does_not_promise_the_original() {
        let log: String = (0..200)
            .map(|i| format!("   Compiling crate{i} v0.1.0\n"))
            .collect();
        let out = compress_tool_output(
            "Bash",
            &json!({"command": "cargo build"}),
            &log,
            CompressionLevel::Minimal,
        );
        assert!(out.contains("was NOT saved"), "{out}");
    }

    #[test]
    fn exact_programs_are_not_filtered() {
        let dir = tempfile::tempdir().unwrap();
        let c = compressor(dir.path());
        let content = "   Compiling looks like noise\n\n\nbut it is file content\n";
        for cmd in ["cat notes.txt", "git diff", "grep -r Compiling ."] {
            let input = json!({"command": cmd});
            let p = c.process(&bash(&input, content), CompressionLevel::Aggressive);
            assert_eq!(p.text, content, "{cmd}");
        }
    }

    #[test]
    fn filtered_pipelines_and_mixed_commands_are_handled_conservatively() {
        let dir = tempfile::tempdir().unwrap();
        let c = compressor(dir.path());
        let content: String = (0..300).map(|i| format!("test t{i} ... ok\n")).collect();
        let input = json!({"command": "cargo test 2>&1 | grep -v ignored"});
        let p = c.process(&bash(&input, &content), CompressionLevel::Minimal);
        // The cargo-test rule would summarise the passing lines; generic does not.
        assert!(!p.text.contains("passing tests"), "{}", &p.text[..300]);
        assert!(p.text.contains("output already transformed by `| grep`"));

        let input = json!({"command": "cargo build && npm test"});
        let p = c.process(&bash(&input, &content), CompressionLevel::Minimal);
        assert!(p.text.contains("several commands"), "{}", &p.text[..300]);
    }

    #[test]
    fn large_json_outputs_get_a_summary_envelope() {
        let dir = tempfile::tempdir().unwrap();
        let c = compressor(dir.path());
        let items: Vec<String> = (0..2000)
            .map(|i| format!("{{\"name\":\"pod-{i}\",\"ready\":true}}"))
            .collect();
        let content = format!("{{\"items\":[{}]}}", items.join(","));
        let input = json!({"command": "kubectl get pods -o json"});
        let p = c.process(&bash(&input, &content), CompressionLevel::Minimal);
        assert!(p.text.contains("\"bricks_view\": \"json-summary/v1\""));
        assert!(p.text.contains("pod-0") && !p.text.contains("pod-3\""));
        assert!(p.raw.is_some());
    }

    #[test]
    fn read_with_offset_or_limit_is_exact() {
        let dir = tempfile::tempdir().unwrap();
        let c = compressor(dir.path());
        let content: String = (1..=400)
            .map(|i| format!("{i:>3} | fn f{i}() {{ let x = {i}; }}\n"))
            .collect();
        let input = json!({"file_path": "/tmp/x.rs", "offset": 0, "limit": 400});
        let p = c.process(
            &ToolOutput {
                tool: "Read",
                input: &input,
                content: &content,
                is_error: false,
                call_id: "r",
                exit_code: None,
            },
            CompressionLevel::Aggressive,
        );
        assert_eq!(p.text, content);
        assert!(!p.partial_view);
    }

    #[test]
    fn reading_a_saved_original_is_never_reduced_again() {
        let dir = tempfile::tempdir().unwrap();
        let c = compressor(dir.path());
        let r = c.raw_store().unwrap().put("x", "{\"a\": 1}").unwrap();
        let content = format!("1 | {}\n", "{\"a\": 1}".repeat(5000));
        let input = json!({"file_path": r.path.to_str().unwrap()});
        let p = c.process(
            &ToolOutput {
                tool: "Read",
                input: &input,
                content: &content,
                is_error: false,
                call_id: "r",
                exit_code: None,
            },
            CompressionLevel::Aggressive,
        );
        assert!(!p.text.contains("bricks_view"));
    }

    #[test]
    fn aggressive_read_of_a_large_source_file_is_a_skeleton() {
        let dir = tempfile::tempdir().unwrap();
        let c = compressor(dir.path());
        let mut src = String::from("use std::io;\n\n");
        for f in 0..20 {
            src.push_str(&format!(
                "/// Function {f}.\npub fn f{f}(x: u32) -> u32 {{\n"
            ));
            for l in 0..8 {
                src.push_str(&format!("    let v{l} = x + {l};\n"));
            }
            src.push_str("    x\n}\n\n");
        }
        let path = dir.path().join("lib.rs");
        std::fs::write(&path, &src).unwrap();
        let content: String = src
            .lines()
            .enumerate()
            .map(|(i, l)| format!("{:>3} | {l}\n", i + 1))
            .collect();
        let input = json!({"file_path": path.to_str().unwrap()});
        let read = ToolOutput {
            tool: "Read",
            input: &input,
            content: &content,
            is_error: false,
            call_id: "r",
            exit_code: None,
        };
        let p = c.process(&read, CompressionLevel::Aggressive);
        assert!(p.partial_view);
        assert!(
            p.text.starts_with("[bricks: skeleton view of"),
            "{}",
            p.text
        );
        assert!(p.text.contains("NOT the file's text"));
        assert!(p.text.contains("pub fn f19(x: u32) -> u32 {"));
        assert!(!p.text.contains("let v3"));
        // Minimal keeps the exact text.
        assert_eq!(c.process(&read, CompressionLevel::Minimal).text, content);
    }

    #[test]
    fn invalid_json_file_stays_readable_with_a_diagnostic() {
        let dir = tempfile::tempdir().unwrap();
        let c = compressor(dir.path());
        let body = format!("{{\"a\": [{}], \"b\": tru}}", vec!["1"; 9000].join(","));
        let path = dir.path().join("bad.json");
        std::fs::write(&path, &body).unwrap();
        let content = format!("1 | {body}\n");
        let input = json!({"file_path": path.to_str().unwrap()});
        let p = c.process(
            &ToolOutput {
                tool: "Read",
                input: &input,
                content: &content,
                is_error: false,
                call_id: "r",
                exit_code: None,
            },
            CompressionLevel::Minimal,
        );
        assert!(p.text.contains("not valid JSON"), "{}", &p.text[..200]);
        assert!(p.text.contains("line 1, column"));
        assert!(
            p.text.contains("\"b\": tru"),
            "the original text is still shown"
        );
    }

    #[test]
    fn giant_multiline_error_truncates_head_and_tail() {
        let dir = tempfile::tempdir().unwrap();
        let cfg = CompressionConfig {
            max_output_chars: 4_000,
            ..Default::default()
        };
        let c = Compressor::new(
            cfg,
            Arc::new(RuleSet::builtin()),
            Some(RawStore::new(dir.path().join("raw"))),
        );

        let mut err = String::from("error[E0001]: TOP_INITIAL_FAILURE_MARKER\n");
        for i in 0..400 {
            err.push_str(&format!(
                "error: frame_{i:04} at crate::module::fn_{i} (detail padding {}) \n",
                "x".repeat(40)
            ));
        }
        err.push_str("thread 'main' panicked at FINAL_STACKTRACE_TAIL_SUMMARY\n");

        let p = c.process(
            &ToolOutput {
                tool: "Bash",
                input: &json!({ "command": "cargo test" }),
                content: &err,
                is_error: true,
                call_id: "err_multi",
                exit_code: Some(101),
            },
            CompressionLevel::Minimal,
        );

        assert!(p.transformed);
        assert!(p.text.contains("TOP_INITIAL_FAILURE_MARKER"), "{}", p.text);
        assert!(
            p.text.contains("FINAL_STACKTRACE_TAIL_SUMMARY"),
            "{}",
            p.text
        );
        assert!(p.text.contains("chars truncated] ..."), "{}", p.text);
        assert!(p.text.len() <= 4_500, "len={}", p.text.len());
        let raw = p.raw.expect("full error saved to RawStore");
        assert_eq!(std::fs::read_to_string(&raw.path).unwrap(), err);
    }

    #[test]
    fn giant_single_line_utf8_error_truncates_head_and_tail_safely() {
        let dir = tempfile::tempdir().unwrap();
        let cfg = CompressionConfig {
            max_output_chars: 1_200,
            ..Default::default()
        };
        let c = Compressor::new(
            cfg,
            Arc::new(RuleSet::builtin()),
            Some(RawStore::new(dir.path().join("raw"))),
        );

        let middle = "é🚀".repeat(1_000);
        let err = format!("HEAD_ERROR_START:{middle}:TAIL_STACKTRACE_CAUSE");

        for (tool, input, level) in [
            ("Bash", json!({ "command": "./run" }), CompressionLevel::Off),
            ("other_tool", json!({}), CompressionLevel::Aggressive),
        ] {
            let p = c.process(
                &ToolOutput {
                    tool,
                    input: &input,
                    content: &err,
                    is_error: true,
                    call_id: "err_single",
                    exit_code: Some(1),
                },
                level,
            );
            assert!(p.transformed, "{tool}");
            assert!(p.text.contains("HEAD_ERROR_START:"), "{tool}: {}", p.text);
            assert!(
                p.text.contains(":TAIL_STACKTRACE_CAUSE"),
                "{tool}: {}",
                p.text
            );
            assert!(
                p.text.contains("chars truncated] ..."),
                "{tool}: {}",
                p.text
            );
            assert!(p.raw.is_some());
        }
    }

    #[test]
    fn hard_ceiling_uses_head_tail_for_errors_and_head_for_non_errors() {
        let long_non_error = format!("START_OK\n{}\nEND_OK\n", "ok line\n".repeat(7_000));
        let long_error = format!(
            "START_ERR\n{}\nEND_ERR_SUMMARY\n",
            "err line\n".repeat(7_000)
        );
        // Directly validate truncate_head_tail ~40% head / ~60% tail split.
        let cut = truncate_head_tail(&long_error, 2_000);
        assert!(cut.starts_with("START_ERR\n"));
        assert!(cut.ends_with("END_ERR_SUMMARY\n"));
        assert!(cut.contains("chars truncated] ..."));
        assert!(cut.len() <= 2_000);
        let (head, tail) = cut.split_once("chars truncated] ...\n").unwrap();
        assert!(tail.len() > head.len(), "tail should get ~60% vs ~40% head");

        // Through finish() via shell-off (non-error vs error) on huge single-line content
        // when max_output_chars is smaller than line length.
        let dir = tempfile::tempdir().unwrap();
        let c = compressor(dir.path());
        let non_err_p = c.process(
            &ToolOutput {
                tool: "WebFetch",
                input: &json!({ "url": "https://example.com" }),
                content: &long_non_error,
                is_error: false,
                call_id: "ok",
                exit_code: None,
            },
            CompressionLevel::Minimal,
        );
        assert!(non_err_p.text.contains("START_OK"));
        assert!(!non_err_p.text.contains("END_OK"));

        let err_p = c.process(
            &ToolOutput {
                tool: "WebFetch",
                input: &json!({ "url": "https://example.com" }),
                content: &long_error,
                is_error: true,
                call_id: "err",
                exit_code: None,
            },
            CompressionLevel::Minimal,
        );
        assert!(err_p.text.contains("START_ERR"));
        assert!(err_p.text.contains("END_ERR_SUMMARY"));
    }

    #[test]
    fn structured_references_and_raw_store_readbacks_are_preserved() {
        let dir = tempfile::tempdir().unwrap();
        let c = compressor(dir.path());
        let saved = c
            .raw_store()
            .unwrap()
            .put("Bash-prev", &"{\"k\":\"v\"}\n".repeat(2_000))
            .unwrap();

        // 1. Reading back a RawStore file at Aggressive level is never JSON-summarized or re-saved.
        let readback = format!("1 | {}\n", "{\"k\":\"v\"}".repeat(2_000));
        let p_read = c.process(
            &ToolOutput {
                tool: "Read",
                input: &json!({ "file_path": saved.path.to_str().unwrap() }),
                content: &readback,
                is_error: false,
                call_id: "r1",
                exit_code: None,
            },
            CompressionLevel::Aggressive,
        );
        assert!(!p_read.text.contains("bricks_view"));
        assert!(p_read.raw.is_none());
        assert_eq!(p_read.text, readback);

        // 2. Output referencing RawStore / [tool result removed / [bricks: header is not re-compressed.
        let removed_ref = format!(
            "[tool result removed from the active context to save space (99999 chars); full output: {}]\n{}",
            saved.hint(),
            "noise\n".repeat(600)
        );
        let p_removed = c.process(
            &ToolOutput {
                tool: "other",
                input: &json!({}),
                content: &removed_ref,
                is_error: false,
                call_id: "r2",
                exit_code: None,
            },
            CompressionLevel::Aggressive,
        );
        assert!(!p_removed.transformed);
        assert!(p_removed.raw.is_none());
        assert_eq!(p_removed.text, removed_ref);

        let already_compressed = format!(
            "[bricks: output reduced by rule `cargo-build`; full output: {}]\n{}",
            saved.hint(),
            "   Compiling x v0.1.0\n".repeat(300)
        );
        let p_bricks = c.process(
            &ToolOutput {
                tool: "Bash",
                input: &json!({ "command": "cargo build" }),
                content: &already_compressed,
                is_error: false,
                call_id: "r3",
                exit_code: None,
            },
            CompressionLevel::Aggressive,
        );
        assert!(!p_bricks.transformed);
        assert!(p_bricks.raw.is_none());
        assert_eq!(p_bricks.text, already_compressed);

        // 3. Active <skill_activation> / <skill> / LoadTools / SKILL.md outputs are protected.
        let skill_xml = format!(
            "<skill_activation id=\"sk1\" name=\"demo\">\n{}\n</skill_activation>",
            "step\n".repeat(600)
        );
        let p_skill = c.process(
            &ToolOutput {
                tool: "Skill",
                input: &json!({ "name": "demo" }),
                content: &skill_xml,
                is_error: false,
                call_id: "s1",
                exit_code: None,
            },
            CompressionLevel::Aggressive,
        );
        assert!(!p_skill.transformed);
        assert_eq!(p_skill.text, skill_xml);

        let load_tools_json = format!(
            "{{\"tools\":[{}]}}",
            (0..500)
                .map(|i| format!("{{\"name\":\"tool_{i}\",\"description\":\"desc\"}}"))
                .collect::<Vec<_>>()
                .join(",")
        );
        let p_load = c.process(
            &ToolOutput {
                tool: "LoadTools",
                input: &json!({ "query": "tool" }),
                content: &load_tools_json,
                is_error: false,
                call_id: "lt1",
                exit_code: None,
            },
            CompressionLevel::Aggressive,
        );
        assert!(!p_load.transformed);
        assert!(!p_load.partial_view);
        assert_eq!(p_load.text, load_tools_json);

        let skill_md = format!("1 | {{\"skill\": \"{}\"}}\n", "a".repeat(5_000));
        let p_skill_md = c.process(
            &ToolOutput {
                tool: "Read",
                input: &json!({ "file_path": "/repo/skills/demo/SKILL.md" }),
                content: &skill_md,
                is_error: false,
                call_id: "sm1",
                exit_code: None,
            },
            CompressionLevel::Aggressive,
        );
        assert!(!p_skill_md.transformed);
        assert_eq!(p_skill_md.text, skill_md);
    }
}
