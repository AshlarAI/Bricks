//! Mesure de référence (lecture seule) de la concurrence des outils d'un tour :
//! ce que le moteur fait aujourd'hui d'un appel d'outil terminé, avant tout
//! changement. Provider scripté (Spy), outils à délai, aucun réseau.
//!
//! Tous les tests sont `#[ignore]` : ils ne tournent pas dans la suite normale.
//! Lancement :
//!   cargo test -p bricks-agent --test bench_concurrency_baseline -- --ignored --nocapture --test-threads=1
//!
//! Chaque scénario joue `REPS` répétitions et imprime des lignes `BENCH|...`
//! (médiane, min, max). Mesure interne scriptée, pas une mesure de production.
//!
//! Horodatages par appel d'outil :
//! - `entered` : entrée dans l'outil (Instant pris au début de `execute`).
//! - `fired` : fin du délai, pris dans une tâche tokio indépendante. Il ne
//!   dépend pas de la boucle de l'agent.
//! - `returned` : Instant pris par l'outil juste avant de retourner (définition
//!   du brief). Il n'est pris que lorsque la boucle de l'agent interroge le
//!   futur de l'outil : une attente de la boucle le retarde.
//! - `toolend` : réception de l'événement `ToolEnd` côté test.
//!
//! L'écart `returned - fired` mesure le temps pendant lequel un travail est
//! fini sans être observé par la boucle de l'agent.

use async_trait::async_trait;
use bricks_agent::Agent;
use bricks_agent::events::AgentEvent;
use bricks_compression::{
    CompressionConfig, CompressionLevel, Compressor, RawStore, RuleSet, ToolOutput,
};
use bricks_provider::{CompletionRequest, CompletionStream, Provider};
use bricks_tools::permissions::AllowAll;
use bricks_tools::{PermissionLevel, Tool, ToolContext, ToolResult};
use bricks_types::*;
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};
use tokio::sync::mpsc;

const REPS: usize = 20;
const BULK_BYTES: usize = 500_000;

/// One model response: the calls it asks for, as (id, tool, input).
type Calls = Vec<(&'static str, &'static str, Value)>;

// ─── Spy provider ────────────────────────────────────────────────────────────

struct Spy {
    steps: parking_lot::Mutex<VecDeque<Calls>>,
    requests: AtomicUsize,
    request_times: parking_lot::Mutex<Vec<Instant>>,
}

struct SpyProvider(Arc<Spy>);

#[async_trait]
impl Provider for SpyProvider {
    fn name(&self) -> &str {
        "spy"
    }
    fn context_window(&self, _: &str) -> u64 {
        200_000
    }
    async fn complete(&self, _: CompletionRequest) -> Result<CompletionStream> {
        self.0.requests.fetch_add(1, Ordering::SeqCst);
        self.0.request_times.lock().push(Instant::now());
        // Script exhausted: a final answer.
        let calls = self.0.steps.lock().pop_front().unwrap_or_default();
        let (tx, rx) = mpsc::channel(32);
        tokio::spawn(async move {
            let _ = tx
                .send(StreamEvent::MessageStart {
                    id: "m".into(),
                    model: "spy".into(),
                    usage: None,
                })
                .await;
            let has_calls = !calls.is_empty();
            if !has_calls {
                let _ = tx
                    .send(StreamEvent::ContentBlockStart {
                        index: 0,
                        block_type: "text".into(),
                        id: None,
                        name: None,
                    })
                    .await;
                let _ = tx
                    .send(StreamEvent::TextDelta {
                        index: 0,
                        text: "done".into(),
                    })
                    .await;
                let _ = tx.send(StreamEvent::ContentBlockStop { index: 0 }).await;
            }
            for (index, (id, name, input)) in calls.into_iter().enumerate() {
                let _ = tx
                    .send(StreamEvent::ContentBlockStart {
                        index,
                        block_type: "tool_use".into(),
                        id: Some(id.into()),
                        name: Some(name.into()),
                    })
                    .await;
                let _ = tx
                    .send(StreamEvent::InputJsonDelta {
                        index,
                        partial_json: input.to_string(),
                    })
                    .await;
                let _ = tx.send(StreamEvent::ContentBlockStop { index }).await;
            }
            let _ = tx
                .send(StreamEvent::MessageDelta {
                    stop_reason: Some(if has_calls {
                        StopReason::ToolUse
                    } else {
                        StopReason::EndTurn
                    }),
                    usage: Some(Usage {
                        input_tokens: 10,
                        output_tokens: 5,
                        ..Default::default()
                    }),
                })
                .await;
            let _ = tx.send(StreamEvent::MessageStop).await;
        });
        Ok(CompletionStream::new(rx))
    }
}

// ─── Probes and tools ────────────────────────────────────────────────────────

#[derive(Default)]
struct Probe {
    active: AtomicUsize,
    peak: AtomicUsize,
    entered: parking_lot::Mutex<HashMap<String, Instant>>,
    fired: parking_lot::Mutex<HashMap<String, Instant>>,
    returned: parking_lot::Mutex<HashMap<String, Instant>>,
}

impl Probe {
    fn enter(&self) {
        let now = self.active.fetch_add(1, Ordering::SeqCst) + 1;
        self.peak.fetch_max(now, Ordering::SeqCst);
    }
}

/// Sleeps `ms` with the tokio timer (no blocking sleep). The work runs in its
/// own task, so the moment it finishes is recorded whatever the agent loop
/// does with the tool's future.
async fn work(probe: Arc<Probe>, id: String, ms: u64) {
    probe.entered.lock().insert(id.clone(), Instant::now());
    probe.enter();
    let p = probe.clone();
    let key = id;
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(ms)).await;
        p.fired.lock().insert(key, Instant::now());
        p.active.fetch_sub(1, Ordering::SeqCst);
    })
    .await
    .expect("the work task does not panic");
}

struct Delay(Arc<Probe>);

#[async_trait]
impl Tool for Delay {
    fn name(&self) -> &str {
        "Delay"
    }
    fn description(&self) -> &str {
        "sleeps ms milliseconds"
    }
    fn permission_level(&self) -> PermissionLevel {
        PermissionLevel::ReadOnly
    }
    fn input_schema(&self) -> Value {
        json!({"type": "object", "properties": {"id": {"type": "string"}, "ms": {"type": "integer"}}})
    }
    async fn execute(&self, input: Value, _: &ToolContext) -> ToolResult {
        let id = input["id"].as_str().unwrap_or("?").to_string();
        let ms = input["ms"].as_u64().unwrap_or(0);
        work(self.0.clone(), id.clone(), ms).await;
        self.0.returned.lock().insert(id.clone(), Instant::now());
        ToolResult::success(format!("ok {id}"))
    }
}

/// Same delay, but answers with a big realistic text (about 500 KB).
struct Bulk {
    probe: Arc<Probe>,
    body: Arc<String>,
}

#[async_trait]
impl Tool for Bulk {
    fn name(&self) -> &str {
        "Bulk"
    }
    fn description(&self) -> &str {
        "answers with a large text"
    }
    fn permission_level(&self) -> PermissionLevel {
        PermissionLevel::ReadOnly
    }
    fn input_schema(&self) -> Value {
        json!({"type": "object", "properties": {"id": {"type": "string"}, "ms": {"type": "integer"}}})
    }
    async fn execute(&self, input: Value, _: &ToolContext) -> ToolResult {
        let id = input["id"].as_str().unwrap_or("?").to_string();
        let ms = input["ms"].as_u64().unwrap_or(0);
        work(self.probe.clone(), id.clone(), ms).await;
        self.probe.returned.lock().insert(id, Instant::now());
        ToolResult::success(self.body.as_str().to_string())
    }
}

/// Deterministic prose-like text (a small LCG picks the words): no repeated
/// character, so the compressor has real work to do.
fn realistic_text(bytes: usize) -> String {
    const WORDS: &[&str] = &[
        "module",
        "fichier",
        "valeur",
        "contexte",
        "session",
        "tableau",
        "index",
        "chemin",
        "projet",
        "règle",
        "budget",
        "tokens",
        "résultat",
        "fonction",
        "struct",
        "trait",
        "cache",
        "racine",
        "schéma",
        "liste",
        "clé",
        "option",
        "export",
        "import",
        "retour",
        "bloc",
        "ligne",
        "colonne",
        "service",
        "client",
        "serveur",
        "requête",
        "réponse",
        "config",
        "profil",
        "politique",
        "outil",
        "sortie",
        "entrée",
        "pour",
        "dans",
        "avec",
        "sans",
        "après",
        "avant",
        "donc",
        "alors",
        "mais",
        "cette",
        "chaque",
        "le",
        "la",
        "les",
        "un",
        "une",
        "de",
        "du",
        "des",
        "et",
        "ou",
        "est",
        "sont",
        "the",
        "with",
        "from",
        "into",
        "value",
        "state",
        "store",
        "update",
        "render",
        "parse",
        "build",
        "cargo",
        "test",
        "crate",
        "tokio",
        "async",
    ];
    let mut out = String::with_capacity(bytes + 256);
    let mut seed: u64 = 0x9E37_79B9_7F4A_7C15;
    let mut line_no = 1usize;
    while out.len() < bytes {
        out.push_str(&format!("{line_no:6}  "));
        line_no += 1;
        seed = seed
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        let count = 6 + ((seed >> 33) as usize % 11);
        for i in 0..count {
            seed = seed
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            let r = (seed >> 33) as usize;
            if r.is_multiple_of(37) {
                out.push_str(&format!("{} ", r % 100_000));
            } else {
                out.push_str(WORDS[r % WORDS.len()]);
                if r.is_multiple_of(7) {
                    out.push(',');
                }
                out.push(' ');
            }
            if i + 1 == count {
                out.push_str(".\n");
            }
        }
    }
    out
}

// ─── Harness ─────────────────────────────────────────────────────────────────

/// Milliseconds from `later` to `earlier`, clipped at zero (`a - b` in ms).
fn gap(a: Instant, b: Instant) -> f64 {
    a.saturating_duration_since(b).as_secs_f64() * 1000.0
}

fn later(a: Option<Instant>, b: Instant) -> Option<Instant> {
    Some(a.map_or(b, |x| x.max(b)))
}

type Samples = BTreeMap<String, Vec<f64>>;

fn push(s: &mut Samples, key: String, v: f64) {
    s.entry(key).or_default().push(v);
}

fn build(
    rounds: &[Calls],
    body: &Arc<String>,
) -> (Arc<Agent>, Arc<Spy>, Arc<Probe>, tempfile::TempDir) {
    let spy = Arc::new(Spy {
        steps: parking_lot::Mutex::new(rounds.to_vec().into()),
        requests: AtomicUsize::new(0),
        request_times: parking_lot::Mutex::new(Vec::new()),
    });
    let probe = Arc::new(Probe::default());
    let dir = tempfile::tempdir().unwrap();
    let agent = Agent::builder()
        .provider(SpyProvider(spy.clone()))
        .tool(Delay(probe.clone()))
        .tool(Bulk {
            probe: probe.clone(),
            body: body.clone(),
        })
        .working_dir(dir.path())
        .permission_policy(AllowAll)
        .build()
        .unwrap();
    (Arc::new(agent), spy, probe, dir)
}

/// One repetition: runs the turn, then adds its samples to `s`.
async fn one_rep(rounds: &[Calls], body: &Arc<String>, s: &mut Samples) {
    let (agent, spy, probe, _dir) = build(rounds, body);
    let t0 = Instant::now();
    let mut stream = agent.run_stream("go");
    let mut toolend: HashMap<String, Instant> = HashMap::new();
    let (output, t_done) = loop {
        match stream.next().await {
            Some(AgentEvent::ToolEnd { id, .. }) => {
                toolend.insert(id, Instant::now());
            }
            Some(AgentEvent::Complete(o)) => break (o, Instant::now()),
            Some(AgentEvent::Error(e)) => panic!("run failed: {e}"),
            Some(_) => {}
            None => panic!("no terminal event"),
        }
    };
    let entered = probe.entered.lock().clone();
    let fired = probe.fired.lock().clone();
    let returned = probe.returned.lock().clone();
    let times = spy.request_times.lock().clone();
    assert_eq!(times.len(), spy.requests.load(Ordering::SeqCst));
    assert_eq!(
        times.len(),
        rounds.len() + 1,
        "one request per round, then the answer"
    );

    push(s, "total_turn_ms".into(), gap(t_done, t0));
    push(
        s,
        "peak_tool_concurrency".into(),
        probe.peak.load(Ordering::SeqCst) as f64,
    );
    push(s, "llm_requests".into(), times.len() as f64);
    push(
        s,
        "tool_calls_in_output".into(),
        output.tool_calls.len() as f64,
    );
    push(s, "before_first_llm_request_ms".into(), gap(times[0], t0));
    push(
        s,
        "after_last_llm_request_ms".into(),
        gap(t_done, times[rounds.len()]),
    );

    for (k, round) in rounds.iter().enumerate() {
        let round_label = round
            .iter()
            .map(|(id, name, _)| format!("{id}({name})"))
            .collect::<Vec<_>>()
            .join("+");
        let (mut last_ret, mut last_fired, mut last_end) = (None, None, None);
        for (id, name, _) in round {
            let key = id.to_string();
            let call = format!("{id}({name})");
            let e = *entered.get(&key).expect("entered");
            let f = *fired.get(&key).expect("fired");
            let r = *returned.get(&key).expect("returned");
            let te = *toolend
                .get(&key)
                .unwrap_or_else(|| panic!("no ToolEnd for {key}"));
            // The request that asked for this round is number k.
            push(
                s,
                format!("request_to_tool_entry_ms[{call}]"),
                gap(e, times[k]),
            );
            push(s, format!("work_ms[{call}]"), gap(f, e));
            push(s, format!("returned_minus_fired_ms[{call}]"), gap(r, f));
            push(s, format!("toolend_minus_returned_ms[{call}]"), gap(te, r));
            push(s, format!("toolend_minus_fired_ms[{call}]"), gap(te, f));
            last_ret = later(last_ret, r);
            last_fired = later(last_fired, f);
            last_end = later(last_end, te);
        }
        // The request after this round is number k + 1.
        let next = times[k + 1];
        let (lr, lf, le) = (last_ret.unwrap(), last_fired.unwrap(), last_end.unwrap());
        push(
            s,
            format!("round{k}_last_returned_to_next_llm_ms[{round_label}]"),
            gap(next, lr),
        );
        push(
            s,
            format!("round{k}_last_fired_to_next_llm_ms[{round_label}]"),
            gap(next, lf),
        );
        push(
            s,
            format!("round{k}_last_toolend_to_next_llm_ms[{round_label}]"),
            gap(next, le),
        );
    }
}

fn stats(mut v: Vec<f64>) -> (f64, f64, f64, usize) {
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let n = v.len();
    let median = if n % 2 == 1 {
        v[n / 2]
    } else {
        (v[n / 2 - 1] + v[n / 2]) / 2.0
    };
    (median, v[0], v[n - 1], n)
}

async fn scenario(name: &str, rounds: Vec<Calls>, body: &Arc<String>) {
    let mut s = Samples::new();
    for _ in 0..REPS {
        one_rep(&rounds, body, &mut s).await;
    }
    let per_round: Vec<usize> = rounds.iter().map(|r| r.len()).collect();
    println!("BENCH|{name}|script_calls_per_round={per_round:?}|reps={REPS}");
    for (metric, values) in &s {
        if metric == "total_turn_ms" {
            let raw: Vec<String> = values.iter().map(|v| format!("{v:.1}")).collect();
            println!(
                "BENCH|{name}|total_turn_ms_raw_in_rep_order=[{}]",
                raw.join(", ")
            );
        }
        let (median, min, max, n) = stats(values.clone());
        println!("BENCH|{name}|{metric}|median={median:.2}|min={min:.2}|max={max:.2}|n={n}");
    }
}

fn call(
    id: &'static str,
    name: &'static str,
    ms_delay: u64,
) -> (&'static str, &'static str, Value) {
    (id, name, json!({"id": id, "ms": ms_delay}))
}

// ─── Scenarios ───────────────────────────────────────────────────────────────

/// 1. Two Delay of 500 ms in the same model response.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore]
async fn s1_two_delays_500ms_one_response() {
    let body = Arc::new(realistic_text(BULK_BYTES));
    scenario(
        "S1_parallel_2x500ms",
        vec![vec![call("a", "Delay", 500), call("b", "Delay", 500)]],
        &body,
    )
    .await;
}

/// 2. A fast call (0 ms) and a slow one (500 ms) in the same response.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore]
async fn s2_fast_plus_slow_one_response() {
    let body = Arc::new(realistic_text(BULK_BYTES));
    scenario(
        "S2_parallel_fast0_slow500",
        vec![vec![call("f", "Delay", 0), call("s", "Delay", 500)]],
        &body,
    )
    .await;
}

/// 3. A big result (about 500 KB, instant) and an independent 500 ms call.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore]
async fn s3_big_result_plus_500ms_one_response() {
    let body = Arc::new(realistic_text(BULK_BYTES));
    scenario(
        "S3_parallel_bulk500KB_plus_500ms",
        vec![vec![
            ("g", "Bulk", json!({"id": "g", "ms": 0})),
            call("s", "Delay", 500),
        ]],
        &body,
    )
    .await;
}

/// 3 bis (extra): the big result and a sibling that also ends at once. Shows
/// whether the publication of the big result delays a finished sibling.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore]
async fn s3bis_big_result_plus_instant_sibling() {
    let body = Arc::new(realistic_text(BULK_BYTES));
    scenario(
        "S3bis_parallel_bulk500KB_plus_0ms",
        vec![vec![
            ("g", "Bulk", json!({"id": "g", "ms": 0})),
            call("s", "Delay", 0),
        ]],
        &body,
    )
    .await;
}

/// 4. Sequential reference: the same calls as 1, one per model response.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore]
async fn s4a_sequential_two_delays_500ms() {
    let body = Arc::new(realistic_text(BULK_BYTES));
    scenario(
        "S4a_sequential_2x500ms",
        vec![vec![call("a", "Delay", 500)], vec![call("b", "Delay", 500)]],
        &body,
    )
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore]
async fn s4b_sequential_fast0_slow500() {
    let body = Arc::new(realistic_text(BULK_BYTES));
    scenario(
        "S4b_sequential_fast0_slow500",
        vec![vec![call("f", "Delay", 0)], vec![call("s", "Delay", 500)]],
        &body,
    )
    .await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore]
async fn s4c_sequential_bulk_500kb_then_500ms() {
    let body = Arc::new(realistic_text(BULK_BYTES));
    scenario(
        "S4c_sequential_bulk500KB_then_500ms",
        vec![
            vec![("g", "Bulk", json!({"id": "g", "ms": 0}))],
            vec![call("s", "Delay", 500)],
        ],
        &body,
    )
    .await;
}

/// Compression alone, on the same 500 KB text, through the public API of
/// `Compressor` (no agent, no channel). Includes the save of the original
/// into the raw store when the output is reduced.
#[test]
#[ignore]
fn compression_alone_on_the_big_result() {
    let text = realistic_text(BULK_BYTES);
    let raw_dir = std::env::temp_dir().join("bench-concurrency-raw");
    let compressor = Compressor::new(
        CompressionConfig::default(),
        RuleSet::builtin_shared(),
        Some(RawStore::new(raw_dir)),
    );
    let input = json!({"id": "g", "ms": 0});
    for level in [CompressionLevel::Off, CompressionLevel::Minimal] {
        let mut times = Vec::new();
        let mut out_len = 0;
        for _ in 0..REPS {
            let out = ToolOutput {
                tool: "Bulk",
                input: &input,
                content: &text,
                is_error: false,
                call_id: "g",
                exit_code: None,
            };
            let t = Instant::now();
            let processed = compressor.process(&out, level);
            times.push(t.elapsed().as_secs_f64() * 1000.0);
            out_len = processed.text.len();
        }
        let label = format!("compression_alone_{level:?}");
        let (median, min, max, n) = stats(times);
        println!("BENCH|{label}|process_ms|median={median:.2}|min={min:.2}|max={max:.2}|n={n}");
        println!(
            "BENCH|{label}|input_bytes={}|output_bytes={out_len}",
            text.len()
        );
    }
}
