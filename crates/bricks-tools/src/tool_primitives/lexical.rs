//! Lexical file walking and ripgrep matcher primitives shared by `Grep`,
//! `Glob`, and `CodeStats` (`ignore` walker and `grep-regex` matcher).

use grep::regex::{RegexMatcher, RegexMatcherBuilder};
use ignore::WalkBuilder;
use ignore::overrides::OverrideBuilder;
use std::path::Path;

/// How a search pattern is interpreted.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum MatchMode {
    #[default]
    Regex,
    Literal,
}

/// Which files a directory walk visits.
#[derive(Debug, Clone, Default)]
pub struct WalkFilters {
    /// Whitelist globs (`*.rs`); empty visits all files.
    pub include: Vec<String>,
    /// Gitignore-style globs to exclude.
    pub exclude: Vec<String>,
    /// Extensions without the leading dot.
    pub extensions: Vec<String>,
    /// Ignore `.gitignore`/`.ignore`/hidden rules.
    pub no_ignore: bool,
    /// Include hidden files.
    pub hidden: bool,
}

/// Shared gitignore-aware directory walker (`ignore` rules apply even outside a
/// git checkout; hidden files are skipped by default).
pub fn walk_builder(root: &Path, filters: &WalkFilters) -> Result<WalkBuilder, String> {
    let mut builder = WalkBuilder::new(root);
    if filters.no_ignore {
        builder.standard_filters(false);
    } else {
        builder.require_git(false);
    }
    builder.hidden(!filters.hidden);
    let mut globs: Vec<String> = filters.include.clone();
    globs.extend(
        filters
            .extensions
            .iter()
            .map(|e| format!("*.{}", e.trim_start_matches('.'))),
    );
    if !globs.is_empty() || !filters.exclude.is_empty() {
        let mut ob = OverrideBuilder::new(root);
        for g in &globs {
            ob.add(g).map_err(|e| e.to_string())?;
        }
        for g in &filters.exclude {
            ob.add(&format!("!{g}")).map_err(|e| e.to_string())?;
        }
        builder.overrides(ob.build().map_err(|e| e.to_string())?);
    }
    Ok(builder)
}

/// Build a `RegexMatcher`: literal or regex, line-oriented.
pub fn build_matcher(
    pattern: &str,
    mode: MatchMode,
    case_insensitive: bool,
) -> Result<RegexMatcher, String> {
    RegexMatcherBuilder::new()
        .case_insensitive(case_insensitive)
        .fixed_strings(mode == MatchMode::Literal)
        .line_terminator(Some(b'\n'))
        .build(pattern)
        .map_err(|e| e.to_string())
}
