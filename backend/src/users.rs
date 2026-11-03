use std::{collections::HashMap, path::PathBuf, sync::Arc};

use chrono::Utc;
use tokio::sync::RwLock;

use crate::{
    db::Db,
    error::{AppError, Result},
    models::{EditGroupRequest, Permission, Role, StoredUser, UpdateUserRequest, UserGroup, UserMetadata, UserStatus, UserView},
};

#[derive(Clone)]
pub struct UserStore {
    pub(crate) inner: Arc<RwLock<HashMap<String, StoredUser>>>,
    pub(crate) groups: Arc<RwLock<HashMap<String, UserGroup>>>,
    db: Db,
}

impl UserStore {
    /// Load users and groups from SQLite. On first run, import the legacy JSON
    /// files (`Vec<StoredUser>` / `Vec<UserGroup>`) if they exist.
    pub async fn load(db: Db, users_migrate: PathBuf, groups_migrate: PathBuf) -> anyhow::Result<Self> {
        let (users_map, groups_map) = {
            let conn = db.lock().await;

            // Users
            let mut users_map: HashMap<String, StoredUser> = HashMap::new();
            for (k, data) in crate::db::load_all(&conn, "users")? {
                if let Ok(u) = serde_json::from_str::<StoredUser>(&data) {
                    users_map.insert(k, u);
                }
            }
            if users_map.is_empty() && users_migrate.exists() {
                if let Ok(raw) = std::fs::read_to_string(&users_migrate) {
                    if let Ok(list) = serde_json::from_str::<Vec<StoredUser>>(&raw) {
                        for u in &list {
                            if let Ok(j) = serde_json::to_string(u) {
                                let _ = crate::db::put(&conn, "users", &u.username, &j);
                            }
                        }
                        tracing::info!("migrated {} user(s) from {:?} into SQLite", list.len(), users_migrate);
                        users_map = list.into_iter().map(|u| (u.username.clone(), u)).collect();
                    }
                }
            }

            // Groups
            let mut groups_map: HashMap<String, UserGroup> = HashMap::new();
            for (k, data) in crate::db::load_all(&conn, "groups")? {
                if let Ok(g) = serde_json::from_str::<UserGroup>(&data) {
                    groups_map.insert(k, g);
                }
            }
            if groups_map.is_empty() && groups_migrate.exists() {
                if let Ok(raw) = std::fs::read_to_string(&groups_migrate) {
                    if let Ok(list) = serde_json::from_str::<Vec<UserGroup>>(&raw) {
                        for g in &list {
                            if let Ok(j) = serde_json::to_string(g) {
                                let _ = crate::db::put(&conn, "groups", &g.id, &j);
                            }
                        }
                        tracing::info!("migrated {} group(s) from {:?} into SQLite", list.len(), groups_migrate);
                        groups_map = list.into_iter().map(|g| (g.id.clone(), g)).collect();
                    }
                }
            }

            (users_map, groups_map)
        };

        Ok(Self {
            inner: Arc::new(RwLock::new(users_map)),
            groups: Arc::new(RwLock::new(groups_map)),
            db,
        })
    }

    // ─── Single-row write-through helpers ─────────────────────────────────────

    async fn save_user(&self, user: &StoredUser) {
        match serde_json::to_string(user) {
            Ok(json) => {
                let conn = self.db.lock().await;
                if let Err(e) = crate::db::put(&conn, "users", &user.username, &json) {
                    tracing::error!("failed to persist user '{}': {}", user.username, e);
                }
            }
            Err(e) => tracing::error!("failed to serialize user '{}': {}", user.username, e),
        }
    }

    async fn remove_user_row(&self, username: &str) {
        let conn = self.db.lock().await;
        let _ = crate::db::delete(&conn, "users", username);
    }

    async fn save_group(&self, group: &UserGroup) {
        if let Ok(json) = serde_json::to_string(group) {
            let conn = self.db.lock().await;
            let _ = crate::db::put(&conn, "groups", &group.id, &json);
        }
    }

    async fn remove_group_row(&self, id: &str) {
        let conn = self.db.lock().await;
        let _ = crate::db::delete(&conn, "groups", id);
    }

    pub async fn is_empty(&self) -> bool {
        self.inner.read().await.is_empty()
    }

    pub async fn count(&self) -> usize {
        self.inner.read().await.len()
    }

    pub async fn get(&self, username: &str) -> Option<StoredUser> {
        self.inner.read().await.get(username).cloned()
    }

    pub async fn list(&self) -> Vec<UserView> {
        let map = self.inner.read().await;
        let mut users: Vec<UserView> = map
            .values()
            .map(|u| UserView {
                username: u.username.clone(),
                role: u.role.clone(),
                status: u.status,
                permissions: u.permissions.clone(),
                groups: u.groups.clone(),
                quota_gb: u.quota_gb,
                used_bytes: u.used_bytes,
                last_login: u.last_login,
                metadata: u.metadata.clone(),
                created_at: u.created_at,
            })
            .collect();
        users.sort_by(|a, b| {
            // Admins first, then alphabetical
            match (&a.role, &b.role) {
                (Role::Admin, Role::User) => std::cmp::Ordering::Less,
                (Role::User, Role::Admin) => std::cmp::Ordering::Greater,
                _ => a.username.cmp(&b.username),
            }
        });
        users
    }

    pub async fn create(&self, username: String, password: &str, role: Role) -> Result<UserView> {
        let hash = bcrypt::hash(password, bcrypt::DEFAULT_COST)
            .map_err(|e| AppError::Internal(anyhow::anyhow!("bcrypt: {}", e)))?;

        let mut map = self.inner.write().await;

        if map.contains_key(&username) {
            return Err(AppError::BadRequest(format!("User '{}' already exists", username)));
        }

        let user = StoredUser {
            username: username.clone(),
            password_hash: hash,
            role: role.clone(),
            status: UserStatus::Active,
            permissions: Vec::new(),
            groups: Vec::new(),
            quota_gb: None,
            used_bytes: 0,
            last_login: None,
            metadata: UserMetadata {
                full_name: None,
                email: None,
            },
            created_at: Utc::now(),
            totp_secret: None,
            totp_enabled: false,
            totp_recovery_codes: Vec::new(),
            // Random, not 0: a token issued to a deleted account would otherwise
            // validate again for a new account recreated under the same name.
            token_version: rand::random(),
        };
        let view = UserView {
            username: user.username.clone(),
            role,
            status: user.status,
            permissions: user.permissions.clone(),
            groups: user.groups.clone(),
            quota_gb: user.quota_gb,
            used_bytes: user.used_bytes,
            last_login: user.last_login,
            metadata: user.metadata.clone(),
            created_at: user.created_at,
        };
        let stored = user.clone();
        map.insert(username, user);
        drop(map);

        self.save_user(&stored).await;
        Ok(view)
    }

    pub async fn delete(&self, username: &str) -> Result<()> {
        let mut map = self.inner.write().await;
        let user = map
            .get(username)
            .ok_or_else(|| AppError::NotFound(format!("User '{}' not found", username)))?;
        // Checked under the same lock as the removal, so two concurrent deletes
        // can't each see another admin left and remove both.
        if is_active_admin(user) && active_admin_count(&map) <= 1 {
            return Err(AppError::BadRequest("Cannot delete the last admin account".into()));
        }
        map.remove(username);
        drop(map);
        self.remove_user_row(username).await;
        Ok(())
    }

    pub async fn set_password(&self, username: &str, new_password: &str) -> Result<()> {
        let hash = bcrypt::hash(new_password, bcrypt::DEFAULT_COST)
            .map_err(|e| AppError::Internal(anyhow::anyhow!("bcrypt: {}", e)))?;

        let stored = {
            let mut map = self.inner.write().await;
            let user = map
                .get_mut(username)
                .ok_or_else(|| AppError::NotFound(format!("User '{}' not found", username)))?;
            user.password_hash = hash;
            // Changing the password revokes every existing session.
            user.token_version = user.token_version.wrapping_add(1);
            user.clone()
        };
        self.save_user(&stored).await;
        Ok(())
    }

    /// Increment the user's token version, invalidating all currently-issued
    /// JWTs ("log out all devices" / admin session revoke).
    pub async fn bump_token_version(&self, username: &str) -> Result<()> {
        let stored = {
            let mut map = self.inner.write().await;
            let user = map
                .get_mut(username)
                .ok_or_else(|| AppError::NotFound(format!("User '{}' not found", username)))?;
            user.token_version = user.token_version.wrapping_add(1);
            user.clone()
        };
        self.save_user(&stored).await;
        Ok(())
    }

    pub async fn verify_password(&self, username: &str, password: &str) -> bool {
        let map = self.inner.read().await;
        map.get(username)
            .map(|u| bcrypt::verify(password, &u.password_hash).unwrap_or(false))
            .unwrap_or(false)
    }

    #[cfg(test)]
    pub async fn admin_count(&self) -> usize {
        self.inner
            .read()
            .await
            .values()
            .filter(|u| u.role == Role::Admin)
            .count()
    }

    /// Minimum gap between persisted `last_login` updates. `require_auth` calls
    /// this on every authenticated request; without a floor each API call would
    /// rewrite the user's row through the global SQLite connection.
    const LAST_LOGIN_WRITE_GAP_SECS: i64 = 60;

    pub async fn update_last_login(&self, username: &str) -> Result<()> {
        let now = Utc::now();

        // Cheap read-locked freshness check before taking the write path.
        {
            let map = self.inner.read().await;
            match map.get(username) {
                Some(user) => {
                    if let Some(last) = user.last_login {
                        if (now - last).num_seconds() < Self::LAST_LOGIN_WRITE_GAP_SECS {
                            return Ok(());
                        }
                    }
                }
                None => return Ok(()),
            }
        }

        let stored = {
            let mut map = self.inner.write().await;
            match map.get_mut(username) {
                Some(user) => {
                    user.last_login = Some(now);
                    user.clone()
                }
                None => return Ok(()),
            }
        };
        self.save_user(&stored).await;
        Ok(())
    }

    pub async fn update_used_bytes(&self, username: &str, delta: i64) -> Result<()> {
        let stored = {
            let mut map = self.inner.write().await;
            match map.get_mut(username) {
                Some(user) => {
                    if delta < 0 {
                        user.used_bytes = user.used_bytes.saturating_sub(delta.unsigned_abs());
                    } else {
                        user.used_bytes = user.used_bytes.saturating_add(delta as u64);
                    }
                    user.clone()
                }
                None => return Ok(()),
            }
        };
        self.save_user(&stored).await;
        Ok(())
    }

    pub async fn get_resolved_permissions(&self, username: &str) -> Vec<Permission> {
        let user = match self.get(username).await {
            Some(u) => u,
            None => return Vec::new(),
        };

        let mut perms: std::collections::HashSet<Permission> = user.permissions.into_iter().collect();

        let groups = self.groups.read().await;
        for group_id in &user.groups {
            if let Some(group) = groups.get(group_id) {
                for p in &group.permissions {
                    perms.insert(*p);
                }
            }
        }

        // If no direct or group permissions, use role defaults
        if perms.is_empty() {
            user.role.default_permissions()
        } else {
            perms.into_iter().collect()
        }
    }

    // ─── Group management ───────────────────────────────────────────────────

    pub async fn list_groups(&self) -> Vec<UserGroup> {
        let map = self.groups.read().await;
        let mut groups: Vec<UserGroup> = map.values().cloned().collect();
        groups.sort_by(|a, b| a.name.cmp(&b.name));
        groups
    }

    pub async fn create_group(&self, name: String, permissions: Vec<Permission>, paths: Vec<String>) -> Result<UserGroup> {
        let mut map = self.groups.write().await;
        let id = uuid::Uuid::new_v4().to_string();
        let group = UserGroup {
            id: id.clone(),
            name,
            permissions,
            allowed_paths: paths,
        };
        map.insert(id, group.clone());
        drop(map);
        self.save_group(&group).await;
        Ok(group)
    }

    pub async fn delete_group(&self, id: &str) -> Result<()> {
        let mut map = self.groups.write().await;
        if map.remove(id).is_none() {
            return Err(AppError::NotFound(format!("Group '{}' not found", id)));
        }
        drop(map);
        self.remove_group_row(id).await;

        // Also remove group from all users, persisting only those that changed.
        let changed: Vec<StoredUser> = {
            let mut users = self.inner.write().await;
            let mut changed = Vec::new();
            for user in users.values_mut() {
                if user.groups.iter().any(|g| g == id) {
                    user.groups.retain(|g| g != id);
                    changed.push(user.clone());
                }
            }
            changed
        };
        for user in &changed {
            self.save_user(user).await;
        }

        Ok(())
    }

    pub async fn update_group(&self, id: &str, req: EditGroupRequest) -> Result<UserGroup> {
        let mut map = self.groups.write().await;
        let group = map
            .get_mut(id)
            .ok_or_else(|| AppError::NotFound(format!("Group '{}' not found", id)))?;

        if let Some(name) = req.name {
            group.name = name;
        }
        if let Some(permissions) = req.permissions {
            group.permissions = permissions;
        }
        if let Some(allowed_paths) = req.allowed_paths {
            group.allowed_paths = allowed_paths;
        }
        let updated_group = group.clone();
        drop(map);
        self.save_group(&updated_group).await;
        Ok(updated_group)
    }

    // ─── 2FA / TOTP ───────────────────────────────────────────────────────────

    pub async fn set_totp_secret(&self, username: &str, secret: &str) -> Result<()> {
        let stored = {
            let mut map = self.inner.write().await;
            let user = map
                .get_mut(username)
                .ok_or_else(|| AppError::NotFound(format!("User '{}' not found", username)))?;
            user.totp_secret = Some(secret.to_string());
            user.clone()
        };
        self.save_user(&stored).await;
        Ok(())
    }

    pub async fn confirm_totp(&self, username: &str, recovery_codes: Vec<String>) -> Result<()> {
        let stored = {
            let mut map = self.inner.write().await;
            let user = map
                .get_mut(username)
                .ok_or_else(|| AppError::NotFound(format!("User '{}' not found", username)))?;
            user.totp_enabled = true;
            user.totp_recovery_codes = recovery_codes;
            user.clone()
        };
        self.save_user(&stored).await;
        Ok(())
    }

    pub async fn disable_totp(&self, username: &str) -> Result<()> {
        let stored = {
            let mut map = self.inner.write().await;
            let user = map
                .get_mut(username)
                .ok_or_else(|| AppError::NotFound(format!("User '{}' not found", username)))?;
            user.totp_secret = None;
            user.totp_enabled = false;
            user.totp_recovery_codes.clear();
            user.clone()
        };
        self.save_user(&stored).await;
        Ok(())
    }

    pub async fn consume_recovery_code(&self, username: &str, plain_code: &str) -> Result<bool> {
        let stored = {
            let mut map = self.inner.write().await;
            let user = map
                .get_mut(username)
                .ok_or_else(|| AppError::NotFound(format!("User '{}' not found", username)))?;

            // Check if the plain code matches any hashed code
            match user
                .totp_recovery_codes
                .iter()
                .position(|hash| bcrypt::verify(plain_code, hash).unwrap_or(false))
            {
                Some(index) => {
                    user.totp_recovery_codes.remove(index);
                    Some(user.clone())
                }
                None => None,
            }
        };
        match stored {
            Some(user) => {
                self.save_user(&user).await;
                Ok(true)
            }
            None => Ok(false),
        }
    }

    pub async fn replace_recovery_codes(&self, username: &str, hashed_codes: Vec<String>) -> Result<()> {
        let stored = {
            let mut map = self.inner.write().await;
            let user = map
                .get_mut(username)
                .ok_or_else(|| AppError::NotFound(format!("User '{}' not found", username)))?;
            user.totp_recovery_codes = hashed_codes;
            user.clone()
        };
        self.save_user(&stored).await;
        Ok(())
    }

    /// Apply an admin user-update, returning the new view plus a human-readable
    /// list of what changed (for the audit log). Persists the single affected row.
    pub async fn apply_update(
        &self,
        username: &str,
        req: UpdateUserRequest,
    ) -> Result<(UserView, Vec<String>)> {
        let (view, changes, stored) = {
            let mut map = self.inner.write().await;
            let user = map
                .get(username)
                .ok_or_else(|| AppError::NotFound(format!("User '{}' not found", username)))?;

            // Never leave the instance without an active admin: demoting or
            // disabling the last one would lock everyone out of administration.
            let stays_admin = req.role.as_ref().unwrap_or(&user.role) == &Role::Admin
                && req.status.unwrap_or(user.status) == UserStatus::Active;
            if is_active_admin(user) && !stays_admin && active_admin_count(&map) <= 1 {
                return Err(AppError::BadRequest(
                    "Cannot demote or disable the last active admin".into(),
                ));
            }
            let Some(user) = map.get_mut(username) else {
                return Err(AppError::NotFound(format!("User '{}' not found", username)));
            };

            let mut changes = Vec::new();
            // Track changes that must invalidate the user's live JWTs. Role,
            // permission and group edits affect authorization decisions that are
            // partly read from the token (e.g. the admin role string), so a stale
            // token must not keep elevated access after a demotion.
            let mut security_change = false;

            if let Some(role) = req.role {
                if user.role != role {
                    changes.push(format!("role: {} -> {}", user.role, role));
                    security_change = true;
                }
                user.role = role;
            }
            if let Some(status) = req.status {
                if user.status != status {
                    let old = match user.status {
                        UserStatus::Active => "active",
                        UserStatus::Disabled => "disabled",
                    };
                    let new = match status {
                        UserStatus::Active => "active",
                        UserStatus::Disabled => "disabled",
                    };
                    changes.push(format!("status: {} -> {}", old, new));
                    security_change = true;
                }
                user.status = status;
            }
            if let Some(permissions) = req.permissions {
                if user.permissions != permissions {
                    changes.push("permissions updated".to_string());
                    security_change = true;
                }
                user.permissions = permissions;
            }
            if let Some(groups) = req.groups {
                if user.groups != groups {
                    changes.push("groups updated".to_string());
                    security_change = true;
                }
                user.groups = groups;
            }
            if let Some(quota) = req.quota_gb {
                user.quota_gb = Some(quota);
                changes.push(format!("quota: {} GB", quota));
            }
            if let Some(metadata) = req.metadata {
                user.metadata = metadata;
                changes.push("metadata updated".to_string());
            }

            // Revoke existing sessions when authorization-relevant fields change
            // so a demotion / permission removal takes effect immediately rather
            // than lingering until the old JWT expires.
            if security_change {
                user.token_version = user.token_version.wrapping_add(1);
            }

            let view = UserView {
                username: user.username.clone(),
                role: user.role.clone(),
                status: user.status,
                permissions: user.permissions.clone(),
                groups: user.groups.clone(),
                quota_gb: user.quota_gb,
                used_bytes: user.used_bytes,
                last_login: user.last_login,
                metadata: user.metadata.clone(),
                created_at: user.created_at,
            };

            (view, changes, user.clone())
        };

        self.save_user(&stored).await;
        Ok((view, changes))
    }
}

fn is_active_admin(u: &StoredUser) -> bool {
    u.role == Role::Admin && u.status == UserStatus::Active
}

fn active_admin_count(map: &HashMap<String, StoredUser>) -> usize {
    map.values().filter(|u| is_active_admin(u)).count()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{UpdateUserRequest, UserMetadata};

    async fn store() -> (tempfile::TempDir, UserStore) {
        let dir = tempfile::tempdir().unwrap();
        let db = crate::db::open(&dir.path().join("t.db")).unwrap();
        let s = UserStore::load(db, dir.path().join("u.json"), dir.path().join("g.json"))
            .await
            .unwrap();
        (dir, s)
    }

    #[tokio::test]
    async fn create_get_and_duplicate() {
        let (_d, s) = store().await;
        assert!(s.is_empty().await);
        s.create("alice".into(), "secretpw", Role::Admin).await.unwrap();
        assert!(!s.is_empty().await);
        assert_eq!(s.count().await, 1);

        let u = s.get("alice").await.unwrap();
        assert_eq!(u.role, Role::Admin);
        assert!(s.get("nobody").await.is_none());

        // Duplicate username is rejected.
        assert!(s.create("alice".into(), "x", Role::User).await.is_err());
    }

    #[tokio::test]
    async fn token_version_bumps_on_revoke_and_password_change() {
        let (_d, s) = store().await;
        s.create("u".into(), "pw12345", Role::User).await.unwrap();
        let v0 = s.get("u").await.unwrap().token_version;

        s.bump_token_version("u").await.unwrap();
        assert_eq!(s.get("u").await.unwrap().token_version, v0.wrapping_add(1));

        // Changing the password also revokes existing sessions.
        s.set_password("u", "newpw678").await.unwrap();
        assert_eq!(s.get("u").await.unwrap().token_version, v0.wrapping_add(2));

        // Unknown user errors.
        assert!(s.bump_token_version("ghost").await.is_err());
    }

    #[tokio::test]
    async fn last_active_admin_cannot_be_demoted_disabled_or_deleted() {
        // F4: the delete guard alone left demotion and disabling open.
        let (_d, s) = store().await;
        s.create("root".into(), "pw12345", Role::Admin).await.unwrap();
        let demote = || UpdateUserRequest {
            role: Some(Role::User), status: None, permissions: None,
            groups: None, quota_gb: None, metadata: None,
        };
        let disable = || UpdateUserRequest {
            role: None, status: Some(UserStatus::Disabled), permissions: None,
            groups: None, quota_gb: None, metadata: None,
        };
        assert!(s.apply_update("root", demote()).await.is_err());
        assert!(s.apply_update("root", disable()).await.is_err());
        assert!(s.delete("root").await.is_err());
        assert_eq!(s.get("root").await.unwrap().role, Role::Admin);

        // A disabled admin doesn't count as the backup.
        s.create("spare".into(), "pw12345", Role::Admin).await.unwrap();
        s.apply_update("spare", disable()).await.unwrap();
        assert!(s.apply_update("root", demote()).await.is_err());

        // With a second active admin, either change is allowed.
        s.apply_update("spare", UpdateUserRequest {
            role: None, status: Some(UserStatus::Active), permissions: None,
            groups: None, quota_gb: None, metadata: None,
        }).await.unwrap();
        s.apply_update("root", demote()).await.unwrap();
        assert!(s.apply_update("spare", demote()).await.is_err()); // now the last one
    }

    #[tokio::test]
    async fn recreated_account_does_not_inherit_token_version() {
        // F2: a JWT carries (sub, tv). A same-name account must not start at
        // the version the deleted one had, or its old tokens validate again.
        let (_d, s) = store().await;
        s.create("u".into(), "pw12345", Role::User).await.unwrap();
        let old = s.get("u").await.unwrap().token_version;
        s.delete("u").await.unwrap();
        s.create("u".into(), "pw12345", Role::User).await.unwrap();
        assert_ne!(s.get("u").await.unwrap().token_version, old);
    }

    #[tokio::test]
    async fn passwords_hash_and_verify() {
        let (_d, s) = store().await;
        s.create("bob".into(), "hunter2pw", Role::User).await.unwrap();
        assert!(s.verify_password("bob", "hunter2pw").await);
        assert!(!s.verify_password("bob", "wrong").await);

        s.set_password("bob", "newpass99").await.unwrap();
        assert!(!s.verify_password("bob", "hunter2pw").await);
        assert!(s.verify_password("bob", "newpass99").await);

        // The stored hash is never the plaintext.
        let u = s.get("bob").await.unwrap();
        assert_ne!(u.password_hash, "newpass99");
    }

    #[tokio::test]
    async fn last_login_updates_are_throttled() {
        let (_d, s) = store().await;
        s.create("u".into(), "pw", Role::User).await.unwrap();
        assert!(s.get("u").await.unwrap().last_login.is_none());

        s.update_last_login("u").await.unwrap();
        let first = s.get("u").await.unwrap().last_login.unwrap();

        // A second call within the write gap is a no-op (same stored timestamp).
        s.update_last_login("u").await.unwrap();
        assert_eq!(s.get("u").await.unwrap().last_login.unwrap(), first);

        // Unknown user is a silent no-op.
        s.update_last_login("ghost").await.unwrap();
    }

    #[tokio::test]
    async fn used_bytes_saturates_at_zero() {
        let (_d, s) = store().await;
        s.create("c".into(), "pw", Role::User).await.unwrap();
        s.update_used_bytes("c", 100).await.unwrap();
        assert_eq!(s.get("c").await.unwrap().used_bytes, 100);
        s.update_used_bytes("c", -250).await.unwrap(); // can't go below 0
        assert_eq!(s.get("c").await.unwrap().used_bytes, 0);
    }

    #[tokio::test]
    async fn list_sorts_admins_before_users() {
        let (_d, s) = store().await;
        s.create("zoe".into(), "pw", Role::User).await.unwrap();
        s.create("amy".into(), "pw", Role::Admin).await.unwrap();
        let list = s.list().await;
        assert_eq!(list[0].username, "amy"); // admin first
        assert_eq!(s.admin_count().await, 1);
    }

    #[tokio::test]
    async fn resolved_permissions_role_default_direct_and_group() {
        let (_d, s) = store().await;

        // No direct/group perms → role default.
        s.create("viewer".into(), "pw", Role::Viewer).await.unwrap();
        assert_eq!(s.get_resolved_permissions("viewer").await, vec![Permission::FileRead]);

        // Group permissions are unioned in.
        let g = s.create_group("editors".into(), vec![Permission::FileWrite], vec![]).await.unwrap();
        s.create("u".into(), "pw", Role::Viewer).await.unwrap();
        s.apply_update("u", UpdateUserRequest {
            role: None, status: None, permissions: None,
            groups: Some(vec![g.id.clone()]), quota_gb: None, metadata: None,
        }).await.unwrap();
        let perms = s.get_resolved_permissions("u").await;
        assert!(perms.contains(&Permission::FileWrite));

        // Direct permissions also count and merge with group ones.
        s.apply_update("u", UpdateUserRequest {
            role: None, status: None, permissions: Some(vec![Permission::ViewAudit]),
            groups: Some(vec![g.id.clone()]), quota_gb: None, metadata: None,
        }).await.unwrap();
        let perms = s.get_resolved_permissions("u").await;
        assert!(perms.contains(&Permission::ViewAudit));
        assert!(perms.contains(&Permission::FileWrite));

        // Unknown user → empty.
        assert!(s.get_resolved_permissions("ghost").await.is_empty());
    }

    #[tokio::test]
    async fn delete_group_detaches_it_from_users() {
        let (_d, s) = store().await;
        let g = s.create_group("team".into(), vec![Permission::FileRead], vec!["/x".into()]).await.unwrap();
        s.create("m".into(), "pw", Role::User).await.unwrap();
        s.apply_update("m", UpdateUserRequest {
            role: None, status: None, permissions: None,
            groups: Some(vec![g.id.clone()]), quota_gb: None, metadata: None,
        }).await.unwrap();
        assert_eq!(s.get("m").await.unwrap().groups, vec![g.id.clone()]);

        s.delete_group(&g.id).await.unwrap();
        assert!(s.list_groups().await.is_empty());
        // The membership reference is cleaned out of the user.
        assert!(s.get("m").await.unwrap().groups.is_empty());
    }

    #[tokio::test]
    async fn update_group_edits_fields() {
        let (_d, s) = store().await;
        let g = s.create_group("g".into(), vec![Permission::FileRead], vec![]).await.unwrap();
        let updated = s.update_group(&g.id, EditGroupRequest {
            name: Some("renamed".into()),
            permissions: Some(vec![Permission::FileRead, Permission::FileWrite]),
            allowed_paths: Some(vec!["/docs".into()]),
        }).await.unwrap();
        assert_eq!(updated.name, "renamed");
        assert_eq!(updated.permissions.len(), 2);
        assert_eq!(updated.allowed_paths, vec!["/docs".to_string()]);
    }

    #[tokio::test]
    async fn totp_lifecycle_and_recovery_codes() {
        let (_d, s) = store().await;
        s.create("t".into(), "pw", Role::User).await.unwrap();

        s.set_totp_secret("t", "SECRET").await.unwrap();
        assert_eq!(s.get("t").await.unwrap().totp_secret.as_deref(), Some("SECRET"));
        assert!(!s.get("t").await.unwrap().totp_enabled);

        let plain = "ABCDE-FGHIJ";
        let hash = bcrypt::hash(plain, 4).unwrap();
        s.confirm_totp("t", vec![hash]).await.unwrap();
        assert!(s.get("t").await.unwrap().totp_enabled);

        // A recovery code can be consumed exactly once.
        assert!(s.consume_recovery_code("t", plain).await.unwrap());
        assert!(!s.consume_recovery_code("t", plain).await.unwrap());
        assert!(!s.consume_recovery_code("t", "nope").await.unwrap());

        s.replace_recovery_codes("t", vec![bcrypt::hash("NEW-CODE", 4).unwrap()]).await.unwrap();
        assert!(s.consume_recovery_code("t", "NEW-CODE").await.unwrap());

        s.disable_totp("t").await.unwrap();
        let u = s.get("t").await.unwrap();
        assert!(!u.totp_enabled);
        assert!(u.totp_secret.is_none());
        assert!(u.totp_recovery_codes.is_empty());
    }

    #[tokio::test]
    async fn apply_update_changes_and_reports() {
        let (_d, s) = store().await;
        s.create("u".into(), "pw", Role::User).await.unwrap();
        let (view, changes) = s.apply_update("u", UpdateUserRequest {
            role: Some(Role::Manager),
            status: Some(UserStatus::Disabled),
            permissions: None,
            groups: None,
            quota_gb: Some(5.0),
            metadata: Some(UserMetadata { full_name: Some("U".into()), email: None }),
        }).await.unwrap();
        assert_eq!(view.role, Role::Manager);
        assert_eq!(view.status, UserStatus::Disabled);
        assert_eq!(view.quota_gb, Some(5.0));
        assert!(changes.iter().any(|c| c.contains("role")));
        assert!(changes.iter().any(|c| c.contains("status")));
    }

    #[tokio::test]
    async fn apply_update_bumps_token_version_on_security_changes() {
        let (_d, s) = store().await;
        s.create("u".into(), "pw", Role::Admin).await.unwrap();
        // A second admin, so demoting "u" isn't refused as the last one.
        s.create("other".into(), "pw", Role::Admin).await.unwrap();
        let v0 = s.get("u").await.unwrap().token_version;

        // Demoting the user must revoke their existing sessions (token_version++),
        // otherwise the stale JWT keeps its admin role claim.
        s.apply_update("u", UpdateUserRequest {
            role: Some(Role::User), status: None, permissions: None,
            groups: None, quota_gb: None, metadata: None,
        }).await.unwrap();
        assert_eq!(s.get("u").await.unwrap().token_version, v0.wrapping_add(1));

        // A no-op role write (same role) does not bump.
        s.apply_update("u", UpdateUserRequest {
            role: Some(Role::User), status: None, permissions: None,
            groups: None, quota_gb: None, metadata: None,
        }).await.unwrap();
        assert_eq!(s.get("u").await.unwrap().token_version, v0.wrapping_add(1));

        // A purely cosmetic change (metadata / quota) does NOT revoke sessions.
        s.apply_update("u", UpdateUserRequest {
            role: None, status: None, permissions: None,
            groups: None, quota_gb: Some(9.0),
            metadata: Some(UserMetadata { full_name: Some("U".into()), email: None }),
        }).await.unwrap();
        assert_eq!(s.get("u").await.unwrap().token_version, v0.wrapping_add(1));

        // Permission and group edits do revoke.
        s.apply_update("u", UpdateUserRequest {
            role: None, status: None, permissions: Some(vec![Permission::FileRead]),
            groups: None, quota_gb: None, metadata: None,
        }).await.unwrap();
        assert_eq!(s.get("u").await.unwrap().token_version, v0.wrapping_add(2));
    }

    #[tokio::test]
    async fn persists_across_reload() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.db");
        let upath = dir.path().join("u.json");
        let gpath = dir.path().join("g.json");
        {
            let db = crate::db::open(&path).unwrap();
            let s = UserStore::load(db, upath.clone(), gpath.clone()).await.unwrap();
            s.create("dave".into(), "davepass", Role::Editor).await.unwrap();
            let g = s.create_group("grp".into(), vec![Permission::FileWrite], vec![]).await.unwrap();
            s.apply_update("dave", UpdateUserRequest {
                role: None, status: None, permissions: None,
                groups: Some(vec![g.id]), quota_gb: Some(2.0), metadata: None,
            }).await.unwrap();
        }
        // Fresh connection to the same database file.
        let db2 = crate::db::open(&path).unwrap();
        let s2 = UserStore::load(db2, upath, gpath).await.unwrap();
        let u = s2.get("dave").await.unwrap();
        assert_eq!(u.role, Role::Editor);
        assert_eq!(u.quota_gb, Some(2.0));
        assert_eq!(u.groups.len(), 1);
        assert!(s2.verify_password("dave", "davepass").await);
        assert_eq!(s2.list_groups().await.len(), 1);
    }
}
