#![no_main]
// Fuzzes filename sanitization (attacker-controlled upload filenames).
// Invariant: output never contains a path separator or control character, and
// never starts with '.' or ' ' — so it can't traverse paths, create dotfiles,
// or corrupt Content-Disposition headers downstream.
use libfuzzer_sys::fuzz_target;
use fileflow::files::sanitize_name;

fuzz_target!(|data: &[u8]| {
    let s = String::from_utf8_lossy(data);
    let out = sanitize_name(&s);
    assert!(!out.contains('/') && !out.contains('\\'), "separator survived: {out:?}");
    assert!(!out.chars().any(|c| c.is_control()), "control char survived: {out:?}");
    assert!(!out.starts_with('.') && !out.starts_with(' '), "bad leading char: {out:?}");
});
