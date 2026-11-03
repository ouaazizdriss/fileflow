use rand::Rng;
use totp_rs::{Secret, TOTP, Algorithm};

/// Generate a random TOTP secret (20 bytes) and return as base32 string.
/// `Secret::generate_secret()` yields a `Secret::Raw`, whose `Display` renders
/// as hex — not valid for `otpauth://` URIs. Convert to base32 via `to_encoded()`
/// so authenticator apps (and our own `verify_code`) decode the same bytes.
pub fn generate_secret() -> String {
    Secret::generate_secret().to_encoded().to_string()
}

/// Generate a QR code provisioning URI (otpauth://) that frontend will render
/// Format: otpauth://totp/issuer:accountname?secret=SECRET&issuer=ISSUER&algorithm=SHA1&digits=6&period=30
pub fn generate_qr_uri(username: &str, secret: &str, issuer: &str) -> anyhow::Result<String> {
    // Build otpauth URI with all required parameters for authenticator apps.
    // Label (issuer:accountname) must NOT be percent-encoded per RFC.
    let uri = format!(
        "otpauth://totp/{}:{}?secret={}&issuer={}&algorithm=SHA1&digits=6&period=30",
        issuer,
        username,
        secret,
        issuer
    );

    Ok(uri)
}

/// Verify a 6-digit code against the secret. Accepts ±1 time window (90 sec tolerance)
pub fn verify_code(secret: &str, code: &str) -> bool {
    if code.len() != 6 || !code.chars().all(|c| c.is_ascii_digit()) {
        return false;
    }

    // Decode the base32 secret string to bytes
    let bytes = match Secret::Encoded(secret.to_string()).to_bytes() {
        Ok(b) => b,
        Err(_) => return false,
    };

    let totp = match TOTP::new(
        Algorithm::SHA1,
        6,
        1,
        30,
        bytes,
        None,
        String::new(),
    ) {
        Ok(t) => t,
        Err(_) => return false,
    };

    // Check current window
    totp.check_current(code).unwrap_or(false)
}

/// Generate 10 recovery codes (plaintext and bcrypt-hashed)
/// Format: XXXXXX-XXXXXX (12 random hex chars split by dash)
pub fn generate_recovery_codes() -> (Vec<String>, Vec<String>) {
    let mut rng = rand::thread_rng();
    let mut plaintext = Vec::new();
    let mut hashed = Vec::new();

    for _ in 0..10 {
        let code_hex: String = (0..12)
            .map(|_| format!("{:x}", rng.gen_range(0..16)))
            .collect();
        let formatted_code = format!("{}-{}", &code_hex[..6], &code_hex[6..]);
        plaintext.push(formatted_code.clone());

        // Hash for storage
        if let Ok(hash) = bcrypt::hash(&formatted_code, bcrypt::DEFAULT_COST) {
            hashed.push(hash);
        }
    }

    (plaintext, hashed)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The generated secret must be valid base32 (RFC 4648) so that authenticator
    /// apps and `verify_code` decode the same key. Hex (the Raw Display default)
    /// would silently break 2FA.
    #[test]
    fn generated_secret_is_valid_base32() {
        let secret = generate_secret();
        assert!(
            Secret::Encoded(secret.clone()).to_bytes().is_ok(),
            "secret '{}' is not decodable base32",
            secret
        );
        // base32 alphabet is A-Z and 2-7 only — hex digits 0,1,8,9 must be absent
        assert!(
            secret.chars().all(|c| c.is_ascii_uppercase() || ('2'..='7').contains(&c)),
            "secret '{}' contains non-base32 characters",
            secret
        );
    }

    /// A code derived from the generated secret must verify against it, proving the
    /// QR secret and the server-side verifier agree on the underlying key.
    #[test]
    fn generated_secret_round_trips_through_verify() {
        let secret = generate_secret();
        let bytes = Secret::Encoded(secret.clone()).to_bytes().unwrap();
        let totp = TOTP::new(Algorithm::SHA1, 6, 1, 30, bytes, None, String::new()).unwrap();
        let code = totp.generate_current().unwrap();
        assert!(verify_code(&secret, &code), "valid TOTP code failed to verify");
    }
}
