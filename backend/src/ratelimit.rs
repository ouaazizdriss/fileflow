//! Shared brute-force lockout used by both password login and TOTP/2FA
//! verification. Keys are opaque strings (an IP, a username, …); after
//! `MAX_ATTEMPTS` consecutive failures a key is locked for `LOCKOUT_SECS`.

use std::{collections::HashMap, sync::Arc, time::{Duration, Instant}};
use tokio::sync::Mutex;

pub const MAX_ATTEMPTS: u8 = 5;
pub const LOCKOUT_SECS: u64 = 15 * 60;
/// Failures against one username, from all IPs together, before the account
/// itself locks. Well above `MAX_ATTEMPTS`: the per-(user, IP) lock stops a
/// single client, and this one only has to stop guessing spread over many IPs,
/// so that a stranger can't lock someone out with five bad passwords.
pub const ACCOUNT_MAX_ATTEMPTS: u8 = 50;

#[derive(Clone)]
pub struct Attempt {
    pub count: u8,
    pub lockout_until: Option<Instant>,
    /// When the last failure was recorded; lets the pruner drop stale entries
    /// so the map doesn't grow without bound from one-off failed keys.
    pub last_failure: Instant,
}

pub type Limiter = Arc<Mutex<HashMap<String, Attempt>>>;

pub fn new_limiter() -> Limiter {
    Arc::new(Mutex::new(HashMap::new()))
}

/// Pure predicate: is `attempt` locked out at instant `now`?
pub fn is_locked(attempt: &Attempt, now: Instant) -> bool {
    matches!(attempt.lockout_until, Some(until) if now < until)
}

/// Returns true if `key` is currently locked. An expired lockout is reset to a
/// clean slate as a side effect so the next failure starts a fresh count.
pub async fn locked(limiter: &Limiter, key: &str) -> bool {
    let mut map = limiter.lock().await;
    if let Some(attempt) = map.get_mut(key) {
        if is_locked(attempt, Instant::now()) {
            return true;
        }
        if attempt.lockout_until.is_some() {
            // Lockout expired — reset.
            *attempt = Attempt { count: 0, lockout_until: None, last_failure: Instant::now() };
        }
    }
    false
}

/// Record one failed attempt against `key`, arming a lockout once the threshold
/// is reached.
pub async fn record_failure(limiter: &Limiter, key: &str) {
    record_failure_max(limiter, key, MAX_ATTEMPTS).await;
}

/// `record_failure` with a custom threshold.
pub async fn record_failure_max(limiter: &Limiter, key: &str, max_attempts: u8) {
    let now = Instant::now();
    let mut map = limiter.lock().await;
    let attempt = map
        .entry(key.to_string())
        .or_insert(Attempt { count: 0, lockout_until: None, last_failure: now });
    attempt.count = attempt.count.saturating_add(1);
    attempt.last_failure = now;
    if attempt.count >= max_attempts {
        attempt.lockout_until = Some(now + Duration::from_secs(LOCKOUT_SECS));
    }
}

/// Pure predicate: can this entry still influence a lockout decision at `now`?
/// False for expired lockouts and for failure counts whose last failure is
/// older than the lockout window.
pub fn still_relevant(a: &Attempt, now: Instant) -> bool {
    match a.lockout_until {
        Some(until) => now < until,
        None => now.saturating_duration_since(a.last_failure).as_secs() < LOCKOUT_SECS,
    }
}

/// Drop entries that no longer matter. Called periodically so unique keys
/// (usernames, IPs) sprayed by an attacker don't accumulate in memory forever.
pub async fn prune(limiter: &Limiter) {
    let now = Instant::now();
    limiter.lock().await.retain(|_, a| still_relevant(a, now));
}

/// Clear all failure state for `key` (call on a successful authentication).
pub async fn clear(limiter: &Limiter, key: &str) {
    limiter.lock().await.remove(key);
}

/// Lockout keys for a password attempt on a public link (share or upload
/// request). Both count: the link key bounds a guess spread over many IPs, the
/// IP key bounds one client spraying many links. On success clear only the link
/// key, so a client can't reset its IP counter with a link it knows.
pub fn link_keys(token: &str, ip: &str) -> [String; 2] {
    [format!("link:{}", token), format!("ip:{}", ip)]
}

/// Key for the per-(username, IP) login lockout. Debug formatting quotes both
/// parts, so no username/IP pair can collide with another.
pub fn user_ip_key(username: &str, ip: &str) -> String {
    format!("{:?}{:?}", username, ip)
}

pub async fn any_locked(limiter: &Limiter, keys: &[String]) -> bool {
    for key in keys {
        if locked(limiter, key).await {
            return true;
        }
    }
    false
}

pub async fn record_failure_all(limiter: &Limiter, keys: &[String]) {
    for key in keys {
        record_failure(limiter, key).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn custom_threshold_locks_only_at_its_own_count() {
        let l = new_limiter();
        for _ in 0..ACCOUNT_MAX_ATTEMPTS - 1 {
            record_failure_max(&l, "acct", ACCOUNT_MAX_ATTEMPTS).await;
        }
        assert!(!locked(&l, "acct").await);
        record_failure_max(&l, "acct", ACCOUNT_MAX_ATTEMPTS).await;
        assert!(locked(&l, "acct").await);
    }

    #[test]
    fn user_ip_keys_do_not_collide() {
        assert_ne!(user_ip_key("a", "bc"), user_ip_key("ab", "c"));
        assert_ne!(user_ip_key("a\"", "b"), user_ip_key("a", "\"b"));
    }

    #[tokio::test]
    async fn link_lockout_triggers_on_either_key_and_success_keeps_ip_count() {
        let l = new_limiter();
        let keys = link_keys("tok", "1.2.3.4");
        for _ in 0..MAX_ATTEMPTS - 1 {
            record_failure_all(&l, &keys).await;
        }
        assert!(!any_locked(&l, &keys).await);
        // A correct password on the link clears only the link key…
        clear(&l, &keys[0]).await;
        // …so the same IP is locked after one more failure, on any link.
        record_failure_all(&l, &link_keys("other", "1.2.3.4")).await;
        assert!(any_locked(&l, &link_keys("tok", "1.2.3.4")).await);
        // A different client on the original link is unaffected.
        assert!(!any_locked(&l, &link_keys("tok", "5.6.7.8")).await);
    }

    #[test]
    fn is_locked_is_pure_and_time_aware() {
        let now = Instant::now();
        let none = Attempt { count: 3, lockout_until: None, last_failure: now };
        assert!(!is_locked(&none, now));

        let future = Attempt { count: 5, lockout_until: Some(now + Duration::from_secs(60)), last_failure: now };
        assert!(is_locked(&future, now));

        let past = Attempt { count: 5, lockout_until: Some(now - Duration::from_secs(1)), last_failure: now };
        assert!(!is_locked(&past, now));
    }

    #[test]
    fn still_relevant_keeps_live_entries_and_drops_stale_ones() {
        let base = Instant::now();
        let later = base + Duration::from_secs(LOCKOUT_SECS + 1);

        // Active lockout — kept.
        let locked = Attempt { count: MAX_ATTEMPTS, lockout_until: Some(later + Duration::from_secs(60)), last_failure: base };
        assert!(still_relevant(&locked, base));
        // Expired lockout — dropped.
        assert!(!still_relevant(&locked, later + Duration::from_secs(120)));

        // Recent failures, no lockout — kept (still counting toward one).
        let counting = Attempt { count: 2, lockout_until: None, last_failure: base };
        assert!(still_relevant(&counting, base + Duration::from_secs(1)));
        // Failures older than the lockout window — dropped.
        assert!(!still_relevant(&counting, later));
    }

    #[tokio::test]
    async fn prune_removes_stale_map_entries() {
        let lim = new_limiter();
        record_failure(&lim, "fresh").await;
        prune(&lim).await;
        // A just-recorded failure survives pruning.
        assert_eq!(lim.lock().await.len(), 1);
    }

    #[tokio::test]
    async fn locks_after_max_attempts_and_clears() {
        let lim = new_limiter();
        for _ in 0..(MAX_ATTEMPTS - 1) {
            record_failure(&lim, "user").await;
        }
        assert!(!locked(&lim, "user").await, "should not lock before the threshold");

        record_failure(&lim, "user").await; // hits MAX_ATTEMPTS
        assert!(locked(&lim, "user").await, "should lock at the threshold");

        clear(&lim, "user").await;
        assert!(!locked(&lim, "user").await, "clear() must remove the lockout");
    }

    #[tokio::test]
    async fn unrelated_keys_are_independent() {
        let lim = new_limiter();
        for _ in 0..MAX_ATTEMPTS {
            record_failure(&lim, "a").await;
        }
        assert!(locked(&lim, "a").await);
        assert!(!locked(&lim, "b").await);
    }
}
