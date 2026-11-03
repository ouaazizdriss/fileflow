use std::{collections::HashMap, path::PathBuf, sync::Arc};

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Extension, Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::{
    db::Db,
    error::{AppError, Result},
    files::{build_entry, resolve},
    models::{Claims, FileEntry, Permission},
    AppState,
};

// ─── Model ────────────────────────────────────────────────────────────────────

/// A direct share of a single file or folder from one user to another.
/// Unlike public share links, this grants an authenticated recipient access to
/// the resource (and, for folders, its descendants) inside the app itself.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InternalShare {
    pub id: String,
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub owner: String,
    pub recipient: String,
    pub can_write: bool,
    pub created_at: DateTime<Utc>,
}

// ─── Store ────────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct InternalShareStore {
    inner: Arc<RwLock<HashMap<String, InternalShare>>>,
    db: Db,
}

impl InternalShareStore {
    pub async fn load(db: Db, migrate_from: PathBuf) -> anyhow::Result<Self> {
        let mut map = crate::db::hydrate_map::<InternalShare>(&db, "internal_shares", &migrate_from).await?;
        // Canonicalize stored paths once so every comparison (access checks,
        // purge/rebase on delete/rename, dedup) sees one spelling. Rows from
        // before paths were normalized that can't be (`..`) are dropped: fail closed.
        map.retain(|id, row| match crate::files::normalize_virtual(&row.path) {
            Ok(p) => {
                row.path = p;
                true
            }
            Err(_) => {
                tracing::warn!("ignoring internal_shares row {} with invalid path {:?}", id, row.path);
                false
            }
        });
        Ok(Self { inner: Arc::new(RwLock::new(map)), db })
    }

    async fn save(&self, id: &str, share: &InternalShare) {
        if let Ok(json) = serde_json::to_string(share) {
            let conn = self.db.lock().await;
            let _ = crate::db::put(&conn, "internal_shares", id, &json);
        }
    }

    async fn remove_row(&self, id: &str) {
        let conn = self.db.lock().await;
        let _ = crate::db::delete(&conn, "internal_shares", id);
    }

    /// Create or update a share. A given (path, recipient) pair is unique — a
    /// repeat share just updates the write flag rather than duplicating.
    pub async fn upsert(
        &self,
        path: String,
        name: String,
        is_dir: bool,
        owner: String,
        recipient: String,
        can_write: bool,
    ) -> InternalShare {
        let share = {
            let mut guard = self.inner.write().await;
            if let Some(existing) = guard
                .values_mut()
                .find(|s| s.path == path && s.recipient == recipient && s.owner == owner)
            {
                existing.can_write = can_write;
                existing.is_dir = is_dir;
                existing.name = name;
                existing.clone()
            } else {
                let id = Uuid::new_v4().to_string();
                let share = InternalShare {
                    id: id.clone(),
                    path,
                    name,
                    is_dir,
                    owner,
                    recipient,
                    can_write,
                    created_at: Utc::now(),
                };
                guard.insert(id, share.clone());
                share
            }
        };
        self.save(&share.id, &share).await;
        share
    }

    pub async fn get(&self, id: &str) -> Option<InternalShare> {
        self.inner.read().await.get(id).cloned()
    }

    pub async fn delete(&self, id: &str) -> bool {
        let removed = self.inner.write().await.remove(id).is_some();
        if removed {
            self.remove_row(id).await;
        }
        removed
    }

    /// Shares created by `username`.
    pub async fn list_owned(&self, username: &str) -> Vec<InternalShare> {
        let mut v: Vec<InternalShare> = self
            .inner
            .read()
            .await
            .values()
            .filter(|s| s.owner == username)
            .cloned()
            .collect();
        v.sort_by_key(|x| std::cmp::Reverse(x.created_at));
        v
    }

    /// Shares whose recipient is `username`.
    pub async fn list_received(&self, username: &str) -> Vec<InternalShare> {
        let mut v: Vec<InternalShare> = self
            .inner
            .read()
            .await
            .values()
            .filter(|s| s.recipient == username)
            .cloned()
            .collect();
        v.sort_by_key(|x| std::cmp::Reverse(x.created_at));
        v
    }

    /// Drop every share that points at `path` (or a descendant of it). Called
    /// when the underlying resource is deleted so dangling grants don't linger.
    pub async fn purge_under(&self, path: &str) {
        let prefix = format!("{}/", path);
        let removed: Vec<String> = {
            let mut guard = self.inner.write().await;
            let removed: Vec<String> = guard
                .iter()
                .filter(|(_, s)| s.path == path || s.path.starts_with(&prefix))
                .map(|(id, _)| id.clone())
                .collect();
            for id in &removed {
                guard.remove(id);
            }
            removed
        };
        for id in &removed {
            self.remove_row(id).await;
        }
    }

    /// Re-point every share at `old` (or a descendant of it) to `new` after the
    /// underlying resource was renamed/moved. Without this a grant would keep
    /// pointing at the old path — dangling, and silently attaching to whatever
    /// is created there next.
    pub async fn rebase_path(&self, old: &str, new: &str) {
        let prefix = format!("{}/", old);
        let changed: Vec<InternalShare> = {
            let mut guard = self.inner.write().await;
            let mut changed = Vec::new();
            for share in guard.values_mut() {
                if share.path == old {
                    share.path = new.to_string();
                    if let Some(n) = new.rsplit('/').next().filter(|n| !n.is_empty()) {
                        share.name = n.to_string();
                    }
                    changed.push(share.clone());
                } else if let Some(rest) = share.path.strip_prefix(&prefix) {
                    share.path = format!("{}/{}", new, rest);
                    changed.push(share.clone());
                }
            }
            changed
        };
        for share in &changed {
            self.save(&share.id, share).await;
        }
    }

    /// True if `username` was granted access to `path` (or an ancestor folder)
    /// via a direct share. `need_write` is true for write/delete operations.
    pub async fn check_access(&self, username: &str, path: &str, need_write: bool) -> bool {
        let guard = self.inner.read().await;
        for share in guard.values() {
            if share.recipient != username {
                continue;
            }
            // Both canonical: `path` from validate_access, share.path since load/create.
            let covers = path == share.path
                || (share.is_dir && crate::files::path_covers(&share.path, path));
            if !covers {
                continue;
            }
            if !need_write || share.can_write {
                return true;
            }
        }
        false
    }
}

// ─── Request / response types ─────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CreateInternalShareRequest {
    pub path: String,
    pub username: String,
    #[serde(default)]
    pub can_write: bool,
}

#[derive(Serialize)]
pub struct InternalSharesResponse {
    pub owned: Vec<InternalShare>,
    pub received: Vec<InternalShare>,
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

pub async fn list_internal_shares(
    State(s): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<InternalSharesResponse>> {
    Ok(Json(InternalSharesResponse {
        owned: s.internal_shares.list_owned(&claims.sub).await,
        received: s.internal_shares.list_received(&claims.sub).await,
    }))
}

pub async fn create_internal_share(
    State(s): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(mut req): Json<CreateInternalShareRequest>,
) -> Result<Json<InternalShare>> {
    // Persist the canonical path: access checks compare stored paths as strings.
    req.path = crate::files::normalize_virtual(&req.path)?;
    // The sharer must be able to read what they're sharing — and must actually
    // hold write access before they can grant it to someone else (otherwise a
    // read-only user could manufacture write access via a share). Access must
    // come from the sharer's OWN role/permissions/groups/collab membership, not
    // from a share they themselves received, so grants can't chain transitively
    // or widen access beyond the granter's genuine reach.
    crate::files::validate_own_access(&s, &claims.sub, &req.path, Permission::FileRead).await?;
    if req.can_write {
        crate::files::validate_own_access(&s, &claims.sub, &req.path, Permission::FileWrite).await?;
    }

    let recipient = req.username.trim().to_string();
    if recipient.is_empty() {
        return Err(AppError::BadRequest("Recipient username is required".into()));
    }
    if recipient == claims.sub {
        return Err(AppError::BadRequest("You cannot share with yourself".into()));
    }
    if s.users.get(&recipient).await.is_none() {
        return Err(AppError::NotFound(format!("User '{}' not found", recipient)));
    }

    let real = resolve(&s.config.root_dir, &req.path)?;
    if !real.exists() {
        return Err(AppError::NotFound(format!("Not found: {}", req.path)));
    }
    crate::files::ensure_direct_path(&s.config.root_dir, &real, &req.path)?;
    let is_dir = real.is_dir();
    let name = real
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| req.path.clone());

    let share = s
        .internal_shares
        .upsert(
            req.path.clone(),
            name,
            is_dir,
            claims.sub.clone(),
            recipient.clone(),
            req.can_write,
        )
        .await;

    s.audit
        .log(
            &claims.sub,
            "internal_share_create",
            Some(req.path),
            None,
            Some(format!(
                "to: {} ({})",
                recipient,
                if req.can_write { "rw" } else { "r" }
            )),
        )
        .await;

    Ok(Json(share))
}

pub async fn delete_internal_share(
    State(s): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<StatusCode> {
    let share = s
        .internal_shares
        .get(&id)
        .await
        .ok_or_else(|| AppError::NotFound("Share not found".into()))?;

    // The owner or the recipient (declining the share) or an admin may remove it.
    if !claims.is_admin() && share.owner != claims.sub && share.recipient != claims.sub {
        return Err(AppError::Forbidden);
    }

    s.internal_shares.delete(&id).await;
    s.audit
        .log(&claims.sub, "internal_share_delete", Some(share.path), None, None)
        .await;
    Ok(StatusCode::NO_CONTENT)
}

/// Resolve the shares received by the caller into live `FileEntry` rows for a
/// "Shared with me" view. Stale shares (resource gone) are skipped.
pub async fn shared_with_me(
    State(s): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<FileEntry>>> {
    let received = s.internal_shares.list_received(&claims.sub).await;
    let mut entries = Vec::new();
    for share in received {
        if let Ok(real) = resolve(&s.config.root_dir, &share.path) {
            if real.exists() {
                if let Ok(entry) = build_entry(&s.config.root_dir, &real) {
                    entries.push(entry);
                }
            }
        }
    }
    Ok(Json(entries))
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn store() -> (tempfile::TempDir, InternalShareStore) {
        let dir = tempfile::tempdir().unwrap();
        let db = crate::db::open(&dir.path().join("t.db")).unwrap();
        let s = InternalShareStore::load(db, dir.path().join("i.json")).await.unwrap();
        (dir, s)
    }

    #[tokio::test]
    async fn file_share_grants_exact_path_only() {
        let (_d, s) = store().await;
        s.upsert("/a/file.txt".into(), "file.txt".into(), false, "alice".into(), "bob".into(), false).await;
        assert!(s.check_access("bob", "/a/file.txt", false).await);
        // A file share (is_dir = false) does NOT cover descendants or its parent.
        assert!(!s.check_access("bob", "/a/file.txt/sub", false).await);
        assert!(!s.check_access("bob", "/a", false).await);
        // Wrong recipient is denied.
        assert!(!s.check_access("carol", "/a/file.txt", false).await);
    }

    #[tokio::test]
    async fn folder_share_covers_descendants_and_respects_write() {
        let (_d, s) = store().await;
        s.upsert("/proj".into(), "proj".into(), true, "alice".into(), "bob".into(), false).await;
        assert!(s.check_access("bob", "/proj", false).await);
        assert!(s.check_access("bob", "/proj/deep/x.txt", false).await);
        assert!(!s.check_access("bob", "/proj/deep/x.txt", true).await); // read-only

        // Upgrading the share to write access takes effect.
        s.upsert("/proj".into(), "proj".into(), true, "alice".into(), "bob".into(), true).await;
        assert!(s.check_access("bob", "/proj/deep/x.txt", true).await);
    }

    #[tokio::test]
    async fn upsert_dedupes_same_triplet() {
        let (_d, s) = store().await;
        let a = s.upsert("/f".into(), "f".into(), false, "alice".into(), "bob".into(), false).await;
        let b = s.upsert("/f".into(), "f".into(), false, "alice".into(), "bob".into(), true).await;
        assert_eq!(a.id, b.id); // same row updated, not duplicated
        assert!(b.can_write);
        assert_eq!(s.list_owned("alice").await.len(), 1);
        assert_eq!(s.list_received("bob").await.len(), 1);
    }

    #[tokio::test]
    async fn rebase_path_follows_rename_for_exact_and_descendants() {
        let (_d, s) = store().await;
        s.upsert("/proj".into(), "proj".into(), true, "a".into(), "bob".into(), true).await;
        s.upsert("/proj/doc.txt".into(), "doc.txt".into(), false, "a".into(), "bob".into(), false).await;
        s.upsert("/projects".into(), "projects".into(), true, "a".into(), "bob".into(), false).await;

        s.rebase_path("/proj", "/renamed").await;

        // Grants follow the resource; old paths no longer match.
        assert!(s.check_access("bob", "/renamed", true).await);
        assert!(s.check_access("bob", "/renamed/doc.txt", false).await);
        assert!(!s.check_access("bob", "/proj", false).await);
        assert!(!s.check_access("bob", "/proj/doc.txt", false).await);
        // Prefix boundary: "/projects" is untouched.
        assert!(s.check_access("bob", "/projects", false).await);
        // Display name updated on the exact-match share.
        let renamed = s.list_received("bob").await.into_iter().find(|x| x.path == "/renamed").unwrap();
        assert_eq!(renamed.name, "renamed");
    }

    #[tokio::test]
    async fn purge_under_removes_path_and_descendants_only() {
        let (_d, s) = store().await;
        s.upsert("/proj".into(), "proj".into(), true, "a".into(), "bob".into(), false).await;
        s.upsert("/proj/sub.txt".into(), "sub.txt".into(), false, "a".into(), "bob".into(), false).await;
        s.upsert("/other".into(), "other".into(), true, "a".into(), "bob".into(), false).await;
        s.purge_under("/proj").await;
        let left = s.list_received("bob").await;
        assert_eq!(left.len(), 1);
        assert_eq!(left[0].path, "/other");
    }
}
