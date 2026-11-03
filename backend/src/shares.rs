use std::{collections::HashMap, path::PathBuf, sync::Arc};

use axum::{
    extract::{ConnectInfo, Form, Path, State},
    http::{HeaderMap, StatusCode},
    response::{Html, IntoResponse, Response},
    Extension, Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::{
    db::Db,
    error::{AppError, Result},
    files::{content_disposition, resolve},
    models::{Claims, Permission, UserStatus},
    AppState,
};

// ─── Model ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShareLink {
    pub token: String,
    pub file_path: String,
    pub filename: String,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    #[serde(default)]
    pub password_hash: Option<String>,
    /// Optional cap on successful downloads (e.g. 1 for a one-time link).
    #[serde(default)]
    pub max_downloads: Option<u64>,
    /// Number of successful downloads served so far.
    #[serde(default)]
    pub download_count: u64,
}

impl ShareLink {
    /// True once the download cap (if any) has been reached.
    pub fn limit_reached(&self) -> bool {
        self.max_downloads.is_some_and(|max| self.download_count >= max)
    }
}

/// API response — never exposes the hash, only whether a password is set.
#[derive(Debug, Serialize)]
pub struct ShareLinkView {
    pub token: String,
    pub file_path: String,
    pub filename: String,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub has_password: bool,
    pub max_downloads: Option<u64>,
    pub download_count: u64,
}

impl From<&ShareLink> for ShareLinkView {
    fn from(l: &ShareLink) -> Self {
        Self {
            token: l.token.clone(),
            file_path: l.file_path.clone(),
            filename: l.filename.clone(),
            created_by: l.created_by.clone(),
            created_at: l.created_at,
            expires_at: l.expires_at,
            has_password: l.password_hash.is_some(),
            max_downloads: l.max_downloads,
            download_count: l.download_count,
        }
    }
}

// ─── Store ────────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct ShareStore {
    inner: Arc<RwLock<HashMap<String, ShareLink>>>,
    db: Db,
}

impl ShareStore {
    pub async fn load(db: Db, migrate_from: PathBuf) -> anyhow::Result<Self> {
        let map = crate::db::hydrate_map::<ShareLink>(&db, "shares", &migrate_from).await?;
        Ok(Self { inner: Arc::new(RwLock::new(map)), db })
    }

    async fn save(&self, token: &str, link: &ShareLink) {
        if let Ok(json) = serde_json::to_string(link) {
            let conn = self.db.lock().await;
            let _ = crate::db::put(&conn, "shares", token, &json);
        }
    }

    async fn remove_row(&self, token: &str) {
        let conn = self.db.lock().await;
        let _ = crate::db::delete(&conn, "shares", token);
    }

    pub async fn create(
        &self,
        file_path: String,
        filename: String,
        created_by: String,
        expires_at: DateTime<Utc>,
        password_hash: Option<String>,
        max_downloads: Option<u64>,
    ) -> ShareLink {
        let token = Uuid::new_v4().simple().to_string();
        let link = ShareLink {
            token: token.clone(),
            file_path,
            filename,
            created_by,
            created_at: Utc::now(),
            expires_at,
            password_hash,
            max_downloads,
            download_count: 0,
        };
        self.inner.write().await.insert(token.clone(), link.clone());
        self.save(&token, &link).await;
        link
    }

    /// Atomically claim one download against a link: the cap check and the
    /// increment happen under the same write lock, so parallel requests can't
    /// all pass the check before any of them counts. Returns false when the link
    /// is gone or its cap is already reached.
    pub async fn try_reserve_download(&self, token: &str) -> bool {
        let updated = {
            let mut guard = self.inner.write().await;
            match guard.get_mut(token) {
                Some(link) if !link.limit_reached() => {
                    link.download_count += 1;
                    Some(link.clone())
                }
                _ => None,
            }
        };
        match updated {
            Some(link) => {
                self.save(token, &link).await;
                true
            }
            None => false,
        }
    }

    /// Give back a reserved download whose file could not be served.
    pub async fn release_download(&self, token: &str) {
        let updated = {
            let mut guard = self.inner.write().await;
            guard.get_mut(token).map(|link| {
                link.download_count = link.download_count.saturating_sub(1);
                link.clone()
            })
        };
        if let Some(link) = updated {
            self.save(token, &link).await;
        }
    }

    pub async fn get(&self, token: &str) -> Option<ShareLink> {
        self.inner.read().await.get(token).cloned()
    }

    pub async fn list(&self) -> Vec<ShareLink> {
        let mut links: Vec<ShareLink> = self.inner.read().await.values().cloned().collect();
        links.sort_by_key(|x| std::cmp::Reverse(x.created_at));
        links
    }

    pub async fn delete(&self, token: &str) -> bool {
        let removed = self.inner.write().await.remove(token).is_some();
        if removed { self.remove_row(token).await; }
        removed
    }

    /// Drop every link on `path` or below it (the resource was deleted), so a
    /// link can't silently attach to whatever is created there next.
    pub async fn purge_under(&self, path: &str) {
        let prefix = format!("{}/", path);
        let removed: Vec<String> = {
            let mut guard = self.inner.write().await;
            let removed: Vec<String> = guard
                .iter()
                .filter(|(_, l)| l.file_path == path || l.file_path.starts_with(&prefix))
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

    /// Re-point every link at `old` (or below it) to `new` after a rename/move.
    pub async fn rebase_path(&self, old: &str, new: &str) {
        let prefix = format!("{}/", old);
        let changed: Vec<ShareLink> = {
            let mut guard = self.inner.write().await;
            let mut changed = Vec::new();
            for link in guard.values_mut() {
                if link.file_path == old {
                    link.file_path = new.to_string();
                    if let Some(n) = new.rsplit('/').next().filter(|n| !n.is_empty()) {
                        link.filename = n.to_string();
                    }
                    changed.push(link.clone());
                } else if let Some(rest) = link.file_path.strip_prefix(&prefix) {
                    link.file_path = format!("{}/{}", new, rest);
                    changed.push(link.clone());
                }
            }
            changed
        };
        for link in &changed {
            self.save(&link.token, link).await;
        }
    }

    pub async fn purge_expired(&self) {
        let now = Utc::now();
        let expired: Vec<String> = {
            let mut guard = self.inner.write().await;
            let expired: Vec<String> = guard
                .iter()
                .filter(|(_, v)| v.expires_at <= now)
                .map(|(k, _)| k.clone())
                .collect();
            for k in &expired {
                guard.remove(k);
            }
            expired
        };
        for k in &expired {
            self.remove_row(k).await;
        }
    }
}

// ─── Request types ────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CreateShareRequest {
    pub file_path: String,
    pub expires_in_secs: u64,
    pub password: Option<String>,
    /// Optional download cap; `Some(1)` makes a one-time link.
    pub max_downloads: Option<u64>,
}

#[derive(Deserialize)]
pub struct PasswordForm {
    pub pwd: String,
}

// ─── Password-gate HTML ───────────────────────────────────────────────────────

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn password_page(filename: &str, wrong: bool) -> String {
    let fname = html_escape(filename);
    let error = if wrong {
        r#"<div class="err">Incorrect password — please try again.</div>"#
    } else {
        ""
    };
    format!(r#"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Protected File — FileFlow</title>
<style>
*,*::before,*::after{{box-sizing:border-box;margin:0;padding:0}}
body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f1117;color:#e2e8f0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1rem}}
.card{{background:#1a1d28;border:1px solid #252836;border-radius:16px;padding:2rem;width:100%;max-width:380px;box-shadow:0 25px 50px rgba(0,0,0,.5)}}
.lock{{font-size:2rem;display:block;margin-bottom:1rem}}
h1{{font-size:1.125rem;font-weight:600;margin-bottom:.35rem}}
.fname{{font-size:.875rem;color:#94a3b8;margin-bottom:1.5rem;word-break:break-all}}
label{{display:block;font-size:.7rem;font-weight:600;color:#64748b;margin-bottom:.5rem;letter-spacing:.08em;text-transform:uppercase}}
input[type=password]{{width:100%;padding:.625rem .875rem;background:#252836;border:1px solid #2d3148;border-radius:8px;color:#e2e8f0;font-size:.875rem;outline:none;margin-bottom:1rem;transition:border-color .15s}}
input[type=password]:focus{{border-color:#6366f1}}
button{{width:100%;padding:.65rem;background:#6366f1;color:#fff;border:none;border-radius:8px;font-size:.875rem;font-weight:500;cursor:pointer;transition:background .15s}}
button:hover{{background:#4f46e5}}
.err{{background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:8px;padding:.625rem .875rem;font-size:.875rem;color:#f87171;margin-bottom:1rem}}
</style>
</head>
<body>
<div class="card">
  <span class="lock">🔒</span>
  <h1>Password Protected</h1>
  <p class="fname">{fname}</p>
  {error}
  <form method="POST">
    <label for="pwd">Password</label>
    <input type="password" id="pwd" name="pwd" placeholder="Enter password" autofocus required>
    <button type="submit">Download File</button>
  </form>
</div>
</body>
</html>"#)
}

// ─── File-serve helper ────────────────────────────────────────────────────────

async fn stream_file(state: &AppState, link: &ShareLink, range: Option<&str>) -> Result<Response> {
    let real = resolve(&state.config.root_dir, &link.file_path)?;
    if !real.exists() || real.is_dir() {
        return Err(AppError::NotFound("The shared file no longer exists".into()));
    }
    crate::files::serve_file_ranged(
        &real,
        content_disposition(&link.filename),
        Some("no-store"),
        range,
        // Shared files are always served as an attachment (download), never
        // rendered inline, so they don't need a MIME override.
        None,
    )
    .await
}

// ─── Authenticated handlers ───────────────────────────────────────────────────

pub async fn create_share(
    State(s): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(mut req): Json<CreateShareRequest>,
) -> Result<Json<ShareLinkView>> {
    // Persist the canonical path: access checks compare stored paths as strings.
    req.file_path = crate::files::normalize_virtual(&req.file_path)?;
    crate::files::validate_access(&s, &claims.sub, &req.file_path, Permission::FileRead).await?;

    let real = resolve(&s.config.root_dir, &req.file_path)?;
    if !real.exists() || real.is_dir() {
        return Err(AppError::NotFound(format!("File not found: {}", req.file_path)));
    }
    crate::files::ensure_direct_path(&s.config.root_dir, &real, &req.file_path)?;

    let secs = req.expires_in_secs.clamp(60, 365 * 24 * 3600);
    let expires_at = Utc::now() + chrono::Duration::seconds(secs as i64);

    let filename = real
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".into());

    let password_hash = match req.password.as_deref().filter(|p| !p.is_empty()) {
        Some(pwd) => Some(
            bcrypt::hash(pwd, bcrypt::DEFAULT_COST)
                .map_err(|e| AppError::Internal(anyhow::anyhow!("bcrypt: {}", e)))?,
        ),
        None => None,
    };

    // A max_downloads of 0 is meaningless; treat it as "no limit".
    let max_downloads = req.max_downloads.filter(|&m| m > 0);

    let link = s.shares.create(
        req.file_path.clone(), filename, claims.sub.clone(), expires_at, password_hash, max_downloads,
    ).await;

    s.audit.log(&claims.sub, "share_create", Some(req.file_path), None,
        Some(format!("token: {}", link.token))).await;

    Ok(Json(ShareLinkView::from(&link)))
}

pub async fn list_shares(
    State(s): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<ShareLinkView>>> {
    s.shares.purge_expired().await;
    let all = s.shares.list().await;
    let filtered: Vec<ShareLink> = if claims.is_admin() {
        all
    } else {
        all.into_iter().filter(|l| l.created_by == claims.sub).collect()
    };
    Ok(Json(filtered.iter().map(ShareLinkView::from).collect()))
}

pub async fn delete_share(
    State(s): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(token): Path<String>,
) -> Result<StatusCode> {
    let link = s.shares.get(&token).await
        .ok_or_else(|| AppError::NotFound("Share not found".into()))?;

    if !claims.is_admin() && link.created_by != claims.sub {
        return Err(AppError::Forbidden);
    }

    s.shares.delete(&token).await;
    s.audit.log(&claims.sub, "share_delete", Some(link.file_path), None,
        Some(format!("token: {}", token))).await;

    Ok(StatusCode::NO_CONTENT)
}

// ─── Public handlers (no auth) ────────────────────────────────────────────────

/// Load a link that may still be served: not expired, and its creator still
/// active and still able to read the file (role, groups or account may have
/// changed since the link was created). Every failure is the same 404 so the
/// public endpoint doesn't reveal why a link is dead.
async fn live_link(s: &AppState, token: &str) -> Result<ShareLink> {
    let gone = || AppError::NotFound("Share link not found or expired".into());
    let link = s.shares.get(token).await.ok_or_else(gone)?;

    if Utc::now() > link.expires_at {
        s.shares.delete(token).await;
        return Err(gone());
    }

    let creator_active = s.users.get(&link.created_by).await
        .is_some_and(|u| u.status != UserStatus::Disabled);
    if !creator_active
        || crate::files::validate_access(s, &link.created_by, &link.file_path, Permission::FileRead)
            .await
            .is_err()
    {
        return Err(gone());
    }

    if link.limit_reached() {
        return Err(AppError::NotFound("This share link has reached its download limit".into()));
    }
    Ok(link)
}

/// Serve the file, counting the download. A link with a download cap ignores
/// Range: partial requests aren't counted, so honouring them would let a
/// one-time link be fetched any number of times in pieces.
async fn serve_counted(s: &AppState, link: &ShareLink, range: Option<&str>) -> Result<Response> {
    let range = if link.max_downloads.is_some() { None } else { range };
    // Count one download per full request (range/seek requests don't re-count).
    let counted = range.is_none();
    if counted && !s.shares.try_reserve_download(&link.token).await {
        return Err(AppError::NotFound("This share link has reached its download limit".into()));
    }
    match stream_file(s, link, range).await {
        Ok(resp) => Ok(resp),
        Err(e) => {
            if counted {
                s.shares.release_download(&link.token).await;
            }
            Err(e)
        }
    }
}

pub async fn serve_shared(
    State(s): State<AppState>,
    headers: HeaderMap,
    Path(token): Path<String>,
) -> Result<Response> {
    let link = live_link(&s, &token).await?;

    if link.password_hash.is_some() {
        return Ok(Html(password_page(&link.filename, false)).into_response());
    }

    let range = headers.get(axum::http::header::RANGE).and_then(|v| v.to_str().ok());
    serve_counted(&s, &link, range).await
}

pub async fn serve_shared_post(
    State(s): State<AppState>,
    ConnectInfo(peer): ConnectInfo<std::net::SocketAddr>,
    headers: HeaderMap,
    Path(token): Path<String>,
    Form(form): Form<PasswordForm>,
) -> Result<Response> {
    let link = live_link(&s, &token).await?;

    match &link.password_hash {
        None => serve_counted(&s, &link, None).await,
        Some(hash) => {
            // Checked before bcrypt: share passwords are often short PINs, and
            // each attempt costs a bcrypt verify (unauthenticated CPU burn).
            let ip = crate::audit::client_ip(&headers, s.config.trust_proxy, peer);
            let keys = crate::ratelimit::link_keys(&token, &ip);
            if crate::ratelimit::any_locked(&s.link_limiter, &keys).await {
                return Err(AppError::TooManyRequests);
            }
            if bcrypt::verify(&form.pwd, hash).unwrap_or(false) {
                crate::ratelimit::clear(&s.link_limiter, &keys[0]).await;
                serve_counted(&s, &link, None).await
            } else {
                crate::ratelimit::record_failure_all(&s.link_limiter, &keys).await;
                Ok(Html(password_page(&link.filename, true)).into_response())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn store() -> (tempfile::TempDir, ShareStore) {
        let dir = tempfile::tempdir().unwrap();
        let db = crate::db::open(&dir.path().join("t.db")).unwrap();
        let s = ShareStore::load(db, dir.path().join("s.json")).await.unwrap();
        (dir, s)
    }

    #[tokio::test]
    async fn create_get_list_delete() {
        let (_d, s) = store().await;
        let exp = Utc::now() + chrono::Duration::hours(1);
        let l = s.create("/a.txt".into(), "a.txt".into(), "alice".into(), exp, None, None).await;
        assert!(s.get(&l.token).await.is_some());
        assert_eq!(s.list().await.len(), 1);
        assert!(s.delete(&l.token).await);
        assert!(s.get(&l.token).await.is_none());
        assert!(!s.delete("nope").await);
    }

    #[tokio::test]
    async fn purge_expired_removes_only_expired() {
        let (_d, s) = store().await;
        let past = Utc::now() - chrono::Duration::hours(1);
        let future = Utc::now() + chrono::Duration::hours(1);
        let expired = s.create("/old".into(), "old".into(), "a".into(), past, None, None).await;
        let live = s.create("/new".into(), "new".into(), "a".into(), future, None, None).await;
        s.purge_expired().await;
        assert!(s.get(&expired.token).await.is_none());
        assert!(s.get(&live.token).await.is_some());
    }

    #[tokio::test]
    async fn view_hides_password_hash() {
        let with = ShareLink {
            token: "t".into(), file_path: "/f".into(), filename: "f".into(),
            created_by: "a".into(), created_at: Utc::now(), expires_at: Utc::now(),
            password_hash: Some("secret-hash".into()), max_downloads: None, download_count: 0,
        };
        let v = ShareLinkView::from(&with);
        assert!(v.has_password);
        let without = ShareLink { password_hash: None, ..with.clone() };
        assert!(!ShareLinkView::from(&without).has_password);
    }

    #[tokio::test]
    async fn download_limit_counts_and_caps() {
        let (_d, s) = store().await;
        let exp = Utc::now() + chrono::Duration::hours(1);
        // A one-time link.
        let l = s.create("/a".into(), "a".into(), "u".into(), exp, None, Some(1)).await;
        assert!(!l.limit_reached());

        assert!(s.try_reserve_download(&l.token).await);
        let after = s.get(&l.token).await.unwrap();
        assert_eq!(after.download_count, 1);
        assert!(after.limit_reached()); // cap reached
        assert!(!s.try_reserve_download(&l.token).await); // no second download

        // A link with no cap never reports limit reached.
        let unlimited = s.create("/b".into(), "b".into(), "u".into(), exp, None, None).await;
        assert!(s.try_reserve_download(&unlimited.token).await);
        assert!(!s.get(&unlimited.token).await.unwrap().limit_reached());
        assert!(!s.try_reserve_download("missing").await);
    }

    #[tokio::test]
    async fn parallel_downloads_never_exceed_cap() {
        // F1: the check and the increment must be one atomic step.
        let (_d, s) = store().await;
        let exp = Utc::now() + chrono::Duration::hours(1);
        let l = s.create("/a".into(), "a".into(), "u".into(), exp, None, Some(1)).await;
        let tasks: Vec<_> = (0..50)
            .map(|_| {
                let (s, t) = (s.clone(), l.token.clone());
                tokio::spawn(async move { s.try_reserve_download(&t).await })
            })
            .collect();
        let mut granted = 0;
        for t in tasks {
            if t.await.unwrap() {
                granted += 1;
            }
        }
        assert_eq!(granted, 1);
        assert_eq!(s.get(&l.token).await.unwrap().download_count, 1);
    }

    #[tokio::test]
    async fn release_gives_back_a_failed_download() {
        let (_d, s) = store().await;
        let exp = Utc::now() + chrono::Duration::hours(1);
        let l = s.create("/a".into(), "a".into(), "u".into(), exp, None, Some(1)).await;
        assert!(s.try_reserve_download(&l.token).await);
        s.release_download(&l.token).await;
        assert!(s.try_reserve_download(&l.token).await);
    }

    #[tokio::test]
    async fn links_follow_rename_and_die_with_delete() {
        // F5: a link must not dangle on the old path after rename/move/delete.
        let (_d, s) = store().await;
        let exp = Utc::now() + chrono::Duration::hours(1);
        let file = s.create("/proj/a.txt".into(), "a.txt".into(), "u".into(), exp, None, None).await;
        let other = s.create("/projX/b.txt".into(), "b.txt".into(), "u".into(), exp, None, None).await;

        s.rebase_path("/proj", "/archive").await;
        assert_eq!(s.get(&file.token).await.unwrap().file_path, "/archive/a.txt");
        assert_eq!(s.get(&other.token).await.unwrap().file_path, "/projX/b.txt"); // sibling prefix untouched

        s.rebase_path("/archive/a.txt", "/archive/c.txt").await;
        let renamed = s.get(&file.token).await.unwrap();
        assert_eq!(renamed.file_path, "/archive/c.txt");
        assert_eq!(renamed.filename, "c.txt");

        s.purge_under("/archive").await;
        assert!(s.get(&file.token).await.is_none());
        assert!(s.get(&other.token).await.is_some());
    }

    #[tokio::test]
    async fn persists_across_reload() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.db");
        let jpath = dir.path().join("s.json");
        let token = {
            let db = crate::db::open(&path).unwrap();
            let s = ShareStore::load(db, jpath.clone()).await.unwrap();
            let l = s.create("/a".into(), "a".into(), "u".into(), Utc::now() + chrono::Duration::hours(1), None, Some(3)).await;
            assert!(s.try_reserve_download(&l.token).await);
            l.token
        };
        let db2 = crate::db::open(&path).unwrap();
        let s2 = ShareStore::load(db2, jpath).await.unwrap();
        let reloaded = s2.get(&token).await.unwrap();
        assert_eq!(reloaded.max_downloads, Some(3));
        assert_eq!(reloaded.download_count, 1); // count survived the reload
    }
}
