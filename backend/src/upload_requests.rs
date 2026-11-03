use std::{collections::HashMap, path::PathBuf, sync::Arc};

use axum::{
    extract::{ConnectInfo, Multipart, Path, State},
    http::{HeaderMap, StatusCode},
    response::{Html, IntoResponse, Response},
    Extension, Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio::{fs, io::AsyncWriteExt, sync::RwLock};
use uuid::Uuid;

use crate::{
    db::Db,
    error::{AppError, Result},
    files::{check_quota, is_blocked_extension, resolve, sanitize_name},
    models::{Claims, Permission},
    AppState,
};

/// Delete any temp files staged for a public upload that ultimately failed
/// (wrong password, oversize, blocked type, …) so nothing is left behind.
async fn discard_staged(staged: &[(String, std::path::PathBuf)]) {
    for (_, temp) in staged {
        let _ = fs::remove_file(temp).await;
    }
}

/// `report.txt` → `report (n).txt`; the extension stays last so the file still
/// opens with the right application. Leading-dot names have no extension.
fn numbered_name(name: &str, n: u32) -> String {
    match name.rfind('.').filter(|&i| i > 0) {
        Some(i) => format!("{} ({}){}", &name[..i], n, &name[i..]),
        None => format!("{} ({})", name, n),
    }
}

/// Move a staged upload into `folder` without ever replacing an existing file:
/// an anonymous uploader must not be able to overwrite the owner's documents.
/// The name is reserved with `create_new` (atomic, fails if it exists), so
/// concurrent uploads can't race each other; the staged file then replaces
/// only our own empty placeholder. Returns the name used.
async fn place_without_overwrite(temp: &std::path::Path, folder: &std::path::Path, name: &str) -> Result<String> {
    for n in 0..1000u32 {
        let candidate = if n == 0 { name.to_string() } else { numbered_name(name, n) };
        let dest = folder.join(&candidate);
        match fs::OpenOptions::new().write(true).create_new(true).open(&dest).await {
            Ok(placeholder) => {
                drop(placeholder);
                if let Err(e) = fs::rename(temp, &dest).await {
                    let _ = fs::remove_file(&dest).await;
                    return Err(e.into());
                }
                return Ok(candidate);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.into()),
        }
    }
    Err(AppError::BadRequest(format!("Too many files named '{}'", name)))
}

// ─── Models ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadRequest {
    pub token: String,
    pub name: String,
    pub folder_path: String,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub password_hash: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct UploadRequestView {
    pub token: String,
    pub name: String,
    pub folder_path: String,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
    pub has_password: bool,
    pub is_expired: bool,
}

impl From<&UploadRequest> for UploadRequestView {
    fn from(r: &UploadRequest) -> Self {
        let now = Utc::now();
        Self {
            token: r.token.clone(),
            name: r.name.clone(),
            folder_path: r.folder_path.clone(),
            created_by: r.created_by.clone(),
            created_at: r.created_at,
            expires_at: r.expires_at,
            has_password: r.password_hash.is_some(),
            is_expired: r.expires_at.map(|e| now > e).unwrap_or(false),
        }
    }
}

// ─── Store ────────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct UploadRequestStore {
    inner: Arc<RwLock<HashMap<String, UploadRequest>>>,
    db: Db,
}

impl UploadRequestStore {
    pub async fn load(db: Db, migrate_from: PathBuf) -> anyhow::Result<Self> {
        let map = crate::db::hydrate_map::<UploadRequest>(&db, "upload_requests", &migrate_from).await?;
        Ok(Self { inner: Arc::new(RwLock::new(map)), db })
    }

    async fn save(&self, token: &str, req: &UploadRequest) {
        if let Ok(json) = serde_json::to_string(req) {
            let conn = self.db.lock().await;
            let _ = crate::db::put(&conn, "upload_requests", token, &json);
        }
    }

    async fn remove_row(&self, token: &str) {
        let conn = self.db.lock().await;
        let _ = crate::db::delete(&conn, "upload_requests", token);
    }

    pub async fn create(
        &self,
        name: String,
        folder_path: String,
        created_by: String,
        expires_at: Option<DateTime<Utc>>,
        password_hash: Option<String>,
    ) -> UploadRequest {
        let token = Uuid::new_v4().simple().to_string();
        let req = UploadRequest {
            token: token.clone(),
            name,
            folder_path,
            created_by,
            created_at: Utc::now(),
            expires_at,
            password_hash,
        };
        self.inner.write().await.insert(token.clone(), req.clone());
        self.save(&token, &req).await;
        req
    }

    pub async fn get(&self, token: &str) -> Option<UploadRequest> {
        self.inner.read().await.get(token).cloned()
    }

    pub async fn list_for_user(&self, username: &str) -> Vec<UploadRequest> {
        let guard = self.inner.read().await;
        let mut reqs: Vec<UploadRequest> = guard
            .values()
            .filter(|r| r.created_by == username)
            .cloned()
            .collect();
        reqs.sort_by_key(|x| std::cmp::Reverse(x.created_at));
        reqs
    }

    pub async fn list_all(&self) -> Vec<UploadRequest> {
        let mut reqs: Vec<UploadRequest> = self.inner.read().await.values().cloned().collect();
        reqs.sort_by_key(|x| std::cmp::Reverse(x.created_at));
        reqs
    }

    pub async fn delete(&self, token: &str) -> bool {
        let removed = self.inner.write().await.remove(token).is_some();
        if removed {
            self.remove_row(token).await;
        }
        removed
    }

    /// Drop every request targeting `path` or a folder below it (it was
    /// deleted), so uploads can't land in whatever is created there next.
    pub async fn purge_under(&self, path: &str) {
        let prefix = format!("{}/", path);
        let removed: Vec<String> = {
            let mut guard = self.inner.write().await;
            let removed: Vec<String> = guard
                .iter()
                .filter(|(_, r)| r.folder_path == path || r.folder_path.starts_with(&prefix))
                .map(|(t, _)| t.clone())
                .collect();
            for t in &removed {
                guard.remove(t);
            }
            removed
        };
        for t in &removed {
            self.remove_row(t).await;
        }
    }

    /// Re-point requests at `old` (or below it) to `new` after a rename/move.
    pub async fn rebase_path(&self, old: &str, new: &str) {
        let prefix = format!("{}/", old);
        let changed: Vec<UploadRequest> = {
            let mut guard = self.inner.write().await;
            let mut changed = Vec::new();
            for r in guard.values_mut() {
                if r.folder_path == old {
                    r.folder_path = new.to_string();
                    changed.push(r.clone());
                } else if let Some(rest) = r.folder_path.strip_prefix(&prefix) {
                    r.folder_path = format!("{}/{}", new, rest);
                    changed.push(r.clone());
                }
            }
            changed
        };
        for r in &changed {
            self.save(&r.token, r).await;
        }
    }
}

// ─── Request types ────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CreateUploadRequestReq {
    pub name: String,
    pub folder_path: String,
    pub expires_in_secs: Option<u64>,
    pub password: Option<String>,
}

// ─── HTML helpers ─────────────────────────────────────────────────────────────

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn upload_page(name: &str, message: Option<&str>, error: Option<&str>) -> String {
    let name_esc = html_escape(name);
    let msg = match message {
        Some(m) => format!(r#"<div class="ok">{}</div>"#, html_escape(m)),
        None => String::new(),
    };
    let err = match error {
        Some(e) => format!(r#"<div class="err">{}</div>"#, html_escape(e)),
        None => String::new(),
    };
    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Upload Files — FileFlow</title>
<style>
*,*::before,*::after{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f1117;color:#e2e8f0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1rem}}
.card{{background:#1a1d28;border:1px solid #252836;border-radius:16px;padding:2rem;width:100%;max-width:460px;box-shadow:0 25px 50px rgba(0,0,0,.5)}}
h1{{font-size:1.25rem;font-weight:600;margin-bottom:.35rem}}
.sub{{font-size:.875rem;color:#94a3b8;margin-bottom:1.5rem}}
.drop{{border:2px dashed #2d3148;border-radius:12px;padding:2rem;text-align:center;cursor:pointer;transition:border-color .2s;margin-bottom:1rem}}
.drop:hover,.drop.over{{border-color:#6366f1}}
.drop p{{color:#64748b;font-size:.875rem}}
input[type=file]{{width:100%;padding:.5rem;background:#252836;border:1px solid #2d3148;border-radius:8px;color:#e2e8f0;font-size:.8125rem;margin-bottom:1rem}}
.files{{margin-bottom:1rem;font-size:.8125rem;color:#94a3b8;max-height:120px;overflow-y:auto}}
.files li{{padding:.25rem 0;border-bottom:1px solid #1e2130;list-style:none}}
label.pw{{display:block;font-size:.7rem;font-weight:600;color:#64748b;margin-bottom:.4rem;letter-spacing:.08em;text-transform:uppercase}}
input[type=password]{{width:100%;padding:.625rem .875rem;background:#252836;border:1px solid #2d3148;border-radius:8px;color:#e2e8f0;font-size:.875rem;outline:none;margin-bottom:1rem;transition:border-color .15s}}
input[type=password]:focus{{border-color:#6366f1}}
button{{width:100%;padding:.65rem;background:#6366f1;color:#fff;border:none;border-radius:8px;font-size:.875rem;font-weight:500;cursor:pointer;transition:background .15s}}
button:hover{{background:#4f46e5}}
button:disabled{{background:#3d3f5e;cursor:not-allowed}}
.ok{{background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.3);border-radius:8px;padding:.625rem .875rem;font-size:.875rem;color:#4ade80;margin-bottom:1rem}}
.err{{background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:8px;padding:.625rem .875rem;font-size:.875rem;color:#f87171;margin-bottom:1rem}}
</style>
</head>
<body>
<div class="card">
  <h1>📤 Upload Files</h1>
  <p class="sub">{name_esc}</p>
  {msg}{err}
  <form method="POST" enctype="multipart/form-data" id="frm">
    <!-- The password must come first: fields are sent in document order and
         the server rejects files that arrive before the password is checked. -->
    <label class="pw" for="pwd">Password (if required)</label>
    <input type="password" id="pwd" name="pwd" placeholder="Leave blank if none">
    <label class="pw" for="fi">Select files</label>
    <input type="file" id="fi" name="files" multiple class="fileinput">
    <button type="submit" id="btn">Upload</button>
  </form>
</div>
</body>
</html>"#,
        name_esc = name_esc,
        msg = msg,
        err = err,
    )
}

// ─── Authenticated handlers ───────────────────────────────────────────────────

pub async fn list_upload_requests(
    State(s): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<UploadRequestView>>> {
    let reqs = if claims.is_admin() {
        s.upload_requests.list_all().await
    } else {
        s.upload_requests.list_for_user(&claims.sub).await
    };
    Ok(Json(reqs.iter().map(UploadRequestView::from).collect()))
}

pub async fn create_upload_request(
    State(s): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(mut req): Json<CreateUploadRequestReq>,
) -> Result<Json<UploadRequestView>> {
    // Persist the canonical path: access checks compare stored paths as strings.
    req.folder_path = crate::files::normalize_virtual(&req.folder_path)?;
    // An upload request lets anonymous people write into the folder, so the
    // creator must hold write access there themselves — not merely read, and
    // not write borrowed through an internal share (no transitive re-granting).
    crate::files::validate_own_access(&s, &claims.sub, &req.folder_path, Permission::FileWrite).await?;
    let real = resolve(&s.config.root_dir, &req.folder_path)?;
    if !real.exists() || !real.is_dir() {
        return Err(AppError::NotFound(format!("Folder not found: {}", req.folder_path)));
    }
    crate::files::ensure_direct_path(&s.config.root_dir, &real, &req.folder_path)?;

    let name = req.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::BadRequest("Name cannot be empty".into()));
    }

    let expires_at = req.expires_in_secs.map(|secs| {
        let clamped = secs.clamp(60, 365 * 24 * 3600);
        Utc::now() + chrono::Duration::seconds(clamped as i64)
    });

    let password_hash = match req.password.as_deref().filter(|p| !p.is_empty()) {
        Some(pwd) => Some(
            bcrypt::hash(pwd, bcrypt::DEFAULT_COST)
                .map_err(|e| AppError::Internal(anyhow::anyhow!("bcrypt: {}", e)))?,
        ),
        None => None,
    };

    let ur = s
        .upload_requests
        .create(name.clone(), req.folder_path.clone(), claims.sub.clone(), expires_at, password_hash)
        .await;
    s.audit.log(&claims.sub, "upload_request_create", Some(req.folder_path), None, Some(format!("name: {}", name))).await;
    Ok(Json(UploadRequestView::from(&ur)))
}

pub async fn delete_upload_request(
    State(s): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(token): Path<String>,
) -> Result<StatusCode> {
    let ur = s
        .upload_requests
        .get(&token)
        .await
        .ok_or_else(|| AppError::NotFound("Upload request not found".into()))?;

    if !claims.is_admin() && ur.created_by != claims.sub {
        return Err(AppError::Forbidden);
    }

    s.upload_requests.delete(&token).await;
    s.audit.log(&claims.sub, "upload_request_delete", Some(token), None, None).await;
    Ok(StatusCode::NO_CONTENT)
}

// ─── Public handlers (no auth required) ──────────────────────────────────────

pub async fn serve_upload_page(
    State(s): State<AppState>,
    Path(token): Path<String>,
) -> Result<Response> {
    let ur = s
        .upload_requests
        .get(&token)
        .await
        .ok_or_else(|| AppError::NotFound("Upload request not found or expired".into()))?;

    if let Some(exp) = ur.expires_at {
        if Utc::now() > exp {
            return Err(AppError::NotFound("This upload link has expired".into()));
        }
    }

    Ok(Html(upload_page(&ur.name, None, None)).into_response())
}

pub async fn handle_public_upload(
    State(s): State<AppState>,
    ConnectInfo(peer): ConnectInfo<std::net::SocketAddr>,
    headers: HeaderMap,
    Path(token): Path<String>,
    mut multipart: Multipart,
) -> Result<Response> {
    let ur = s
        .upload_requests
        .get(&token)
        .await
        .ok_or_else(|| AppError::NotFound("Upload request not found or expired".into()))?;

    if let Some(exp) = ur.expires_at {
        if Utc::now() > exp {
            return Err(AppError::NotFound("This upload link has expired".into()));
        }
    }

    // Re-check the creator's write access on every upload: their role, groups or
    // account may have changed since the link was created. Answer 404 rather
    // than 403 so the public endpoint doesn't reveal why the link is dead.
    if crate::files::validate_own_access(&s, &ur.created_by, &ur.folder_path, Permission::FileWrite)
        .await
        .is_err()
    {
        return Err(AppError::NotFound("Upload request not found or expired".into()));
    }

    let folder = resolve(&s.config.root_dir, &ur.folder_path)?;
    if !folder.exists() || !folder.is_dir() {
        return Err(AppError::NotFound("Target folder no longer exists".into()));
    }

    let ip = crate::audit::client_ip(&headers, s.config.trust_proxy, peer);
    let keys = crate::ratelimit::link_keys(&token, &ip);
    if ur.password_hash.is_some() && crate::ratelimit::any_locked(&s.link_limiter, &keys).await {
        return Err(AppError::TooManyRequests);
    }

    let uploads_dir = s.config.root_dir.join(".fileflow/uploads");
    fs::create_dir_all(&uploads_dir).await?;

    let max = s.config.public_upload_max_size as u64;
    let mut password_verified = ur.password_hash.is_none();
    // Files are streamed to disk (never buffered whole in memory) into temp
    // .part files, and only after the password has been verified: a file field
    // arriving first is refused, so a wrong password costs no disk writes.
    let mut staged: Vec<(String, std::path::PathBuf)> = vec![];
    let mut total: u64 = 0;

    while let Some(mut field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?
    {
        let field_name = field.name().unwrap_or("").to_string();
        if field_name == "pwd" {
            let pwd_bytes = field.bytes().await.map_err(|e| AppError::BadRequest(e.to_string()))?;
            let pwd = String::from_utf8_lossy(&pwd_bytes);
            if let Some(hash) = &ur.password_hash {
                password_verified = bcrypt::verify(pwd.as_ref(), hash).unwrap_or(false);
                if !password_verified {
                    crate::ratelimit::record_failure_all(&s.link_limiter, &keys).await;
                    discard_staged(&staged).await;
                    return Ok(
                        Html(upload_page(&ur.name, None, Some("Incorrect password — please try again.")))
                            .into_response(),
                    );
                }
                crate::ratelimit::clear(&s.link_limiter, &keys[0]).await;
            }
        } else if field_name == "files" {
            if !password_verified {
                discard_staged(&staged).await;
                return Ok(
                    Html(upload_page(&ur.name, None, Some("Please enter the password before uploading.")))
                        .into_response(),
                );
            }
            let fname = field.file_name().unwrap_or("upload").to_string();
            let safe_name = sanitize_name(&fname);
            if safe_name.is_empty() {
                continue;
            }
            // Apply the same extension blocklist the authenticated paths enforce.
            if is_blocked_extension(&safe_name) {
                discard_staged(&staged).await;
                return Err(AppError::BadRequest("File type is not allowed".into()));
            }

            let temp = uploads_dir.join(format!("{}.part", Uuid::new_v4().simple()));
            let mut file = fs::File::create(&temp).await?;
            let mut file_bytes: u64 = 0;
            loop {
                // Any failure mid-stream (client abort, oversize) must not leave
                // this temp file or the earlier staged files behind.
                let chunk = match field.chunk().await {
                    Ok(Some(chunk)) => chunk,
                    Ok(None) => break,
                    Err(e) => {
                        drop(file);
                        let _ = fs::remove_file(&temp).await;
                        discard_staged(&staged).await;
                        return Err(AppError::BadRequest(e.to_string()));
                    }
                };
                total += chunk.len() as u64;
                file_bytes += chunk.len() as u64;
                if total > max {
                    drop(file);
                    let _ = fs::remove_file(&temp).await;
                    discard_staged(&staged).await;
                    return Err(AppError::BadRequest("Upload exceeds the maximum allowed size".into()));
                }
                file.write_all(&chunk).await?;
            }
            file.flush().await?;
            if file_bytes == 0 {
                let _ = fs::remove_file(&temp).await;
                continue;
            }
            staged.push((safe_name, temp));
        }
    }

    if !password_verified {
        // Password required but no password field was sent; nothing was staged.
        return Ok(
            Html(upload_page(&ur.name, None, Some("Please enter the password before uploading.")))
                .into_response(),
        );
    }

    if staged.is_empty() {
        return Ok(
            Html(upload_page(&ur.name, None, Some("No files were selected for upload.")))
                .into_response(),
        );
    }

    // Enforce the owner's storage quota against the total just received.
    if check_quota(&s, &ur.created_by, total).await.is_err() {
        discard_staged(&staged).await;
        return Ok(
            Html(upload_page(&ur.name, None, Some("Upload rejected: storage quota exceeded.")))
                .into_response(),
        );
    }

    let count = staged.len();
    let mut bytes_written: i64 = 0;
    let mut file_names: Vec<String> = vec![];
    // If one placement fails, stop placing, drop the remaining staged files, and
    // still account for (quota) and audit the files already placed.
    let mut failure: Option<AppError> = None;
    for (name, temp) in &staged {
        if failure.is_some() {
            let _ = fs::remove_file(temp).await;
            continue;
        }
        let sz = fs::metadata(temp).await.map(|m| m.len()).unwrap_or(0);
        match place_without_overwrite(temp, &folder, name).await {
            Ok(placed) => {
                bytes_written += sz as i64;
                file_names.push(placed);
            }
            Err(e) => {
                let _ = fs::remove_file(temp).await;
                failure = Some(e);
            }
        }
    }
    if !file_names.is_empty() {
        s.users.update_used_bytes(&ur.created_by, bytes_written).await?;
        s.audit.log(&format!("[anonymous:{}]", token), "public_upload", Some(ur.folder_path), None, Some(format!("files: {}; total: {} bytes", file_names.join(", "), bytes_written))).await;
    }
    if let Some(e) = failure {
        return Err(e);
    }

    Ok(Html(upload_page(
        &ur.name,
        Some(&format!("{} file(s) uploaded successfully!", count)),
        None,
    ))
    .into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn store() -> (tempfile::TempDir, UploadRequestStore) {
        let dir = tempfile::tempdir().unwrap();
        let db = crate::db::open(&dir.path().join("t.db")).unwrap();
        let s = UploadRequestStore::load(db, dir.path().join("ur.json")).await.unwrap();
        (dir, s)
    }

    #[tokio::test]
    async fn create_list_delete_and_scope() {
        let (_d, s) = store().await;
        let r = s.create("Box".into(), "/drop".into(), "alice".into(), None, None).await;
        assert!(s.get(&r.token).await.is_some());
        assert_eq!(s.list_for_user("alice").await.len(), 1);
        assert_eq!(s.list_for_user("bob").await.len(), 0); // scoped to creator
        assert_eq!(s.list_all().await.len(), 1);
        assert!(s.delete(&r.token).await);
        assert!(s.get(&r.token).await.is_none());
    }

    #[tokio::test]
    async fn view_reports_password_and_expiry() {
        let past = Utc::now() - chrono::Duration::hours(1);
        let r = UploadRequest {
            token: "t".into(), name: "n".into(), folder_path: "/d".into(),
            created_by: "a".into(), created_at: Utc::now(),
            expires_at: Some(past), password_hash: Some("h".into()),
        };
        let v = UploadRequestView::from(&r);
        assert!(v.has_password);
        assert!(v.is_expired);

        let r2 = UploadRequest { expires_at: None, password_hash: None, ..r.clone() };
        let v2 = UploadRequestView::from(&r2);
        assert!(!v2.has_password);
        assert!(!v2.is_expired);
    }

    #[test]
    fn numbered_name_keeps_extension_last() {
        assert_eq!(numbered_name("report.txt", 1), "report (1).txt");
        assert_eq!(numbered_name("a.tar.gz", 2), "a.tar (2).gz");
        assert_eq!(numbered_name("README", 3), "README (3)");
        assert_eq!(numbered_name(".env", 1), ".env (1)");
    }

    #[tokio::test]
    async fn placement_never_overwrites_existing_files() {
        let dir = tempfile::tempdir().unwrap();
        let folder = dir.path().join("drop");
        std::fs::create_dir(&folder).unwrap();
        std::fs::write(folder.join("report.txt"), "original").unwrap();
        std::fs::write(folder.join("report (1).txt"), "first copy").unwrap();

        let temp = dir.path().join("x.part");
        std::fs::write(&temp, "uploaded").unwrap();
        let placed = place_without_overwrite(&temp, &folder, "report.txt").await.unwrap();

        assert_eq!(placed, "report (2).txt");
        assert_eq!(std::fs::read_to_string(folder.join("report.txt")).unwrap(), "original");
        assert_eq!(std::fs::read_to_string(folder.join("report (1).txt")).unwrap(), "first copy");
        assert_eq!(std::fs::read_to_string(folder.join("report (2).txt")).unwrap(), "uploaded");
        assert!(!temp.exists(), "staged temp file must be cleaned up");
    }

    #[tokio::test]
    async fn persists_across_reload() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.db");
        let jpath = dir.path().join("ur.json");
        let token = {
            let db = crate::db::open(&path).unwrap();
            let s = UploadRequestStore::load(db, jpath.clone()).await.unwrap();
            s.create("Box".into(), "/drop".into(), "alice".into(), None, None).await.token
        };
        let db2 = crate::db::open(&path).unwrap();
        let s2 = UploadRequestStore::load(db2, jpath).await.unwrap();
        assert!(s2.get(&token).await.is_some());
    }
}
