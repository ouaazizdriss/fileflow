use std::{path::PathBuf, sync::Arc};
use chrono::Utc;
use tokio::{fs::OpenOptions, io::AsyncWriteExt, sync::Mutex};
use crate::models::{AuditEntry, AuditQuery};

/// Extract the client IP from proxy headers. These headers are client-supplied
/// and trivially spoofable, so they are only honored when `trust_proxy` is true
/// (i.e. the deployment sits behind a reverse proxy that overwrites them).
/// When false — the default — callers should fall back to the socket peer
/// address instead, otherwise an attacker could forge `X-Forwarded-For` to
/// evade IP-based rate limiting and poison audit logs.
/// Client IP for rate limiting: proxy headers when trusted, else the socket peer.
pub fn client_ip(headers: &axum::http::HeaderMap, trust_proxy: bool, peer: std::net::SocketAddr) -> String {
    extract_ip(headers, trust_proxy).unwrap_or_else(|| peer.ip().to_string())
}

pub fn extract_ip(headers: &axum::http::HeaderMap, trust_proxy: bool) -> Option<String> {
    if !trust_proxy {
        return None;
    }

    // Try X-Forwarded-For first (load balancer)
    if let Some(header) = headers.get("X-Forwarded-For")
        .and_then(|h| h.to_str().ok())
    {
        if let Some(ip) = header.split(',').next() {
            return Some(ip.trim().to_string());
        }
    }

    // Try X-Real-IP
    if let Some(header) = headers.get("X-Real-IP")
        .and_then(|h| h.to_str().ok())
    {
        return Some(header.to_string());
    }

    None
}

/// Rotate the append-only log once it reaches this size, so it can't grow
/// without bound. One previous segment is kept (`<path>.1`) and remains visible
/// to queries; a second rotation discards it.
const MAX_AUDIT_BYTES: u64 = 50 * 1024 * 1024;

#[derive(Clone)]
pub struct AuditLogger {
    path: PathBuf,
    lock: Arc<Mutex<()>>,
}

impl AuditLogger {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            lock: Arc::new(Mutex::new(())),
        }
    }

    /// Path of the single retained rotated segment.
    fn rotated_path(&self) -> PathBuf {
        let mut s = self.path.clone().into_os_string();
        s.push(".1");
        PathBuf::from(s)
    }

    pub async fn log(&self, username: &str, action: &str, resource: Option<String>, ip: Option<String>, details: Option<String>) {
        let entry = AuditEntry {
            timestamp: Utc::now(),
            username: username.to_string(),
            action: action.to_string(),
            resource,
            ip,
            details,
        };

        if let Ok(json) = serde_json::to_string(&entry) {
            let _guard = self.lock.lock().await;

            // Rotate before appending if the current segment is full.
            if let Ok(meta) = tokio::fs::metadata(&self.path).await {
                if meta.len() >= MAX_AUDIT_BYTES {
                    let _ = tokio::fs::rename(&self.path, &self.rotated_path()).await;
                }
            }

            if let Ok(mut file) = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&self.path)
                .await
            {
                let _ = file.write_all(format!("{}\n", json).as_bytes()).await;
            }
        }
    }

    /// Concatenate the retained rotated segment (if any) followed by the current
    /// log, so reads see recent history across a rotation boundary.
    async fn read_all(&self) -> String {
        let mut out = String::new();
        if let Ok(c) = tokio::fs::read_to_string(&self.rotated_path()).await {
            out.push_str(&c);
            if !c.ends_with('\n') {
                out.push('\n');
            }
        }
        if let Ok(c) = tokio::fs::read_to_string(&self.path).await {
            out.push_str(&c);
        }
        out
    }

    pub async fn list(&self, limit: usize) -> Vec<AuditEntry> {
        let content = self.read_all().await;
        let mut entries: Vec<AuditEntry> = content
            .lines()
            .filter_map(|line| serde_json::from_str(line).ok())
            .collect();

        entries.sort_by_key(|x| std::cmp::Reverse(x.timestamp));
        entries.truncate(limit);
        entries
    }

    pub async fn query(&self, q: &AuditQuery) -> Vec<AuditEntry> {
        {
            let content = self.read_all().await;
            let mut entries: Vec<AuditEntry> = content
                .lines()
                .filter_map(|line| serde_json::from_str(line).ok())
                .filter(|entry: &AuditEntry| {
                    // Filter by username (contains)
                    if let Some(ref username) = q.username {
                        if !entry.username.to_lowercase().contains(&username.to_lowercase()) {
                            return false;
                        }
                    }

                    // Filter by action (contains or exact)
                    if let Some(ref action) = q.action {
                        if !entry.action.to_lowercase().contains(&action.to_lowercase()) {
                            return false;
                        }
                    }

                    // Filter by date range
                    if let Some(from) = q.from {
                        if entry.timestamp < from {
                            return false;
                        }
                    }
                    if let Some(to) = q.to {
                        if entry.timestamp > to {
                            return false;
                        }
                    }

                    // Filter by resource (contains)
                    if let Some(ref resource) = q.resource {
                        if let Some(ref r) = entry.resource {
                            if !r.to_lowercase().contains(&resource.to_lowercase()) {
                                return false;
                            }
                        } else {
                            return false;
                        }
                    }

                    true
                })
                .collect();

            entries.sort_by_key(|x| std::cmp::Reverse(x.timestamp));

            // Apply pagination
            let limit = q.limit.unwrap_or(500).min(5000); // max 5000
            let offset = q.offset.unwrap_or(0);

            entries.into_iter()
                .skip(offset)
                .take(limit)
                .collect()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderMap;

    #[test]
    fn extract_ip_prefers_forwarded_for_then_real_ip_when_trusted() {
        let mut h = HeaderMap::new();
        h.insert("X-Forwarded-For", "1.2.3.4, 5.6.7.8".parse().unwrap());
        assert_eq!(extract_ip(&h, true), Some("1.2.3.4".to_string()));

        let mut h2 = HeaderMap::new();
        h2.insert("X-Real-IP", "9.9.9.9".parse().unwrap());
        assert_eq!(extract_ip(&h2, true), Some("9.9.9.9".to_string()));

        assert_eq!(extract_ip(&HeaderMap::new(), true), None);
    }

    #[test]
    fn extract_ip_ignores_spoofable_headers_when_untrusted() {
        // With trust_proxy = false the client-supplied headers must be ignored
        // so a forged X-Forwarded-For cannot evade IP rate limiting.
        let mut h = HeaderMap::new();
        h.insert("X-Forwarded-For", "1.2.3.4".parse().unwrap());
        h.insert("X-Real-IP", "9.9.9.9".parse().unwrap());
        assert_eq!(extract_ip(&h, false), None);
    }

    #[tokio::test]
    async fn query_reads_across_rotation_boundary() {
        let dir = tempfile::tempdir().unwrap();
        let logger = AuditLogger::new(dir.path().join("audit.json"));

        // Simulate a previously-rotated segment sitting alongside the live log.
        let old = AuditEntry {
            timestamp: Utc::now() - chrono::Duration::hours(1),
            username: "old".into(), action: "login".into(),
            resource: None, ip: None, details: None,
        };
        tokio::fs::write(logger.rotated_path(), format!("{}\n", serde_json::to_string(&old).unwrap()))
            .await.unwrap();

        // A fresh entry goes to the current segment.
        logger.log("new", "upload", None, None, None).await;

        let q = AuditQuery {
            username: None, action: None, from: None, to: None,
            resource: None, limit: None, offset: None,
        };
        let r = logger.query(&q).await;
        // Both the rotated and the current entry are visible.
        assert_eq!(r.len(), 2);
        assert_eq!(r[0].action, "upload"); // newest first
    }

    #[tokio::test]
    async fn query_filters_sorts_and_paginates() {
        let dir = tempfile::tempdir().unwrap();
        let logger = AuditLogger::new(dir.path().join("audit.json"));
        logger.log("alice", "login", None, Some("1.1.1.1".into()), None).await;
        logger.log("bob", "upload", Some("/f.txt".into()), None, None).await;
        logger.log("alice", "download", Some("/g.txt".into()), None, None).await;

        // Filter by username substring; newest entry first.
        let q = AuditQuery {
            username: Some("alice".into()), action: None, from: None, to: None,
            resource: None, limit: None, offset: None,
        };
        let r = logger.query(&q).await;
        assert_eq!(r.len(), 2);
        assert!(r.iter().all(|e| e.username == "alice"));
        assert_eq!(r[0].action, "download");

        // Filter by action.
        let q = AuditQuery {
            username: None, action: Some("upload".into()), from: None, to: None,
            resource: None, limit: None, offset: None,
        };
        assert_eq!(logger.query(&q).await.len(), 1);

        // Filter by resource substring.
        let q = AuditQuery {
            username: None, action: None, from: None, to: None,
            resource: Some("g.txt".into()), limit: None, offset: None,
        };
        assert_eq!(logger.query(&q).await.len(), 1);

        // Pagination: limit 1, offset 1 → exactly one row.
        let q = AuditQuery {
            username: None, action: None, from: None, to: None,
            resource: None, limit: Some(1), offset: Some(1),
        };
        assert_eq!(logger.query(&q).await.len(), 1);
    }
}
