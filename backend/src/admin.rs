use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Extension, Json,
};

use crate::{
    error::{AppError, Result},
    models::{
        AuditEntry, AuditQuery, ChangePasswordRequest, Claims, CreateGroupRequest, CreateUserRequest, EditGroupRequest, Permission, Role,
        UpdateUserRequest, UserGroup, UserView,
    },
    AppState,
};

// ─── User management ────────────────────────────────────────────

pub async fn list_users(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Extension(perms): Extension<Vec<Permission>>,
) -> Result<Json<Vec<UserView>>> {
    if !claims.is_admin() && !perms.contains(&Permission::UserManage) {
        return Err(AppError::Forbidden);
    }
    Ok(Json(state.users.list().await))
}

pub async fn update_user(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(username): Path<String>,
    Json(req): Json<UpdateUserRequest>,
) -> Result<Json<UserView>> {
    if !claims.is_admin() {
        return Err(AppError::Forbidden);
    }

    let (view, changes) = state.users.apply_update(&username, req).await?;

    state.audit.log(&claims.sub, "user_update", Some(username), None, Some(changes.join("; "))).await;

    Ok(Json(view))
}

pub async fn create_user(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<CreateUserRequest>,
) -> Result<(StatusCode, Json<UserView>)> {
    if !claims.is_admin() {
        return Err(AppError::Forbidden);
    }
    let username = req.username.trim().to_string();

    if username.is_empty() || username.len() > 64 {
        return Err(AppError::BadRequest("Username must be 1–64 characters".into()));
    }
    if username.chars().any(|c| !c.is_alphanumeric() && c != '_' && c != '-' && c != '.') {
        return Err(AppError::BadRequest(
            "Username may only contain letters, numbers, _, -, .".into(),
        ));
    }
    if req.password.len() < 8 {
        return Err(AppError::BadRequest(
            "Password must be at least 8 characters".into(),
        ));
    }

    let role = req.role.unwrap_or(Role::User);
    let view = state.users.create(username.clone(), &req.password, role.clone()).await?;

    state.audit.log(&claims.sub, "user_create", Some(username), None, Some(format!("role: {}", role))).await;

    Ok((StatusCode::CREATED, Json(view)))
}

pub async fn delete_user(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(username): Path<String>,
) -> Result<StatusCode> {
    if !claims.is_admin() {
        return Err(AppError::Forbidden);
    }
    if username == claims.sub {
        return Err(AppError::BadRequest("Cannot delete your own account".into()));
    }

    // The store refuses to delete the last active admin.
    state.users.delete(&username).await?;

    state.audit.log(&claims.sub, "user_delete", Some(username), None, None).await;

    Ok(StatusCode::NO_CONTENT)
}

// ─── Group management ───────────────────────────────────────────

/// Validate and canonicalize a group's `allowed_paths` at write time, so access
/// checks only ever see canonical prefixes. Entries must be absolute and free
/// of `..`; a bad entry is rejected here rather than silently granting nothing.
fn normalize_allowed_paths(paths: &[String]) -> Result<Vec<String>> {
    paths
        .iter()
        .map(|p| {
            let p = p.trim();
            if !p.starts_with('/') {
                return Err(AppError::BadRequest(format!("Allowed path '{}' must start with '/'", p)));
            }
            crate::files::normalize_virtual(p)
                .map_err(|_| AppError::BadRequest(format!("Allowed path '{}' is invalid", p)))
        })
        .collect()
}

pub async fn list_groups(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Extension(perms): Extension<Vec<Permission>>,
) -> Result<Json<Vec<UserGroup>>> {
    if !claims.is_admin() && !perms.contains(&Permission::GroupManage) {
        return Err(AppError::Forbidden);
    }
    Ok(Json(state.users.list_groups().await))
}

pub async fn create_group(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<CreateGroupRequest>,
) -> Result<(StatusCode, Json<UserGroup>)> {
    if !claims.is_admin() {
        return Err(AppError::Forbidden);
    }
    let allowed_paths = normalize_allowed_paths(&req.allowed_paths)?;
    let group = state
        .users
        .create_group(req.name.clone(), req.permissions.clone(), allowed_paths)
        .await?;

    state.audit.log(&claims.sub, "group_create", Some(req.name), None, Some(format!("perms: {}", req.permissions.len()))).await;

    Ok((StatusCode::CREATED, Json(group)))
}

pub async fn delete_group(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
) -> Result<StatusCode> {
    if !claims.is_admin() {
        return Err(AppError::Forbidden);
    }
    state.users.delete_group(&id).await?;

    state.audit.log(&claims.sub, "group_delete", Some(id), None, None).await;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn update_group(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<String>,
    Json(mut req): Json<EditGroupRequest>,
) -> Result<Json<UserGroup>> {
    if !claims.is_admin() {
        return Err(AppError::Forbidden);
    }
    if let Some(paths) = &req.allowed_paths {
        req.allowed_paths = Some(normalize_allowed_paths(paths)?);
    }
    let updated_group = state.users.update_group(&id, req).await?;

    state.audit.log(&claims.sub, "group_update", Some(id), None, Some("group permissions/paths modified".to_string())).await;

    Ok(Json(updated_group))
}

/// Escape a value for a CSV cell: double internal quotes (RFC 4180) and guard
/// against spreadsheet formula injection by prefixing a single quote when the
/// value begins with a character a spreadsheet would treat as a formula.
fn csv_field(s: &str) -> String {
    let guarded = if s.starts_with(['=', '+', '-', '@', '\t', '\r']) {
        format!("'{}", s)
    } else {
        s.to_string()
    };
    guarded.replace('"', "\"\"")
}

// ─── Audit logs ────────────────────────────────────────────────

pub async fn list_audit_logs(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Extension(perms): Extension<Vec<Permission>>,
    Query(q): Query<AuditQuery>,
) -> Result<Json<Vec<AuditEntry>>> {
    if !claims.is_admin() && !perms.contains(&Permission::ViewAudit) {
        return Err(AppError::Forbidden);
    }
    Ok(Json(state.audit.query(&q).await))
}

pub async fn export_audit_logs(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Extension(perms): Extension<Vec<Permission>>,
    Query(q): Query<AuditQuery>,
) -> Result<axum::response::Response> {
    if !claims.is_admin() && !perms.contains(&Permission::ViewAudit) {
        return Err(AppError::Forbidden);
    }

    let entries = state.audit.query(&q).await;

    let mut csv = String::from("timestamp,username,action,resource,ip,details\n");
    for entry in entries {
        csv.push_str(&format!(
            "\"{}\",\"{}\",\"{}\",\"{}\",\"{}\",\"{}\"\n",
            csv_field(&entry.timestamp.to_rfc3339()),
            csv_field(&entry.username),
            csv_field(&entry.action),
            csv_field(&entry.resource.unwrap_or_default()),
            csv_field(&entry.ip.unwrap_or_default()),
            csv_field(&entry.details.unwrap_or_default()),
        ));
    }

    let filename = format!("audit_{}.csv", chrono::Utc::now().format("%Y%m%d_%H%M%S"));
    axum::response::Response::builder()
        .status(axum::http::StatusCode::OK)
        .header("Content-Type", "text/csv; charset=utf-8")
        .header("Content-Disposition", format!("attachment; filename=\"{}\"", filename))
        .body(axum::body::Body::from(csv))
        .map_err(|e| AppError::Internal(e.into()))
}

pub async fn admin_set_password(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(username): Path<String>,
    Json(req): Json<ChangePasswordRequest>,
) -> Result<StatusCode> {
    if !claims.is_admin() {
        return Err(AppError::Forbidden);
    }
    if req.new_password.len() < 8 {
        return Err(AppError::BadRequest(
            "Password must be at least 8 characters".into(),
        ));
    }

    state.users.set_password(&username, &req.new_password).await?;

    state.audit.log(&claims.sub, "password_reset_admin", Some(username), None, None).await;

    Ok(StatusCode::NO_CONTENT)
}

/// Admin: revoke all of a user's active sessions (e.g. after a compromise),
/// invalidating every JWT they currently hold.
pub async fn revoke_user_sessions(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(username): Path<String>,
) -> Result<StatusCode> {
    if !claims.is_admin() {
        return Err(AppError::Forbidden);
    }
    state.users.bump_token_version(&username).await?;
    state.audit.log(&claims.sub, "revoke_sessions", Some(username), None, None).await;
    Ok(StatusCode::NO_CONTENT)
}

// ─── Self-service password change ────────────────────────────────────────────

pub async fn change_own_password(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<ChangePasswordRequest>,
) -> Result<StatusCode> {
    let current = req
        .current_password
        .as_deref()
        .ok_or_else(|| AppError::BadRequest("current_password is required".into()))?;

    if !state.users.verify_password(&claims.sub, current).await {
        state.audit.log(&claims.sub, "password_change_failed", None, None, Some("incorrect current password".to_string())).await;
        return Err(AppError::BadRequest("Current password is incorrect".into()));
    }

    if req.new_password.len() < 8 {
        return Err(AppError::BadRequest(
            "Password must be at least 8 characters".into(),
        ));
    }

    if req.new_password == current {
        return Err(AppError::BadRequest(
            "New password must differ from current password".into(),
        ));
    }

    state.users.set_password(&claims.sub, &req.new_password).await?;

    state.audit.log(&claims.sub, "password_change", None, None, None).await;

    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::{csv_field, normalize_allowed_paths};

    #[test]
    fn allowed_paths_are_canonicalized_or_rejected() {
        let ok = normalize_allowed_paths(&["/teamA/".into(), " /a//b ".into(), "/".into()]).unwrap();
        assert_eq!(ok, vec!["/teamA", "/a/b", "/"]);
        for bad in [".", "teamA", "/teamA/../teamB", ""] {
            assert!(normalize_allowed_paths(&[bad.into()]).is_err(), "{:?} must be rejected", bad);
        }
    }

    #[test]
    fn csv_field_neutralizes_formula_injection() {
        // Leading formula characters get a single-quote guard.
        assert_eq!(csv_field("=HYPERLINK(\"x\")"), "'=HYPERLINK(\"\"x\"\")");
        assert_eq!(csv_field("+1"), "'+1");
        assert_eq!(csv_field("-1"), "'-1");
        assert_eq!(csv_field("@SUM(A1)"), "'@SUM(A1)");
        // Benign values are left intact (quotes still doubled).
        assert_eq!(csv_field("/docs/report.txt"), "/docs/report.txt");
        assert_eq!(csv_field("alice"), "alice");
        assert_eq!(csv_field("say \"hi\""), "say \"\"hi\"\"");
    }
}
