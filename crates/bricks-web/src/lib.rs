//! bricks-web: search the web, read pages within bounds, and select citable
//! passages.
//!
//! The pipeline of a search ([`WebContext::research`]):
//!
//! 1. **search** — the configured provider, with a visible fallback cascade
//!    ([`search`]);
//! 2. **download** — the first pages, concurrently, bounded globally and per
//!    host, in time and in decoded bytes, under the network policy
//!    ([`fetch`], [`policy`]);
//! 3. **extract** — HTML/Markdown/text/JSON to Markdown on bounded blocking
//!    threads ([`extract`]); each document is kept in the session store
//!    ([`store`]);
//! 4. **split and rank** — structural passages, BM25 over the passages of
//!    this search only, selection under a character budget ([`chunk`],
//!    [`rank`]).
//!
//! Each stage is timed separately. Selecting passages loses information by
//! design: the full extracted documents stay readable (paged, in document
//! order) through [`WebContext::read`] and the store's files. Pages are
//! external, untrusted content: nothing here interprets their text as
//! instructions.

pub mod chunk;
pub mod config;
pub mod extract;
pub mod fetch;
pub mod policy;
pub mod rank;
pub mod search;
pub mod store;

pub use config::{LoadedWebConfig, ProviderKind, WebConfig};

use chunk::Passage;
use extract::{Extractor, Unreadable};
use fetch::{FetchError, Fetcher};
use rank::Selection;
use search::{SearchHit, SearchOptions, SearchOutcome, Searcher};
use std::collections::HashSet;
use std::sync::Arc;
use std::time::Instant;
use store::{DocEntry, NewDoc, WebStore};

/// Everything a web call needs, shared across calls of a session.
pub struct WebContext {
    pub config: WebConfig,
    pub searcher: Searcher,
    pub fetcher: Arc<Fetcher>,
    pub extractor: Extractor,
    pub store: Option<Arc<WebStore>>,
}

impl WebContext {
    pub fn new(config: WebConfig, store: Option<Arc<WebStore>>) -> Result<Self, String> {
        config.validate()?;
        Ok(Self {
            searcher: Searcher::new(config.search.clone(), &config.fetch.user_agent)?,
            fetcher: Arc::new(Fetcher::new(config.fetch.clone())?),
            extractor: Extractor::new(config.extract.clone()),
            store,
            config,
        })
    }
}

/// Why a page gave no document.
#[derive(Debug, Clone, PartialEq, thiserror::Error, serde::Serialize)]
#[serde(tag = "stage", content = "detail", rename_all = "snake_case")]
pub enum PageError {
    #[error("download failed: {0}")]
    Fetch(#[serde(serialize_with = "display")] FetchError),
    #[error("{0}")]
    Unreadable(#[serde(serialize_with = "display")] Unreadable),
    #[error("could not be stored: {0}")]
    Store(String),
}

fn display<T: std::fmt::Display, S: serde::Serializer>(v: &T, s: S) -> Result<S::Ok, S::Error> {
    s.serialize_str(&v.to_string())
}

/// A page read for a search.
#[derive(Debug, Clone)]
pub struct PageDoc {
    pub entry: DocEntry,
    pub markdown: String,
    pub passages: Vec<Passage>,
    /// Served from the session store, not downloaded again.
    pub cached: bool,
}

#[derive(Debug, Clone)]
pub struct PageResult {
    /// The search result it comes from (`S3`).
    pub source_id: String,
    pub url: String,
    pub outcome: Result<PageDoc, PageError>,
}

#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct Timings {
    pub search_ms: u64,
    pub fetch_ms: u64,
    pub extract_ms: u64,
    pub rank_ms: u64,
    pub total_ms: u64,
}

#[derive(Debug, Clone)]
pub struct Research {
    pub search: SearchOutcome,
    pub pages: Vec<PageResult>,
    /// `None` when no page was read.
    pub selection: Option<Selection>,
    pub timings: Timings,
}

/// What [`WebContext::research`] does.
#[derive(Debug, Clone, Copy)]
pub struct ResearchOptions {
    pub results: usize,
    /// Pages to read among the results (0: search only).
    pub read_pages: usize,
}

impl WebContext {
    /// Search, read the first pages and select passages for `query`.
    pub async fn research(&self, query: &str, opts: ResearchOptions) -> Research {
        self.research_with(query, opts, &SearchOptions::default())
            .await
    }

    /// Search with explicit domain/recency filters, read pages (filling up from
    /// later hits when early ones fail), and select passages for `query`.
    pub async fn research_with(
        &self,
        query: &str,
        opts: ResearchOptions,
        search_opts: &SearchOptions,
    ) -> Research {
        let t0 = Instant::now();
        let search = self
            .searcher
            .search_with_options(query, opts.results, search_opts)
            .await;
        let search_ms = t0.elapsed().as_millis() as u64;
        let target_count = opts.read_pages.min(self.config.fetch.max_pages);
        let mut pages: Vec<PageResult> = Vec::new();
        let mut fetch_ms: u64 = 0;
        let mut extract_ms: u64 = 0;
        let mut cursor = 0usize;
        let mut seen_final = HashSet::new();
        let fetch_start = Instant::now();
        let fetch_deadline = fetch_start + self.config.fetch.budget;

        while cursor < search.hits.len() {
            let ok_count = pages.iter().filter(|p| p.outcome.is_ok()).count();
            let remaining_needed = target_count.saturating_sub(ok_count);
            if remaining_needed == 0 {
                break;
            }
            if cursor > 0 && Instant::now() >= fetch_deadline {
                break;
            }
            let end = (cursor + remaining_needed).min(search.hits.len());
            let batch = &search.hits[cursor..end];
            cursor = end;
            let (mut batch_pages, bf_ms, be_ms) = self
                .read_many(batch, &mut seen_final, fetch_deadline)
                .await;
            fetch_ms += bf_ms;
            extract_ms += be_ms;
            pages.append(&mut batch_pages);
        }

        let t3 = Instant::now();
        let docs: Vec<Vec<Passage>> = pages
            .iter()
            .map(|p| {
                p.outcome
                    .as_ref()
                    .map(|d| d.passages.clone())
                    .unwrap_or_default()
            })
            .collect();
        let selection = (!pages.is_empty() && docs.iter().any(|d| !d.is_empty()))
            .then(|| rank::select(query, &docs, &self.config.passages));
        let rank_ms = t3.elapsed().as_millis() as u64;
        Research {
            search,
            pages,
            selection,
            timings: Timings {
                search_ms,
                fetch_ms,
                extract_ms,
                rank_ms,
                total_ms: t0.elapsed().as_millis() as u64,
            },
        }
    }

    /// Download (or take from the store) and extract several pages; results
    /// in the order given. Returns the network and extraction times.
    async fn read_many(
        &self,
        hits: &[SearchHit],
        seen_final: &mut HashSet<String>,
        deadline: Instant,
    ) -> (Vec<PageResult>, u64, u64) {
        let mut cached: Vec<Option<PageDoc>> = Vec::new();
        let mut to_fetch = Vec::new();
        let ttl = self.config.store.search_ttl_secs;
        for h in hits {
            match self.stored_url_with_ttl(&h.url, ttl) {
                Some(doc) => cached.push(Some(doc)),
                None => {
                    cached.push(None);
                    to_fetch.push(h.url.clone());
                }
            }
        }
        let t = Instant::now();
        let fetched = self.fetcher.fetch_many_until(&to_fetch, deadline).await;
        let fetch_ms = t.elapsed().as_millis() as u64;
        let t = Instant::now();
        let extracted_futs = fetched.into_iter().map(|r| async move {
            match r {
                Err(e) => Err(map_fetch_error(e)),
                Ok(page) => self.extract_with_alternate(&page).await,
            }
        });
        let mut extracted_iter = futures::future::join_all(extracted_futs).await.into_iter();
        let mut raw_outcomes: Vec<Result<PageDoc, PageError>> = Vec::with_capacity(hits.len());
        for (h, c) in hits.iter().zip(cached) {
            if let Some(doc) = c {
                seen_final.insert(search::dedup_key(&doc.entry.final_url));
                raw_outcomes.push(Ok(doc));
                continue;
            }
            let res = match extracted_iter.next() {
                None => Err(PageError::Store("missing".into())),
                Some(Err(e)) => Err(e),
                Some(Ok((used_page, x))) => {
                    let final_key = search::dedup_key(used_page.final_url.as_str());
                    if !seen_final.insert(final_key) {
                        Err(PageError::Store(format!(
                            "duplicate of an earlier page ({})",
                            used_page.final_url
                        )))
                    } else {
                        self.store_page(&used_page, x)
                    }
                }
            };
            let res = match res {
                Err(err) if should_use_provider_content(&err) => {
                    if let Some(raw_text) = &h.raw_content {
                        self.store_provider_content(h, raw_text, &err)
                    } else {
                        Err(err)
                    }
                }
                other => other,
            };
            raw_outcomes.push(res);
        }
        let extract_ms = t.elapsed().as_millis() as u64;
        let pages = hits
            .iter()
            .zip(raw_outcomes)
            .map(|(h, outcome)| PageResult {
                source_id: h.source_id.clone(),
                url: h.url.clone(),
                outcome,
            })
            .collect();
        (pages, fetch_ms, extract_ms)
    }

    async fn extract_with_alternate(
        &self,
        page: &fetch::FetchedPage,
    ) -> Result<(fetch::FetchedPage, extract::Extracted), PageError> {
        match self.extract_page(page).await {
            Ok(x) => Ok((page.clone(), x)),
            Err(orig_err @ PageError::Unreadable(Unreadable::NeedsJavascript { .. })) => {
                if let Some(alt_url) = extract::find_alternate_markdown(
                    &page.body,
                    page.content_type.as_deref(),
                    &page.final_url,
                ) && let Ok(mut alt_page) = self.fetcher.fetch(alt_url.as_str()).await
                    && let Ok(mut x) = self.extract_page(&alt_page).await
                {
                    alt_page.requested = page.requested.clone();
                    x.notes.push(format!(
                        "loaded alternate Markdown representation ({alt_url})"
                    ));
                    return Ok((alt_page, x));
                }
                Err(orig_err)
            }
            Err(e) => Err(e),
        }
    }

    fn store_provider_content(
        &self,
        hit: &SearchHit,
        raw_text: &str,
        fetch_err: &PageError,
    ) -> Result<PageDoc, PageError> {
        let mut md = raw_text.trim().to_string();
        if !md.starts_with("# ") && !hit.title.is_empty() {
            md = format!("# {}\n\n{md}", hit.title);
        }
        let notes = vec![format!(
            "retrieved from {} search result after direct fetch failed ({fetch_err})",
            hit.provider
        )];
        let strategy = format!("{} (provider content)", hit.provider);
        let entry = match &self.store {
            Some(store) => store
                .put(NewDoc {
                    requested_url: &hit.url,
                    final_url: &hit.url,
                    title: &hit.title,
                    content_type: Some("text/plain"),
                    raw: raw_text.as_bytes(),
                    truncated: false,
                    markdown: &md,
                    strategy: &strategy,
                    notes: &notes,
                })
                .map_err(|e| PageError::Store(e.to_string()))?,
            None => DocEntry {
                id: "-".into(),
                requested_url: hit.url.clone(),
                final_url: hit.url.clone(),
                title: hit.title.clone(),
                content_type: Some("text/plain".into()),
                fetched_at: 0,
                raw_file: String::new(),
                raw_bytes: raw_text.len() as u64,
                truncated: false,
                markdown_file: String::new(),
                markdown_chars: md.chars().count(),
                strategy,
                notes,
            },
        };
        let p = &self.config.passages;
        Ok(PageDoc {
            passages: chunk::split(&md, p.min_chars, p.max_chars),
            entry,
            markdown: md,
            cached: false,
        })
    }

    fn stored_url(&self, url: &str) -> Option<PageDoc> {
        self.stored_url_with_ttl(url, 0)
    }

    fn stored_url_with_ttl(&self, url: &str, max_age_secs: u64) -> Option<PageDoc> {
        let store = self.store.as_ref()?;
        let entry = store.find_fresh_url(url, max_age_secs)?;
        let markdown = store.markdown(&entry).ok()?;
        let p = &self.config.passages;
        Some(PageDoc {
            passages: chunk::split(&markdown, p.min_chars, p.max_chars),
            entry,
            markdown,
            cached: true,
        })
    }

    async fn extract_page(
        &self,
        page: &fetch::FetchedPage,
    ) -> Result<extract::Extracted, PageError> {
        self.extractor
            .extract(
                page.final_url.clone(),
                page.content_type.clone(),
                page.body.clone(),
                page.truncated,
                page.declared_length,
            )
            .await
            .map_err(PageError::Unreadable)
    }

    fn store_page(
        &self,
        page: &fetch::FetchedPage,
        extracted: extract::Extracted,
    ) -> Result<PageDoc, PageError> {
        let mut notes = extracted.notes.clone();
        if let Some(i) = &page.interrupted {
            notes.push(format!("the transfer broke off: {i}"));
        }
        let strategy = extracted.strategy.to_string();
        let entry = match &self.store {
            Some(store) => store
                .put(NewDoc {
                    requested_url: page.requested.as_str(),
                    final_url: page.final_url.as_str(),
                    title: &extracted.title,
                    content_type: page.content_type.as_deref(),
                    raw: &page.body,
                    truncated: page.truncated,
                    markdown: &extracted.markdown,
                    strategy: &strategy,
                    notes: &notes,
                })
                .map_err(|e| PageError::Store(e.to_string()))?,
            None => DocEntry {
                id: "-".into(),
                requested_url: page.requested.to_string(),
                final_url: page.final_url.to_string(),
                title: extracted.title.clone(),
                content_type: page.content_type.clone(),
                fetched_at: 0,
                raw_file: String::new(),
                raw_bytes: page.body.len() as u64,
                truncated: page.truncated,
                markdown_file: String::new(),
                markdown_chars: extracted.markdown.chars().count(),
                strategy,
                notes,
            },
        };
        let p = &self.config.passages;
        Ok(PageDoc {
            passages: chunk::split(&extracted.markdown, p.min_chars, p.max_chars),
            entry,
            markdown: extracted.markdown,
            cached: false,
        })
    }

    /// One page as a document: from the store unless `refresh`, else
    /// downloaded and extracted (and stored).
    pub async fn read(&self, url: &str, refresh: bool) -> Result<PageDoc, PageError> {
        if !refresh && let Some(doc) = self.stored_url(url) {
            return Ok(doc);
        }
        let page = self.fetcher.fetch(url).await.map_err(map_fetch_error)?;
        let (used_page, extracted) = self.extract_with_alternate(&page).await?;
        self.store_page(&used_page, extracted)
    }

    /// A stored document by id (`D3`).
    pub fn stored(&self, id: &str) -> Option<PageDoc> {
        let store = self.store.as_ref()?;
        let entry = store.get(id)?;
        let markdown = store.markdown(&entry).ok()?;
        let p = &self.config.passages;
        Some(PageDoc {
            passages: chunk::split(&markdown, p.min_chars, p.max_chars),
            entry,
            markdown,
            cached: true,
        })
    }
}

/// The largest char boundary `<= i` (stable-Rust friendly).
pub fn floor_boundary(s: &str, mut i: usize) -> usize {
    if i >= s.len() {
        return s.len();
    }
    while i > 0 && !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

/// Byte offset of character `n` (or the end).
pub fn char_to_byte(s: &str, n: usize) -> usize {
    s.char_indices().nth(n).map(|(b, _)| b).unwrap_or(s.len())
}

fn map_fetch_error(e: FetchError) -> PageError {
    match e {
        FetchError::Binary {
            mime,
            declared_length,
        } => PageError::Unreadable(Unreadable::Binary {
            mime,
            bytes: 0,
            truncated: false,
            declared: declared_length,
        }),
        other => PageError::Fetch(other),
    }
}

fn should_use_provider_content(err: &PageError) -> bool {
    matches!(
        err,
        PageError::Unreadable(Unreadable::NeedsJavascript { .. })
            | PageError::Fetch(FetchError::Http { status: 403 | 429 })
            | PageError::Fetch(FetchError::Timeout(_))
    )
}
