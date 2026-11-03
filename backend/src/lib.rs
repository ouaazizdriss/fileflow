//! FileFlow library crate. Exposes the modules both to the binary (`main.rs`,
//! which just calls `run()`) and to the fuzz targets in `fuzz/`.
pub mod admin;
pub mod audit;
pub mod auth;
pub mod collab;
pub mod db;
pub mod error;
pub mod favorites;
pub mod files;
pub mod internal_shares;
pub mod models;
pub mod ratelimit;
pub mod shares;
pub mod totp;
pub mod two_factor;
pub mod upload_requests;
pub mod uploads;
pub mod users;

use std::{net::SocketAddr, path::{Path, PathBuf}, sync::Arc, time::Duration};
use tokio::sync::RwLock;

use audit::AuditLogger;
use auth::COOKIE_NAME;
use axum::{
    extract::{ConnectInfo, Request, State},
    http::{header, HeaderName, HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Json, Response},
    routing::{delete, get, post, put},
    Extension, Router,
};
use axum_extra::extract::{
    cookie::{Cookie, SameSite},
    CookieJar,
};
use models::{LoginRequest, Role, UserInfo};
use serde_json::json;
use collab::CollabStore;
use favorites::FavoriteStore;
use internal_shares::InternalShareStore;
use shares::ShareStore;
use upload_requests::UploadRequestStore;
use users::UserStore;
use tower_http::{
    compression::CompressionLayer,
    trace::TraceLayer,
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::error::{AppError, Result};

#[derive(Clone)]
pub struct Config {
    pub root_dir: PathBuf,
    pub jwt_secret: String,
    pub max_upload_size: usize,
    /// Cap for anonymous uploads through a public upload request, independent of
    /// (and never above) the authenticated limit.
    pub public_upload_max_size: usize,
    /// Honor `X-Forwarded-For`/`X-Real-IP` (only when behind a trusted proxy).
    pub trust_proxy: bool,
    /// Set the `Secure` attribute on auth cookies (must be true behind TLS).
    pub cookie_secure: bool,
}

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub users: UserStore,
    pub audit: AuditLogger,
    pub shares: ShareStore,
    pub collab: CollabStore,
    pub internal_shares: InternalShareStore,
    pub favorites: FavoriteStore,
    pub upload_requests: UploadRequestStore,
    pub upload_sessions: uploads::UploadSessions,
    pub metadata_lock: Arc<RwLock<()>>,
    /// Serializes read-modify-write cycles on `.fileflow/trash.json` (delete,
    /// restore, empty, expiry) so concurrent operations can't lose entries.
    pub trash_lock: Arc<tokio::sync::Mutex<()>>,
    pub ip_limiter: ratelimit::Limiter,
    /// Per-account lockout across all IPs, at the higher
    /// `ratelimit::ACCOUNT_MAX_ATTEMPTS` threshold.
    pub user_limiter: ratelimit::Limiter,
    /// Per-(username, IP) lockout at the normal threshold: stops one client
    /// guessing an account without letting it lock the account for others.
    pub user_ip_limiter: ratelimit::Limiter,
    /// Brute-force lockout for the TOTP/2FA verification step (keyed by username).
    pub totp_limiter: ratelimit::Limiter,
    /// Brute-force lockout for passwords on public share and upload links
    /// (keyed by link and by client IP, see `ratelimit::link_keys`).
    pub link_limiter: ratelimit::Limiter,
    /// Caps concurrent bulk (zip) downloads. Each builds a temp archive on disk,
    /// so this bounds peak temp-disk usage regardless of how many clients ask.
    pub bulk_downloads: Arc<tokio::sync::Semaphore>,
}

// ─── Auth handlers ────────────────────────────────────────────────────────────

async fn login(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    jar: CookieJar,
    headers: axum::http::HeaderMap,
    Json(req): Json<LoginRequest>,
) -> Result<(CookieJar, Json<serde_json::Value>)> {
    // Resolve the client IP: proxy headers are only trusted when configured,
    // otherwise fall back to the real socket peer (un-spoofable).
    let ip = audit::extract_ip(&headers, state.config.trust_proxy)
        .or_else(|| Some(peer.ip().to_string()));
    let ip_key = ip.clone().unwrap_or_else(|| "unknown".to_string());

    // Reject early if either the IP or the username is currently locked out.
    if ratelimit::locked(&state.ip_limiter, &ip_key).await {
        state.audit.log(&req.username, "login_blocked_ip", None, ip.clone(), None).await;
        return Err(AppError::TooManyRequests);
    }
    let user_ip_key = ratelimit::user_ip_key(&req.username, &ip_key);
    if ratelimit::locked(&state.user_ip_limiter, &user_ip_key).await
        || ratelimit::locked(&state.user_limiter, &req.username).await
    {
        state.audit.log(&req.username, "login_blocked_user", None, ip.clone(), None).await;
        return Err(AppError::TooManyRequests);
    }

    // Verify the password. For an unknown username we still run a bcrypt
    // operation so the response time doesn't reveal whether the account exists.
    let maybe_user = state.users.get(&req.username).await;
    let valid = match &maybe_user {
        Some(user) => bcrypt::verify(&req.password, &user.password_hash)
            .map_err(|e| AppError::Internal(anyhow::anyhow!("bcrypt: {}", e)))?,
        None => {
            let _ = bcrypt::hash(&req.password, bcrypt::DEFAULT_COST);
            false
        }
    };

    if !valid {
        // Count the failure against the IP, the (username, IP) pair and the
        // account, locking out unknown users identically so the limiter can't
        // be used to enumerate.
        ratelimit::record_failure(&state.ip_limiter, &ip_key).await;
        ratelimit::record_failure(&state.user_ip_limiter, &user_ip_key).await;
        ratelimit::record_failure_max(&state.user_limiter, &req.username, ratelimit::ACCOUNT_MAX_ATTEMPTS).await;
        state.audit.log(&req.username, "login_failed", None, ip.clone(), Some("invalid credentials".to_string())).await;
        return Err(AppError::Unauthorized);
    }

    let user = maybe_user.expect("valid implies the user exists");

    if user.status == models::UserStatus::Disabled {
        state.audit.log(&req.username, "login_failed", None, ip.clone(), Some("account disabled".to_string())).await;
        return Err(AppError::Unauthorized);
    }

    // Check if 2FA is enabled for this user
    if user.totp_enabled {
        // Issue a short-lived pending token for 2FA challenge
        let pending_token = auth::create_pending_token(&req.username, &state.config.jwt_secret)
            .map_err(AppError::Internal)?;

        let cookie = Cookie::build((auth::TOTP_PENDING_COOKIE_NAME, pending_token))
            .http_only(true)
            .secure(state.config.cookie_secure)
            .same_site(SameSite::Strict)
            .path("/")
            .max_age(time::Duration::seconds(300))
            .build();

        state.audit.log(&req.username, "login_2fa_required", None, ip, None).await;

        return Ok((
            jar.add(cookie),
            Json(serde_json::json!({ "requires_2fa": true })),
        ));
    }

    // No 2FA - proceed with normal login
    let role_str = user.role.to_string();
    let token = auth::create_token(&req.username, &role_str, user.token_version, &state.config.jwt_secret)
        .map_err(AppError::Internal)?;

    let permissions = state.users.get_resolved_permissions(&req.username).await;

    state.audit.log(&req.username, "login", None, ip.clone(), None).await;

    // Clear rate limiting counters on successful login
    // The account-wide count is left to expire on its own: a successful login
    // in between mustn't reset the budget of someone guessing from many IPs.
    ratelimit::clear(&state.ip_limiter, &ip_key).await;
    ratelimit::clear(&state.user_ip_limiter, &user_ip_key).await;

    let cookie = Cookie::build((COOKIE_NAME, token))
        .http_only(true)
        .secure(state.config.cookie_secure)
        .same_site(SameSite::Strict)
        .path("/")
        .max_age(time::Duration::days(7))
        .build();

    Ok((
        jar.add(cookie),
        Json(serde_json::to_value(UserInfo {
            username: user.username,
            role: role_str,
            permissions,
            totp_enabled: false,
        }).map_err(|e| AppError::Internal(e.into()))?),
    ))
}

/// Expire the session and pending-2FA cookies. Attributes must match the ones
/// they were set with (path "/") or the browser keeps the original.
fn clear_session_cookies(jar: CookieJar) -> CookieJar {
    [COOKIE_NAME, auth::TOTP_PENDING_COOKIE_NAME]
        .into_iter()
        .fold(jar, |jar, name| {
            jar.add(Cookie::build(name).path("/").max_age(time::Duration::ZERO).build())
        })
}

/// Public route (no `require_auth`): logging out must succeed even with a
/// missing, expired or revoked token, and must always clear the cookies.
async fn logout(State(state): State<AppState>, jar: CookieJar) -> (CookieJar, StatusCode) {
    let user = jar
        .get(COOKIE_NAME)
        .and_then(|c| auth::verify_token(c.value(), &state.config.jwt_secret).ok())
        .map(|claims| claims.sub);
    if let Some(user) = user {
        state.audit.log(&user, "logout", None, None, None).await;
    }
    (clear_session_cookies(jar), StatusCode::OK)
}

/// Revoke every session for the current user (this device and all others) by
/// bumping their token version, then clear the local cookie.
async fn logout_all(
    State(state): State<AppState>,
    Extension(claims): Extension<models::Claims>,
    jar: CookieJar,
) -> Result<(CookieJar, StatusCode)> {
    state.users.bump_token_version(&claims.sub).await?;
    state.audit.log(&claims.sub, "logout_all", None, None, None).await;
    Ok((clear_session_cookies(jar), StatusCode::NO_CONTENT))
}

async fn me(State(state): State<AppState>, jar: CookieJar) -> Result<Json<UserInfo>> {
    let token = jar
        .get(COOKIE_NAME)
        .map(|c| c.value().to_string())
        .ok_or(AppError::Unauthorized)?;

    let claims = auth::verify_token(&token, &state.config.jwt_secret)
        .map_err(|_| AppError::Unauthorized)?;

    // Verify the user still exists (catches deleted users with valid tokens)
    let user = state
        .users
        .get(&claims.sub)
        .await
        .ok_or(AppError::Unauthorized)?;

    // Reject revoked tokens (password change / log-out-all / admin revoke).
    if claims.tv != user.token_version {
        return Err(AppError::Unauthorized);
    }

    let permissions = state.users.get_resolved_permissions(&claims.sub).await;

    Ok(Json(UserInfo {
        username: claims.sub,
        role: claims.role,
        permissions,
        totp_enabled: user.totp_enabled,
    }))
}

// ─── Health check ─────────────────────────────────────────────────────────────

/// Unauthenticated liveness probe for load balancers / container orchestrators.
async fn health() -> Json<serde_json::Value> {
    Json(json!({ "status": "ok", "version": env!("CARGO_PKG_VERSION") }))
}

// ─── SPA fallback ─────────────────────────────────────────────────────────────

async fn spa_fallback(uri: axum::http::Uri) -> Response {
    let path = uri.path().trim_start_matches('/');

    // Safety check: if somehow /api hits this, return 404 JSON
    if path.starts_with("api/") {
        return (
            StatusCode::NOT_FOUND,
            [(header::CONTENT_TYPE, "application/json")],
            r#"{"error":"API route not found"}"#,
        ).into_response();
    }

    let Ok(dist_root) = std::fs::canonicalize("dist") else {
        return StatusCode::NOT_FOUND.into_response();
    };

    // Resolve the candidate path and verify it stays inside dist/.
    let safe_path = if path.is_empty() {
        dist_root.join("index.html")
    } else {
        // Strip any percent-encoding and normalize components before joining.
        let decoded = percent_encoding::percent_decode_str(path).decode_utf8_lossy().into_owned();
        let candidate = dist_root.join(&decoded);
        match std::fs::canonicalize(&candidate) {
            Ok(resolved) if resolved.starts_with(&dist_root) => resolved,
            _ => dist_root.join("index.html"),
        }
    };

    if let Ok(bytes) = tokio::fs::read(&safe_path).await {
        let mime = mime_guess::from_path(&safe_path)
            .first_or_octet_stream()
            .to_string();
        return ([(header::CONTENT_TYPE, mime)], bytes).into_response();
    }

    match tokio::fs::read(dist_root.join("index.html")).await {
        Ok(html) => ([(header::CONTENT_TYPE, "text/html; charset=utf-8")], html).into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

// ─── Security headers ─────────────────────────────────────────────────────────

/// Apply baseline security headers to every response. The CSP is the key
/// defense against stored XSS: even if a file slipped through served as HTML,
/// inline scripts won't execute and resources load only from our own origin.
/// `nosniff` stops content-type sniffing; `frame-ancestors 'self'` allows the
/// app's own preview iframes while blocking external clickjacking.
async fn security_headers(State(state): State<AppState>, req: Request, next: Next) -> Response {
    let mut resp = next.run(req).await;
    let h = resp.headers_mut();
    h.insert(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff"));
    h.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("SAMEORIGIN"));
    h.insert(header::REFERRER_POLICY, HeaderValue::from_static("no-referrer"));
    h.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; \
             img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; \
             object-src 'none'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
        ),
    );
    // Deny powerful browser features the app never uses. clipboard-write
    // (copy share links) and fullscreen (PDF/video previews) stay same-origin.
    h.insert(
        HeaderName::from_static("permissions-policy"),
        HeaderValue::from_static(
            "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), \
             bluetooth=(), hid=(), midi=(), magnetometer=(), gyroscope=(), accelerometer=(), \
             display-capture=(), interest-cohort=(), browsing-topics=(), \
             clipboard-write=(self), fullscreen=(self)",
        ),
    );
    // Isolate the browsing context from cross-origin windows (tabnabbing,
    // XS-Leaks). COEP is deliberately not set: nothing needs cross-origin isolation.
    h.insert(
        HeaderName::from_static("cross-origin-opener-policy"),
        HeaderValue::from_static("same-origin"),
    );
    // Enforce HTTPS for a year (incl. subdomains) once TLS is in use. Gated on
    // cookie_secure so the local plain-HTTP compose isn't pinned to HTTPS.
    if state.config.cookie_secure {
        h.insert(
            header::STRICT_TRANSPORT_SECURITY,
            HeaderValue::from_static("max-age=31536000; includeSubDomains"),
        );
    }
    resp
}

// ─── JWT secret bootstrap ─────────────────────────────────────────────────────

fn resolve_jwt_secret(root_dir: &Path) -> String {
    // Explicit env var takes priority (useful for external secret managers).
    if let Ok(s) = std::env::var("JWT_SECRET") {
        if !s.is_empty() {
            return s;
        }
    }

    let secret_file = root_dir.join(".fileflow_secret");

    // Load from persisted file if it already exists.
    if let Ok(s) = std::fs::read_to_string(&secret_file) {
        let s = s.trim().to_string();
        if !s.is_empty() {
            return s;
        }
    }

    // First run: generate 256 bits from the OS CSPRNG and persist it (hex).
    let secret = {
        use rand::RngCore;
        let mut bytes = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut bytes);
        bytes.iter().map(|b| format!("{:02x}", b)).collect::<String>()
    };
    std::fs::write(&secret_file, &secret).expect("Failed to persist JWT secret");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&secret_file, std::fs::Permissions::from_mode(0o600));
    }
    tracing::info!("Generated JWT secret → {:?}", secret_file);
    secret
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/// Container healthcheck: `fileflow healthcheck` performs a localhost GET on
/// `/api/health` and exits 0 (healthy) or 1. Self-contained so it works in the
/// distroless runtime image, which has no shell, wget or curl.
fn run_healthcheck() -> ! {
    use std::io::{Read, Write};
    let port = std::env::var("PORT")
        .ok()
        .and_then(|v| v.parse::<u16>().ok())
        .unwrap_or(8080);
    let ok = (|| -> std::io::Result<bool> {
        let mut s = std::net::TcpStream::connect(("127.0.0.1", port))?;
        s.set_read_timeout(Some(Duration::from_secs(3)))?;
        s.set_write_timeout(Some(Duration::from_secs(3)))?;
        s.write_all(b"GET /api/health HTTP/1.0\r\nHost: localhost\r\nConnection: close\r\n\r\n")?;
        let mut buf = String::new();
        let _ = s.read_to_string(&mut buf);
        Ok(buf.starts_with("HTTP/1.1 200") || buf.contains(" 200 OK"))
    })()
    .unwrap_or(false);
    std::process::exit(if ok { 0 } else { 1 });
}

/// Application entry point. `main.rs` is a thin shim that awaits this inside a
/// Tokio runtime; keeping it here lets the fuzz targets and integration tests
/// link the crate as a library.
pub async fn run() {
    // Lightweight healthcheck mode (used by the container HEALTHCHECK).
    // Selecting the run-mode from argv is not a security decision (argv[0] is
    // never trusted here), so the generic "args in security context" rule N/A.
    // nosemgrep: rust.lang.security.args.args
    if std::env::args().skip(1).any(|a| a == "healthcheck") {
        run_healthcheck();
    }

    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "fileflow=info,tower_http=warn".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let root_dir = PathBuf::from(
        std::env::var("ROOT_DIR").unwrap_or_else(|_| "/data".to_string()),
    );
    std::fs::create_dir_all(&root_dir).expect("Cannot create ROOT_DIR");
    let root_dir = root_dir.canonicalize().expect("Cannot canonicalize ROOT_DIR");

    // CONFIG_DIR holds .fileflow_* files; defaults to ROOT_DIR for backward compatibility.
    let config_dir = std::env::var("CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| root_dir.clone());
    std::fs::create_dir_all(&config_dir).expect("Cannot create CONFIG_DIR");
    let config_dir = config_dir.canonicalize().expect("Cannot canonicalize CONFIG_DIR");

    // Open the SQLite database that backs all config stores. Legacy `.json`
    // files are imported automatically on first run, then left untouched.
    let database = db::open(&config_dir.join(".fileflow.db"))
        .expect("Failed to open SQLite database");

    let users_file = config_dir.join(".fileflow_users.json");
    let groups_file = config_dir.join(".fileflow_groups.json");
    let users = UserStore::load(database.clone(), users_file, groups_file)
        .await
        .expect("Failed to load user store");

    if users.is_empty().await {
        let admin_username =
            std::env::var("ADMIN_USERNAME").unwrap_or_else(|_| "admin".to_string());
        let admin_password =
            std::env::var("ADMIN_PASSWORD").expect("ADMIN_PASSWORD env var required for initial setup");

        users
            .create(admin_username.clone(), &admin_password, Role::Admin)
            .await
            .expect("Failed to create initial admin user");

        tracing::info!("Created initial admin user: {}", admin_username);
    }

    // Restrict the SQLite database file to the owner — it holds password hashes
    // and TOTP secrets. Best-effort; ignored on non-unix.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let db_file = config_dir.join(".fileflow.db");
        let _ = std::fs::set_permissions(&db_file, std::fs::Permissions::from_mode(0o600));
    }

    let env_flag = |name: &str, default: bool| {
        std::env::var(name)
            .ok()
            .map(|v| matches!(v.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
            .unwrap_or(default)
    };

    let env_mb = |name: &str, default: usize| {
        std::env::var(name).ok().and_then(|v| v.parse::<usize>().ok()).unwrap_or(default) * 1024 * 1024
    };
    let max_upload_size = env_mb("MAX_UPLOAD_MB", 200);
    let config = Arc::new(Config {
        jwt_secret: resolve_jwt_secret(&config_dir),
        root_dir,
        max_upload_size,
        public_upload_max_size: env_mb("PUBLIC_UPLOAD_MAX_MB", 100).min(max_upload_size),
        // Only trust proxy IP headers when explicitly enabled (behind a proxy).
        trust_proxy: env_flag("TRUST_PROXY_HEADERS", false),
        // Secure cookies by default; set COOKIE_SECURE=false only for local HTTP.
        cookie_secure: env_flag("COOKIE_SECURE", true),
    });

    let audit = AuditLogger::new(config_dir.join(".fileflow_audit.json"));
    let shares = ShareStore::load(database.clone(), config_dir.join(".fileflow_shares.json"))
        .await
        .expect("Failed to load share store");
    let collab = CollabStore::load(database.clone(), config_dir.join(".fileflow_collab.json"))
        .await
        .expect("Failed to load collab store");
    let internal_shares = InternalShareStore::load(database.clone(), config_dir.join(".fileflow_internal_shares.json"))
        .await
        .expect("Failed to load internal shares store");
    let favorites = FavoriteStore::load(database.clone(), config_dir.join(".fileflow_favorites.json"))
        .await
        .expect("Failed to load favorites store");
    let upload_requests = UploadRequestStore::load(database.clone(), config_dir.join(".fileflow_upload_requests.json"))
        .await
        .expect("Failed to load upload requests store");
    let state = AppState {
        config,
        users,
        audit,
        shares,
        collab,
        internal_shares,
        favorites,
        upload_requests,
        upload_sessions: uploads::new_sessions(),
        metadata_lock: Arc::new(RwLock::new(())),
        trash_lock: Arc::new(tokio::sync::Mutex::new(())),
        ip_limiter: ratelimit::new_limiter(),
        user_limiter: ratelimit::new_limiter(),
        user_ip_limiter: ratelimit::new_limiter(),
        totp_limiter: ratelimit::new_limiter(),
        link_limiter: ratelimit::new_limiter(),
        bulk_downloads: Arc::new(tokio::sync::Semaphore::new(4)),
    };

    // 1. Admin Sub-router
    let admin_routes = Router::new()
        .route("/users", get(admin::list_users).post(admin::create_user))
        .route("/users/:username", put(admin::update_user).delete(admin::delete_user))
        .route("/users/:username/password", put(admin::admin_set_password))
        .route("/users/:username/revoke-sessions", post(admin::revoke_user_sessions))
        .route("/groups", get(admin::list_groups).post(admin::create_group))
        .route("/groups/:id", put(admin::update_group).delete(admin::delete_group))
        .route("/audit", get(admin::list_audit_logs))
        .route("/audit/export", get(admin::export_audit_logs))
        .layer(middleware::from_fn_with_state(state.clone(), auth::require_auth));

    // 2. Protected Routes (require_auth)
    let protected_api = Router::new()
        .route("/auth/me", get(me))
        .route("/auth/logout-all", post(logout_all))
        .route("/auth/2fa/setup", post(two_factor::setup))
        .route("/auth/2fa/confirm", post(two_factor::confirm))
        .route("/auth/2fa/disable", post(two_factor::disable))
        .route("/auth/2fa/recovery-codes/regenerate", post(two_factor::regenerate_codes))
        .route("/files", get(files::list_dir))
        .route("/files/download", get(files::download))
        .route("/files/download-bulk", get(files::download_bulk))
        .route("/files/preview", get(files::preview))
        .route("/files/upload", post(files::upload).route_layer(axum::extract::DefaultBodyLimit::disable()))
        .route("/uploads/init", post(uploads::init_upload))
        .route("/uploads/chunk", put(uploads::upload_chunk).route_layer(axum::extract::DefaultBodyLimit::max(uploads::MAX_CHUNK_BYTES)))
        .route("/uploads/status", get(uploads::upload_status))
        .route("/uploads/finish", post(uploads::finish_upload))
        .route("/uploads/abort", post(uploads::abort_upload))
        .route("/files/mkdir", post(files::mkdir))
        .route("/files/rename", post(files::rename))
        .route("/files/delete", post(files::delete))
        .route("/files/move", post(files::move_items))
        .route("/files/search", get(files::search))
        .route("/trash", get(files::list_trash))
        .route("/trash/restore", post(files::restore_trash))
        .route("/trash/empty", post(files::empty_trash))
        .route("/versions", get(files::list_versions))
        .route("/versions/restore", post(files::restore_version))
        .route("/metadata/tags", get(files::get_tags).post(files::set_tags))
        .route("/metadata/tags/bulk", post(files::set_tags_bulk))
        .route("/metadata/search", get(files::search_by_tag))
        .route("/shares", get(shares::list_shares).post(shares::create_share))
        .route("/shares/:token", delete(shares::delete_share))
        .route("/shared-folders", get(collab::list_shared_folders).post(collab::create_shared_folder))
        .route("/shared-folders/:id", get(collab::get_shared_folder).delete(collab::delete_shared_folder))
        .route("/shared-folders/:id/members", put(collab::update_members))
        .route("/internal-shares", get(internal_shares::list_internal_shares).post(internal_shares::create_internal_share))
        .route("/internal-shares/:id", delete(internal_shares::delete_internal_share))
        .route("/shared-with-me", get(internal_shares::shared_with_me))
        .route("/favorites", get(favorites::list_favorites).post(favorites::add_favorite).delete(favorites::remove_favorite))
        .route("/upload-requests", get(upload_requests::list_upload_requests).post(upload_requests::create_upload_request))
        .route("/upload-requests/:token", delete(upload_requests::delete_upload_request))
        .nest("/admin", admin_routes)
        .route("/users/me/password", put(admin::change_own_password))
        .layer(middleware::from_fn_with_state(state.clone(), auth::require_auth));

    // 3. Combined API Router
    let api_router = Router::new()
        .route("/health", get(health))
        .route("/auth/login", post(login))
        .route("/auth/logout", post(logout))
        .route("/auth/2fa/verify", post(two_factor::verify))
        .route("/auth/2fa/verify-recovery", post(two_factor::verify_recovery))
        .route("/s/:token", get(shares::serve_shared).post(shares::serve_shared_post))
        .route("/r/:token", get(upload_requests::serve_upload_page).post(upload_requests::handle_public_upload))
        .merge(protected_api)
        // API-specific fallback to prevent HTML being returned for missing API routes
        .fallback(|| async {
            (
                StatusCode::NOT_FOUND,
                Json(json!({ "error": "API route not found" })),
            )
        });

    // Clean up temp files left by a previous run before accepting traffic.
    uploads::cleanup_orphaned_parts(&state.config.root_dir).await;

    // Background maintenance: discard idle upload sessions, prune stale
    // rate-limit entries, and purge expired share links (previously only
    // purged when someone happened to list shares).
    let maintenance_state = state.clone();
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(30 * 60));
        loop {
            tick.tick().await;
            let n = uploads::reap_stale(&maintenance_state.upload_sessions, chrono::Utc::now()).await;
            if n > 0 {
                tracing::info!("reaped {} stale upload session(s)", n);
            }
            ratelimit::prune(&maintenance_state.ip_limiter).await;
            ratelimit::prune(&maintenance_state.user_limiter).await;
            ratelimit::prune(&maintenance_state.user_ip_limiter).await;
            ratelimit::prune(&maintenance_state.totp_limiter).await;
            ratelimit::prune(&maintenance_state.link_limiter).await;
            maintenance_state.shares.purge_expired().await;
        }
    });

    // 4. Main App Router
    let app = Router::new()
        .nest("/api", api_router)
        .fallback(spa_fallback)
        .layer(axum::extract::DefaultBodyLimit::max(state.config.max_upload_size + 10 * 1024))
        .layer(middleware::from_fn_with_state(state.clone(), security_headers))
        .layer(CompressionLayer::new())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(8080);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!("FileFlow listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.expect("Cannot bind the listen address");
    // `into_make_service_with_connect_info` exposes the socket peer address to
    // handlers (used as the un-spoofable client IP for rate limiting).
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await
    .expect("HTTP server failed");
    tracing::info!("FileFlow shut down cleanly");
}

/// Resolve when the process receives Ctrl-C or (on Unix) SIGTERM, so in-flight
/// requests finish before the server stops.
async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut sig) => {
                sig.recv().await;
            }
            Err(e) => tracing::error!("failed to install SIGTERM handler: {}", e),
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    tracing::info!("shutdown signal received");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn logout_expires_session_and_pending_2fa_cookies() {
        let jar = CookieJar::new()
            .add(Cookie::new(COOKIE_NAME, "jwt"))
            .add(Cookie::new(auth::TOTP_PENDING_COOKIE_NAME, "pending"));
        let jar = clear_session_cookies(jar);
        for name in [COOKIE_NAME, auth::TOTP_PENDING_COOKIE_NAME] {
            let c = jar.get(name).expect("removal cookie present");
            assert_eq!(c.value(), "", "{name} value cleared");
            assert_eq!(c.max_age(), Some(time::Duration::ZERO), "{name} expired");
            assert_eq!(c.path(), Some("/"), "{name} path matches the original");
        }
    }
}
