use std::path::{Component, Path, PathBuf};
use std::io::SeekFrom;

use axum::{
    body::Body,
    extract::{Multipart, Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    Extension, Json,
};
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use tokio::{fs, io::{AsyncWriteExt, AsyncReadExt, AsyncSeekExt}};
use tokio_util::io::ReaderStream;
use walkdir::WalkDir;
use zip::ZipWriter;
use anyhow;

use crate::{
    error::{AppError, Result},
    models::*,
    AppState,
};

/// Upper bound on the total uncompressed size of a single bulk (zip) download.
/// The archive is assembled in memory, so this caps peak allocation and blocks
/// a cheap memory-exhaustion request.
const MAX_BULK_BYTES: u64 = 2 * 1024 * 1024 * 1024; // 2 GiB

const BLOCKED_EXTENSIONS: &[&str] = &[
    "exe", "sh", "bat", "cmd", "ps1", "vbs", "js",
    "php", "py", "rb", "pl", "jar", "com", "msi",
    "scr", "pif", "reg", "hta", "ws", "wsf", "lnk",
];

/// Canonical form of a client-supplied virtual path: `/a/b`, with empty and `.`
/// segments dropped. Any `..` segment is rejected outright. Authorization
/// compares paths as strings (group `allowed_paths`, share and shared-folder
/// prefixes), so the string that is checked must be the one that is accessed:
/// `/teamA/../teamB` would pass a `/teamA/` prefix test yet resolve to `/teamB`.
pub fn normalize_virtual(path: &str) -> Result<String> {
    let mut segments = Vec::new();
    for seg in path.split('/') {
        match seg {
            "" | "." => {}
            ".." => return Err(AppError::BadRequest("Invalid path".into())),
            s => segments.push(s),
        }
    }
    Ok(format!("/{}", segments.join("/")))
}

/// True if canonical `path` is `prefix` itself or lies beneath it. Both sides
/// must already be canonical (see normalize_virtual); this is the single prefix
/// test behind group `allowed_paths`, internal shares and shared folders.
pub fn path_covers(prefix: &str, path: &str) -> bool {
    prefix == "/"
        || path == prefix
        || path.strip_prefix(prefix).is_some_and(|rest| rest.starts_with('/'))
}

/// Canonical form of a stored `allowed_paths` entry, or None if it grants
/// nothing. Entries are normalized when saved; for older entries only the
/// canonical spelling (optionally with one trailing slash) is honored, so a
/// malformed value like `.` or `//` can't silently widen to the whole root.
pub(crate) fn canonical_prefix(p: &str) -> Option<String> {
    let c = normalize_virtual(p).ok()?;
    if p == c || (c != "/" && p.strip_suffix('/') == Some(c.as_str())) {
        Some(c)
    } else {
        None
    }
}

/// Reject a resource reached through a symlink when creating a persistent grant
/// or link on it. Grants are stored under the requested (authorized) path, but
/// delete/rename purge and rebase by the resolved real path; the two must agree.
pub(crate) fn ensure_direct_path(root: &Path, real: &Path, path: &str) -> Result<()> {
    if virtual_path(root, real) != path {
        return Err(AppError::BadRequest("Path must not go through a symbolic link".into()));
    }
    Ok(())
}

/// Resolve a user-supplied path to a real path, preventing path traversal.
pub fn resolve(root: &Path, user_path: &str) -> Result<PathBuf> {
    let canonical_root = root
        .canonicalize()
        .map_err(|e| AppError::Internal(anyhow::anyhow!("Root dir error: {}", e)))?;

    // Reject `..` here too, not only in validate_access: paths persisted before
    // that check existed (share links, upload requests, trash records) are
    // resolved without re-authorization.
    let normalized = normalize_virtual(user_path)?;
    let joined = canonical_root.join(normalized.trim_start_matches('/'));

    // Manually normalize without touching the filesystem
    let mut out = PathBuf::new();
    for component in joined.components() {
        match component {
            Component::Prefix(p) => out.push(p.as_os_str()),
            Component::RootDir => out.push("/"),
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            Component::Normal(s) => out.push(s),
        }
    }

    if !out.starts_with(&canonical_root) {
        return Err(AppError::Forbidden);
    }

    // Block access to internal data files/dirs at ANY depth, not just the final
    // component — e.g. `/.fileflow/versions/<hash>` must be rejected too, so a
    // user cannot reach other users' trash, file versions, or the secret/user
    // files via a nested path.
    check_no_internal_components(&out, &canonical_root)?;

    // If the target already exists, resolve symlinks and re-verify containment:
    // a link placed inside the root must not lead outside it (or into
    // `.fileflow` internals). Non-existent targets (upload/mkdir destinations)
    // can't be symlinks themselves and their parent is covered next time around.
    if out.exists() {
        let canon = out
            .canonicalize()
            .map_err(|e| AppError::Internal(anyhow::anyhow!("canonicalize: {}", e)))?;
        if !canon.starts_with(&canonical_root) {
            return Err(AppError::Forbidden);
        }
        check_no_internal_components(&canon, &canonical_root)?;
        return Ok(canon);
    }

    Ok(out)
}

/// Reject any `.fileflow*` component in `path` relative to `root`.
fn check_no_internal_components(path: &Path, root: &Path) -> Result<()> {
    if let Ok(rel) = path.strip_prefix(root) {
        for comp in rel.components() {
            if let Component::Normal(s) = comp {
                if s.to_string_lossy().starts_with(".fileflow") {
                    return Err(AppError::Forbidden);
                }
            }
        }
    }
    Ok(())
}

/// True if any component of `rel` (a path relative to the data root) is a
/// hidden / internal FileFlow entry. Used to keep dotfiles and `.fileflow/*`
/// internal data out of directory walks (bulk download, etc.).
pub(crate) fn is_internal_rel(rel: &Path) -> bool {
    rel.components().any(|c| {
        matches!(c, Component::Normal(s) if s.to_string_lossy().starts_with('.'))
    })
}

/// True for file types a browser would render as active content (HTML, SVG,
/// XML, …). Such files must never be served `inline` with their native MIME or
/// they become a stored-XSS vector; the preview path downgrades them to
/// `text/plain` so they render as inert source instead.
pub(crate) fn is_active_content(name: &Path) -> bool {
    let ext = name
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase());
    matches!(
        ext.as_deref(),
        Some("html") | Some("htm") | Some("xhtml") | Some("shtml")
            | Some("xml") | Some("svg") | Some("svgz") | Some("mhtml") | Some("mht")
    )
}

/// Pure quota check: would adding `additional` bytes push `used_bytes` over the
/// (optional) `quota_gb` allowance? No quota → never over.
pub(crate) fn over_quota(quota_gb: Option<f64>, used_bytes: u64, additional: u64) -> bool {
    match quota_gb {
        Some(gb) => {
            let quota_bytes = (gb * 1024.0 * 1024.0 * 1024.0) as u64;
            used_bytes.saturating_add(additional) > quota_bytes
        }
        None => false,
    }
}

/// Recursive size of every regular file under `dir`, computed off the async
/// runtime (a large tree is blocking IO).
async fn dir_size(dir: PathBuf) -> Result<u64> {
    tokio::task::spawn_blocking(move || {
        WalkDir::new(&dir)
            .into_iter()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
            .filter_map(|e| e.metadata().ok())
            .map(|m| m.len())
            .sum::<u64>()
    })
    .await
    .map_err(|e| AppError::Internal(e.into()))
}

pub(crate) fn virtual_path(root: &Path, real: &Path) -> String {
    let rel = real.strip_prefix(root).unwrap_or(real);
    format!("/{}", rel.to_string_lossy().replace('\\', "/"))
}

pub(crate) fn build_entry(root: &Path, path: &Path) -> Result<FileEntry> {
    let meta = std::fs::metadata(path)?;
    let is_dir = meta.is_dir();
    let size = if is_dir { 0 } else { meta.len() };

    let modified = meta.modified().ok().and_then(|t| {
        t.duration_since(std::time::UNIX_EPOCH)
            .ok()
            .and_then(|d| DateTime::<Utc>::from_timestamp(d.as_secs() as i64, 0))
    });

    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    let extension = if is_dir {
        None
    } else {
        path.extension()
            .map(|e| e.to_string_lossy().to_lowercase())
    };

    let mime_type = if is_dir {
        None
    } else {
        Some(
            mime_guess::from_path(path)
                .first_or_octet_stream()
                .to_string(),
        )
    };

    Ok(FileEntry {
        path: virtual_path(root, path),
        name,
        is_dir,
        size,
        modified,
        extension,
        mime_type,
    })
}

/// True if the file's extension is on the upload blocklist.
pub(crate) fn is_blocked_extension(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .map(|e| BLOCKED_EXTENSIONS.contains(&e.as_str()))
        .unwrap_or(false)
}

/// If `dest` is an existing file, move it into the per-file version archive
/// (keyed by a stable hash of its virtual path). Returns the archive timestamp
/// when something was archived. Shared by the multipart and chunked upload paths.
pub(crate) async fn archive_existing_version(root: &Path, dest: &Path) -> Result<Option<i64>> {
    if !(dest.exists() && dest.is_file()) {
        return Ok(None);
    }
    let versions_dir = root.join(".fileflow/versions");
    fs::create_dir_all(&versions_dir).await?;

    let rel_path = virtual_path(root, dest);
    let path_hash = uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_DNS, rel_path.as_bytes()).to_string();
    let file_versions_dir = versions_dir.join(&path_hash);
    fs::create_dir_all(&file_versions_dir).await?;

    let timestamp = Utc::now().timestamp_millis();
    let version_path = file_versions_dir.join(format!("{}.bak", timestamp));
    fs::rename(dest, &version_path).await?;
    Ok(Some(timestamp))
}

pub fn sanitize_name(name: &str) -> String {
    // Replace path separators, shell/Windows-illegal chars, AND all control
    // characters (incl. \n, \r, \t, \0). Control chars in a filename would
    // otherwise flow into Content-Disposition / header values downstream.
    let s: String = name
        .trim()
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                '_'
            } else {
                c
            }
        })
        .collect();
    s.trim_start_matches(['.', ' ']).to_string()
}

/// Encode a filename for Content-Disposition headers (RFC 5987 / RFC 6266).
/// Produces both a safe ASCII fallback and a percent-encoded `filename*` parameter.
pub fn content_disposition(filename: &str) -> String {
    let ascii_safe: String = filename
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ' ') {
                c
            } else {
                '_'
            }
        })
        .collect();

    let mut encoded = String::new();
    for &b in filename.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'!' | b'#' | b'$' | b'&' | b'+'
            | b'-' | b'.' | b'^' | b'_' | b'`' | b'|' | b'~' => encoded.push(b as char),
            _ => encoded.push_str(&format!("%{:02X}", b)),
        }
    }

    format!(
        "attachment; filename=\"{}\"; filename*=UTF-8''{}",
        ascii_safe, encoded
    )
}

// ─── Ranged file serving (RFC 7233) ───────────────────────────────────────────

pub enum RangeSpec {
    /// No (or non-bytes) Range header — serve the whole file.
    None,
    /// A satisfiable inclusive byte range [start, end].
    Range(u64, u64),
    /// A syntactically-valid but unsatisfiable range — must answer 416.
    Unsatisfiable,
}

/// Parse a single HTTP byte-range request against a known total size.
/// Only the first range in a multi-range header is honored.
pub fn parse_range(header: &str, total: u64) -> RangeSpec {
    let spec = match header.trim().strip_prefix("bytes=") {
        Some(s) => s.trim(),
        None => return RangeSpec::None,
    };
    let first = spec.split(',').next().unwrap_or("").trim();
    let (a, b) = match first.split_once('-') {
        Some(parts) => parts,
        None => return RangeSpec::Unsatisfiable,
    };

    if total == 0 {
        return RangeSpec::Unsatisfiable;
    }

    let (start, end) = if a.is_empty() {
        // Suffix range: last N bytes.
        let n: u64 = match b.trim().parse() {
            Ok(n) if n > 0 => n,
            _ => return RangeSpec::Unsatisfiable,
        };
        let n = n.min(total);
        (total - n, total - 1)
    } else {
        let start: u64 = match a.trim().parse() {
            Ok(s) => s,
            Err(_) => return RangeSpec::Unsatisfiable,
        };
        let end: u64 = if b.trim().is_empty() {
            total - 1
        } else {
            match b.trim().parse() {
                Ok(e) => e,
                Err(_) => return RangeSpec::Unsatisfiable,
            }
        };
        (start, end.min(total - 1))
    };

    if start > end || start >= total {
        return RangeSpec::Unsatisfiable;
    }
    RangeSpec::Range(start, end)
}

/// Stream a file with byte-range support. Always advertises `Accept-Ranges: bytes`.
/// Returns 206 + Content-Range for a satisfiable range, 416 for an unsatisfiable
/// one, or 200 with the full body otherwise. `disposition` is the full
/// Content-Disposition header value.
pub async fn serve_file_ranged(
    real: &Path,
    disposition: String,
    cache_control: Option<&str>,
    range_header: Option<&str>,
    content_type_override: Option<&str>,
) -> Result<Response> {
    let mut file = fs::File::open(real).await?;
    let total = file.metadata().await?.len();
    let mime = match content_type_override {
        Some(ct) => ct.to_string(),
        None => mime_guess::from_path(real)
            .first_or_octet_stream()
            .to_string(),
    };

    // Build header values fallibly. `mime` and `disposition` are derived from
    // filenames/MIME detection; a stray invalid byte must surface as a 500, not
    // panic the process (release builds use panic=abort → whole-process crash).
    let hv = |s: &str| -> Result<HeaderValue> {
        HeaderValue::from_str(s).map_err(|e| AppError::Internal(anyhow::anyhow!("invalid header value: {}", e)))
    };
    let mut headers = HeaderMap::new();
    headers.insert(header::CONTENT_TYPE, hv(&mime)?);
    headers.insert(header::CONTENT_DISPOSITION, hv(&disposition)?);
    headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    if let Some(cc) = cache_control {
        headers.insert(header::CACHE_CONTROL, hv(cc)?);
    }

    match range_header.map(|h| parse_range(h, total)).unwrap_or(RangeSpec::None) {
        RangeSpec::Range(start, end) => {
            let len = end - start + 1;
            file.seek(SeekFrom::Start(start)).await?;
            let stream = ReaderStream::new(file.take(len));
            headers.insert(header::CONTENT_LENGTH, HeaderValue::from(len));
            headers.insert(
                header::CONTENT_RANGE,
                hv(&format!("bytes {}-{}/{}", start, end, total))?,
            );
            Ok((StatusCode::PARTIAL_CONTENT, headers, Body::from_stream(stream)).into_response())
        }
        RangeSpec::Unsatisfiable => {
            let mut headers = HeaderMap::new();
            headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
            headers.insert(
                header::CONTENT_RANGE,
                hv(&format!("bytes */{}", total))?,
            );
            Ok((StatusCode::RANGE_NOT_SATISFIABLE, headers).into_response())
        }
        RangeSpec::None => {
            let stream = ReaderStream::new(file);
            headers.insert(header::CONTENT_LENGTH, HeaderValue::from(total));
            Ok((StatusCode::OK, headers, Body::from_stream(stream)).into_response())
        }
    }
}

pub async fn validate_access(
    state: &AppState,
    username: &str,
    path: &str,
    permission: Permission,
) -> Result<()> {
    validate_access_inner(state, username, path, permission, true).await
}

/// Access check that ignores direct (internal) shares — i.e. the user must reach
/// the resource through their own role/permissions/groups/collab membership.
/// Used when granting a new internal share, so a recipient of a read/write share
/// cannot re-share access they only hold transitively, nor widen it past their
/// own genuine reach.
pub async fn validate_own_access(
    state: &AppState,
    username: &str,
    path: &str,
    permission: Permission,
) -> Result<()> {
    validate_access_inner(state, username, path, permission, false).await
}

async fn validate_access_inner(
    state: &AppState,
    username: &str,
    path: &str,
    permission: Permission,
    allow_internal_share: bool,
) -> Result<()> {
    // Every check below is a string prefix comparison, so it must run on the
    // canonical path (see normalize_virtual), never on the raw request string.
    let path = normalize_virtual(path)?;
    let path = path.as_str();

    let user = state.users.get(username).await.ok_or(AppError::Unauthorized)?;
    if user.role == Role::Admin {
        return Ok(());
    }

    let need_write = matches!(permission, Permission::FileWrite | Permission::FileDelete);

    // A direct user-to-user share grants access to its resource regardless of the
    // recipient's base role/permissions (a Viewer can be given write on one file).
    // Skipped when re-granting a share, so shares can't be chained transitively.
    if allow_internal_share
        && state.internal_shares.check_access(username, path, need_write).await
    {
        return Ok(());
    }

    let perms = state.users.get_resolved_permissions(username).await;
    if !perms.contains(&permission) {
        return Err(AppError::Forbidden);
    }

    // Shared folder membership bypasses the member's group path restrictions,
    // but only as far as the folder's creator could go themselves — checked now,
    // not at creation, so revoking the creator's access revokes the members' too.
    for owner in state.collab.granting_owners(username, path, need_write).await {
        if own_grant(state, &owner, path, permission).await.is_ok() {
            return Ok(());
        }
    }

    if !groups_allow(state, &user.groups, path).await {
        return Err(AppError::Forbidden);
    }

    Ok(())
}

/// Access a user holds in their own right: role/permissions plus group path
/// restrictions, ignoring internal shares and shared folders. This bounds what
/// they may hand on to others, so access can never be re-shared transitively.
pub(crate) async fn own_grant(
    state: &AppState,
    username: &str,
    path: &str,
    permission: Permission,
) -> Result<()> {
    let path = normalize_virtual(path)?;
    let user = state.users.get(username).await.ok_or(AppError::Forbidden)?;
    if user.role == Role::Admin {
        return Ok(());
    }
    if !state.users.get_resolved_permissions(username).await.contains(&permission) {
        return Err(AppError::Forbidden);
    }
    if !groups_allow(state, &user.groups, &path).await {
        return Err(AppError::Forbidden);
    }
    Ok(())
}

/// Group `allowed_paths` check on a canonical path. No restrictions at all means
/// unrestricted; otherwise fails closed (malformed entries grant nothing).
async fn groups_allow(state: &AppState, group_ids: &[String], path: &str) -> bool {
    let restricted_paths: Vec<String> = state
        .users
        .list_groups()
        .await
        .into_iter()
        .filter(|g| group_ids.contains(&g.id))
        .flat_map(|g| g.allowed_paths)
        .collect();

    restricted_paths.is_empty()
        || restricted_paths
            .iter()
            .filter_map(|p| canonical_prefix(p))
            .any(|p| path_covers(&p, path))
}

pub async fn check_quota(state: &AppState, username: &str, new_bytes: u64) -> Result<()> {
    let user = state.users.get(username).await.ok_or(AppError::Unauthorized)?;
    if over_quota(user.quota_gb, user.used_bytes, new_bytes) {
        return Err(AppError::BadRequest("Quota exceeded".into()));
    }
    Ok(())
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

pub async fn set_tags(
    State(s): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<TagUpdateRequest>,
) -> Result<Json<Value>> {
    // Canonical key, so rename/delete (which use canonical paths) find it.
    let path = normalize_virtual(&req.path)?;
    validate_access(&s, &claims.sub, &path, Permission::FileWrite).await?;

    let meta_path = s.config.root_dir.join(".fileflow/metadata.json");
    let _lock = s.metadata_lock.write().await;

    let mut metadata: std::collections::HashMap<String, crate::models::FileMetadata> = if meta_path.exists() {
        let content = fs::read_to_string(&meta_path).await?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        std::collections::HashMap::new()
    };

    let entry = metadata.entry(path.clone()).or_default();
    if let Some(tags) = req.tags {
        entry.tags = tags;
    }
    if let Some(collections) = req.collections {
        entry.collections = collections;
    }

    fs::write(&meta_path, serde_json::to_string_pretty(&metadata)?).await?;
    drop(_lock);
    s.audit.log(&claims.sub, "update_tags", Some(path), None, None).await;

    Ok(Json(json!({ "success": true })))
}

pub async fn set_tags_bulk(
    State(s): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<BulkTagUpdateRequest>,
) -> Result<Json<Value>> {
    let paths: Vec<String> = req.paths.iter().map(|p| normalize_virtual(p)).collect::<Result<_>>()?;
    for path in &paths {
        validate_access(&s, &claims.sub, path, Permission::FileWrite).await?;
    }

    let meta_path = s.config.root_dir.join(".fileflow/metadata.json");
    let _lock = s.metadata_lock.write().await;

    let mut metadata: std::collections::HashMap<String, crate::models::FileMetadata> = if meta_path.exists() {
        let content = fs::read_to_string(&meta_path).await?;
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        std::collections::HashMap::new()
    };

    for path in &paths {
        let entry = metadata.entry(path.clone()).or_default();
        entry.tags = req.tags.clone();
        entry.collections = req.collections.clone();
    }

    fs::write(&meta_path, serde_json::to_string_pretty(&metadata)?).await?;
    drop(_lock);
    s.audit.log(&claims.sub, "bulk_update_tags", Some(format!("{} files", req.paths.len())), None, None).await;

    Ok(Json(json!({ "success": true, "count": req.paths.len() })))
}

/// Re-key tag entries at `old` (or a descendant) to `new`. An entry already at
/// the destination is stale (nothing existed there) and is overwritten.
fn rebase_metadata_keys(metadata: &mut std::collections::HashMap<String, FileMetadata>, old: &str, new: &str) -> bool {
    let prefix = format!("{}/", old);
    let keys: Vec<String> = metadata
        .keys()
        .filter(|k| k.as_str() == old || k.starts_with(&prefix))
        .cloned()
        .collect();
    for k in &keys {
        if let Some(entry) = metadata.remove(k) {
            let moved = if k == old { new.to_string() } else { format!("{}/{}", new, &k[prefix.len()..]) };
            metadata.insert(moved, entry);
        }
    }
    !keys.is_empty()
}

/// Drop tag entries at `path` and its descendants.
fn purge_metadata_keys(metadata: &mut std::collections::HashMap<String, FileMetadata>, path: &str) -> bool {
    let prefix = format!("{}/", path);
    let before = metadata.len();
    metadata.retain(|k, _| k != path && !k.starts_with(&prefix));
    metadata.len() != before
}

/// Apply `f` to metadata.json under the metadata lock, writing back only on change.
/// Best-effort: the file operation has already succeeded, so a failure here is
/// logged rather than surfaced.
async fn update_metadata<F>(s: &AppState, f: F)
where
    F: FnOnce(&mut std::collections::HashMap<String, FileMetadata>) -> bool,
{
    let meta_path = s.config.root_dir.join(".fileflow/metadata.json");
    let _lock = s.metadata_lock.write().await;
    let Ok(content) = fs::read_to_string(&meta_path).await else { return };
    let mut metadata: std::collections::HashMap<String, FileMetadata> = serde_json::from_str(&content).unwrap_or_default();
    if f(&mut metadata) {
        let written = match serde_json::to_string_pretty(&metadata) {
            Ok(json) => fs::write(&meta_path, json).await.map_err(|e| e.to_string()),
            Err(e) => Err(e.to_string()),
        };
        if let Err(e) = written {
            tracing::warn!("failed to update metadata.json: {}", e);
        }
    }
}

pub async fn search_by_tag(
    State(s): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(q): Query<SearchQuery>,
) -> Result<Json<Vec<FileEntry>>> {
    let raw = q.q.clone();
    if raw.len() < 2 {
        return Err(AppError::BadRequest("Tag query too short".into()));
    }
    // Strip leading '#' and normalise to lowercase so "#Work" matches tag "work"
    let tag = raw.trim_start_matches('#').to_lowercase();

    let meta_path = s.config.root_dir.join(".fileflow/metadata.json");
    if !meta_path.exists() {
        return Ok(Json(Vec::new()));
    }

    let _lock = s.metadata_lock.read().await;
    let content = fs::read_to_string(&meta_path).await?;
    let metadata: std::collections::HashMap<String, crate::models::FileMetadata> = serde_json::from_str(&content)?;

    let mut results = Vec::new();
    for (path, meta) in metadata {
        if meta.tags.iter().any(|t| t.to_lowercase().contains(&tag))
            || meta.collections.iter().any(|c| c.to_lowercase().contains(&tag))
        {
            if let Ok(real) = resolve(&s.config.root_dir, &path) {
                if real.exists() {
                    if let Ok(entry) = build_entry(&s.config.root_dir, &real) {
                        if validate_access(&s, &claims.sub, &path, Permission::FileRead).await.is_ok() {
                            results.push(entry);
                        }
                    }
                }
            }
        }
    }

    Ok(Json(results))
}

pub async fn get_tags(
    State(s): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(q): Query<PathQuery>,
) -> Result<Json<FileMetadata>> {
    let path = normalize_virtual(&q.path.ok_or_else(|| AppError::BadRequest("path required".into()))?)?;
    validate_access(&s, &claims.sub, &path, Permission::FileRead).await?;

    let meta_path = s.config.root_dir.join(".fileflow/metadata.json");
    if !meta_path.exists() {
        return Ok(Json(FileMetadata::default()));
    }

    let _lock = s.metadata_lock.read().await;
    let content = fs::read_to_string(&meta_path).await?;
    let metadata: std::collections::HashMap<String, FileMetadata> = serde_json::from_str(&content)?;

    Ok(Json(metadata.get(&path).cloned().unwrap_or_default()))
}

pub async fn list_versions(
    State(s): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(q): Query<PathQuery>,
) -> Result<Json<Vec<VersionEntry>>> {
    let path = normalize_virtual(&q.path.ok_or_else(|| AppError::BadRequest("path required".into()))?)?;
    validate_access(&s, &claims.sub, &path, Permission::FileRead).await?;

    let rel_path = path.to_string();
    let path_hash = uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_DNS, rel_path.as_bytes()).to_string();
    let versions_dir = s.config.root_dir.join(".fileflow/versions").join(&path_hash);

    if !versions_dir.exists() {
        return Ok(Json(Vec::new()));
    }

    let mut versions = Vec::new();
    let mut rd = fs::read_dir(&versions_dir).await?;
    while let Some(e) = rd.next_entry().await? {
        let p = e.path();
        let meta = fs::metadata(&p).await?;
        let version_id = p.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        let timestamp = p.file_stem()
            .and_then(|s| s.to_str())
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(0);

        versions.push(VersionEntry {
            path: rel_path.clone(),
            version_id,
            timestamp: DateTime::<Utc>::from_timestamp(timestamp, 0).unwrap_or(Utc::now()),
            size: meta.len(),
        });
    }

    versions.sort_by_key(|x| std::cmp::Reverse(x.timestamp));
    Ok(Json(versions))
}

pub async fn restore_version(
    State(s): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<VersionRestoreRequest>,
) -> Result<Json<Value>> {
    let path = normalize_virtual(&req.path)?;
    validate_access(&s, &claims.sub, &path, Permission::FileWrite).await?;

    // Reject version_id that contains path separators to prevent traversal
    if req.version_id.contains('/') || req.version_id.contains('\\') || req.version_id.contains("..") {
        return Err(AppError::BadRequest("Invalid version id".into()));
    }

    let rel_path = path.clone();
    let path_hash = uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_DNS, rel_path.as_bytes()).to_string();
    let versions_base = s.config.root_dir.join(".fileflow/versions").join(&path_hash);
    let version_path = versions_base.join(&req.version_id);

    // Confirm the resolved path stays inside the expected directory
    let canonical_version = version_path.canonicalize()
        .map_err(|_| AppError::NotFound("Version not found".into()))?;
    let canonical_base = versions_base.canonicalize()
        .map_err(|_| AppError::NotFound("Version not found".into()))?;
    if !canonical_version.starts_with(&canonical_base) {
        return Err(AppError::BadRequest("Invalid version id".into()));
    }

    if !canonical_version.exists() {
        return Err(AppError::NotFound("Version not found".into()));
    }

    let dest = resolve(&s.config.root_dir, &path)?;

    // Archive current file before restoring
    if dest.exists() && dest.is_file() {
        let timestamp = Utc::now().timestamp_millis();
        let backup_path = versions_base.join(format!("{}.bak", timestamp));
        fs::rename(&dest, &backup_path).await?;
    }

    fs::rename(&canonical_version, &dest).await?;
    s.audit.log(&claims.sub, "restore_version", Some(path), None, Some(req.version_id)).await;

    Ok(Json(json!({ "restored": true })))
}

pub async fn list_trash(
    State(s): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Vec<TrashEntry>>> {
    let trash_json_path = s.config.root_dir.join(".fileflow/trash.json");
    if !trash_json_path.exists() {
        return Ok(Json(Vec::new()));
    }

    // Expiry below mutates trash.json — hold the lock across read + write.
    let _trash_guard = s.trash_lock.lock().await;
    let content = fs::read_to_string(&trash_json_path).await?;
    let mut entries: Vec<TrashEntry> = serde_json::from_str(&content)?;

    // Expire items older than 30 days
    let now = chrono::Utc::now();
    let trash_dir = s.config.root_dir.join(".fileflow/trash");
    let expired: Vec<String> = entries
        .iter()
        .filter(|e| (now - e.deleted_at).num_days() >= 30)
        .map(|e| e.id.clone())
        .collect();

    if !expired.is_empty() {
        for e in entries.iter().filter(|e| expired.contains(&e.id)) {
            let p = trash_dir.join(&e.id);
            if p.exists() {
                if p.is_dir() {
                    let _ = fs::remove_dir_all(&p).await;
                } else {
                    let _ = fs::remove_file(&p).await;
                }
            }
            if e.size > 0 {
                let _ = s.users.update_used_bytes(&e.username, -(e.size as i64)).await;
            }
        }
        entries.retain(|e| !expired.contains(&e.id));
        fs::write(&trash_json_path, serde_json::to_string_pretty(&entries)?).await?;
    }

    let is_admin = s.users.get(&claims.sub).await.map(|u| u.role == Role::Admin).unwrap_or(false);
    let filtered: Vec<TrashEntry> = entries
        .into_iter()
        .filter(|e| e.username == claims.sub || is_admin)
        .collect();

    Ok(Json(filtered))
}

pub async fn restore_trash(
    State(s): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<RestoreRequest>,
) -> Result<Json<Value>> {
    let trash_json_path = s.config.root_dir.join(".fileflow/trash.json");
    let _trash_guard = s.trash_lock.lock().await;
    let mut entries: Vec<TrashEntry> = if trash_json_path.exists() {
        let content = fs::read_to_string(&trash_json_path).await?;
        serde_json::from_str(&content)?
    } else {
        return Err(AppError::NotFound("Trash empty".into()));
    };

    let pos = entries.iter().position(|e| e.id == req.id)
        .ok_or_else(|| AppError::NotFound("Item not found in trash".into()))?;

    let entry = entries[pos].clone();
    let is_admin = s.users.get(&claims.sub).await.map(|u| u.role == Role::Admin).unwrap_or(false);
    if entry.username != claims.sub && !is_admin {
        return Err(AppError::Forbidden);
    }

    let trash_path = s.config.root_dir.join(".fileflow/trash").join(&entry.id);
    let dest = resolve(&s.config.root_dir, &entry.original_path)?;

    if dest.exists() {
        return Err(AppError::BadRequest("Original path already exists".into()));
    }

    fs::rename(&trash_path, &dest).await?;
    entries.remove(pos);

    fs::write(&trash_json_path, serde_json::to_string_pretty(&entries)?).await?;
    s.audit.log(&claims.sub, "restore", Some(entry.original_path), None, None).await;

    Ok(Json(json!({ "restored": true })))
}

pub async fn empty_trash(
    State(s): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<Value>> {
    // Only allow users to empty their own trash, or admins to empty all
    let trash_dir = s.config.root_dir.join(".fileflow/trash");
    let trash_json_path = s.config.root_dir.join(".fileflow/trash.json");

    let _trash_guard = s.trash_lock.lock().await;

    if s.users.get(&claims.sub).await.map(|u| u.role == Role::Admin).unwrap_or(false) {
        // Read entries before wiping so we can update per-user quota counts
        if trash_json_path.exists() {
            let content = fs::read_to_string(&trash_json_path).await?;
            let entries: Vec<TrashEntry> = serde_json::from_str(&content).unwrap_or_default();
            for e in &entries {
                if e.size > 0 {
                    let _ = s.users.update_used_bytes(&e.username, -(e.size as i64)).await;
                }
            }
            fs::remove_file(&trash_json_path).await?;
        }
        if trash_dir.exists() {
            fs::remove_dir_all(&trash_dir).await?;
        }
    } else {
        // User-specific empty trash
        if trash_json_path.exists() {
            let content = fs::read_to_string(&trash_json_path).await?;
            let mut entries: Vec<TrashEntry> = serde_json::from_str(&content)?;

            let to_remove: Vec<TrashEntry> = entries.iter()
                .filter(|e| e.username == claims.sub)
                .cloned()
                .collect();

            for e in &to_remove {
                let p = trash_dir.join(&e.id);
                if p.exists() {
                    if p.is_dir() {
                        let _ = fs::remove_dir_all(&p).await;
                    } else {
                        let _ = fs::remove_file(&p).await;
                    }
                }
                if e.size > 0 {
                    let _ = s.users.update_used_bytes(&e.username, -(e.size as i64)).await;
                }
            }

            entries.retain(|e| e.username != claims.sub);
            fs::write(&trash_json_path, serde_json::to_string_pretty(&entries)?).await?;
        }
    }

    let is_admin = s.users.get(&claims.sub).await.map(|u| u.role == Role::Admin).unwrap_or(false);
    s.audit.log(&claims.sub, "trash_empty", None, None, Some(if is_admin { "all trash" } else { "own trash" }.to_string())).await;

    Ok(Json(json!({ "emptied": true })))
}

pub async fn list_dir(
    State(s): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(q): Query<PathQuery>,
) -> Result<Json<DirectoryListing>> {
    let path = q.path.as_deref().unwrap_or("/");
    validate_access(&s, &claims.sub, path, Permission::FileRead).await?;

    let real = resolve(&s.config.root_dir, path)?;

    if !real.exists() || !real.is_dir() {
        return Err(AppError::NotFound(format!("Directory not found: {}", path)));
    }

    let mut entries = Vec::new();
    let mut rd = fs::read_dir(&real).await?;
    while let Some(e) = rd.next_entry().await? {
        let p = e.path();
        if p.file_name()
            .map(|n| n.to_string_lossy().starts_with('.'))
            .unwrap_or(false)
        {
            continue;
        }
        if let Ok(entry) = build_entry(&s.config.root_dir, &p) {
            entries.push(entry);
        }
    }

    entries.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    let vpath = virtual_path(&s.config.root_dir, &real);
    let parent = if real == s.config.root_dir {
        None
    } else {
        real.parent()
            .map(|p| virtual_path(&s.config.root_dir, p))
    };

    Ok(Json(DirectoryListing {
        path: vpath,
        entries,
        parent,
    }))
}

pub async fn download(
    State(s): State<AppState>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Query(q): Query<PathQuery>,
) -> Result<Response> {
    let path = q
        .path
        .ok_or_else(|| AppError::BadRequest("path required".into()))?;
    validate_access(&s, &claims.sub, &path, Permission::FileRead).await?;

    let real = resolve(&s.config.root_dir, &path)?;

    if !real.exists() || real.is_dir() {
        return Err(AppError::NotFound(format!("File not found: {}", path)));
    }

    let filename = real
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".into());

    let range = headers.get(header::RANGE).and_then(|v| v.to_str().ok());
    let response = serve_file_ranged(&real, content_disposition(&filename), None, range, None).await?;

    // Only audit full downloads to avoid a log entry per media seek/range request.
    if range.is_none() {
        s.audit.log(&claims.sub, "download", Some(path), None, None).await;
    }

    Ok(response)
}

pub async fn download_bulk(
    State(s): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(q): Query<Vec<(String, String)>>,
) -> Result<Response> {
    let paths: Vec<String> = q
        .iter()
        .filter(|(k, _)| k == "paths")
        .map(|(_, v)| v.clone())
        .collect();

    if paths.is_empty() {
        return Err(AppError::BadRequest("No paths provided".into()));
    }

    for path in &paths {
        validate_access(&s, &claims.sub, path, Permission::FileRead).await?;
    }

    // Resolve all requested paths up front (resolve() already rejects traversal
    // and top-level `.fileflow*` entries).
    let mut reals: Vec<PathBuf> = Vec::new();
    for path in &paths {
        let real = resolve(&s.config.root_dir, path)?;
        if real.exists() {
            reals.push(real);
        }
    }

    // Build the archive off the async runtime: zip creation is blocking CPU/IO
    // and could otherwise starve the executor. The archive is spooled to a temp
    // file and streamed out, so peak memory stays flat regardless of size; the
    // cumulative byte cap bounds temp disk usage and zip work per request.
    // Bound concurrent archive builds so parallel requests can't fill temp disk.
    let _permit = s
        .bulk_downloads
        .clone()
        .acquire_owned()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("bulk semaphore closed: {}", e)))?;

    let root = s.config.root_dir.clone();
    let tmp_dir = root.join(".fileflow/uploads");
    fs::create_dir_all(&tmp_dir).await?;
    let tmp_path = tmp_dir.join(format!("bulk-{}.zip.part", uuid::Uuid::new_v4().simple()));

    let build_result = {
        let tmp_path = tmp_path.clone();
        tokio::task::spawn_blocking(move || -> Result<()> {
            let out = std::fs::File::create(&tmp_path)?;
            let mut zip = ZipWriter::new(out);
            let mut total: u64 = 0;

            let add = |zip: &mut ZipWriter<std::fs::File>, real: &Path, zip_name: String, total: &mut u64| -> Result<()> {
                *total = total.saturating_add(std::fs::metadata(real).map(|m| m.len()).unwrap_or(0));
                if *total > MAX_BULK_BYTES {
                    return Err(AppError::BadRequest("Bulk download exceeds the maximum allowed size".into()));
                }
                zip.start_file(zip_name, zip::write::SimpleFileOptions::default()).map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
                let mut src = std::fs::File::open(real)?;
                std::io::copy(&mut src, zip)?;
                Ok(())
            };

            for real in &reals {
                if real.is_dir() {
                    for entry in WalkDir::new(real).into_iter().filter_map(|e| e.ok()) {
                        if !entry.path().is_file() {
                            continue;
                        }
                        let rel = entry.path().strip_prefix(&root).unwrap_or(entry.path());
                        // Never leak internal data (.fileflow/*, other dotfiles) into a bulk archive.
                        if is_internal_rel(rel) {
                            continue;
                        }
                        let zip_path = rel.to_string_lossy().replace('\\', "/");
                        add(&mut zip, entry.path(), zip_path, &mut total)?;
                    }
                } else {
                    let rel = real.strip_prefix(&root).unwrap_or(real.as_path());
                    if is_internal_rel(rel) {
                        continue;
                    }
                    let filename = real
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_else(|| "file".into());
                    add(&mut zip, real, filename, &mut total)?;
                }
            }

            zip.finish().map_err(|e| AppError::Internal(anyhow::anyhow!(e)))?;
            Ok(())
        })
        .await
        .map_err(|e| AppError::Internal(e.into()))?
    };
    if let Err(e) = build_result {
        let _ = fs::remove_file(&tmp_path).await;
        return Err(e);
    }

    // Open the finished archive, then unlink it immediately: the open handle
    // keeps the data alive until streaming completes, and nothing is left on
    // disk afterwards (even if the client disconnects mid-stream).
    let file = fs::File::open(&tmp_path).await?;
    let len = file.metadata().await?.len();
    let _ = fs::remove_file(&tmp_path).await;
    // Archive is built and unlinked (data lives in the open fd) — release the
    // build slot before the potentially long streaming phase.
    drop(_permit);

    let mut headers = HeaderMap::new();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("application/zip"));
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_static("attachment; filename=\"files.zip\""),
    );
    headers.insert(header::CONTENT_LENGTH, HeaderValue::from(len));

    let body = Body::from_stream(ReaderStream::new(file));
    s.audit.log(&claims.sub, "download_bulk", Some(format!("{} files", paths.len())), None, None).await;

    Ok((StatusCode::OK, headers, body).into_response())
}

pub async fn preview(
    State(s): State<AppState>,
    Extension(claims): Extension<Claims>,
    headers: HeaderMap,
    Query(q): Query<PathQuery>,
) -> Result<Response> {
    let path = q
        .path
        .ok_or_else(|| AppError::BadRequest("path required".into()))?;
    validate_access(&s, &claims.sub, &path, Permission::FileRead).await?;

    let real = resolve(&s.config.root_dir, &path)?;

    if !real.exists() || real.is_dir() {
        return Err(AppError::NotFound(format!("File not found: {}", path)));
    }

    // Files a browser would execute (HTML/SVG/XML/…) are downgraded to inert
    // text/plain so an uploaded file cannot run script in our origin when
    // previewed. Other types keep their detected MIME for normal rendering.
    let override_ct = if is_active_content(&real) {
        Some("text/plain; charset=utf-8")
    } else {
        None
    };

    let range = headers.get(header::RANGE).and_then(|v| v.to_str().ok());
    let response = serve_file_ranged(&real, "inline".to_string(), Some("private, max-age=300"), range, override_ct).await?;

    if range.is_none() {
        s.audit.log(&claims.sub, "preview", Some(path), None, None).await;
    }

    Ok(response)
}

pub async fn upload(
    State(s): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(q): Query<PathQuery>,
    mut multipart: Multipart,
) -> Result<Json<Value>> {
    let path = q.path.as_deref().unwrap_or("/");
    validate_access(&s, &claims.sub, path, Permission::FileWrite).await?;

    let dir = resolve(&s.config.root_dir, path)?;

    if !dir.is_dir() {
        return Err(AppError::BadRequest("Target is not a directory".into()));
    }

    // Snapshot the uploader's quota allowance once; enforce it across all files
    // in this request as bytes stream in (the old code passed 0 here, so quota
    // was never actually enforced on upload).
    let uploader = s.users.get(&claims.sub).await.ok_or(AppError::Unauthorized)?;
    let quota_gb = uploader.quota_gb;
    let base_used = uploader.used_bytes;
    let mut committed: u64 = 0;

    let mut uploaded: Vec<String> = Vec::new();

    while let Some(mut field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?
    {
        let filename = match field.file_name() {
            Some(n) => n.to_string(),
            None => continue,
        };
        let safe = sanitize_name(&filename);
        if safe.is_empty() {
            continue;
        }

        // Check extension blocklist
        if is_blocked_extension(&safe) {
            let ext = std::path::Path::new(&safe)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            return Err(AppError::BadRequest(format!(
                "File type '{}' is not allowed",
                ext
            )));
        }

        let dest = dir.join(&safe);

        // Versioning: if file exists, archive the old one
        if let Some(ts) = archive_existing_version(&s.config.root_dir, &dest).await? {
            let rel_path = virtual_path(&s.config.root_dir, &dest);
            s.audit.log(&claims.sub, "version_archive", Some(rel_path), None, Some(format!("version: {}", ts))).await;
        }

        let mut file = fs::File::create(&dest).await?;
        let mut bytes_written: usize = 0;

        loop {
            match field.chunk().await {
                Ok(Some(chunk)) => {
                    bytes_written += chunk.len();
                    if bytes_written > s.config.max_upload_size {
                        drop(file);
                        let _ = fs::remove_file(&dest).await;
                        return Err(AppError::BadRequest(format!(
                            "'{}' exceeds max upload size",
                            safe
                        )));
                    }
                    // Enforce the storage quota across everything uploaded so far
                    // in this request, not just per file.
                    if over_quota(quota_gb, base_used, committed + bytes_written as u64) {
                        drop(file);
                        let _ = fs::remove_file(&dest).await;
                        return Err(AppError::BadRequest("Quota exceeded".into()));
                    }
                    file.write_all(&chunk).await?;
                }
                Ok(None) => break,
                Err(e) => {
                    drop(file);
                    let _ = fs::remove_file(&dest).await;
                    return Err(AppError::BadRequest(e.to_string()));
                }
            }
        }
        file.flush().await?;

        uploaded.push(safe.clone());
        committed += bytes_written as u64;

        s.users.update_used_bytes(&claims.sub, bytes_written as i64).await?;
        s.audit.log(&claims.sub, "upload", Some(format!("{}/{}", path, safe)), None, None).await;
    }

    Ok(Json(json!({ "uploaded": uploaded, "count": uploaded.len() })))
}

pub async fn mkdir(
    State(s): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<MkdirRequest>,
) -> Result<Json<Value>> {
    validate_access(&s, &claims.sub, &req.path, Permission::FileWrite).await?;

    let safe = sanitize_name(&req.name);
    if safe.is_empty() {
        return Err(AppError::BadRequest("Invalid directory name".into()));
    }

    let parent = resolve(&s.config.root_dir, &req.path)?;
    let new_dir = parent.join(&safe);

    if new_dir.exists() {
        return Err(AppError::BadRequest(format!("'{}' already exists", safe)));
    }

    fs::create_dir(&new_dir).await?;

    s.audit.log(&claims.sub, "mkdir", Some(virtual_path(&s.config.root_dir, &new_dir)), None, None).await;

    Ok(Json(json!({
        "path": virtual_path(&s.config.root_dir, &new_dir),
        "name": safe,
    })))
}

pub async fn rename(
    State(s): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<RenameRequest>,
) -> Result<Json<Value>> {
    validate_access(&s, &claims.sub, &req.old_path, Permission::FileWrite).await?;

    let real_old = resolve(&s.config.root_dir, &req.old_path)?;
    if !real_old.exists() {
        return Err(AppError::NotFound(format!("Not found: {}", req.old_path)));
    }

    let safe = sanitize_name(&req.new_name);
    if safe.is_empty() {
        return Err(AppError::BadRequest("Invalid name".into()));
    }

    let parent = real_old
        .parent()
        .ok_or_else(|| AppError::BadRequest("Cannot rename root".into()))?;
    let new_path = parent.join(&safe);

    if new_path.exists() {
        return Err(AppError::BadRequest(format!("'{}' already exists", safe)));
    }

    let old_vpath = virtual_path(&s.config.root_dir, &real_old);
    fs::rename(&real_old, &new_path).await?;

    // Grants, stars and tags follow the resource: re-point internal shares,
    // shared folders, favorites, public links and metadata so they don't dangle on the old path (and silently
    // attach to whatever is created there next).
    let new_vpath = virtual_path(&s.config.root_dir, &new_path);
    s.internal_shares.rebase_path(&old_vpath, &new_vpath).await;
    s.collab.rebase_path(&old_vpath, &new_vpath).await;
    s.favorites.rebase_path(&old_vpath, &new_vpath).await;
    s.shares.rebase_path(&old_vpath, &new_vpath).await;
    s.upload_requests.rebase_path(&old_vpath, &new_vpath).await;
    update_metadata(&s, |m| rebase_metadata_keys(m, &old_vpath, &new_vpath)).await;

    s.audit.log(&claims.sub, "rename", Some(old_vpath), None, Some(format!("to: {}", safe))).await;

    Ok(Json(json!({
        "path": virtual_path(&s.config.root_dir, &new_path),
        "name": safe,
    })))
}

pub async fn delete(
    State(s): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<DeleteRequest>,
) -> Result<Json<Value>> {
    let mut deleted: Vec<String> = Vec::new();
    let trash_dir = s.config.root_dir.join(".fileflow/trash");
    fs::create_dir_all(&trash_dir).await?;

    // Serialize trash.json read-modify-write against concurrent trash operations.
    let _trash_guard = s.trash_lock.lock().await;

    for path in &req.paths {
        validate_access(&s, &claims.sub, path, Permission::FileDelete).await?;

        let real = resolve(&s.config.root_dir, path)?;

        if real == s.config.root_dir {
            return Err(AppError::Forbidden);
        }

        if !real.exists() {
            continue;
        }

        // Normalize the virtual path so store purges and the trash record use
        // the same form regardless of how the client spelled the request path.
        let vpath = virtual_path(&s.config.root_dir, &real);

        // Move to trash instead of permanent deletion. Directories record their
        // recursive content size so quota is credited back when the trash entry
        // is permanently removed.
        let trash_id = uuid::Uuid::new_v4().to_string();
        let trash_path = trash_dir.join(&trash_id);
        let item_size = if real.is_file() {
            fs::metadata(&real).await?.len()
        } else {
            dir_size(real.clone()).await?
        };

        fs::rename(&real, &trash_path).await?;

        // Record in trash.json
        let trash_json_path = s.config.root_dir.join(".fileflow/trash.json");
        let mut trash_entries: Vec<crate::models::TrashEntry> = if trash_json_path.exists() {
            let content = fs::read_to_string(&trash_json_path).await.unwrap_or_default();
            serde_json::from_str(&content).unwrap_or_default()
        } else {
            Vec::new()
        };

        trash_entries.push(crate::models::TrashEntry {
            id: trash_id,
            original_path: vpath.clone(),
            deleted_at: Utc::now(),
            username: claims.sub.clone(),
            size: item_size,
        });

        fs::write(&trash_json_path, serde_json::to_string_pretty(&trash_entries)?).await?;

        // Drop grants, stars and tags that pointed at the now-trashed resource.
        s.internal_shares.purge_under(&vpath).await;
        s.collab.purge_under(&vpath).await;
        s.favorites.purge_under(&vpath).await;
        s.shares.purge_under(&vpath).await;
        s.upload_requests.purge_under(&vpath).await;
        update_metadata(&s, |m| purge_metadata_keys(m, &vpath)).await;

        s.audit.log(&claims.sub, "trash", Some(vpath), None, None).await;
        deleted.push(path.clone());
    }

    Ok(Json(json!({ "deleted": deleted, "count": deleted.len() })))
}

pub async fn move_items(
    State(s): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<MoveRequest>,
) -> Result<Json<Value>> {
    validate_access(&s, &claims.sub, &req.destination, Permission::FileWrite).await?;

    let dest = resolve(&s.config.root_dir, &req.destination)?;

    if !dest.is_dir() {
        return Err(AppError::BadRequest("Destination must be a directory".into()));
    }

    let mut moved: Vec<String> = Vec::new();

    for path in &req.paths {
        validate_access(&s, &claims.sub, path, Permission::FileWrite).await?;

        let src = resolve(&s.config.root_dir, path)?;
        let fname = src
            .file_name()
            .ok_or_else(|| AppError::BadRequest("Invalid source path".into()))?;
        let target = dest.join(fname);

        if target.exists() {
            return Err(AppError::BadRequest(format!(
                "'{}' already exists in destination",
                fname.to_string_lossy()
            )));
        }

        let old_vpath = virtual_path(&s.config.root_dir, &src);
        fs::rename(&src, &target).await?;

        // Re-point grants, stars and tags at the new location (see rename()).
        let new_vpath = virtual_path(&s.config.root_dir, &target);
        s.internal_shares.rebase_path(&old_vpath, &new_vpath).await;
        s.collab.rebase_path(&old_vpath, &new_vpath).await;
        s.favorites.rebase_path(&old_vpath, &new_vpath).await;
        s.shares.rebase_path(&old_vpath, &new_vpath).await;
        s.upload_requests.rebase_path(&old_vpath, &new_vpath).await;
        update_metadata(&s, |m| rebase_metadata_keys(m, &old_vpath, &new_vpath)).await;

        s.audit.log(&claims.sub, "move", Some(old_vpath), None, Some(format!("to: {}", req.destination))).await;
        moved.push(path.clone());
    }

    Ok(Json(json!({ "moved": moved, "count": moved.len() })))
}

pub async fn search(
    State(s): State<AppState>,
    Extension(claims): Extension<Claims>,
    Query(q): Query<SearchQuery>,
) -> Result<Json<Vec<FileEntry>>> {
    let path = q.path.as_deref().unwrap_or("/");
    validate_access(&s, &claims.sub, path, Permission::FileRead).await?;

    if q.q.len() < 2 {
        return Err(AppError::BadRequest("Query too short (min 2 chars)".into()));
    }

    // Collect allowed paths for per-result filtering.
    // Empty means no path restriction (admin or user in groups with no allowed_paths set).
    let user = s.users.get(&claims.sub).await.ok_or(AppError::Unauthorized)?;
    let restricted_paths: Vec<String> = if user.role == Role::Admin {
        vec![]
    } else {
        let groups = s.users.list_groups().await;
        groups
            .into_iter()
            .filter(|g| user.groups.contains(&g.id))
            .flat_map(|g| g.allowed_paths.clone())
            .collect()
    };
    // Same rule as validate_access: canonical prefixes, case-sensitive match.
    // Non-empty input with no valid entry must still restrict (fail closed).
    let restricted = !restricted_paths.is_empty();
    let allowed_prefixes: Vec<String> = restricted_paths.iter().filter_map(|p| canonical_prefix(p)).collect();

    let search_root = resolve(&s.config.root_dir, q.path.as_deref().unwrap_or("/"))?;
    let query = q.q.to_lowercase();
    let root = s.config.root_dir.clone();
    let do_full_text = q.full_text.unwrap_or(false);

    let results = tokio::task::spawn_blocking(move || {
        let mut hits = Vec::new();
        for entry in WalkDir::new(&search_root)
            .max_depth(8)
            .into_iter()
            .filter_map(|e| e.ok())
            .take(2000)
        {
            let name = entry.file_name().to_string_lossy().to_lowercase();
            if name.starts_with('.') {
                continue;
            }
            let raw_vpath = virtual_path(&root, entry.path());
            let vpath = raw_vpath.to_lowercase();

            // Enforce per-result path restrictions so symlinks or other traversals
            // cannot expose files outside the user's allowed paths.
            if restricted && !allowed_prefixes.iter().any(|p| path_covers(p, &raw_vpath)) {
                continue;
            }

            let name_match = name.contains(&query) || vpath.contains(&query);

            let content_match = if !name_match && do_full_text && !entry.path().is_dir() {
                let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
                if size > 0 && size < 1024 * 1024 {
                    let mime = mime_guess::from_path(entry.path())
                        .first_or_octet_stream()
                        .to_string();
                    let is_text = mime.starts_with("text/")
                        || mime.contains("json")
                        || mime.contains("xml")
                        || mime.contains("javascript")
                        || mime.contains("yaml")
                        || mime.contains("toml")
                        || mime.contains("csv");
                    if is_text {
                        std::fs::read_to_string(entry.path())
                            .map(|c| c.to_lowercase().contains(&query))
                            .unwrap_or(false)
                    } else {
                        false
                    }
                } else {
                    false
                }
            } else {
                false
            };

            if name_match || content_match {
                if let Ok(fe) = build_entry(&root, entry.path()) {
                    hits.push(fe);
                }
            }
            if hits.len() >= 100 {
                break;
            }
        }
        hits
    })
    .await
    .map_err(|e| AppError::Internal(e.into()))?;

    Ok(Json(results))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn setup_root() -> TempDir {
        tempfile::tempdir().unwrap()
    }

    fn tagged(tag: &str) -> FileMetadata {
        FileMetadata { tags: vec![tag.to_string()], ..Default::default() }
    }

    #[test]
    fn rebase_metadata_follows_rename_and_descendants() {
        let mut m = std::collections::HashMap::new();
        m.insert("/proj".to_string(), tagged("a"));
        m.insert("/proj/doc.txt".to_string(), tagged("b"));
        m.insert("/projects".to_string(), tagged("c"));
        m.insert("/renamed".to_string(), tagged("stale"));

        assert!(rebase_metadata_keys(&mut m, "/proj", "/renamed"));
        assert_eq!(m["/renamed"].tags, vec!["a"]);
        assert_eq!(m["/renamed/doc.txt"].tags, vec!["b"]);
        assert!(!m.contains_key("/proj") && !m.contains_key("/proj/doc.txt"));
        // Prefix boundary respected.
        assert_eq!(m["/projects"].tags, vec!["c"]);
        assert!(!rebase_metadata_keys(&mut m, "/missing", "/x"));
    }

    #[test]
    fn purge_metadata_removes_path_and_descendants_only() {
        let mut m = std::collections::HashMap::new();
        m.insert("/proj".to_string(), tagged("a"));
        m.insert("/proj/doc.txt".to_string(), tagged("b"));
        m.insert("/projects".to_string(), tagged("c"));

        assert!(purge_metadata_keys(&mut m, "/proj"));
        assert_eq!(m.len(), 1);
        assert!(m.contains_key("/projects"));
        assert!(!purge_metadata_keys(&mut m, "/proj"));
    }

    #[test]
    fn normal_path_resolves() {
        let dir = setup_root();
        let result = resolve(dir.path(), "/somefile.txt");
        assert!(result.is_ok());
    }

    #[test]
    fn traversal_blocked() {
        let dir = setup_root();
        assert!(resolve(dir.path(), "../../etc/passwd").is_err());
    }

    #[test]
    fn fileflow_file_blocked() {
        let dir = setup_root();
        assert!(resolve(dir.path(), "/.fileflow_users.json").is_err());
    }

    #[test]
    fn root_itself_allowed() {
        let dir = setup_root();
        assert!(resolve(dir.path(), "/").is_ok());
    }

    #[test]
    fn blocked_extension_rejected() {
        let blocked = ["evil.exe", "script.sh", "run.bat", "code.php"];
        for name in blocked {
            let ext = std::path::Path::new(name)
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_lowercase())
                .unwrap_or_default();
            assert!(BLOCKED_EXTENSIONS.contains(&ext.as_str()), "{} should be blocked", name);
        }
    }

    fn as_range(spec: RangeSpec) -> Option<(u64, u64)> {
        match spec {
            RangeSpec::Range(s, e) => Some((s, e)),
            _ => None,
        }
    }

    #[test]
    fn range_full_open_ended() {
        assert_eq!(as_range(parse_range("bytes=0-", 1000)), Some((0, 999)));
    }

    #[test]
    fn range_explicit_window() {
        assert_eq!(as_range(parse_range("bytes=200-499", 1000)), Some((200, 499)));
    }

    #[test]
    fn range_suffix() {
        assert_eq!(as_range(parse_range("bytes=-100", 1000)), Some((900, 999)));
    }

    #[test]
    fn range_clamps_end_to_size() {
        assert_eq!(as_range(parse_range("bytes=500-99999", 1000)), Some((500, 999)));
    }

    #[test]
    fn range_start_past_end_unsatisfiable() {
        assert!(matches!(parse_range("bytes=2000-3000", 1000), RangeSpec::Unsatisfiable));
    }

    #[test]
    fn range_non_bytes_unit_ignored() {
        assert!(matches!(parse_range("items=0-10", 1000), RangeSpec::None));
    }

    #[test]
    fn safe_extension_allowed() {
        let safe = ["photo.jpg", "doc.pdf", "archive.zip", "notes.txt"];
        for name in safe {
            let ext = std::path::Path::new(name)
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_lowercase())
                .unwrap_or_default();
            assert!(!BLOCKED_EXTENSIONS.contains(&ext.as_str()), "{} should be allowed", name);
        }
    }

    #[test]
    fn is_blocked_extension_is_case_insensitive() {
        assert!(is_blocked_extension("virus.EXE"));
        assert!(is_blocked_extension("a.Sh"));
        assert!(!is_blocked_extension("report.PDF"));
        assert!(!is_blocked_extension("noext"));
    }

    #[test]
    fn sanitize_name_strips_separators_and_dotfiles() {
        assert_eq!(sanitize_name("a/b\\c"), "a_b_c");
        assert_eq!(sanitize_name("  spaced.txt  "), "spaced.txt");
        // leading dots/spaces are trimmed (no hidden files, no "..")
        assert_eq!(sanitize_name("..hidden"), "hidden");
        assert_eq!(sanitize_name("...."), "");
        // each illegal character becomes its own underscore
        assert_eq!(sanitize_name("a:b*c|d"), "a_b_c_d");
        assert_eq!(sanitize_name("q?\"x"), "q__x");
        // a path-traversal attempt cannot survive sanitization
        assert!(!sanitize_name("../../etc/passwd").contains('/'));
    }

    #[test]
    fn sanitize_name_strips_control_chars() {
        // Newlines/CR/tab/NUL would corrupt Content-Disposition headers downstream.
        assert_eq!(sanitize_name("evil\n.txt"), "evil_.txt");
        assert_eq!(sanitize_name("a\r\nb\tc\0d.bin"), "a__b_c_d.bin");
        let out = sanitize_name("x\u{7f}\u{1b}[31m.log"); // DEL + ESC
        assert!(!out.chars().any(|c| c.is_control()));
    }

    #[test]
    fn content_disposition_ascii_and_unicode() {
        let cd = content_disposition("hello world.txt");
        assert!(cd.starts_with("attachment; filename=\"hello world.txt\""));
        assert!(cd.contains("filename*=UTF-8''hello%20world.txt"));

        // Non-ASCII names get an underscore ASCII fallback + percent-encoded form.
        let cd = content_disposition("résumé.pdf");
        assert!(cd.contains("filename=\"r_sum_.pdf\""));
        assert!(cd.contains("filename*=UTF-8''r%C3%A9sum%C3%A9.pdf"));
        // no raw quotes/newlines that could break the header
        assert!(!cd.contains('\n'));
    }

    #[test]
    fn virtual_path_roundtrips_under_root() {
        let root = std::path::Path::new("/srv/data");
        assert_eq!(virtual_path(root, std::path::Path::new("/srv/data/a/b.txt")), "/a/b.txt");
        assert_eq!(virtual_path(root, root), "/");
    }

    #[test]
    fn resolve_rejects_dot_dot_escape_variants() {
        let dir = setup_root();
        assert!(resolve(dir.path(), "/a/../../etc").is_err());
        // Even an in-root `..` is refused: authorization is string-based, so a
        // path that names one place and resolves to another must never resolve.
        assert!(resolve(dir.path(), "/sub/../sub2/ok.txt").is_err());
        assert!(resolve(dir.path(), "/sub/./sub2//ok.txt").is_ok());
        // internal data files stay protected even via nested paths
        assert!(resolve(dir.path(), "/sub/.fileflow_users.json").is_err());
    }

    #[test]
    fn normalize_virtual_canonicalizes_and_rejects_parent_segments() {
        assert_eq!(normalize_virtual("/").unwrap(), "/");
        assert_eq!(normalize_virtual("").unwrap(), "/");
        assert_eq!(normalize_virtual("docs/report.txt").unwrap(), "/docs/report.txt");
        assert_eq!(normalize_virtual("//teamA/./x//").unwrap(), "/teamA/x");
        // The H1 bypass shapes: each would pass a `/teamA/` prefix check.
        for p in ["/teamA/../teamB/secret", "/teamA/..", "..", "/a/b/../../c", "/teamA/./../teamB"] {
            assert!(normalize_virtual(p).is_err(), "{} must be rejected", p);
        }
        // `..` only as a whole segment; names merely containing dots are fine.
        assert_eq!(normalize_virtual("/a/..b/c..").unwrap(), "/a/..b/c..");
    }

    #[test]
    fn path_covers_respects_segment_boundaries() {
        assert!(path_covers("/proj", "/proj"));
        assert!(path_covers("/proj", "/proj/a/b"));
        assert!(!path_covers("/proj", "/projects"));
        assert!(!path_covers("/proj", "/"));
        assert!(path_covers("/", "/anything"));
    }

    #[test]
    fn canonical_prefix_honors_only_canonical_legacy_entries() {
        assert_eq!(canonical_prefix("/teamA").as_deref(), Some("/teamA"));
        assert_eq!(canonical_prefix("/teamA/").as_deref(), Some("/teamA"));
        assert_eq!(canonical_prefix("/").as_deref(), Some("/"));
        // Malformed entries must not widen to the root (or to anything).
        for p in [".", "./", "//", "", "teamA", "/a//b", "/teamA/../teamB"] {
            assert_eq!(canonical_prefix(p), None, "{:?} must grant nothing", p);
        }
    }

    #[test]
    fn resolve_blocks_nested_fileflow_directory() {
        let dir = setup_root();
        // The internal data dir must be unreachable at any depth — this is the
        // path that previously slipped through (only the final component was checked).
        assert!(resolve(dir.path(), "/.fileflow/versions/abc/1.bak").is_err());
        assert!(resolve(dir.path(), "/.fileflow/trash/some-id").is_err());
        assert!(resolve(dir.path(), "/.fileflow_secret").is_err());
        // A normal nested file is still fine.
        assert!(resolve(dir.path(), "/docs/report.txt").is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn resolve_rejects_symlink_escaping_root() {
        let root = setup_root();
        let outside = setup_root();
        std::fs::write(outside.path().join("secret.txt"), b"top secret").unwrap();

        // A symlink inside the root pointing outside must be refused once the
        // target exists (resolve canonicalizes existing paths).
        std::os::unix::fs::symlink(outside.path().join("secret.txt"), root.path().join("link.txt")).unwrap();
        assert!(resolve(root.path(), "/link.txt").is_err());

        // A symlinked directory escaping the root is refused too.
        std::os::unix::fs::symlink(outside.path(), root.path().join("dir")).unwrap();
        assert!(resolve(root.path(), "/dir/secret.txt").is_err());

        // A symlink to a sibling *inside* the root is fine.
        std::fs::write(root.path().join("real.txt"), b"ok").unwrap();
        std::os::unix::fs::symlink(root.path().join("real.txt"), root.path().join("alias.txt")).unwrap();
        assert!(resolve(root.path(), "/alias.txt").is_ok());

        // A symlink into .fileflow internals is refused even though it stays in-root.
        std::fs::create_dir_all(root.path().join(".fileflow/trash")).unwrap();
        std::fs::write(root.path().join(".fileflow/trash/x"), b"hidden").unwrap();
        std::os::unix::fs::symlink(root.path().join(".fileflow/trash/x"), root.path().join("peek.txt")).unwrap();
        assert!(resolve(root.path(), "/peek.txt").is_err());
    }

    #[test]
    fn is_internal_rel_flags_dotfiles_and_fileflow() {
        assert!(is_internal_rel(Path::new(".fileflow/versions/x")));
        assert!(is_internal_rel(Path::new("docs/.hidden")));
        assert!(is_internal_rel(Path::new(".secret")));
        assert!(!is_internal_rel(Path::new("docs/report.txt")));
        assert!(!is_internal_rel(Path::new("a/b/c.png")));
    }

    #[test]
    fn is_active_content_flags_renderable_types() {
        for n in ["evil.html", "x.HTM", "logo.svg", "data.xml", "p.xhtml", "a.mhtml"] {
            assert!(is_active_content(Path::new(n)), "{} should be treated as active content", n);
        }
        for n in ["photo.jpg", "doc.pdf", "notes.txt", "sheet.csv", "clip.mp4"] {
            assert!(!is_active_content(Path::new(n)), "{} should render normally", n);
        }
    }

    #[test]
    fn over_quota_math() {
        // No quota → never over.
        assert!(!over_quota(None, u64::MAX, u64::MAX));
        // 1 GiB quota.
        let one_gib = 1024 * 1024 * 1024;
        assert!(!over_quota(Some(1.0), 0, one_gib));            // exactly at the limit is allowed
        assert!(over_quota(Some(1.0), 0, one_gib + 1));         // one byte over
        assert!(over_quota(Some(1.0), one_gib, 1));             // already full
        assert!(!over_quota(Some(2.0), one_gib, one_gib));      // within a larger quota
        // Saturating add must not panic/overflow.
        assert!(over_quota(Some(0.001), u64::MAX, u64::MAX));
    }
}
