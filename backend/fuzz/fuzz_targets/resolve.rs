#![no_main]
// Fuzzes the path resolver (attacker-controlled virtual paths). This is the core
// path-traversal defense. Invariant: it never panics, and any Ok(path) stays
// inside the canonical root.
use libfuzzer_sys::fuzz_target;
use std::path::Path;
use fileflow::files::resolve;

fuzz_target!(|data: &[u8]| {
    let user_path = String::from_utf8_lossy(data);
    // A fixed, existing root (this crate's dir); resolve canonicalizes it.
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    if let Ok(p) = resolve(root, &user_path) {
        let canon = root.canonicalize().expect("manifest dir canonicalizes");
        assert!(p.starts_with(&canon), "resolved path escaped root: {p:?}");
    }
});
