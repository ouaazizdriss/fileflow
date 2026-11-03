#![no_main]
// Fuzzes Content-Disposition header construction (attacker-controlled filenames).
// Invariant: output is pure ASCII with no control characters, so it is always a
// valid HTTP header value — this is what lets serve_file_ranged build the header
// without panicking (release builds use panic=abort).
use libfuzzer_sys::fuzz_target;
use fileflow::files::content_disposition;

fuzz_target!(|data: &[u8]| {
    let name = String::from_utf8_lossy(data);
    let cd = content_disposition(&name);
    assert!(cd.is_ascii(), "non-ascii in header: {cd:?}");
    assert!(!cd.chars().any(|c| c.is_control()), "control char in header: {cd:?}");
});
