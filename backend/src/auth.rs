use crate::{error::AppError, models::{Claims, PendingClaims, UserStatus}, AppState};
use axum::{extract::{Request, State}, middleware::Next, response::Response};
use axum_extra::extract::CookieJar;
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use std::time::{SystemTime, UNIX_EPOCH};

pub const COOKIE_NAME: &str = "fileflow_token";
pub const TOTP_PENDING_COOKIE_NAME: &str = "fileflow_2fa_pending";
const TOKEN_EXPIRY_SECS: usize = 86400 * 7;
const TOTP_PENDING_EXPIRY_SECS: usize = 300;

pub fn create_token(username: &str, role: &str, token_version: u64, secret: &str) -> anyhow::Result<String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock is set before 1970")
        .as_secs() as usize;

    let claims = Claims {
        sub: username.to_string(),
        role: role.to_string(),
        iat: now,
        exp: now + TOKEN_EXPIRY_SECS,
        tv: token_version,
    };

    Ok(encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )?)
}

pub fn verify_token(token: &str, secret: &str) -> anyhow::Result<Claims> {
    let data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )?;
    Ok(data.claims)
}

pub fn create_pending_token(username: &str, secret: &str) -> anyhow::Result<String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock is set before 1970")
        .as_secs() as usize;

    let claims = PendingClaims {
        sub: username.to_string(),
        iat: now,
        exp: now + TOTP_PENDING_EXPIRY_SECS,
    };

    Ok(encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )?)
}

pub fn verify_pending_token(token: &str, secret: &str) -> anyhow::Result<PendingClaims> {
    let data = decode::<PendingClaims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )?;
    Ok(data.claims)
}

/// Middleware: validates JWT and injects `Claims` and `Permissions` into request extensions.
pub async fn require_auth(
    State(state): State<AppState>,
    jar: CookieJar,
    mut req: Request,
    next: Next,
) -> std::result::Result<Response, AppError> {
    let token = jar
        .get(COOKIE_NAME)
        .map(|c| c.value().to_string())
        .or_else(|| {
            req.headers()
                .get("Authorization")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.strip_prefix("Bearer "))
                .map(|t| t.to_string())
        })
        .ok_or(AppError::Unauthorized)?;

    let claims = verify_token(&token, &state.config.jwt_secret)
        .map_err(|_| AppError::Unauthorized)?;

    // Verify user exists and is active
    let user = state.users.get(&claims.sub).await.ok_or(AppError::Unauthorized)?;
    if user.status == UserStatus::Disabled {
        return Err(AppError::Forbidden);
    }
    // Reject tokens invalidated by a password change / "log out all" / admin revoke.
    if claims.tv != user.token_version {
        return Err(AppError::Unauthorized);
    }

    // Update last login (don't block)
    let users = state.users.clone();
    let username = claims.sub.clone();
    tokio::spawn(async move {
        let _ = users.update_last_login(&username).await;
    });

    let perms = state.users.get_resolved_permissions(&claims.sub).await;

    req.extensions_mut().insert(claims);
    req.extensions_mut().insert(perms);
    Ok(next.run(req).await)
}

/// Middleware: requires admin role (must be composed after `require_auth`).
pub async fn require_admin(
    req: Request,
    next: Next,
) -> std::result::Result<Response, AppError> {
    let claims = req
        .extensions()
        .get::<Claims>()
        .ok_or(AppError::Unauthorized)?;

    if !claims.is_admin() {
        return Err(AppError::Forbidden);
    }

    Ok(next.run(req).await)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECRET: &str = "test_secret";

    #[test]
    fn token_roundtrip() {
        let token = create_token("alice", "admin", 0, SECRET).unwrap();
        let claims = verify_token(&token, SECRET).unwrap();
        assert_eq!(claims.sub, "alice");
        assert_eq!(claims.role, "admin");
        assert_eq!(claims.tv, 0);
    }

    #[test]
    fn token_carries_version() {
        let token = create_token("alice", "admin", 7, SECRET).unwrap();
        let claims = verify_token(&token, SECRET).unwrap();
        assert_eq!(claims.tv, 7);
    }

    #[test]
    fn wrong_secret_rejected() {
        let token = create_token("alice", "admin", 0, SECRET).unwrap();
        assert!(verify_token(&token, "wrong").is_err());
    }

    #[test]
    fn pending_token_roundtrip() {
        let token = create_pending_token("bob", SECRET).unwrap();
        let claims = verify_pending_token(&token, SECRET).unwrap();
        assert_eq!(claims.sub, "bob");
    }

    #[test]
    fn pending_wrong_secret_rejected() {
        let token = create_pending_token("bob", SECRET).unwrap();
        assert!(verify_pending_token(&token, "wrong").is_err());
    }
}

