use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

// ─── File system types ────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TrashEntry {
    pub id: String,
    pub original_path: String,
    pub deleted_at: DateTime<Utc>,
    pub username: String,
    #[serde(default)]
    pub size: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct VersionEntry {
    pub path: String,
    pub version_id: String,
    pub timestamp: DateTime<Utc>,
    pub size: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct FileMetadata {
    pub tags: Vec<String>,
    pub collections: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<DateTime<Utc>>,
    pub extension: Option<String>,
    pub mime_type: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DirectoryListing {
    pub path: String,
    pub entries: Vec<FileEntry>,
    pub parent: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct PathQuery {
    pub path: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SearchQuery {
    pub q: String,
    pub path: Option<String>,
    pub full_text: Option<bool>,
}

#[derive(Debug, Deserialize)]
pub struct RenameRequest {
    pub old_path: String,
    pub new_name: String,
}

#[derive(Debug, Deserialize)]
pub struct MoveRequest {
    pub paths: Vec<String>,
    pub destination: String,
}

#[derive(Debug, Deserialize)]
pub struct DeleteRequest {
    pub paths: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct MkdirRequest {
    pub path: String,
    pub name: String,
}

// ─── Auth / user types ────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum Permission {
    FileRead,
    FileWrite,
    FileDelete,
    UserManage,
    GroupManage,
    ViewAudit,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum UserStatus {
    Active,
    Disabled,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Admin,
    Manager,
    Editor,
    Viewer,
    User,
}

impl std::fmt::Display for Role {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Role::Admin => write!(f, "admin"),
            Role::Manager => write!(f, "manager"),
            Role::Editor => write!(f, "editor"),
            Role::Viewer => write!(f, "viewer"),
            Role::User => write!(f, "user"),
        }
    }
}

impl Role {
    pub fn default_permissions(&self) -> Vec<Permission> {
        match self {
            Role::Admin => vec![
                Permission::FileRead,
                Permission::FileWrite,
                Permission::FileDelete,
                Permission::UserManage,
                Permission::GroupManage,
                Permission::ViewAudit,
            ],
            Role::Manager => vec![
                Permission::FileRead,
                Permission::FileWrite,
                Permission::FileDelete,
                Permission::UserManage,
                Permission::GroupManage,
                Permission::ViewAudit,
            ],
            Role::Editor => vec![
                Permission::FileRead,
                Permission::FileWrite,
                Permission::FileDelete,
            ],
            Role::Viewer => vec![Permission::FileRead],
            Role::User => vec![Permission::FileRead],
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[derive(Default)]
pub struct UserMetadata {
    pub full_name: Option<String>,
    pub email: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UserGroup {
    pub id: String,
    pub name: String,
    pub permissions: Vec<Permission>,
    pub allowed_paths: Vec<String>,
}

/// Stored in the users JSON file on disk.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StoredUser {
    pub username: String,
    pub password_hash: String,
    pub role: Role,
    #[serde(default = "default_status")]
    pub status: UserStatus,
    #[serde(default)]
    pub permissions: Vec<Permission>,
    #[serde(default)]
    pub groups: Vec<String>, // IDs of groups
    pub quota_gb: Option<f64>,
    #[serde(default)]
    pub used_bytes: u64,
    pub last_login: Option<DateTime<Utc>>,
    #[serde(default)]
    pub metadata: UserMetadata,
    pub created_at: DateTime<Utc>,
    #[serde(default)]
    pub totp_secret: Option<String>,
    #[serde(default)]
    pub totp_enabled: bool,
    #[serde(default)]
    pub totp_recovery_codes: Vec<String>,
    /// Monotonic counter bumped to invalidate every previously-issued JWT for
    /// this user (password change, "log out all devices", admin revoke).
    #[serde(default)]
    pub token_version: u64,
}

fn default_status() -> UserStatus {
    UserStatus::Active
}


/// Safe view returned to API callers (no hash).
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct UserView {
    pub username: String,
    pub role: Role,
    pub status: UserStatus,
    pub permissions: Vec<Permission>,
    pub groups: Vec<String>,
    pub quota_gb: Option<f64>,
    pub used_bytes: u64,
    pub last_login: Option<DateTime<Utc>>,
    pub metadata: UserMetadata,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AuditEntry {
    pub timestamp: DateTime<Utc>,
    pub username: String,
    pub action: String,
    pub resource: Option<String>,
    pub ip: Option<String>,
    pub details: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AuditQuery {
    pub username: Option<String>,
    pub action: Option<String>,
    pub from: Option<DateTime<Utc>>,
    pub to: Option<DateTime<Utc>>,
    pub resource: Option<String>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

/// JWT payload.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: String,
    pub role: String,
    pub exp: usize,
    pub iat: usize,
    /// Token version captured at issue time; must match the user's current
    /// `token_version` or the token is rejected (revocation).
    #[serde(default)]
    pub tv: u64,
}

impl Claims {
    pub fn is_admin(&self) -> bool {
        self.role == "admin"
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PendingClaims {
    pub sub: String,
    pub exp: usize,
    pub iat: usize,
}

#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Serialize)]
pub struct UserInfo {
    pub username: String,
    pub role: String,
    pub permissions: Vec<Permission>,
    pub totp_enabled: bool,
}

// ─── 2FA request types ───────────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct TotpSetupConfirm {
    pub code: String,
}

#[derive(Debug, Deserialize)]
pub struct TotpVerifyRequest {
    pub code: String,
}

#[derive(Debug, Deserialize)]
pub struct TotpDisableRequest {
    pub password: String,
    /// Current TOTP code, or a recovery code.
    pub code: String,
}

#[derive(Debug, Deserialize)]
pub struct TotpRegenRequest {
    pub password: String,
    /// Current TOTP code, or a recovery code.
    pub code: String,
}

#[derive(Debug, Deserialize)]
pub struct TotpRecoveryRequest {
    pub recovery_code: String,
}

#[derive(Debug, Serialize)]
pub struct TotpSetupResponse {
    pub qr_code_png_b64: String,
}

#[derive(Debug, Serialize)]
pub struct TotpConfirmResponse {
    pub backup_codes: Vec<String>,
}

// ─── User management request types ───────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct RestoreRequest {
    pub id: String,
}

#[derive(Debug, Deserialize)]
pub struct VersionRestoreRequest {
    pub path: String,
    pub version_id: String,
}

#[derive(Debug, Deserialize)]
pub struct TagUpdateRequest {
    pub path: String,
    pub tags: Option<Vec<String>>,
    pub collections: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct BulkTagUpdateRequest {
    pub paths: Vec<String>,
    pub tags: Vec<String>,
    pub collections: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct BulkDownloadRequest {
    pub paths: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateUserRequest {
    pub username: String,
    pub password: String,
    pub role: Option<Role>,
}

#[derive(Debug, Deserialize)]
pub struct CreateGroupRequest {
    pub name: String,
    pub permissions: Vec<Permission>,
    pub allowed_paths: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct EditGroupRequest {
    pub name: Option<String>,
    pub permissions: Option<Vec<Permission>>,
    pub allowed_paths: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateUserRequest {
    pub role: Option<Role>,
    pub status: Option<UserStatus>,
    pub permissions: Option<Vec<Permission>>,
    pub groups: Option<Vec<String>>,
    pub quota_gb: Option<f64>,
    pub metadata: Option<UserMetadata>,
}

#[derive(Debug, Deserialize)]
pub struct ChangePasswordRequest {
    pub new_password: String,
    /// Required when changing your own password (not needed for admin changing others').
    pub current_password: Option<String>,
}
