use axum::{
    extract::State,
    http::StatusCode,
    Extension, Json,
};
use axum_extra::extract::CookieJar;
use axum_extra::extract::cookie::Cookie;
use axum_extra::extract::cookie::SameSite;
use time;

use crate::{
    auth,
    error::{AppError, Result},
    models::{
        Claims, TotpSetupConfirm, TotpVerifyRequest, TotpDisableRequest, TotpRegenRequest,
        TotpRecoveryRequest, TotpSetupResponse, TotpConfirmResponse, UserInfo,
    },
    totp,
    AppState,
};

/// Full session cookie for `token` (same attributes as at login).
fn session_cookie(state: &AppState, token: String) -> Cookie<'static> {
    Cookie::build((auth::COOKIE_NAME, token))
        .http_only(true)
        .secure(state.config.cookie_secure)
        .same_site(SameSite::Strict)
        .path("/")
        .max_age(time::Duration::days(7))
        .build()
}

/// Revoke every existing session of `username` and hand the caller a fresh
/// one, so a change to the second factor also logs out any other holder of
/// the old session (e.g. a stolen cookie) without logging out the user here.
async fn rotate_session(state: &AppState, username: &str, jar: CookieJar) -> Result<CookieJar> {
    state.users.bump_token_version(username).await?;
    let user = state.users.get(username).await.ok_or(AppError::Unauthorized)?;
    let token = auth::create_token(username, &user.role.to_string(), user.token_version, &state.config.jwt_secret)
        .map_err(AppError::Internal)?;
    Ok(jar.add(session_cookie(state, token)))
}

/// Step-up check for changing an active second factor: the password AND a
/// current TOTP code or a recovery code (consumed). A stolen session alone, or
/// a stolen password alone, is not enough. Failures share the 2FA lockout.
async fn verify_password_and_second_factor(
    state: &AppState,
    username: &str,
    password: &str,
    code: &str,
    action: &str,
) -> Result<()> {
    if crate::ratelimit::locked(&state.totp_limiter, username).await {
        state.audit.log(username, "2fa_blocked", None, None, Some(action.to_string())).await;
        return Err(AppError::TooManyRequests);
    }
    let user = state.users.get(username).await.ok_or(AppError::Unauthorized)?;
    if !user.totp_enabled {
        return Err(AppError::BadRequest("2FA not enabled".into()));
    }

    let password_ok = bcrypt::verify(password, &user.password_hash)
        .map_err(|e| AppError::Internal(anyhow::anyhow!("bcrypt: {}", e)))?;
    let code = code.trim();
    let factor_ok = password_ok
        && match &user.totp_secret {
            Some(secret) if code.len() == 6 && code.bytes().all(|b| b.is_ascii_digit()) => {
                totp::verify_code(secret, code)
            }
            _ => state.users.consume_recovery_code(username, code).await?,
        };

    if !factor_ok {
        crate::ratelimit::record_failure(&state.totp_limiter, username).await;
        let reason = if password_ok { "invalid code" } else { "wrong password" };
        state.audit.log(username, &format!("{}_failed", action), None, None, Some(reason.to_string())).await;
        // One message for both, so the response doesn't confirm the password.
        return Err(AppError::BadRequest("Invalid password or code".into()));
    }
    crate::ratelimit::clear(&state.totp_limiter, username).await;
    Ok(())
}

// ─── POST /api/auth/2fa/setup — Requires auth ──────────────────────────────

pub async fn setup(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<TotpSetupResponse>> {
    // Never replace an active secret: with a hijacked session that would let an
    // attacker swap in their own authenticator. Changing it means disabling
    // 2FA first, which requires the password and a current code.
    let user = state.users.get(&claims.sub).await.ok_or(AppError::Unauthorized)?;
    if user.totp_enabled {
        return Err(AppError::BadRequest("2FA is already enabled".into()));
    }

    let secret = totp::generate_secret();

    // Store unconfirmed secret (only consulted at login once confirmed)
    state.users.set_totp_secret(&claims.sub, &secret).await?;

    // Generate QR code URI (otpauth://)
    let qr_code_uri = totp::generate_qr_uri(&claims.sub, &secret, "FileFlow")?;

    // NOTE: recovery codes are generated and returned ONLY at /confirm, once the
    // user proves they can produce a valid TOTP code. Returning throwaway codes
    // here would show the user codes that are never stored (and thus never work).

    state.audit.log(
        &claims.sub,
        "2fa_setup_started",
        None,
        None,
        None,
    ).await;

    Ok(Json(TotpSetupResponse {
        qr_code_png_b64: qr_code_uri,  // Actually contains otpauth:// URI for QR rendering
    }))
}

// ─── POST /api/auth/2fa/confirm — Requires auth ────────────────────────────

pub async fn confirm(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    jar: CookieJar,
    Json(req): Json<TotpSetupConfirm>,
) -> Result<(CookieJar, Json<TotpConfirmResponse>)> {
    // Get unconfirmed secret
    let user = state.users.get(&claims.sub).await
        .ok_or(AppError::NotFound("User not found".into()))?;
    // Re-confirming would silently replace the recovery codes.
    if user.totp_enabled {
        return Err(AppError::BadRequest("2FA is already enabled".into()));
    }

    let secret = user.totp_secret
        .as_ref()
        .ok_or(AppError::BadRequest("2FA setup not in progress".into()))?;

    // Verify the code
    if !totp::verify_code(secret, &req.code) {
        state.audit.log(
            &claims.sub,
            "2fa_setup_verify_failed",
            None,
            None,
            Some("invalid code".to_string()),
        ).await;
        return Err(AppError::BadRequest("Invalid verification code".into()));
    }

    // Generate recovery codes for real this time
    let (plaintext_codes, hashed_codes) = totp::generate_recovery_codes();

    // Mark TOTP as enabled; sessions opened without 2FA are revoked.
    state.users.confirm_totp(&claims.sub, hashed_codes).await?;
    let jar = rotate_session(&state, &claims.sub, jar).await?;

    state.audit.log(
        &claims.sub,
        "2fa_enabled",
        None,
        None,
        Some("TOTP configured".to_string()),
    ).await;

    Ok((jar, Json(TotpConfirmResponse {
        backup_codes: plaintext_codes,
    })))
}

// ─── POST /api/auth/2fa/verify — No auth (reads pending cookie) ──────────────

pub async fn verify(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(req): Json<TotpVerifyRequest>,
) -> Result<(CookieJar, Json<UserInfo>)> {
    // Extract pending token from cookie
    let pending_token = jar
        .get(auth::TOTP_PENDING_COOKIE_NAME)
        .map(|c| c.value().to_string())
        .ok_or(AppError::Unauthorized)?;

    let pending_claims = auth::verify_pending_token(&pending_token, &state.config.jwt_secret)
        .map_err(|_| AppError::Unauthorized)?;

    // Throttle TOTP guessing: the pending token is reusable for its lifetime, so
    // without this an attacker who passed the password step could brute-force the
    // 6-digit code.
    if crate::ratelimit::locked(&state.totp_limiter, &pending_claims.sub).await {
        state.audit.log(&pending_claims.sub, "2fa_blocked", None, None, None).await;
        return Err(AppError::TooManyRequests);
    }

    // Get user and verify TOTP code
    let user = state.users.get(&pending_claims.sub).await
        .ok_or(AppError::Unauthorized)?;

    if !user.totp_enabled {
        return Err(AppError::BadRequest("2FA not enabled for this user".into()));
    }

    let secret = user.totp_secret
        .as_ref()
        .ok_or(AppError::Unauthorized)?;

    // Verify code
    if !totp::verify_code(secret, &req.code) {
        crate::ratelimit::record_failure(&state.totp_limiter, &pending_claims.sub).await;
        state.audit.log(
            &pending_claims.sub,
            "2fa_verify_failed",
            None,
            None,
            Some("invalid code".to_string()),
        ).await;
        return Err(AppError::BadRequest("Invalid code".into()));
    }
    crate::ratelimit::clear(&state.totp_limiter, &pending_claims.sub).await;

    // Remove pending cookie and issue full session cookie
    let mut new_jar = jar.remove(Cookie::build(auth::TOTP_PENDING_COOKIE_NAME).path("/").build());

    // Create full JWT
    let role_str = user.role.to_string();
    let token = auth::create_token(&pending_claims.sub, &role_str, user.token_version, &state.config.jwt_secret)
        .map_err(AppError::Internal)?;

    let session_cookie = session_cookie(&state, token);

    new_jar = new_jar.add(session_cookie);

    // Update last login
    let users = state.users.clone();
    let username = pending_claims.sub.clone();
    tokio::spawn(async move {
        let _ = users.update_last_login(&username).await;
    });

    let permissions = state.users.get_resolved_permissions(&pending_claims.sub).await;

    state.audit.log(
        &pending_claims.sub,
        "2fa_verify_success",
        None,
        None,
        None,
    ).await;

    Ok((
        new_jar,
        Json(UserInfo {
            username: user.username,
            role: role_str,
            permissions,
            totp_enabled: true,
        }),
    ))
}

// ─── POST /api/auth/2fa/verify-recovery — No auth (reads pending cookie) ────

pub async fn verify_recovery(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(req): Json<TotpRecoveryRequest>,
) -> Result<(CookieJar, Json<UserInfo>)> {
    // Extract pending token from cookie
    let pending_token = jar
        .get(auth::TOTP_PENDING_COOKIE_NAME)
        .map(|c| c.value().to_string())
        .ok_or(AppError::Unauthorized)?;

    let pending_claims = auth::verify_pending_token(&pending_token, &state.config.jwt_secret)
        .map_err(|_| AppError::Unauthorized)?;

    // Same throttle as the TOTP step: the pending token is reusable for its
    // lifetime, and each recovery attempt costs a bcrypt verify per stored
    // code — without a lockout this is both a guessing and a CPU-burn surface.
    if crate::ratelimit::locked(&state.totp_limiter, &pending_claims.sub).await {
        state.audit.log(&pending_claims.sub, "2fa_blocked", None, None, None).await;
        return Err(AppError::TooManyRequests);
    }

    // Get user and consume recovery code
    let user = state.users.get(&pending_claims.sub).await
        .ok_or(AppError::Unauthorized)?;

    if !user.totp_enabled {
        return Err(AppError::BadRequest("2FA not enabled for this user".into()));
    }

    // Try to consume the recovery code
    let consumed = state.users.consume_recovery_code(&pending_claims.sub, &req.recovery_code).await?;

    if !consumed {
        crate::ratelimit::record_failure(&state.totp_limiter, &pending_claims.sub).await;
        state.audit.log(
            &pending_claims.sub,
            "2fa_recovery_failed",
            None,
            None,
            Some("invalid code".to_string()),
        ).await;
        return Err(AppError::BadRequest("Invalid recovery code".into()));
    }
    crate::ratelimit::clear(&state.totp_limiter, &pending_claims.sub).await;

    // Remove pending cookie and issue full session cookie
    let mut new_jar = jar.remove(Cookie::build(auth::TOTP_PENDING_COOKIE_NAME).path("/").build());

    // Create full JWT
    let role_str = user.role.to_string();
    let token = auth::create_token(&pending_claims.sub, &role_str, user.token_version, &state.config.jwt_secret)
        .map_err(AppError::Internal)?;

    let session_cookie = session_cookie(&state, token);

    new_jar = new_jar.add(session_cookie);

    // Update last login
    let users = state.users.clone();
    let username = pending_claims.sub.clone();
    tokio::spawn(async move {
        let _ = users.update_last_login(&username).await;
    });

    let permissions = state.users.get_resolved_permissions(&pending_claims.sub).await;

    state.audit.log(
        &pending_claims.sub,
        "2fa_recovery_used",
        None,
        None,
        None,
    ).await;

    Ok((
        new_jar,
        Json(UserInfo {
            username: user.username,
            role: role_str,
            permissions,
            totp_enabled: true,
        }),
    ))
}

// ─── POST /api/auth/2fa/disable — Requires auth ───────────────────────────

pub async fn disable(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    jar: CookieJar,
    Json(req): Json<TotpDisableRequest>,
) -> Result<(CookieJar, StatusCode)> {
    verify_password_and_second_factor(&state, &claims.sub, &req.password, &req.code, "2fa_disable").await?;

    // Disable TOTP; other sessions are revoked.
    state.users.disable_totp(&claims.sub).await?;
    let jar = rotate_session(&state, &claims.sub, jar).await?;

    state.audit.log(
        &claims.sub,
        "2fa_disabled",
        None,
        None,
        None,
    ).await;

    Ok((jar, StatusCode::NO_CONTENT))
}

// ─── POST /api/auth/2fa/recovery-codes/regenerate — Requires auth ──────────

pub async fn regenerate_codes(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<TotpRegenRequest>,
) -> Result<Json<Vec<String>>> {
    verify_password_and_second_factor(&state, &claims.sub, &req.password, &req.code, "2fa_regen").await?;

    // Generate new recovery codes
    let (plaintext_codes, hashed_codes) = totp::generate_recovery_codes();

    // Replace old codes
    state.users.replace_recovery_codes(&claims.sub, hashed_codes).await?;

    state.audit.log(
        &claims.sub,
        "2fa_recovery_regenerated",
        None,
        None,
        None,
    ).await;

    Ok(Json(plaintext_codes))
}
