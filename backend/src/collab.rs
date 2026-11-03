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
    models::{Claims, Permission},
    AppState,
};

// ─── Models ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharedFolderMember {
    pub username: String,
    pub can_write: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharedFolder {
    pub id: String,
    pub name: String,
    pub path: String,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    pub members: Vec<SharedFolderMember>,
}

// ─── Store ────────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct CollabStore {
    inner: Arc<RwLock<HashMap<String, SharedFolder>>>,
    db: Db,
}

impl CollabStore {
    pub async fn load(db: Db, migrate_from: PathBuf) -> anyhow::Result<Self> {
        let mut map = crate::db::hydrate_map::<SharedFolder>(&db, "collab", &migrate_from).await?;
        // Canonicalize stored paths once so every comparison (access checks,
        // purge/rebase on delete/rename, dedup) sees one spelling. Rows from
        // before paths were normalized that can't be (`..`) are dropped: fail closed.
        map.retain(|id, row| match crate::files::normalize_virtual(&row.path) {
            Ok(p) => {
                row.path = p;
                true
            }
            Err(_) => {
                tracing::warn!("ignoring collab row {} with invalid path {:?}", id, row.path);
                false
            }
        });
        Ok(Self { inner: Arc::new(RwLock::new(map)), db })
    }

    async fn save(&self, id: &str, folder: &SharedFolder) {
        if let Ok(json) = serde_json::to_string(folder) {
            let conn = self.db.lock().await;
            let _ = crate::db::put(&conn, "collab", id, &json);
        }
    }

    async fn remove_row(&self, id: &str) {
        let conn = self.db.lock().await;
        let _ = crate::db::delete(&conn, "collab", id);
    }

    pub async fn create(&self, name: String, path: String, created_by: String) -> SharedFolder {
        let id = Uuid::new_v4().to_string();
        let folder = SharedFolder {
            id: id.clone(),
            name,
            path,
            created_by,
            created_at: Utc::now(),
            members: vec![],
        };
        self.inner.write().await.insert(id.clone(), folder.clone());
        self.save(&id, &folder).await;
        folder
    }

    pub async fn get(&self, id: &str) -> Option<SharedFolder> {
        self.inner.read().await.get(id).cloned()
    }

    pub async fn list_for_user(&self, username: &str) -> Vec<SharedFolder> {
        let guard = self.inner.read().await;
        let mut folders: Vec<SharedFolder> = guard
            .values()
            .filter(|f| {
                f.created_by == username || f.members.iter().any(|m| m.username == username)
            })
            .cloned()
            .collect();
        folders.sort_by_key(|x| std::cmp::Reverse(x.created_at));
        folders
    }

    pub async fn list_all(&self) -> Vec<SharedFolder> {
        let mut folders: Vec<SharedFolder> = self.inner.read().await.values().cloned().collect();
        folders.sort_by_key(|x| std::cmp::Reverse(x.created_at));
        folders
    }

    pub async fn delete(&self, id: &str) -> bool {
        let removed = self.inner.write().await.remove(id).is_some();
        if removed {
            self.remove_row(id).await;
        }
        removed
    }

    pub async fn update_members(&self, id: &str, members: Vec<SharedFolderMember>) -> bool {
        let updated = {
            let mut guard = self.inner.write().await;
            if let Some(f) = guard.get_mut(id) {
                f.members = members;
                Some(f.clone())
            } else {
                None
            }
        };
        match updated {
            Some(folder) => {
                self.save(id, &folder).await;
                true
            }
            None => false,
        }
    }

    /// Re-point shared folders at `old` (or a descendant) to `new` after a
    /// rename/move, so membership follows the folder instead of dangling on the
    /// old path (where it would grant access to whatever is created there next).
    pub async fn rebase_path(&self, old: &str, new: &str) {
        let prefix = format!("{}/", old);
        let changed: Vec<SharedFolder> = {
            let mut guard = self.inner.write().await;
            let mut changed = Vec::new();
            for f in guard.values_mut() {
                if f.path == old {
                    f.path = new.to_string();
                    changed.push(f.clone());
                } else if let Some(rest) = f.path.strip_prefix(&prefix) {
                    f.path = format!("{}/{}", new, rest);
                    changed.push(f.clone());
                }
            }
            changed
        };
        for f in &changed {
            self.save(&f.id, f).await;
        }
    }

    /// Remove shared folders rooted at `path` (or a descendant of it). Called
    /// when the underlying directory is deleted.
    pub async fn purge_under(&self, path: &str) {
        let prefix = format!("{}/", path);
        let removed: Vec<String> = {
            let mut guard = self.inner.write().await;
            let removed: Vec<String> = guard
                .iter()
                .filter(|(_, f)| f.path == path || f.path.starts_with(&prefix))
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

    /// Creators of the shared folders through which `username` is a member
    /// covering `path` (with write, if `need_write`). Membership alone is not
    /// access: the caller must confirm the creator still holds it in their own
    /// right. The creator gains nothing from their own folder.
    pub async fn granting_owners(&self, username: &str, path: &str, need_write: bool) -> Vec<String> {
        let guard = self.inner.read().await;
        let mut owners: Vec<String> = guard
            .values()
            // Both canonical: `path` from validate_access, folder.path since load/create.
            .filter(|f| crate::files::path_covers(&f.path, path))
            .filter(|f| {
                f.members
                    .iter()
                    .any(|m| m.username == username && (!need_write || m.can_write))
            })
            .map(|f| f.created_by.clone())
            .collect();
        owners.sort();
        owners.dedup();
        owners
    }
}

// ─── Request types ────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CreateSharedFolderRequest {
    pub name: String,
    pub path: String,
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

pub async fn list_shared_folders(
    State(s): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<SharedFolder>>> {
    let folders = if claims.is_admin() {
        s.collab.list_all().await
    } else {
        s.collab.list_for_user(&claims.sub).await
    };
    Ok(Json(folders))
}

pub async fn create_shared_folder(
    State(s): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(mut req): Json<CreateSharedFolderRequest>,
) -> Result<Json<SharedFolder>> {
    // Persist the canonical path: access checks compare stored paths as strings.
    req.path = crate::files::normalize_virtual(&req.path)?;
    // Only what the creator holds in their own right can be shared: not access
    // received through an internal share or another shared folder.
    crate::files::own_grant(&s, &claims.sub, &req.path, Permission::FileRead).await?;
    let real = crate::files::resolve(&s.config.root_dir, &req.path)?;
    if !real.exists() || !real.is_dir() {
        return Err(AppError::NotFound(format!("Folder not found: {}", req.path)));
    }
    crate::files::ensure_direct_path(&s.config.root_dir, &real, &req.path)?;

    let name = req.name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::BadRequest("Name cannot be empty".into()));
    }

    let folder = s.collab.create(name, req.path.clone(), claims.sub.clone()).await;
    s.audit.log(&claims.sub, "shared_folder_create", Some(req.path), None, None).await;
    Ok(Json(folder))
}

pub async fn get_shared_folder(
    State(s): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<Json<SharedFolder>> {
    let folder = s
        .collab
        .get(&id)
        .await
        .ok_or_else(|| AppError::NotFound("Shared folder not found".into()))?;

    let is_member = folder.members.iter().any(|m| m.username == claims.sub);
    if !claims.is_admin() && folder.created_by != claims.sub && !is_member {
        return Err(AppError::Forbidden);
    }

    Ok(Json(folder))
}

pub async fn delete_shared_folder(
    State(s): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<StatusCode> {
    let folder = s
        .collab
        .get(&id)
        .await
        .ok_or_else(|| AppError::NotFound("Shared folder not found".into()))?;

    if !claims.is_admin() && folder.created_by != claims.sub {
        return Err(AppError::Forbidden);
    }

    s.collab.delete(&id).await;
    s.audit.log(&claims.sub, "shared_folder_delete", Some(id), None, None).await;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn update_members(
    State(s): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
    Json(members): Json<Vec<SharedFolderMember>>,
) -> Result<Json<SharedFolder>> {
    let folder = s
        .collab
        .get(&id)
        .await
        .ok_or_else(|| AppError::NotFound("Shared folder not found".into()))?;

    if !claims.is_admin() && folder.created_by != claims.sub {
        return Err(AppError::Forbidden);
    }
    // Granting write requires holding it: members are capped by the creator's
    // own access at check time anyway, but refuse an ineffective grant upfront.
    if members.iter().any(|m| m.can_write) {
        crate::files::own_grant(&s, &claims.sub, &folder.path, Permission::FileWrite).await?;
    }

    s.collab.update_members(&id, members.clone()).await;
    let member_list = members.iter().map(|m| format!("{}:{}", m.username, if m.can_write { "rw" } else { "r" })).collect::<Vec<_>>().join(", ");
    s.audit.log(&claims.sub, "shared_folder_members_update", Some(id.clone()), None, Some(format!("members: {}", member_list))).await;
    let updated = s
        .collab
        .get(&id)
        .await
        .ok_or_else(|| AppError::NotFound("Shared folder not found".into()))?;
    Ok(Json(updated))
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn store() -> (tempfile::TempDir, CollabStore) {
        let dir = tempfile::tempdir().unwrap();
        let db = crate::db::open(&dir.path().join("t.db")).unwrap();
        let s = CollabStore::load(db, dir.path().join("c.json")).await.unwrap();
        (dir, s)
    }

    #[tokio::test]
    async fn owner_gains_nothing_from_own_folder() {
        let (_d, s) = store().await;
        let _f = s.create("Proj".into(), "/proj".into(), "alice".into()).await;
        // The creator's access is their own; the folder must not widen it.
        assert!(s.granting_owners("alice", "/proj", false).await.is_empty());
        assert!(s.granting_owners("alice", "/proj/sub/file.txt", true).await.is_empty());
    }

    #[tokio::test]
    async fn granting_owners_names_the_creator() {
        let (_d, s) = store().await;
        let f = s.create("P".into(), "/proj".into(), "alice".into()).await;
        s.update_members(&f.id, vec![SharedFolderMember { username: "bob".into(), can_write: true }]).await;
        assert_eq!(s.granting_owners("bob", "/proj/x", true).await, vec!["alice".to_string()]);
    }

    #[tokio::test]
    async fn member_read_vs_write_and_nonmember() {
        let (_d, s) = store().await;
        let f = s.create("Proj".into(), "/proj".into(), "alice".into()).await;
        s.update_members(&f.id, vec![
            SharedFolderMember { username: "bob".into(), can_write: false },
            SharedFolderMember { username: "carol".into(), can_write: true },
        ]).await;
        assert!(!s.granting_owners("bob", "/proj/x", false).await.is_empty());    // read ok
        assert!(s.granting_owners("bob", "/proj/x", true).await.is_empty());     // write denied
        assert!(!s.granting_owners("carol", "/proj/x", true).await.is_empty());    // write ok
        assert!(s.granting_owners("dave", "/proj/x", false).await.is_empty());   // non-member
    }

    #[tokio::test]
    async fn path_prefix_matching_is_boundary_safe() {
        let (_d, s) = store().await;
        let f = s.create("P".into(), "/proj".into(), "alice".into()).await;
        s.update_members(&f.id, vec![SharedFolderMember { username: "bob".into(), can_write: false }]).await;
        assert!(!s.granting_owners("bob", "/proj", false).await.is_empty());
        assert!(!s.granting_owners("bob", "/proj/a", false).await.is_empty());
        // "/projects" must NOT match the "/proj" share (prefix boundary)
        assert!(s.granting_owners("bob", "/projects", false).await.is_empty());
    }

    #[tokio::test]
    async fn root_share_covers_everything() {
        let (_d, s) = store().await;
        let f = s.create("Root".into(), "/".into(), "alice".into()).await;
        s.update_members(&f.id, vec![SharedFolderMember { username: "bob".into(), can_write: false }]).await;
        assert!(!s.granting_owners("bob", "/anything/here", false).await.is_empty());
    }

    #[tokio::test]
    async fn rebase_path_follows_rename_and_purge_under_deletes() {
        let (_d, s) = store().await;
        let f = s.create("P".into(), "/proj".into(), "alice".into()).await;
        s.update_members(&f.id, vec![SharedFolderMember { username: "bob".into(), can_write: true }]).await;
        let _other = s.create("Q".into(), "/projects".into(), "alice".into()).await;

        s.rebase_path("/proj", "/renamed").await;
        assert!(!s.granting_owners("bob", "/renamed/x", true).await.is_empty());
        assert!(s.granting_owners("bob", "/proj/x", false).await.is_empty());
        // Prefix boundary: "/projects" untouched.
        assert_eq!(s.get(&_other.id).await.unwrap().path, "/projects");

        s.purge_under("/renamed").await;
        assert!(s.get(&f.id).await.is_none());
        assert!(s.granting_owners("bob", "/renamed/x", false).await.is_empty());
        assert!(s.get(&_other.id).await.is_some());
    }

    #[tokio::test]
    async fn list_scoping_and_delete() {
        let (_d, s) = store().await;
        let f = s.create("P".into(), "/p".into(), "alice".into()).await;
        assert_eq!(s.list_for_user("alice").await.len(), 1);
        assert_eq!(s.list_for_user("bob").await.len(), 0);
        assert_eq!(s.list_all().await.len(), 1);
        assert!(s.delete(&f.id).await);
        assert_eq!(s.list_all().await.len(), 0);
    }
}
