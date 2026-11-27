//! File search primitives — structured grep and glob.
//!
//! `grep` is a native, in-process recursive regex search built on ripgrep's own
//! library crates (`ignore` for the gitignore-aware parallel directory walker
//! and `grep` for the regex matcher/searcher). It needs no external `rg`/`grep`
//! binary, so behavior is identical on every machine.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

/// A line a search returns: a match, or a line of context around one.
#[derive(Debug, Clone)]
pub struct SearchMatch {
    pub file: PathBuf,
    pub line_number: usize,
    pub line_content: String,
    /// A line around a match (see [`GrepOptions::context`],
    /// [`GrepOptions::before_context`], [`GrepOptions::after_context`]), not a match.
    pub is_context: bool,
}

/// What a grep collects in each file.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum GrepMode {
    /// The matching lines, with their context: [`GrepOutcome::matches`].
    #[default]
    Lines,
    /// The files with a match, each read up to its first: [`GrepOutcome::files`].
    Files,
    /// The files with a match and how many of their lines match:
    /// [`GrepOutcome::files`].
    Count,
}

/// A file with a match ([`GrepMode::Files`] and [`GrepMode::Count`]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileMatches {
    pub file: PathBuf,
    /// Matching lines in the file; 1 in [`GrepMode::Files`], which stops at
    /// the first.
    pub count: usize,
}

/// Options for grep.
///
/// Defaults mirror ripgrep's code-search defaults: gitignore/`.ignore` rules are
/// respected and hidden + binary files are skipped. The boolean opt-outs default
/// to `false`, so `GrepOptions::default()` keeps that sensible behavior.
#[derive(Debug, Clone, Default)]
pub struct GrepOptions {
    /// Whitelist glob applied to file paths (e.g. `*.rs`). `None` searches all files.
    pub glob_filter: Option<String>,
    /// Language/file type filter using ripgrep's built-in type definitions
    /// (e.g. `rust`, `py`, `ts`). `None` searches all file types.
    pub file_type: Option<String>,
    /// Cap on the number of matches returned. `None` is unlimited; `Some(0)`
    /// checks the pattern, type, and path, then searches nothing.
    pub max_results: Option<usize>,
    /// Number of leading matches (or files in `Files`/`Count` modes) to skip
    /// before applying `max_results`.
    pub offset: usize,
    /// Case-insensitive matching.
    pub case_insensitive: bool,
    /// When `true`, ignore `.gitignore`/`.ignore`/hidden filtering (search everything).
    pub no_ignore: bool,
    /// When `true`, include hidden files/directories in the search.
    pub hidden: bool,
    /// When `true`, the pattern is exact text, not a regex.
    pub literal: bool,
    /// Enable multi-line regex matching so patterns can match across `\n`.
    pub multiline: bool,
    /// What is collected per file. In [`GrepMode::Files`] and
    /// [`GrepMode::Count`], `max_results` counts files.
    pub mode: GrepMode,
    /// Lines of context before and after each match ([`GrepMode::Lines`]
    /// only). They do not count toward `max_results`. The search of a file
    /// stops at its last match within the limit, so that match may come
    /// without its trailing context.
    pub context: usize,
    /// Lines of context before each match ([`GrepMode::Lines`] only).
    /// Falls back to [`GrepOptions::context`] when `None`.
    pub before_context: Option<usize>,
    /// Lines of context after each match ([`GrepMode::Lines`] only).
    /// Falls back to [`GrepOptions::context`] when `None`.
    pub after_context: Option<usize>,
    /// In [`GrepMode::Lines`], emit only the matched substring(s) instead of
    /// full lines.
    pub only_matching: bool,
}

/// What a grep found.
#[derive(Debug, Default, Clone)]
pub struct GrepOutcome {
    /// [`GrepMode::Lines`]: matches and their context lines, sorted by
    /// `(file, line_number)`, at most `max_results` matches.
    pub matches: Vec<SearchMatch>,
    /// [`GrepMode::Files`] and [`GrepMode::Count`]: the files with a match,
    /// sorted, at most `max_results` of them.
    pub files: Vec<FileMatches>,
    /// More matches (or files) exist than returned (their number is not known).
    pub more: bool,
}

/// Search errors.
#[derive(Debug)]
pub enum SearchError {
    InvalidPattern(String),
    IoError(std::io::Error),
    CommandFailed(String),
}

impl std::fmt::Display for SearchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidPattern(p) => write!(f, "invalid pattern: {p}"),
            Self::IoError(e) => write!(f, "I/O error: {e}"),
            Self::CommandFailed(msg) => write!(f, "command failed: {msg}"),
        }
    }
}

impl std::error::Error for SearchError {}

impl From<std::io::Error> for SearchError {
    fn from(e: std::io::Error) -> Self {
        Self::IoError(e)
    }
}

/// Recursively search file contents using a regex pattern. See
/// [`grep_search`]; this drops whether more matches exist.
pub async fn grep(
    pattern: &str,
    path: &Path,
    opts: GrepOptions,
) -> Result<Vec<SearchMatch>, SearchError> {
    Ok(grep_search(pattern, path, opts).await?.matches)
}

/// Recursively search file contents using a regex (or literal) pattern.
///
/// Native and in-process: uses ripgrep's `ignore` crate for a gitignore-aware
/// parallel directory walk and ripgrep's `grep` crate for matching. No external
/// `rg`/`grep` binary is required. `path` may be a directory (searched
/// recursively) or a single file; a path that does not exist is an error.
/// Results are sorted by `(file, line_number)`.
///
/// The walk stops once more than `max_results` matches are known, and no
/// file contributes more than that many: a large file is never read to the
/// end only to be truncated. Which matches are kept when the limit is passed
/// depends on the order the parallel walk reaches the files.
///
/// Binary files: a file is binary when a NUL byte appears in the bytes the
/// search read. Its reading stops there and none of its lines are returned,
/// even lines read before the NUL. Only the bytes read are checked: a file
/// left early because the limit was reached is checked up to that point
/// (and its read-ahead buffer), not to its end. Binary data without a NUL
/// byte (and UTF-16 text) is not recognised; a matching line that is not
/// valid UTF-8 is returned with U+FFFD in place of its invalid bytes.
pub async fn grep_search(
    pattern: &str,
    path: &Path,
    opts: GrepOptions,
) -> Result<GrepOutcome, SearchError> {
    let pattern = pattern.to_string();
    let path = path.to_path_buf();

    tokio::task::spawn_blocking(move || grep_blocking(&pattern, &path, opts))
        .await
        .map_err(|e| SearchError::CommandFailed(e.to_string()))?
}

/// Collects one file's matches, at most `room` of them in
/// [`GrepMode::Lines`] (with their context); counts them in the other
/// modes. A NUL byte marks the file binary and stops its reading.
struct FileSink<'a> {
    file: &'a Path,
    matcher: &'a grep::regex::RegexMatcher,
    out: Vec<SearchMatch>,
    room: usize,
    binary: bool,
    mode: GrepMode,
    multiline: bool,
    only_matching: bool,
    /// Matching items seen (lines, substrings when `only_matching`, or matches).
    matched: usize,
}

impl grep::searcher::Sink for FileSink<'_> {
    type Error = std::io::Error;

    fn matched(
        &mut self,
        _searcher: &grep::searcher::Searcher,
        mat: &grep::searcher::SinkMatch<'_>,
    ) -> Result<bool, std::io::Error> {
        use grep::matcher::Matcher;

        if self.mode == GrepMode::Lines && self.only_matching {
            let haystack = if self.multiline {
                mat.bytes()
            } else {
                let b = mat.bytes().strip_suffix(b"\n").unwrap_or(mat.bytes());
                b.strip_suffix(b"\r").unwrap_or(b)
            };
            let base_line = mat.line_number().unwrap_or(0) as usize;
            let mut find_err: Option<std::io::Error> = None;
            let res = self.matcher.find_iter(haystack, |m| {
                let extra_lines = if self.multiline {
                    haystack[..m.start()].iter().filter(|&&b| b == b'\n').count()
                } else {
                    0
                };
                let matched_text = String::from_utf8_lossy(&haystack[m.start()..m.end()])
                    .trim_end_matches(['\n', '\r'])
                    .to_string();
                self.matched += 1;
                self.out.push(SearchMatch {
                    file: self.file.to_path_buf(),
                    line_number: base_line + extra_lines,
                    line_content: matched_text,
                    is_context: false,
                });
                self.room -= 1;
                self.room > 0
            });
            if let Err(err) = res {
                find_err = Some(std::io::Error::other(err.to_string()));
            }
            if let Some(err) = find_err {
                return Err(err);
            }
            return Ok(self.room > 0);
        }

        // A line that is not valid UTF-8 is shown with U+FFFD: a file in
        // another encoding still gives its matches.
        let line = String::from_utf8_lossy(mat.bytes());
        self.matched += 1;
        match self.mode {
            GrepMode::Files => return Ok(false),
            GrepMode::Count => return Ok(true),
            GrepMode::Lines => {}
        }
        self.out.push(SearchMatch {
            file: self.file.to_path_buf(),
            line_number: mat.line_number().unwrap_or(0) as usize,
            line_content: line.trim_end_matches(['\n', '\r']).to_string(),
            is_context: false,
        });
        self.room -= 1;
        Ok(self.room > 0)
    }

    fn context(
        &mut self,
        _searcher: &grep::searcher::Searcher,
        ctx: &grep::searcher::SinkContext<'_>,
    ) -> Result<bool, std::io::Error> {
        // A context line is shown as it can be: it never drops the file.
        let line = String::from_utf8_lossy(ctx.bytes());
        self.out.push(SearchMatch {
            file: self.file.to_path_buf(),
            line_number: ctx.line_number().unwrap_or(0) as usize,
            line_content: line.trim_end_matches(['\n', '\r']).to_string(),
            is_context: true,
        });
        Ok(true)
    }

    fn binary_data(
        &mut self,
        _searcher: &grep::searcher::Searcher,
        _binary_byte_offset: u64,
    ) -> Result<bool, std::io::Error> {
        self.binary = true;
        Ok(false)
    }
}

/// Build a regex or literal matcher, supporting both single-line and multi-line matching.
fn build_search_matcher(
    pattern: &str,
    mode: crate::tool_primitives::lexical::MatchMode,
    case_insensitive: bool,
    multiline: bool,
) -> Result<grep::regex::RegexMatcher, String> {
    if !multiline {
        return crate::tool_primitives::lexical::build_matcher(pattern, mode, case_insensitive);
    }
    grep::regex::RegexMatcherBuilder::new()
        .case_insensitive(case_insensitive)
        .fixed_strings(mode == crate::tool_primitives::lexical::MatchMode::Literal)
        .multi_line(true)
        .line_terminator(None)
        .build(pattern)
        .map_err(|e| e.to_string())
}

/// Searches a single directory entry and records its matches/file entry,
/// returning [`WalkState::Quit`] once `wanted` items are reached.
#[allow(clippy::too_many_arguments)]
fn search_entry(
    entry: Result<ignore::DirEntry, ignore::Error>,
    matcher: &grep::regex::RegexMatcher,
    built_types: Option<&ignore::types::Types>,
    searcher: &mut grep::searcher::Searcher,
    mode: GrepMode,
    multiline: bool,
    only_matching: bool,
    wanted: usize,
    found: &std::sync::atomic::AtomicUsize,
    results: &Mutex<Vec<SearchMatch>>,
    files: &Mutex<Vec<FileMatches>>,
) -> ignore::WalkState {
    use ignore::WalkState;

    let entry = match entry {
        Ok(e) => e,
        Err(_) => return WalkState::Continue,
    };
    // Only search regular files.
    if !entry.file_type().is_some_and(|t| t.is_file()) {
        return WalkState::Continue;
    }
    // `ignore` skips `should_skip_entry` at depth 0 (when `path` itself
    // is a single file), so enforce `types` on depth-0 files explicitly.
    if entry.depth() == 0
        && let Some(types) = built_types
        && types.matched(entry.path(), false).is_ignore()
    {
        return WalkState::Continue;
    }
    let room = wanted.saturating_sub(found.load(Ordering::SeqCst));
    if room == 0 {
        return WalkState::Quit;
    }

    let mut sink = FileSink {
        file: entry.path(),
        matcher,
        out: Vec::new(),
        room,
        binary: false,
        mode,
        multiline,
        only_matching,
        matched: 0,
    };
    let search_result = searcher.search_path(matcher, entry.path(), &mut sink);
    // Ignore per-file read/decoding errors (e.g. permission denied) and
    // keep walking, mirroring ripgrep's resilience. A binary file
    // gives nothing, not even the lines read before its NUL byte.
    if search_result.is_err() || sink.binary || sink.matched == 0 {
        return WalkState::Continue;
    }

    // Matches in Lines mode, files otherwise.
    let n = if mode == GrepMode::Lines {
        let n = sink.matched;
        results.lock().unwrap().extend(sink.out);
        n
    } else {
        files.lock().unwrap().push(FileMatches {
            file: entry.path().to_path_buf(),
            count: sink.matched,
        });
        1
    };
    if found.fetch_add(n, Ordering::SeqCst) + n >= wanted {
        return WalkState::Quit;
    }
    WalkState::Continue
}

/// Synchronous core of [`grep_search`], intended to run on a blocking thread.
fn grep_blocking(
    pattern: &str,
    path: &Path,
    opts: GrepOptions,
) -> Result<GrepOutcome, SearchError> {
    use crate::tool_primitives::lexical::{MatchMode, WalkFilters, walk_builder};
    use grep::searcher::{BinaryDetection, SearcherBuilder};
    use ignore::WalkState;
    use ignore::types::TypesBuilder;
    use std::sync::atomic::AtomicUsize;

    let match_mode = if opts.literal {
        MatchMode::Literal
    } else {
        MatchMode::Regex
    };
    let matcher = build_search_matcher(pattern, match_mode, opts.case_insensitive, opts.multiline)
        .map_err(SearchError::InvalidPattern)?;

    let built_types = if let Some(ref file_type) = opts.file_type {
        let mut tb = TypesBuilder::new();
        tb.add_defaults();
        tb.select(file_type);
        Some(tb.build().map_err(|e| {
            SearchError::InvalidPattern(format!("invalid file type `{file_type}`: {e}"))
        })?)
    } else {
        None
    };

    // Shared gitignore-aware walker with consistent hidden-file defaults.
    let filters = WalkFilters {
        include: opts.glob_filter.iter().cloned().collect(),
        no_ignore: opts.no_ignore,
        hidden: opts.hidden,
        ..Default::default()
    };
    let mut builder = walk_builder(path, &filters).map_err(SearchError::InvalidPattern)?;
    if let Some(ref types) = built_types {
        builder.types(types.clone());
    }
    // The walker reports a missing root as an entry error, which would
    // otherwise read as "no matches".
    if !path.exists() {
        return Err(SearchError::IoError(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            format!("path does not exist: {}", path.display()),
        )));
    }
    if opts.max_results == Some(0) {
        return Ok(GrepOutcome::default());
    }

    // One match (or file) past `offset + limit` proves that more exist.
    let wanted = opts
        .max_results
        .map_or(usize::MAX, |m| opts.offset.saturating_add(m).saturating_add(1));
    let mode = opts.mode;
    let multiline = opts.multiline;
    let only_matching = opts.only_matching;
    let (before_context, after_context) = if mode == GrepMode::Lines {
        (
            opts.before_context.unwrap_or(opts.context),
            opts.after_context.unwrap_or(opts.context),
        )
    } else {
        (0, 0)
    };
    let results: Arc<Mutex<Vec<SearchMatch>>> = Arc::new(Mutex::new(Vec::new()));
    let files: Arc<Mutex<Vec<FileMatches>>> = Arc::new(Mutex::new(Vec::new()));
    let found = Arc::new(AtomicUsize::new(0));

    let make_searcher = || {
        SearcherBuilder::new()
            .line_number(true)
            .binary_detection(BinaryDetection::quit(b'\x00'))
            .multi_line(multiline)
            .before_context(before_context)
            .after_context(after_context)
            .build()
    };

    if opts.offset > 0 {
        // Paginated queries walk in sorted path order so `offset` skips a
        // deterministic prefix across files rather than racing worker threads.
        builder.sort_by_file_name(|a, b| a.cmp(b));
        let mut searcher = make_searcher();
        for entry in builder.build() {
            if search_entry(
                entry,
                &matcher,
                built_types.as_ref(),
                &mut searcher,
                mode,
                multiline,
                only_matching,
                wanted,
                &found,
                &results,
                &files,
            ) == WalkState::Quit
            {
                break;
            }
        }
    } else {
        let threads = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(1);
        builder.threads(threads);
        builder.build_parallel().run(|| {
            let matcher = matcher.clone();
            let built_types = built_types.clone();
            let results = Arc::clone(&results);
            let files = Arc::clone(&files);
            let found = Arc::clone(&found);
            let mut searcher = make_searcher();

            Box::new(move |entry| {
                search_entry(
                    entry,
                    &matcher,
                    built_types.as_ref(),
                    &mut searcher,
                    mode,
                    multiline,
                    only_matching,
                    wanted,
                    &found,
                    &results,
                    &files,
                )
            })
        });
    }

    let mut matches = Arc::try_unwrap(results)
        .map(|m| m.into_inner().unwrap())
        .unwrap_or_else(|arc| arc.lock().unwrap().clone());
    let mut files = Arc::try_unwrap(files)
        .map(|m| m.into_inner().unwrap())
        .unwrap_or_else(|arc| arc.lock().unwrap().clone());

    // Parallel walk order is nondeterministic — sort for stable output.
    matches.sort_by(|a, b| a.file.cmp(&b.file).then(a.line_number.cmp(&b.line_number)));
    files.sort_by(|a, b| a.file.cmp(&b.file));
    let mut more = false;
    if opts.offset > 0 {
        if opts.offset >= files.len() {
            files.clear();
        } else {
            files.drain(..opts.offset);
        }
    }
    if let Some(max) = opts.max_results
        && files.len() > max
    {
        files.truncate(max);
        more = true;
    }
    if paginate_lines(
        &mut matches,
        opts.offset,
        opts.max_results,
        before_context,
        after_context,
    ) {
        more = true;
    }

    Ok(GrepOutcome {
        matches,
        files,
        more,
    })
}

/// Applies `offset` and `max_results` over sorted `lines` (keeping leading
/// `before_context` for the first kept match and trailing `after_context` for
/// the last kept match). Returns whether any match exists after `offset + max`.
fn paginate_lines(
    lines: &mut Vec<SearchMatch>,
    offset: usize,
    max_results: Option<usize>,
    before_context: usize,
    after_context: usize,
) -> bool {
    if offset > 0 {
        let Some(first_match_idx) = lines
            .iter()
            .enumerate()
            .filter(|(_, l)| !l.is_context)
            .nth(offset)
            .map(|(i, _)| i)
        else {
            lines.clear();
            return false;
        };
        let first_file = lines[first_match_idx].file.clone();
        let first_line = lines[first_match_idx].line_number;
        let min_ctx_line = first_line.saturating_sub(before_context);
        let mut keep_ctx_from = first_match_idx;
        let mut drop_indices = Vec::new();
        for i in (0..first_match_idx).rev() {
            let l = &lines[i];
            if l.file != first_file {
                break;
            }
            if !l.is_context {
                if l.line_number == first_line {
                    // Earlier match on the same line (e.g. `only_matching`) is
                    // skipped, but leading context for `first_line` can still precede it.
                    drop_indices.push(i);
                    continue;
                }
                break;
            }
            if l.line_number < min_ctx_line {
                break;
            }
            keep_ctx_from = i;
        }
        // Keep only the leading context lines in `keep_ctx_from..first_match_idx`
        // (excluding any skipped same-line matches) plus `first_match_idx..`.
        let mut kept = Vec::with_capacity(lines.len() - keep_ctx_from);
        for (idx, item) in std::mem::take(lines).into_iter().enumerate() {
            if idx >= first_match_idx
                || (idx >= keep_ctx_from && !drop_indices.contains(&idx))
            {
                kept.push(item);
            }
        }
        *lines = kept;
    }

    let Some(max) = max_results else {
        return false;
    };
    let Some(cut) = lines
        .iter()
        .enumerate()
        .filter(|(_, l)| !l.is_context)
        .nth(max)
        .map(|(i, _)| i)
    else {
        return false;
    };
    lines.truncate(cut);
    let last = lines.iter().rev().find(|l| !l.is_context).map(|l| {
        let extra_lines = l.line_content.bytes().filter(|&b| b == b'\n').count();
        (l.file.clone(), l.line_number.saturating_add(extra_lines))
    });
    while let Some(tail) = lines.last() {
        let belongs = tail.is_context
            && last.as_ref().is_some_and(|(file, end_line)| {
                *file == tail.file && tail.line_number <= end_line.saturating_add(after_context)
            });
        if !tail.is_context || belongs {
            break;
        }
        lines.pop();
    }
    true
}

/// Bounds and limits of [`glob_walk`].
#[derive(Debug, Clone)]
pub struct GlobOptions {
    /// Matches to return; the walk stops at the first match past it (which
    /// only proves that more exist). `0` returns without walking.
    pub limit: usize,
    /// Entries (files and directories) the walk may visit before it stops.
    pub max_visited: usize,
}

/// Entries a glob walk visits at most by default.
pub const GLOB_MAX_VISITED: usize = 200_000;

impl Default for GlobOptions {
    fn default() -> Self {
        Self {
            limit: usize::MAX,
            max_visited: GLOB_MAX_VISITED,
        }
    }
}

/// What a glob walk found.
#[derive(Debug, Default, Clone)]
pub struct GlobOutcome {
    /// Matches, sorted (at most `limit`).
    pub paths: Vec<PathBuf>,
    /// More matches exist than returned (their number is not known).
    pub more: bool,
    /// Entries visited.
    pub visited: usize,
    /// The walk stopped at `max_visited`: the list may be incomplete.
    pub visit_cap_hit: bool,
    /// The walk was abandoned (its caller went away).
    pub cancelled: bool,
}

/// Find files and directories matching `pattern` under `base_dir` (all of
/// them, within [`GLOB_MAX_VISITED`] entries). See [`glob_walk`].
pub async fn glob(pattern: &str, base_dir: &Path) -> Result<Vec<PathBuf>, SearchError> {
    Ok(glob_walk(pattern, base_dir, GlobOptions::default())
        .await?
        .paths)
}

/// Find files and directories matching `pattern` under `base_dir`.
///
/// `base_dir` is taken literally; only `pattern` is a glob (`*` and `?`
/// within a path component, `**` across components, `[…]` classes). Its
/// leading literal components narrow the walk. The walk uses the walker
/// shared with `Grep` and the code engine: `.gitignore`/`.ignore` rules
/// (with their `!` re-inclusions) apply even outside a git checkout and
/// ignored directories are pruned before descent; hidden entries are
/// skipped unless the pattern names a hidden component (`.github/**`). The
/// walk is sorted, so which matches are kept is deterministic; it stops at
/// the first match past `limit`, at `max_visited` entries, or when the
/// returned future is dropped (checked at every entry, on the blocking
/// pool). A fully literal pattern names one path, returned if it exists.
pub async fn glob_walk(
    pattern: &str,
    base_dir: &Path,
    opts: GlobOptions,
) -> Result<GlobOutcome, SearchError> {
    struct Stop(Arc<AtomicBool>);
    impl Drop for Stop {
        fn drop(&mut self) {
            self.0.store(true, Ordering::SeqCst);
        }
    }
    if opts.limit == 0 {
        ::glob::Pattern::new(pattern).map_err(|e| SearchError::InvalidPattern(e.to_string()))?;
        return Ok(GlobOutcome::default());
    }
    let stop = Stop(Arc::new(AtomicBool::new(false)));
    let abort = Arc::clone(&stop.0);
    let (pattern, base) = (pattern.to_string(), base_dir.to_path_buf());
    let outcome =
        tokio::task::spawn_blocking(move || glob_walk_blocking(&pattern, &base, &opts, &abort))
            .await
            .map_err(|e| SearchError::CommandFailed(e.to_string()))?;
    drop(stop);
    outcome
}

fn has_glob_meta(component: &str) -> bool {
    component.contains(['*', '?', '['])
}

/// Synchronous core of [`glob_walk`].
pub(crate) fn glob_walk_blocking(
    pattern: &str,
    base_dir: &Path,
    opts: &GlobOptions,
    abort: &AtomicBool,
) -> Result<GlobOutcome, SearchError> {
    let mut out = GlobOutcome::default();
    if opts.limit == 0 {
        return Ok(out);
    }
    // Leading literal components narrow the walk; the rest is matched
    // against paths relative to it.
    let pat = Path::new(pattern);
    let mut root = if pat.is_absolute() {
        PathBuf::new()
    } else {
        base_dir.to_path_buf()
    };
    let mut rest = Vec::new();
    for c in pat.components() {
        let text = c.as_os_str().to_string_lossy().to_string();
        if rest.is_empty() && !has_glob_meta(&text) {
            root.push(c.as_os_str());
        } else {
            rest.push(text);
        }
    }
    if rest.is_empty() {
        // A literal path.
        if root.exists() {
            out.paths.push(root);
        }
        return Ok(out);
    }
    let rest = rest.join("/");
    let matcher =
        ::glob::Pattern::new(&rest).map_err(|e| SearchError::InvalidPattern(e.to_string()))?;
    let options = ::glob::MatchOptions {
        case_sensitive: true,
        require_literal_separator: true,
        require_literal_leading_dot: false,
    };
    if !root.is_dir() {
        return Ok(out);
    }
    let hidden = pat.components().any(|c| {
        let t = c.as_os_str().to_string_lossy();
        t.starts_with('.') && t != "." && t != ".."
    });
    let filters = crate::tool_primitives::lexical::WalkFilters {
        hidden,
        ..Default::default()
    };
    let mut builder = crate::tool_primitives::lexical::walk_builder(&root, &filters)
        .map_err(SearchError::InvalidPattern)?;
    builder
        .follow_links(false)
        .sort_by_file_name(|a, b| a.cmp(b));
    for entry in builder.build() {
        if abort.load(Ordering::SeqCst) {
            out.cancelled = true;
            break;
        }
        let Ok(entry) = entry else { continue };
        if entry.depth() == 0 {
            continue;
        }
        out.visited += 1;
        if out.visited > opts.max_visited {
            out.visit_cap_hit = true;
            break;
        }
        let Ok(rel) = entry.path().strip_prefix(&root) else {
            continue;
        };
        if matcher.matches_path_with(rel, options) {
            if out.paths.len() == opts.limit {
                out.more = true;
                break;
            }
            out.paths.push(entry.path().to_path_buf());
        }
    }
    out.paths.sort();
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    // ── glob ──

    fn names(out: &GlobOutcome, root: &Path) -> Vec<String> {
        out.paths
            .iter()
            .map(|p| p.strip_prefix(root).unwrap().display().to_string())
            .collect()
    }

    fn walk(pattern: &str, root: &Path, limit: usize) -> GlobOutcome {
        glob_walk_blocking(
            pattern,
            root,
            &GlobOptions {
                limit,
                ..Default::default()
            },
            &AtomicBool::new(false),
        )
        .unwrap()
    }

    #[test]
    fn ignored_trees_are_pruned_and_unignored_homonyms_kept() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        // No `.git`: the rules apply all the same.
        fs::write(root.join(".gitignore"), "target/\n*.log\n!keep.log\n").unwrap();
        fs::create_dir_all(root.join("target/debug")).unwrap();
        for i in 0..300 {
            fs::write(root.join(format!("target/debug/f{i}.rs")), "").unwrap();
        }
        fs::create_dir_all(root.join("app/node_modules")).unwrap();
        fs::write(root.join("app/node_modules/kept.rs"), "").unwrap();
        fs::write(root.join("src.rs"), "").unwrap();
        fs::write(root.join("drop.log"), "").unwrap();
        fs::write(root.join("keep.log"), "").unwrap();
        let out = walk("**/*.rs", root, 1000);
        assert_eq!(names(&out, root), ["app/node_modules/kept.rs", "src.rs"]);
        // The 300 ignored files were never visited.
        assert!(out.visited < 20, "visited {}", out.visited);
        assert_eq!(names(&walk("*.log", root, 10), root), ["keep.log"]);
    }

    #[test]
    fn the_walk_stops_once_the_limit_is_passed() {
        let tmp = tempfile::tempdir().unwrap();
        for i in 0..1000 {
            fs::write(tmp.path().join(format!("f{i:04}.txt")), "").unwrap();
        }
        let out = walk("*.txt", tmp.path(), 10);
        assert_eq!(out.paths.len(), 10);
        assert!(out.more);
        assert_eq!(out.visited, 11, "stopped at the first match past the limit");
        // Deterministic selection and order.
        assert_eq!(names(&out, tmp.path())[0], "f0000.txt");
        assert_eq!(
            names(&walk("*.txt", tmp.path(), 10), tmp.path()),
            names(&out, tmp.path())
        );
        // Exactly the limit: no "more".
        let all = walk("f000*.txt", tmp.path(), 10);
        assert_eq!(all.paths.len(), 10);
        assert!(!all.more);
        // A rare pattern still walks everything (bounded by max_visited).
        let rare = glob_walk_blocking(
            "nothing*",
            tmp.path(),
            &GlobOptions {
                limit: 10,
                max_visited: 100,
            },
            &AtomicBool::new(false),
        )
        .unwrap();
        assert!(rare.paths.is_empty() && rare.visit_cap_hit);
        assert_eq!(rare.visited, 101);
    }

    #[test]
    fn literal_bases_brackets_spaces_hidden_roots_and_recursion() {
        let tmp = tempfile::tempdir().unwrap();
        let base = tmp.path().join(".work dir [1]");
        fs::create_dir_all(base.join("sub/deep")).unwrap();
        for f in [
            "a.rs",
            "b.rs",
            "c.rs",
            "sub/m.rs",
            "sub/deep/z.rs",
            "sub/n.txt",
        ] {
            fs::write(base.join(f), "").unwrap();
        }
        fs::create_dir_all(base.join(".github")).unwrap();
        fs::write(base.join(".github/ci.yml"), "").unwrap();
        // The base is literal even with brackets, spaces and a leading dot.
        assert_eq!(
            names(&walk("*.rs", &base, 100), &base),
            ["a.rs", "b.rs", "c.rs"]
        );
        assert_eq!(names(&walk("[ab].rs", &base, 100), &base), ["a.rs", "b.rs"]);
        assert_eq!(
            names(&walk("**/*.rs", &base, 100), &base),
            ["a.rs", "b.rs", "c.rs", "sub/deep/z.rs", "sub/m.rs"]
        );
        assert_eq!(names(&walk("sub/*.rs", &base, 100), &base), ["sub/m.rs"]);
        assert_eq!(
            names(&walk("sub/**/*.rs", &base, 100), &base),
            ["sub/deep/z.rs", "sub/m.rs"]
        );
        // Hidden entries only when the pattern names one.
        assert!(names(&walk("**/*.yml", &base, 100), &base).is_empty());
        assert_eq!(
            names(&walk(".github/*.yml", &base, 100), &base),
            [".github/ci.yml"]
        );
        // A literal path, and an absolute pattern (whose brackets would be
        // glob syntax: only the base is literal).
        assert_eq!(names(&walk("sub/n.txt", &base, 100), &base), ["sub/n.txt"]);
        let plain = tmp.path().join("plain");
        fs::create_dir_all(plain.join("sub")).unwrap();
        fs::write(plain.join("sub/n.txt"), "").unwrap();
        let abs = format!("{}/sub/*.txt", plain.display());
        let out = walk(&abs, Path::new("/nonexistent"), 100);
        assert_eq!(names(&out, &plain), ["sub/n.txt"]);
    }

    #[test]
    fn limit_zero_no_match_invalid_pattern_and_cancellation() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("a.rs"), "").unwrap();
        let zero = walk("*.rs", tmp.path(), 0);
        assert!(zero.paths.is_empty() && zero.visited == 0 && !zero.more);
        let none = walk("*.zig", tmp.path(), 10);
        assert!(none.paths.is_empty() && !none.more);
        let bad = glob_walk_blocking(
            "[",
            tmp.path(),
            &GlobOptions::default(),
            &AtomicBool::new(false),
        );
        assert!(matches!(bad, Err(SearchError::InvalidPattern(_))));
        let stopped = glob_walk_blocking(
            "*.rs",
            tmp.path(),
            &GlobOptions::default(),
            &AtomicBool::new(true),
        )
        .unwrap();
        assert!(stopped.cancelled && stopped.paths.is_empty() && stopped.visited == 0);
    }

    #[tokio::test]
    async fn finds_match_with_line_number_and_trimmed_content() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("a.txt"), "alpha\nbeta TARGET here\ngamma\n").unwrap();

        let m = grep("TARGET", tmp.path(), GrepOptions::default())
            .await
            .unwrap();
        assert_eq!(m.len(), 1);
        assert_eq!(m[0].line_number, 2);
        assert_eq!(m[0].line_content, "beta TARGET here");
        assert!(m[0].file.ends_with("a.txt"));
    }

    #[tokio::test]
    async fn searches_recursively_into_subdirs() {
        let tmp = tempfile::tempdir().unwrap();
        fs::create_dir_all(tmp.path().join("sub/deep")).unwrap();
        fs::write(tmp.path().join("top.rs"), "NEEDLE\n").unwrap();
        fs::write(tmp.path().join("sub/mid.rs"), "no match\nNEEDLE\n").unwrap();
        fs::write(tmp.path().join("sub/deep/low.rs"), "NEEDLE\n").unwrap();

        let m = grep("NEEDLE", tmp.path(), GrepOptions::default())
            .await
            .unwrap();
        assert_eq!(m.len(), 3);
    }

    #[tokio::test]
    async fn respects_gitignore_by_default_but_not_with_no_ignore() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join(".gitignore"), "ignored.txt\n").unwrap();
        fs::write(tmp.path().join("kept.txt"), "SECRET\n").unwrap();
        fs::write(tmp.path().join("ignored.txt"), "SECRET\n").unwrap();

        // Default: the gitignored file is skipped.
        let m = grep("SECRET", tmp.path(), GrepOptions::default())
            .await
            .unwrap();
        assert_eq!(m.len(), 1);
        assert!(m[0].file.ends_with("kept.txt"));

        // no_ignore: both files are searched.
        let opts = GrepOptions {
            no_ignore: true,
            ..Default::default()
        };
        let m = grep("SECRET", tmp.path(), opts).await.unwrap();
        assert_eq!(m.len(), 2);
    }

    #[tokio::test]
    async fn case_insensitive_matching() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("a.txt"), "Hello World\n").unwrap();

        let sensitive = grep("hello", tmp.path(), GrepOptions::default())
            .await
            .unwrap();
        assert!(sensitive.is_empty());

        let opts = GrepOptions {
            case_insensitive: true,
            ..Default::default()
        };
        let insensitive = grep("hello", tmp.path(), opts).await.unwrap();
        assert_eq!(insensitive.len(), 1);
    }

    #[tokio::test]
    async fn glob_filter_restricts_file_types() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("a.rs"), "MATCH\n").unwrap();
        fs::write(tmp.path().join("b.txt"), "MATCH\n").unwrap();

        let opts = GrepOptions {
            glob_filter: Some("*.rs".to_string()),
            ..Default::default()
        };
        let m = grep("MATCH", tmp.path(), opts).await.unwrap();
        assert_eq!(m.len(), 1);
        assert!(m[0].file.ends_with("a.rs"));
    }

    #[tokio::test]
    async fn max_results_caps_output() {
        let tmp = tempfile::tempdir().unwrap();
        let body: String = (0..50).map(|_| "HIT\n").collect();
        fs::write(tmp.path().join("a.txt"), body).unwrap();

        let opts = GrepOptions {
            max_results: Some(10),
            ..Default::default()
        };
        let m = grep("HIT", tmp.path(), opts).await.unwrap();
        assert_eq!(m.len(), 10);
    }

    #[tokio::test]
    async fn results_are_sorted_deterministically() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("z.txt"), "X\n").unwrap();
        fs::write(tmp.path().join("a.txt"), "X\nX\n").unwrap();

        let m = grep("X", tmp.path(), GrepOptions::default()).await.unwrap();
        // Sorted by (file, line): a.txt:1, a.txt:2, z.txt:1
        assert_eq!(m.len(), 3);
        assert!(m[0].file.ends_with("a.txt") && m[0].line_number == 1);
        assert!(m[1].file.ends_with("a.txt") && m[1].line_number == 2);
        assert!(m[2].file.ends_with("z.txt"));
    }

    #[tokio::test]
    async fn searches_a_single_file_path() {
        let tmp = tempfile::tempdir().unwrap();
        let target = tmp.path().join("only.txt");
        fs::write(&target, "FOO\n").unwrap();
        fs::write(tmp.path().join("other.txt"), "FOO\n").unwrap();

        let m = grep("FOO", &target, GrepOptions::default()).await.unwrap();
        assert_eq!(m.len(), 1);
        assert!(m[0].file.ends_with("only.txt"));
    }

    // Real-repo smoke test (run explicitly: `cargo test -p bricks-tools
    // real_repo_smoke -- --ignored`). Searches the actual workspace and asserts
    // it (a) finds our own source, (b) skips the gitignored `target/` dir.
    #[tokio::test]
    #[ignore]
    async fn real_repo_smoke() {
        // Crate dir is .../crates/bricks-tools; workspace root is two up.
        let crate_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
        let workspace_root = crate_dir.parent().unwrap().parent().unwrap();

        let matches = grep("WalkBuilder::new", workspace_root, GrepOptions::default())
            .await
            .unwrap();

        // Our native grep() implementation contains this call.
        assert!(
            matches
                .iter()
                .any(|m| m.file.ends_with("tool_primitives/search.rs")),
            "expected to find our own source; got {} matches",
            matches.len()
        );
        // The gitignored build directory must be excluded.
        assert!(
            !matches
                .iter()
                .any(|m| m.file.components().any(|c| c.as_os_str() == "target")),
            "target/ should be gitignored and skipped"
        );
        eprintln!(
            "real_repo_smoke: {} matches across the workspace",
            matches.len()
        );
    }

    #[tokio::test]
    async fn invalid_regex_is_an_error() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("a.txt"), "x\n").unwrap();
        let r = grep("(unclosed", tmp.path(), GrepOptions::default()).await;
        assert!(matches!(r, Err(SearchError::InvalidPattern(_))));
    }

    // ── grep_search ──

    #[tokio::test]
    async fn grep_search_more_flag_tells_whether_matches_were_cut() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("a.txt"), "HIT\nHIT\nHIT\nHIT\nHIT\n").unwrap();
        let limited = |n: usize| GrepOptions {
            max_results: Some(n),
            ..Default::default()
        };

        let cut = grep_search("HIT", tmp.path(), limited(3)).await.unwrap();
        assert_eq!(cut.matches.len(), 3);
        assert!(cut.more, "3 of 5 returned, more must be true");

        let exact = grep_search("HIT", tmp.path(), limited(5)).await.unwrap();
        assert_eq!(exact.matches.len(), 5);
        assert!(!exact.more, "exactly the limit: nothing more");

        let all = grep_search("HIT", tmp.path(), GrepOptions::default())
            .await
            .unwrap();
        assert_eq!(all.matches.len(), 5);
        assert!(!all.more);

        // `Some(0)` returns nothing and claims nothing more.
        let zero = grep_search("HIT", tmp.path(), limited(0)).await.unwrap();
        assert!(zero.matches.is_empty() && !zero.more);
    }

    #[tokio::test]
    async fn grep_search_literal_option_takes_the_pattern_as_text() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("a.txt"), "a.b\naxb\n").unwrap();

        let literal = GrepOptions {
            literal: true,
            ..Default::default()
        };
        let exact = grep_search("a.b", tmp.path(), literal).await.unwrap();
        assert_eq!(exact.matches.len(), 1);
        assert_eq!(exact.matches[0].line_content, "a.b");

        // Without `literal`, `.` is a regex wildcard and both lines match.
        let regex = grep_search("a.b", tmp.path(), GrepOptions::default())
            .await
            .unwrap();
        assert_eq!(regex.matches.len(), 2);
    }

    #[tokio::test]
    async fn grep_search_binary_file_gives_no_lines_for_nul_before_or_after() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("before.bin"), b"head\0NEEDLE\n").unwrap();
        fs::write(tmp.path().join("after.bin"), b"NEEDLE\n\0NEEDLE\n").unwrap();
        fs::write(tmp.path().join("text.txt"), "NEEDLE\n").unwrap();

        let out = grep_search("NEEDLE", tmp.path(), GrepOptions::default())
            .await
            .unwrap();
        assert_eq!(out.matches.len(), 1, "got: {:?}", out.matches);
        assert!(out.matches[0].file.ends_with("text.txt"));
    }

    #[tokio::test]
    async fn grep_search_nonexistent_path_is_an_error() {
        let r = grep_search(
            "x",
            Path::new("/definitely/not/here/bricks-grep-test"),
            GrepOptions::default(),
        )
        .await;
        assert!(
            matches!(&r, Err(SearchError::IoError(e)) if e.kind() == std::io::ErrorKind::NotFound),
            "got: {r:?}"
        );
    }

    #[tokio::test]
    async fn grep_search_type_filter_handles_dirs_single_files_and_invalid_type() {
        let tmp = tempfile::tempdir().unwrap();
        let rs_file = tmp.path().join("lib.rs");
        let py_file = tmp.path().join("app.py");
        fs::write(&rs_file, "TOKEN\n").unwrap();
        fs::write(&py_file, "TOKEN\n").unwrap();

        let rust_opts = GrepOptions {
            file_type: Some("rust".to_string()),
            ..Default::default()
        };
        let dir_out = grep_search("TOKEN", tmp.path(), rust_opts.clone())
            .await
            .unwrap();
        assert_eq!(dir_out.matches.len(), 1);
        assert!(dir_out.matches[0].file.ends_with("lib.rs"));

        // Single-file `path` also respects `file_type`.
        let single_match = grep_search("TOKEN", &rs_file, rust_opts.clone())
            .await
            .unwrap();
        assert_eq!(single_match.matches.len(), 1);
        let single_miss = grep_search("TOKEN", &py_file, rust_opts).await.unwrap();
        assert!(single_miss.matches.is_empty());

        let bad_type = grep_search(
            "TOKEN",
            tmp.path(),
            GrepOptions {
                file_type: Some("not_a_real_type".to_string()),
                ..Default::default()
            },
        )
        .await;
        assert!(
            matches!(&bad_type, Err(SearchError::InvalidPattern(msg)) if msg.contains("not_a_real_type")),
            "got: {bad_type:?}"
        );
    }

    #[tokio::test]
    async fn grep_search_multiline_matches_across_newlines_with_context() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("a.txt"), "before\nalpha\nbeta\nafter\n").unwrap();

        // `\s` is valid in single-line mode but cannot cross line breaks until `multiline: true`.
        let single_ws = grep_search(r"alpha\s+beta", tmp.path(), GrepOptions::default())
            .await
            .unwrap();
        assert!(single_ws.matches.is_empty());

        // Explicit `\n` is rejected in single-line mode.
        let single_nl = grep_search(r"alpha\nbeta", tmp.path(), GrepOptions::default()).await;
        assert!(matches!(single_nl, Err(SearchError::InvalidPattern(_))));

        let multi = grep_search(
            r"alpha\nbeta",
            tmp.path(),
            GrepOptions {
                multiline: true,
                before_context: Some(1),
                after_context: Some(1),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(multi.matches.len(), 3, "got: {:?}", multi.matches);
        assert!(multi.matches[0].is_context && multi.matches[0].line_number == 1);
        assert!(!multi.matches[1].is_context && multi.matches[1].line_number == 2);
        assert_eq!(multi.matches[1].line_content, "alpha\nbeta");
        assert!(multi.matches[2].is_context && multi.matches[2].line_number == 4);
    }

    #[tokio::test]
    async fn grep_search_offset_and_limit_across_all_modes() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("a.txt"), "HIT 1\nHIT 2\nHIT 3\n").unwrap();
        fs::write(tmp.path().join("b.txt"), "HIT 4\n").unwrap();
        fs::write(tmp.path().join("c.txt"), "HIT 5\n").unwrap();

        // Lines mode: 5 matches total; offset 2 + limit 2 -> HIT 3, HIT 4, more = true.
        let lines_page = grep_search(
            "HIT",
            tmp.path(),
            GrepOptions {
                offset: 2,
                max_results: Some(2),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(lines_page.matches.len(), 2);
        assert_eq!(lines_page.matches[0].line_content, "HIT 3");
        assert_eq!(lines_page.matches[1].line_content, "HIT 4");
        assert!(lines_page.more);

        // Exact end: offset 3 + limit 2 -> HIT 4, HIT 5, more = false.
        let lines_end = grep_search(
            "HIT",
            tmp.path(),
            GrepOptions {
                offset: 3,
                max_results: Some(2),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(lines_end.matches.len(), 2);
        assert!(!lines_end.more);

        // Files mode: 3 files total; offset 1 + limit 1 -> b.txt, more = true.
        let files_page = grep_search(
            "HIT",
            tmp.path(),
            GrepOptions {
                mode: GrepMode::Files,
                offset: 1,
                max_results: Some(1),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(files_page.files.len(), 1);
        assert!(files_page.files[0].file.ends_with("b.txt"));
        assert!(files_page.more);

        // Count mode: offset 1 + limit 2 -> b.txt (1), c.txt (1), more = false.
        let count_page = grep_search(
            "HIT",
            tmp.path(),
            GrepOptions {
                mode: GrepMode::Count,
                offset: 1,
                max_results: Some(2),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert_eq!(count_page.files.len(), 2);
        assert!(count_page.files[0].file.ends_with("b.txt"));
        assert_eq!(count_page.files[0].count, 1);
        assert!(count_page.files[1].file.ends_with("c.txt"));
        assert!(!count_page.more);
    }

    #[tokio::test]
    async fn grep_search_asymmetric_context_and_offset_suppression() {
        let tmp = tempfile::tempdir().unwrap();
        let body: String = (1..=20)
            .map(|i| {
                if i == 5 || i == 12 || i == 18 {
                    format!("HIT {i}\n")
                } else {
                    format!("l{i}\n")
                }
            })
            .collect();
        fs::write(tmp.path().join("a.txt"), body).unwrap();

        // Skip line 5 (HIT 5), keep line 12 (HIT 12) with 2 before + 1 after, drop line 18.
        let out = grep_search(
            "HIT",
            tmp.path(),
            GrepOptions {
                offset: 1,
                max_results: Some(1),
                context: 3,
                before_context: Some(2),
                after_context: Some(1),
                ..Default::default()
            },
        )
        .await
        .unwrap();
        assert!(out.more);
        let summary: Vec<(usize, bool)> = out
            .matches
            .iter()
            .map(|m| (m.line_number, m.is_context))
            .collect();
        assert_eq!(
            summary,
            vec![(10, true), (11, true), (12, false), (13, true)],
            "got: {:?}",
            out.matches
        );
    }

    #[tokio::test]
    async fn grep_search_only_matching_emits_substrings_and_handles_non_utf8() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("a.txt"), b"pre\nfoo1 mid foo2\npost\n").unwrap();
        fs::write(tmp.path().join("bin.txt"), b"x\xfffoo3\xfe\n").unwrap();

        let out = grep_search(
            r"foo\d",
            tmp.path(),
            GrepOptions {
                only_matching: true,
                before_context: Some(1),
                after_context: Some(1),
                offset: 1,
                max_results: Some(2),
                ..Default::default()
            },
        )
        .await
        .unwrap();

        assert!(!out.more);
        let texts: Vec<(usize, bool, &str)> = out
            .matches
            .iter()
            .map(|m| (m.line_number, m.is_context, m.line_content.as_str()))
            .collect();
        // Offset=1 skipped `foo1`, kept `foo2` (preserving before_context `pre` and after_context `post`),
        // and kept `foo3` from `bin.txt`.
        assert_eq!(
            texts,
            vec![
                (1, true, "pre"),
                (2, false, "foo2"),
                (3, true, "post"),
                (1, false, "foo3"),
            ],
            "got: {:?}",
            out.matches
        );
    }
}
