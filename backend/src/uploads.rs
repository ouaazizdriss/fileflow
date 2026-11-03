use std::{collections::HashMap, path::PathBuf, sync::Arc};

use axum::{
    body::Bytes,
    extract::{Query, State},
    http::StatusCode,
    Extension, Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::{
    fs,
    io::{AsyncSeekExt, AsyncWriteExt},
    sync::Mutex,
};
use uuid::Uuid;

use crate::{
    error::{AppError, Result},
    files::{archive_existing_version, check_quota, is_blocked_extension, resolve, sanitize_name, validate_access},
    models::{Claims, Permission},
    AppState,
};

/// A resumable upload in progress. The bytes themselves live in a `.part` file
/// on disk; only the bookkeeping is kept in memory.
#[derive(Clone)]
pub struct UploadSession {
    pub owner: String,
    pub dir_path: String,
    pub filename: String,
    pub total_size: u64,
    pub received: u64,
    pub temp_path: PathBuf,
    pub created_at: DateTime<Utc>,
    /// Serializes concurrent chunk writes to the same session.
    pub write_lock: Arc<Mutex<()>>,
}

pub type UploadSessions = Arc<Mutex<HashMap<String, UploadSession>>>;

pub fn new_sessions() -> UploadSessions {
    Arc::new(Mutex::new(HashMap::new()))
}

/// Largest single chunk we will buffer in memory. The client uploads 5 MiB
/// chunks; this cap (applied as a per-route body limit) prevents a malicious
/// client from sending one enormous chunk and exhausting memory.
pub const MAX_CHUNK_BYTES: usize = 32 * 1024 * 1024;

/// How long an idle, unfinished upload session is kept before the reaper
/// discards it and deletes its `.part` file.
pub const SESSION_TTL_SECS: i64 = 6 * 3600;

/// Pure selection step for the reaper: ids of sessions created before `cutoff`.
fn stale_ids(map: &HashMap<String, UploadSession>, cutoff: DateTime<Utc>) -> Vec<String> {
    map.iter()
        .filter(|(_, s)| s.created_at < cutoff)
        .map(|(id, _)| id.clone())
        .collect()
}

/// Remove upload sessions idle for longer than `SESSION_TTL_SECS`, deleting
/// each one's temp file. Returns the number reaped.
pub async fn reap_stale(sessions: &UploadSessions, now: DateTime<Utc>) -> usize {
    let cutoff = now - chrono::Duration::seconds(SESSION_TTL_SECS);
    let removed: Vec<UploadSession> = {
        let mut map = sessions.lock().await;
        let ids = stale_ids(&map, cutoff);
        ids.iter().filter_map(|id| map.remove(id)).collect()
    };
    for sess in &removed {
        let _ = tokio::fs::remove_file(&sess.temp_path).await;
    }
    removed.len()
}

/// On startup, delete `.part` files left behind by a previous run. Sessions live
/// only in memory, so any existing temp file is orphaned and unrecoverable.
pub async fn cleanup_orphaned_parts(root: &std::path::Path) {
    let uploads_dir = root.join(".fileflow/uploads");
    let mut rd = match tokio::fs::read_dir(&uploads_dir).await {
        Ok(rd) => rd,
        Err(_) => return,
    };
    let mut removed = 0u32;
    while let Ok(Some(entry)) = rd.next_entry().await {
        let p = entry.path();
        if p.extension().map(|e| e == "part").unwrap_or(false)
            && tokio::fs::remove_file(&p).await.is_ok() {
                removed += 1;
            }
    }
    if removed > 0 {
        tracing::info!("cleaned up {} orphaned upload part file(s)", removed);
    }
}

// ─── Request / response types ─────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct InitUploadRequest {
    pub path: String,
    pub filename: String,
    pub size: u64,
}

#[derive(Serialize)]
pub struct InitUploadResponse {
    pub upload_id: String,
    pub offset: u64,
}

#[derive(Deserialize)]
pub struct ChunkQuery {
    pub upload_id: String,
    pub offset: u64,
}

#[derive(Deserialize)]
pub struct UploadIdQuery {
    pub upload_id: String,
}

#[derive(Deserialize)]
pub struct FinishRequest {
    pub upload_id: String,
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

/// Begin (or be ready to resume) a resumable upload. Validates write access,
/// the blocklist and quota up front so the client fails fast before sending data.
pub async fn init_upload(
    State(s): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<InitUploadRequest>,
) -> Result<Json<InitUploadResponse>> {
    validate_access(&s, &claims.sub, &req.path, Permission::FileWrite).await?;

    let dir = resolve(&s.config.root_dir, &req.path)?;
    if !dir.is_dir() {
        return Err(AppError::BadRequest("Target is not a directory".into()));
    }

    let safe = sanitize_name(&req.filename);
    if safe.is_empty() {
        return Err(AppError::BadRequest("Invalid filename".into()));
    }
    if is_blocked_extension(&safe) {
        return Err(AppError::BadRequest("File type is not allowed".into()));
    }
    if req.size as usize > s.config.max_upload_size {
        return Err(AppError::BadRequest("File exceeds max upload size".into()));
    }
    check_quota(&s, &claims.sub, req.size).await?;

    let upload_id = Uuid::new_v4().simple().to_string();
    let uploads_dir = s.config.root_dir.join(".fileflow/uploads");
    fs::create_dir_all(&uploads_dir).await?;
    let temp_path = uploads_dir.join(format!("{}.part", upload_id));

    // Create (truncate) the part file.
    fs::File::create(&temp_path).await?;

    let session = UploadSession {
        owner: claims.sub.clone(),
        dir_path: req.path.clone(),
        filename: safe,
        total_size: req.size,
        received: 0,
        temp_path,
        created_at: Utc::now(),
        write_lock: Arc::new(Mutex::new(())),
    };

    s.upload_sessions.lock().await.insert(upload_id.clone(), session);

    Ok(Json(InitUploadResponse { upload_id, offset: 0 }))
}

/// Report how many bytes the server has so a disconnected client can resume.
pub async fn upload_status(
    State(s): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(q): Query<UploadIdQuery>,
) -> Result<Json<Value>> {
    let sessions = s.upload_sessions.lock().await;
    let session = sessions
        .get(&q.upload_id)
        .ok_or_else(|| AppError::NotFound("Upload session not found".into()))?;
    if session.owner != claims.sub {
        return Err(AppError::Forbidden);
    }
    Ok(Json(json!({ "offset": session.received, "total": session.total_size })))
}

/// Append one chunk at `offset`. Chunks must arrive in order (offset == bytes
/// received so far); a mismatch returns 409 with the expected offset so the
/// client can re-seek.
pub async fn upload_chunk(
    State(s): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(q): Query<ChunkQuery>,
    body: Bytes,
) -> Result<Json<Value>> {
    // Snapshot the session metadata and its write lock.
    let session = {
        let sessions = s.upload_sessions.lock().await;
        let session = sessions
            .get(&q.upload_id)
            .ok_or_else(|| AppError::NotFound("Upload session not found".into()))?;
        if session.owner != claims.sub {
            return Err(AppError::Forbidden);
        }
        session.clone()
    };

    let _guard = session.write_lock.lock().await;

    // Re-read received under the write lock to avoid a stale snapshot.
    let received = {
        let sessions = s.upload_sessions.lock().await;
        sessions.get(&q.upload_id).map(|x| x.received).unwrap_or(session.received)
    };

    if q.offset != received {
        return Err(AppError::Conflict(format!(
            "Unexpected offset; expected {}",
            received
        )));
    }

    let new_total = received + body.len() as u64;
    if new_total > session.total_size {
        return Err(AppError::BadRequest("Chunk exceeds declared file size".into()));
    }
    if new_total as usize > s.config.max_upload_size {
        return Err(AppError::BadRequest("Upload exceeds max upload size".into()));
    }

    // Write the chunk at the requested offset.
    let mut file = fs::OpenOptions::new()
        .write(true)
        .open(&session.temp_path)
        .await?;
    file.seek(std::io::SeekFrom::Start(received)).await?;
    file.write_all(&body).await?;
    file.flush().await?;

    // Commit the new received count.
    {
        let mut sessions = s.upload_sessions.lock().await;
        if let Some(sess) = sessions.get_mut(&q.upload_id) {
            sess.received = new_total;
        }
    }

    Ok(Json(json!({ "offset": new_total, "total": session.total_size })))
}

/// Finalize: verify the byte count, archive any existing file as a version,
/// move the part file into place, and update quota + audit.
pub async fn finish_upload(
    State(s): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<FinishRequest>,
) -> Result<Json<Value>> {
    let session = {
        let mut sessions = s.upload_sessions.lock().await;
        let session = sessions
            .get(&req.upload_id)
            .ok_or_else(|| AppError::NotFound("Upload session not found".into()))?;
        if session.owner != claims.sub {
            return Err(AppError::Forbidden);
        }
        if session.received != session.total_size {
            return Err(AppError::BadRequest(format!(
                "Upload incomplete: {} of {} bytes",
                session.received, session.total_size
            )));
        }
        // Remove from the map; we own the temp file from here on.
        sessions
            .remove(&req.upload_id)
            .ok_or_else(|| AppError::NotFound("Upload session not found".into()))?
    };

    // Re-validate access at finalize time (permissions may have changed).
    validate_access(&s, &claims.sub, &session.dir_path, Permission::FileWrite).await?;

    let dir = resolve(&s.config.root_dir, &session.dir_path)?;
    if !dir.is_dir() {
        let _ = fs::remove_file(&session.temp_path).await;
        return Err(AppError::BadRequest("Target is not a directory".into()));
    }
    let dest = dir.join(&session.filename);

    // Versioning: archive an existing file before overwriting.
    if let Some(ts) = archive_existing_version(&s.config.root_dir, &dest).await? {
        s.audit
            .log(
                &claims.sub,
                "version_archive",
                Some(format!("{}/{}", session.dir_path, session.filename)),
                None,
                Some(format!("version: {}", ts)),
            )
            .await;
    }

    fs::rename(&session.temp_path, &dest).await?;

    s.users.update_used_bytes(&claims.sub, session.total_size as i64).await?;
    s.audit
        .log(
            &claims.sub,
            "upload",
            Some(format!("{}/{}", session.dir_path, session.filename)),
            None,
            Some(format!("resumable; {} bytes", session.total_size)),
        )
        .await;

    Ok(Json(json!({ "uploaded": session.filename, "size": session.total_size })))
}

/// Abort an in-progress upload and discard its temp file.
pub async fn abort_upload(
    State(s): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(q): Query<UploadIdQuery>,
) -> Result<StatusCode> {
    let session = {
        let mut sessions = s.upload_sessions.lock().await;
        match sessions.get(&q.upload_id) {
            Some(sess) if sess.owner == claims.sub => sessions.remove(&q.upload_id),
            Some(_) => return Err(AppError::Forbidden),
            None => None,
        }
    };
    if let Some(sess) = session {
        let _ = fs::remove_file(&sess.temp_path).await;
    }
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_session(temp: PathBuf, created_at: DateTime<Utc>) -> UploadSession {
        UploadSession {
            owner: "u".into(),
            dir_path: "/".into(),
            filename: "f".into(),
            total_size: 10,
            received: 0,
            temp_path: temp,
            created_at,
            write_lock: Arc::new(Mutex::new(())),
        }
    }

    #[test]
    fn stale_ids_selects_only_old_sessions() {
        let now = Utc::now();
        let mut map = HashMap::new();
        map.insert("old".to_string(), make_session("/x".into(), now - chrono::Duration::hours(2)));
        map.insert("new".to_string(), make_session("/y".into(), now));
        let cutoff = now - chrono::Duration::hours(1);
        let ids = stale_ids(&map, cutoff);
        assert_eq!(ids, vec!["old".to_string()]);
    }

    #[tokio::test]
    async fn reap_removes_stale_and_deletes_temp_file() {
        let dir = tempfile::tempdir().unwrap();
        let now = Utc::now();
        let old_part = dir.path().join("old.part");
        let new_part = dir.path().join("new.part");
        tokio::fs::write(&old_part, b"x").await.unwrap();
        tokio::fs::write(&new_part, b"x").await.unwrap();

        let sessions = new_sessions();
        {
            let mut m = sessions.lock().await;
            m.insert("old".into(), make_session(old_part.clone(), now - chrono::Duration::seconds(SESSION_TTL_SECS + 60)));
            m.insert("new".into(), make_session(new_part.clone(), now));
        }

        let reaped = reap_stale(&sessions, now).await;
        assert_eq!(reaped, 1);
        assert!(!old_part.exists()); // stale temp file deleted
        assert!(new_part.exists()); // fresh session untouched
        assert_eq!(sessions.lock().await.len(), 1);
    }

    #[tokio::test]
    async fn cleanup_orphaned_parts_targets_only_part_files() {
        let dir = tempfile::tempdir().unwrap();
        let uploads = dir.path().join(".fileflow/uploads");
        tokio::fs::create_dir_all(&uploads).await.unwrap();
        tokio::fs::write(uploads.join("a.part"), b"x").await.unwrap();
        tokio::fs::write(uploads.join("keep.txt"), b"x").await.unwrap();

        cleanup_orphaned_parts(dir.path()).await;
        assert!(!uploads.join("a.part").exists());
        assert!(uploads.join("keep.txt").exists());
    }
}
