//! Videos read by `Read`: a video file (MP4, MOV, WebM, AVI) is shown to
//! the model.
//!
//! Video detection inspects leading magic bytes only (never the file extension)
//! so text files with a `.mp4` extension remain readable as text.

use super::*;
use base64::Engine as _;
use std::path::{Path, PathBuf};

/// Largest video read, in bytes (20 MiB).
pub const MAX_VIDEO_BYTES: usize = 20 * 1024 * 1024;

/// Whether the file at `path` starts with magic bytes of a supported `video/*` format.
pub fn starts_like_video(path: &Path) -> bool {
    use std::io::Read as _;
    let mut head = [0u8; 64];
    let Ok(mut file) = std::fs::File::open(path) else {
        return false;
    };
    let mut n = 0;
    while n < head.len() {
        match file.read(&mut head[n..]) {
            Ok(0) | Err(_) => break,
            Ok(k) => n += k,
        }
    }
    is_video_magic(&head[..n])
}

fn is_video_magic(bytes: &[u8]) -> bool {
    bricks_types::detect_mime(bytes, None).is_some_and(|mime| mime.starts_with("video/"))
}

/// Shows the video at `path` to the model (`display_path` as the agent wrote it,
/// for messages): its type and size in text, and the base64-encoded video in
/// [`ToolResult::videos`].
pub async fn view(path: PathBuf, display_path: &str, ctx: &ToolContext) -> ToolResult {
    if let Some(support) = ctx.extensions.get::<crate::VideoSupport>()
        && !support.0
    {
        return ToolResult::error(format!(
            "Cannot read video {display_path}: the active model does not support video input."
        ));
    }

    let meta = match tokio::fs::metadata(&path).await {
        Ok(m) => m,
        Err(e) => return ToolResult::error(format!("{display_path}: {e}")),
    };
    if meta.len() > MAX_VIDEO_BYTES as u64 {
        return ToolResult::error(format!(
            "{display_path} is {} bytes; videos over {MAX_VIDEO_BYTES} bytes (20 MiB) are not accepted.",
            meta.len()
        ));
    }

    let bytes = match tokio::fs::read(&path).await {
        Ok(b) => b,
        Err(e) => return ToolResult::error(format!("{display_path}: {e}")),
    };
    if bytes.len() > MAX_VIDEO_BYTES {
        return ToolResult::error(format!(
            "{display_path} is {} bytes; videos over {MAX_VIDEO_BYTES} bytes (20 MiB) are not accepted.",
            bytes.len()
        ));
    }

    let Some(mime) = bricks_types::detect_mime(&bytes, None).filter(|m| m.starts_with("video/"))
    else {
        return ToolResult::error(format!(
            "{display_path} is not a supported video file (MP4, MOV, WebM, or AVI)."
        ));
    };

    let byte_len = bytes.len();
    let data_base64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    ToolResult::success(format!("Video {display_path}: {mime}, {byte_len} bytes"))
        .with_metadata(serde_json::json!({ "media_type": mime, "size": byte_len }))
        .with_videos(vec![ToolVideo {
            media_type: mime,
            data_base64,
            path: Some(display_path.to_string()),
            bytes: byte_len,
        }])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::permissions::AllowAll;
    use crate::{CostTracker, Extensions, VideoSupport};

    fn mp4_bytes() -> Vec<u8> {
        let mut b = vec![0, 0, 0, 20];
        b.extend_from_slice(b"ftypisom");
        b.extend_from_slice(&[0, 0, 2, 0]);
        b.extend_from_slice(b"isomiso2");
        b
    }

    fn webm_bytes() -> Vec<u8> {
        vec![0x1A, 0x45, 0xDF, 0xA3, 0x9F, 0x42, 0x86, 0x81, 0x01, 0x42, 0xF7, 0x81]
    }

    fn ctx(dir: &Path) -> ToolContext {
        ToolContext {
            working_dir: dir.to_path_buf(),
            session_id: "view-video-test".into(),
            permissions: Arc::new(AllowAll),
            cost_tracker: Arc::new(CostTracker::new()),
            mcp_manager: None,
            extensions: Extensions::default(),
        }
    }

    #[tokio::test]
    async fn mp4_and_webm_are_detected_and_carried_in_result_videos() {
        let dir = tempfile::tempdir().unwrap();
        let mp4 = mp4_bytes();
        std::fs::write(dir.path().join("clip.mp4"), &mp4).unwrap();
        let r = crate::file_read::FileReadTool
            .execute(
                serde_json::json!({ "file_path": "clip.mp4" }),
                &ctx(dir.path()),
            )
            .await;
        assert!(!r.is_error, "{}", r.content);
        assert!(r.content.contains("video/mp4"), "{}", r.content);
        assert_eq!(r.videos.len(), 1);
        assert_eq!(r.videos[0].media_type, "video/mp4");
        assert_eq!(r.videos[0].bytes, mp4.len());
        assert_eq!(r.videos[0].path.as_deref(), Some("clip.mp4"));
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(&r.videos[0].data_base64)
            .unwrap();
        assert_eq!(decoded, mp4);

        let webm = webm_bytes();
        std::fs::write(dir.path().join("clip.webm"), &webm).unwrap();
        let r = crate::file_read::FileReadTool
            .execute(
                serde_json::json!({ "file_path": "clip.webm" }),
                &ctx(dir.path()),
            )
            .await;
        assert!(!r.is_error, "{}", r.content);
        assert_eq!(r.videos.len(), 1);
        assert_eq!(r.videos[0].media_type, "video/webm");
        assert_eq!(r.videos[0].bytes, webm.len());
    }

    #[tokio::test]
    async fn text_file_named_mp4_is_read_as_text_not_video() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("clip.mp4"), "hello\nworld\n").unwrap();
        assert!(!starts_like_video(&dir.path().join("clip.mp4")));

        let r = crate::file_read::FileReadTool
            .execute(
                serde_json::json!({ "file_path": "clip.mp4" }),
                &ctx(dir.path()),
            )
            .await;
        assert!(!r.is_error, "{}", r.content);
        assert!(r.videos.is_empty());
        assert!(r.content.contains("1 | hello"), "{}", r.content);
    }

    #[tokio::test]
    async fn oversized_video_returns_error() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("huge.mp4");
        {
            use std::io::{Seek, SeekFrom, Write};
            let mut f = std::fs::File::create(&path).unwrap();
            f.write_all(&mp4_bytes()).unwrap();
            f.seek(SeekFrom::Start(MAX_VIDEO_BYTES as u64)).unwrap();
            f.write_all(&[0]).unwrap();
        }
        let r = crate::file_read::FileReadTool
            .execute(
                serde_json::json!({ "file_path": "huge.mp4" }),
                &ctx(dir.path()),
            )
            .await;
        assert!(r.is_error, "expected oversized error");
        assert!(r.content.contains("20 MiB"), "{}", r.content);
        assert!(r.videos.is_empty());
    }

    #[tokio::test]
    async fn offset_and_limit_are_rejected_for_video() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("clip.mp4"), mp4_bytes()).unwrap();
        for input in [
            serde_json::json!({ "file_path": "clip.mp4", "offset": 1 }),
            serde_json::json!({ "file_path": "clip.mp4", "limit": 10 }),
        ] {
            let r = crate::file_read::FileReadTool
                .execute(input, &ctx(dir.path()))
                .await;
            assert!(r.is_error, "expected error for offset/limit on video");
            assert!(r.content.contains("offset and limit"), "{}", r.content);
            assert!(r.videos.is_empty());
        }
    }

    #[tokio::test]
    async fn video_support_false_is_rejected_cleanly() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("clip.mp4"), mp4_bytes()).unwrap();
        let c = ctx(dir.path());
        c.extensions.insert(VideoSupport(false));
        let r = crate::file_read::FileReadTool
            .execute(serde_json::json!({ "file_path": "clip.mp4" }), &c)
            .await;
        assert!(r.is_error);
        assert!(
            r.content.contains("does not support video input"),
            "{}",
            r.content
        );
        assert!(r.videos.is_empty());
    }
}
