//! Fan-out of desktop events to the subscribed windows.
//!
//! Each subscription has a bounded queue drained by its own task, which
//! writes to the channel. Publishing never waits: a subscriber whose queue
//! is full misses the event, and is told so with `Lagged` for that session
//! once it can take it again (the view then reloads the session).

use crate::contract::{ChangeRecord, DesktopEvent};
use crate::services::changes::ChangeJournal;
use std::collections::{HashMap, HashSet};
use std::time::Duration;
use tauri::ipc::Channel;
use tokio::sync::mpsc::error::TrySendError;
use tokio::time::Instant;

/// Events a subscriber may have waiting before it starts missing some.
const SUBSCRIBER_QUEUE: usize = 2048;
/// Coalesce consecutive streaming deltas within one 60 Hz display frame.
const DELTA_COALESCE_WINDOW: Duration = Duration::from_millis(16);

struct Subscriber {
    tx: tokio::sync::mpsc::Sender<DesktopEvent>,
    /// Sessions whose events were missed: a `Lagged` notice is owed.
    lagged: HashSet<String>,
}

pub struct Hub {
    subscribers: parking_lot::Mutex<HashMap<String, Subscriber>>,
    pub journal: std::sync::Arc<ChangeJournal>,
}

impl Hub {
    pub fn new(journal: std::sync::Arc<ChangeJournal>) -> Self {
        Self {
            subscribers: parking_lot::Mutex::new(HashMap::new()),
            journal,
        }
    }

    /// Subscribes `channel` to every session's events; returns the
    /// subscription id.
    pub fn subscribe(&self, channel: Channel<DesktopEvent>) -> String {
        let id = uuid::Uuid::new_v4().simple().to_string();
        let (tx, mut rx) = tokio::sync::mpsc::channel::<DesktopEvent>(SUBSCRIBER_QUEUE);
        tauri::async_runtime::spawn(async move {
            let mut pending: Option<DesktopEvent> = None;
            let mut last_delta_sent: Option<Instant> = None;
            let mut flush_at: Option<Instant> = None;

            loop {
                let Some(buffered) = pending.take() else {
                    let Some(event) = rx.recv().await else {
                        break;
                    };
                    if is_coalesceable_delta(&event) {
                        if last_delta_sent.is_none_or(|t| t.elapsed() >= DELTA_COALESCE_WINDOW) {
                            if channel.send(event).is_err() {
                                break;
                            }
                            last_delta_sent = Some(Instant::now());
                        } else {
                            let base = last_delta_sent.unwrap_or_else(Instant::now);
                            pending = Some(event);
                            flush_at = Some(base + DELTA_COALESCE_WINDOW);
                        }
                    } else {
                        if channel.send(event).is_err() {
                            break;
                        }
                        last_delta_sent = None;
                    }
                    continue;
                };

                pending = Some(buffered);
                let deadline = flush_at.unwrap_or_else(Instant::now);
                tokio::select! {
                    biased;
                    maybe_next = rx.recv() => {
                        match maybe_next {
                            Some(next) => {
                                if let Some(cur) = pending.as_mut()
                                    && try_coalesce(cur, &next)
                                {
                                    continue;
                                }
                                if let Some(ready) = pending.take()
                                    && channel.send(ready).is_err()
                                {
                                    break;
                                }
                                if is_coalesceable_delta(&next) {
                                    let now = Instant::now();
                                    pending = Some(next);
                                    last_delta_sent = Some(now);
                                    flush_at = Some(now + DELTA_COALESCE_WINDOW);
                                } else {
                                    if channel.send(next).is_err() {
                                        break;
                                    }
                                    last_delta_sent = None;
                                    flush_at = None;
                                }
                            }
                            None => {
                                if let Some(ready) = pending.take() {
                                    let _ = channel.send(ready);
                                }
                                break;
                            }
                        }
                    }
                    _ = tokio::time::sleep_until(deadline) => {
                        if let Some(ready) = pending.take()
                            && channel.send(ready).is_err()
                        {
                            break;
                        }
                        last_delta_sent = Some(Instant::now());
                        flush_at = None;
                    }
                }
            }
        });
        self.subscribers.lock().insert(
            id.clone(),
            Subscriber {
                tx,
                lagged: HashSet::new(),
            },
        );
        id
    }

    pub fn unsubscribe(&self, subscription_id: &str) -> bool {
        self.subscribers.lock().remove(subscription_id).is_some()
    }

    /// Sends `event` to every subscriber without waiting for any of them.
    pub fn publish(&self, event: DesktopEvent) {
        let session = session_of(&event);
        let mut subs = self.subscribers.lock();
        subs.retain(|_, sub| {
            // Owed notices first, while there is room for them.
            let owed: Vec<String> = sub.lagged.iter().cloned().collect();
            for session_id in owed {
                match sub.tx.try_send(DesktopEvent::Lagged {
                    session_id: session_id.clone(),
                }) {
                    Ok(()) => {
                        sub.lagged.remove(&session_id);
                    }
                    Err(TrySendError::Full(_)) => break,
                    Err(TrySendError::Closed(_)) => return false,
                }
            }
            match sub.tx.try_send(event.clone()) {
                Ok(()) => true,
                Err(TrySendError::Full(_)) => {
                    if let Some(id) = &session {
                        sub.lagged.insert(id.clone());
                    }
                    true
                }
                Err(TrySendError::Closed(_)) => false,
            }
        });
    }

    /// A journal entry, announced to every window.
    pub fn record_added(&self, record: ChangeRecord) {
        self.publish(DesktopEvent::ChangeRecorded { record });
    }
}

/// Whether `event` is a `text_delta` or `thinking_delta` engine envelope eligible for coalescing.
fn is_coalesceable_delta(event: &DesktopEvent) -> bool {
    let DesktopEvent::Engine { envelope, .. } = event else {
        return false;
    };
    matches!(
        envelope.get("type").and_then(|v| v.as_str()),
        Some("text_delta" | "thinking_delta")
    ) && envelope.get("text").and_then(|v| v.as_str()).is_some()
}

/// Merge `next` into `pending` when both are consecutive streaming deltas of the same kind,
/// session, and run.
fn try_coalesce(pending: &mut DesktopEvent, next: &DesktopEvent) -> bool {
    let (
        DesktopEvent::Engine {
            project_id: p_proj,
            envelope: p_env,
        },
        DesktopEvent::Engine {
            project_id: n_proj,
            envelope: n_env,
        },
    ) = (pending, next)
    else {
        return false;
    };
    if p_proj != n_proj {
        return false;
    }
    let Some(kind) = p_env.get("type").and_then(|v| v.as_str()) else {
        return false;
    };
    if !matches!(kind, "text_delta" | "thinking_delta")
        || n_env.get("type").and_then(|v| v.as_str()) != Some(kind)
    {
        return false;
    }
    if p_env.get("session_id") != n_env.get("session_id")
        || p_env.get("run_id") != n_env.get("run_id")
    {
        return false;
    }
    let (Some(p_text), Some(n_text)) = (
        p_env.get("text").and_then(|v| v.as_str()).map(str::to_owned),
        n_env.get("text").and_then(|v| v.as_str()),
    ) else {
        return false;
    };
    if let Some(obj) = p_env.as_object_mut() {
        obj.insert(
            "text".into(),
            serde_json::Value::String(format!("{p_text}{n_text}")),
        );
        if let Some(seq) = n_env.get("seq") {
            obj.insert("seq".into(), seq.clone());
        }
        if let Some(at) = n_env.get("at") {
            obj.insert("at".into(), at.clone());
        }
        return true;
    }
    false
}

/// The session an event is about, when it has one.
fn session_of(event: &DesktopEvent) -> Option<String> {
    match event {
        DesktopEvent::Engine { envelope, .. } => envelope
            .get("session_id")
            .and_then(|v| v.as_str())
            .map(String::from),
        DesktopEvent::SessionState { session_id, .. }
        | DesktopEvent::SessionDeleted { session_id }
        | DesktopEvent::Lagged { session_id }
        | DesktopEvent::RunLabeled { session_id, .. } => Some(session_id.clone()),
        DesktopEvent::SessionUpdated { session } => Some(session.id.clone()),
        DesktopEvent::ChangeRecorded { record } => Some(record.session_id.clone()),
        DesktopEvent::UpdateStateChanged { .. } => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};
    use tauri::ipc::{Channel, InvokeResponseBody};

    #[tokio::test(flavor = "multi_thread")]
    async fn a_stuck_window_never_blocks_publishing_and_is_told_what_it_missed() {
        let dir = tempfile::tempdir().unwrap();
        let hub = Hub::new(Arc::new(ChangeJournal::at(dir.path().to_path_buf())));
        // The window is stuck until the test releases it.
        let (release_tx, release_rx) = std::sync::mpsc::channel::<()>();
        let release_rx = Mutex::new(release_rx);
        let (seen_tx, seen_rx) = std::sync::mpsc::channel::<String>();
        let channel: Channel<DesktopEvent> = Channel::new(move |body| {
            let _ = release_rx.lock().unwrap().recv();
            if let InvokeResponseBody::Json(text) = body {
                let _ = seen_tx.send(text);
            }
            Ok(())
        });
        let id = hub.subscribe(channel);

        let started = Instant::now();
        for i in 0..5000 {
            hub.publish(DesktopEvent::SessionState {
                session_id: "s1".into(),
                open: true,
                running: i % 2 == 0,
            });
        }
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "publishing never waits"
        );

        // Released, the window takes events again; the missed session is
        // announced on a later publication.
        for _ in 0..10_000 {
            let _ = release_tx.send(());
        }
        let mut lagged = false;
        for _ in 0..200 {
            hub.publish(DesktopEvent::SessionState {
                session_id: "s2".into(),
                open: false,
                running: false,
            });
            while let Ok(text) = seen_rx.try_recv() {
                if text.contains("\"kind\":\"lagged\"") && text.contains("\"s1\"") {
                    lagged = true;
                }
            }
            if lagged {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        assert!(lagged, "the missed session is announced");
        assert!(hub.unsubscribe(&id));
        assert!(!hub.unsubscribe(&id), "unknown ids are reported as such");
    }

    fn delta_event(
        session_id: &str,
        run_id: &str,
        seq: u64,
        at: i64,
        kind: &str,
        text: &str,
    ) -> DesktopEvent {
        DesktopEvent::Engine {
            project_id: Some("p1".into()),
            envelope: serde_json::json!({
                "schema": 1,
                "session_id": session_id,
                "run_id": run_id,
                "seq": seq,
                "at": at,
                "type": kind,
                "text": text,
            }),
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn coalesces_burst_text_deltas_and_preserves_first_token_immediacy() {
        let dir = tempfile::tempdir().unwrap();
        let hub = Hub::new(Arc::new(ChangeJournal::at(dir.path().to_path_buf())));
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<serde_json::Value>();
        let channel: Channel<DesktopEvent> = Channel::new(move |body| {
            if let InvokeResponseBody::Json(text) = body
                && let Ok(val) = serde_json::from_str::<serde_json::Value>(&text)
            {
                let _ = tx.send(val);
            }
            Ok(())
        });
        let id = hub.subscribe(channel);

        // First delta arrives with 0 ms coalesce delay.
        hub.publish(delta_event("s1", "r1", 1, 100, "text_delta", "Hello"));
        let first = tokio::time::timeout(Duration::from_millis(50), rx.recv())
            .await
            .expect("first delta arrives promptly")
            .unwrap();
        assert_eq!(
            first,
            serde_json::to_value(delta_event("s1", "r1", 1, 100, "text_delta", "Hello")).unwrap()
        );

        // Rapid follow-up deltas within the 16 ms window coalesce into a single event.
        hub.publish(delta_event("s1", "r1", 2, 101, "text_delta", " "));
        hub.publish(delta_event("s1", "r1", 3, 102, "text_delta", "world"));
        hub.publish(delta_event("s1", "r1", 4, 103, "text_delta", "!"));

        let coalesced = tokio::time::timeout(Duration::from_millis(200), rx.recv())
            .await
            .expect("coalesced delta arrives after window")
            .unwrap();
        assert_eq!(
            coalesced,
            serde_json::to_value(delta_event("s1", "r1", 4, 103, "text_delta", " world!")).unwrap()
        );
        assert!(rx.try_recv().is_err(), "no extra fragmented deltas sent");

        assert!(hub.unsubscribe(&id));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn flushes_pending_delta_immediately_before_non_delta_or_different_kind() {
        let dir = tempfile::tempdir().unwrap();
        let hub = Hub::new(Arc::new(ChangeJournal::at(dir.path().to_path_buf())));
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<serde_json::Value>();
        let channel: Channel<DesktopEvent> = Channel::new(move |body| {
            if let InvokeResponseBody::Json(text) = body
                && let Ok(val) = serde_json::from_str::<serde_json::Value>(&text)
            {
                let _ = tx.send(val);
            }
            Ok(())
        });
        let id = hub.subscribe(channel);

        // First text_delta goes immediately, second is buffered.
        hub.publish(delta_event("s1", "r1", 1, 100, "text_delta", "A"));
        let _ = tokio::time::timeout(Duration::from_millis(50), rx.recv())
            .await
            .unwrap();

        hub.publish(delta_event("s1", "r1", 2, 101, "text_delta", "B"));
        hub.publish(delta_event("s1", "r1", 3, 102, "text_delta", "C"));
        // Switching to thinking_delta immediately flushes buffered text_delta ("BC").
        hub.publish(delta_event("s1", "r1", 4, 103, "thinking_delta", "hmm"));
        // A non-delta immediately flushes the buffered thinking_delta and passes through in order.
        let tool_started = DesktopEvent::Engine {
            project_id: Some("p1".into()),
            envelope: serde_json::json!({
                "schema": 1,
                "session_id": "s1",
                "run_id": "r1",
                "seq": 5,
                "at": 104,
                "type": "tool_started",
                "tool_call_id": "tc1",
                "name": "Read",
                "input": {},
            }),
        };
        hub.publish(tool_started.clone());

        let mut received = Vec::new();
        for _ in 0..3 {
            received.push(
                tokio::time::timeout(Duration::from_millis(50), rx.recv())
                    .await
                    .expect("flushed without waiting full coalesce window")
                    .unwrap(),
            );
        }
        assert_eq!(
            received,
            vec![
                serde_json::to_value(delta_event("s1", "r1", 3, 102, "text_delta", "BC")).unwrap(),
                serde_json::to_value(delta_event("s1", "r1", 4, 103, "thinking_delta", "hmm"))
                    .unwrap(),
                serde_json::to_value(tool_started).unwrap(),
            ]
        );
        assert!(hub.unsubscribe(&id));
    }
}
