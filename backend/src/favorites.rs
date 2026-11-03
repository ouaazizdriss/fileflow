use std::{collections::HashMap, path::PathBuf, sync::Arc};

use axum::{
    extract::{Query, State},
    http::StatusCode,
    Extension, Json,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

use crate::{
    db::Db,
    error::{AppError, Result},
    files::{resolve, validate_access},
    models::{Claims, Permission},
    AppState,
};

// ─── Model ────────────────────────────────────────────────────────────────────

/// A user's starred file or folder. The store key is `username\u{1f}path`, so a
/// given (user, path) is unique and starring twice is idempotent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Favorite {
    pub username: String,
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub created_at: DateTime<Utc>,
}

fn key(username: &str, path: &str) -> String {
    format!("{}\u{1f}{}", username, path)
}

// ─── Store ────────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct FavoriteStore {
    inner: Arc<RwLock<HashMap<String, Favorite>>>,
    db: Db,
}

impl FavoriteStore {
    pub async fn load(db: Db, migrate_from: PathBuf) -> anyhow::Result<Self> {
        let map = crate::db::hydrate_map::<Favorite>(&db, "favorites", &migrate_from).await?;
        Ok(Self { inner: Arc::new(RwLock::new(map)), db })
    }

    async fn save(&self, k: &str, fav: &Favorite) {
        if let Ok(json) = serde_json::to_string(fav) {
            let conn = self.db.lock().await;
            let _ = crate::db::put(&conn, "favorites", k, &json);
        }
    }

    async fn remove_row(&self, k: &str) {
        let conn = self.db.lock().await;
        let _ = crate::db::delete(&conn, "favorites", k);
    }

    /// Star a path for a user (idempotent). Returns the stored favorite.
    pub async fn add(&self, username: &str, path: &str, name: &str, is_dir: bool) -> Favorite {
        let k = key(username, path);
        let fav = Favorite {
            username: username.to_string(),
            path: path.to_string(),
            name: name.to_string(),
            is_dir,
            created_at: Utc::now(),
        };
        self.inner.write().await.insert(k.clone(), fav.clone());
        self.save(&k, &fav).await;
        fav
    }

    pub async fn remove(&self, username: &str, path: &str) -> bool {
        let k = key(username, path);
        let removed = self.inner.write().await.remove(&k).is_some();
        if removed {
            self.remove_row(&k).await;
        }
        removed
    }

    pub async fn is_favorite(&self, username: &str, path: &str) -> bool {
        self.inner.read().await.contains_key(&key(username, path))
    }

    /// Re-key favorites at `old` (or a descendant) to `new` after a rename/move,
    /// so stars follow the resource instead of dangling on the old path.
    pub async fn rebase_path(&self, old: &str, new: &str) {
        let prefix = format!("{}/", old);
        let moved: Vec<(String, String, Favorite)> = {
            let mut guard = self.inner.write().await;
            let old_keys: Vec<String> = guard
                .iter()
                .filter(|(_, f)| f.path == old || f.path.starts_with(&prefix))
                .map(|(k, _)| k.clone())
                .collect();
            let mut moved = Vec::new();
            for old_key in old_keys {
                if let Some(mut fav) = guard.remove(&old_key) {
                    if fav.path == old {
                        fav.path = new.to_string();
                        if let Some(n) = new.rsplit('/').next().filter(|n| !n.is_empty()) {
                            fav.name = n.to_string();
                        }
                    } else {
                        fav.path = format!("{}/{}", new, &fav.path[prefix.len()..]);
                    }
                    let new_key = key(&fav.username, &fav.path);
                    guard.insert(new_key.clone(), fav.clone());
                    moved.push((old_key, new_key, fav));
                }
            }
            moved
        };
        for (old_key, new_key, fav) in &moved {
            self.remove_row(old_key).await;
            self.save(new_key, fav).await;
        }
    }

    /// Drop every favorite pointing at `path` or a descendant of it (resource
    /// deleted).
    pub async fn purge_under(&self, path: &str) {
        let prefix = format!("{}/", path);
        let removed: Vec<String> = {
            let mut guard = self.inner.write().await;
            let keys: Vec<String> = guard
                .iter()
                .filter(|(_, f)| f.path == path || f.path.starts_with(&prefix))
                .map(|(k, _)| k.clone())
                .collect();
            for k in &keys {
                guard.remove(k);
            }
            keys
        };
        for k in &removed {
            self.remove_row(k).await;
        }
    }

    pub async fn list_for_user(&self, username: &str) -> Vec<Favorite> {
        let mut v: Vec<Favorite> = self
            .inner
            .read()
            .await
            .values()
            .filter(|f| f.username == username)
            .cloned()
            .collect();
        // Folders first, then most-recently starred.
        v.sort_by(|a, b| match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => b.created_at.cmp(&a.created_at),
        });
        v
    }
}

// ─── Request types ────────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct AddFavoriteRequest {
    pub path: String,
}

#[derive(Deserialize)]
pub struct FavoritePathQuery {
    pub path: String,
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

pub async fn list_favorites(
    State(s): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<Favorite>>> {
    Ok(Json(s.favorites.list_for_user(&claims.sub).await))
}

pub async fn add_favorite(
    State(s): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(mut req): Json<AddFavoriteRequest>,
) -> Result<Json<Favorite>> {
    // Persist the canonical path: access checks compare stored paths as strings.
    req.path = crate::files::normalize_virtual(&req.path)?;
    // You can only star something you're allowed to read.
    validate_access(&s, &claims.sub, &req.path, Permission::FileRead).await?;

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

    let fav = s.favorites.add(&claims.sub, &req.path, &name, is_dir).await;
    Ok(Json(fav))
}

pub async fn remove_favorite(
    State(s): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(q): Query<FavoritePathQuery>,
) -> Result<StatusCode> {
    // Stars are keyed by canonical path (see add_favorite); a path that can't
    // be normalized can't have been starred.
    if let Ok(path) = crate::files::normalize_virtual(&q.path) {
        s.favorites.remove(&claims.sub, &path).await;
    }
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn store() -> (tempfile::TempDir, FavoriteStore) {
        let dir = tempfile::tempdir().unwrap();
        let db = crate::db::open(&dir.path().join("t.db")).unwrap();
        let s = FavoriteStore::load(db, dir.path().join("f.json")).await.unwrap();
        (dir, s)
    }

    #[tokio::test]
    async fn add_is_idempotent_and_per_user() {
        let (_d, s) = store().await;
        s.add("alice", "/a.txt", "a.txt", false).await;
        s.add("alice", "/a.txt", "a.txt", false).await; // starring twice
        assert_eq!(s.list_for_user("alice").await.len(), 1);
        assert!(s.is_favorite("alice", "/a.txt").await);
        // Favorites are scoped to the user.
        assert!(!s.is_favorite("bob", "/a.txt").await);
        assert_eq!(s.list_for_user("bob").await.len(), 0);
    }

    #[tokio::test]
    async fn remove_unstars() {
        let (_d, s) = store().await;
        s.add("alice", "/a.txt", "a.txt", false).await;
        assert!(s.remove("alice", "/a.txt").await);
        assert!(!s.is_favorite("alice", "/a.txt").await);
        assert!(!s.remove("alice", "/a.txt").await); // already gone
    }

    #[tokio::test]
    async fn list_orders_folders_first() {
        let (_d, s) = store().await;
        s.add("u", "/file.txt", "file.txt", false).await;
        s.add("u", "/folder", "folder", true).await;
        let list = s.list_for_user("u").await;
        assert_eq!(list[0].name, "folder"); // folders first
    }

    #[tokio::test]
    async fn rebase_path_rekeys_and_purge_under_removes() {
        let (_d, s) = store().await;
        s.add("u", "/proj", "proj", true).await;
        s.add("u", "/proj/doc.txt", "doc.txt", false).await;
        s.add("u", "/projects", "projects", true).await;

        s.rebase_path("/proj", "/renamed").await;
        assert!(s.is_favorite("u", "/renamed").await);
        assert!(s.is_favorite("u", "/renamed/doc.txt").await);
        assert!(!s.is_favorite("u", "/proj").await);
        assert!(!s.is_favorite("u", "/proj/doc.txt").await);
        // Prefix boundary respected.
        assert!(s.is_favorite("u", "/projects").await);
        // Exact-match star picks up the new display name.
        let star = s.list_for_user("u").await.into_iter().find(|f| f.path == "/renamed").unwrap();
        assert_eq!(star.name, "renamed");

        s.purge_under("/renamed").await;
        assert!(!s.is_favorite("u", "/renamed").await);
        assert!(!s.is_favorite("u", "/renamed/doc.txt").await);
        assert!(s.is_favorite("u", "/projects").await);
    }

    #[tokio::test]
    async fn persists_across_reload() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.db");
        let jpath = dir.path().join("f.json");
        {
            let db = crate::db::open(&path).unwrap();
            let s = FavoriteStore::load(db, jpath.clone()).await.unwrap();
            s.add("u", "/keep", "keep", true).await;
        }
        let db2 = crate::db::open(&path).unwrap();
        let s2 = FavoriteStore::load(db2, jpath).await.unwrap();
        assert!(s2.is_favorite("u", "/keep").await);
    }
}
