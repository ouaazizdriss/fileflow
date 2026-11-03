# Fuzz targets

Coverage-guided fuzzing (via [`cargo-fuzz`] / libFuzzer) for the parsers that
consume attacker-controlled input. Each target asserts a safety invariant, so a
crash means either a panic (a DoS risk — release builds use `panic = "abort"`)
or a violated security property.

| Target | Function | Invariant checked |
|--------|----------|-------------------|
| `resolve` | `files::resolve` | resolved paths never escape the canonical root (path traversal) |
| `sanitize_name` | `files::sanitize_name` | no path separators, control chars, or leading `.`/space |
| `parse_range` | `files::parse_range` | satisfiable ranges are well-formed and in-bounds |
| `content_disposition` | `files::content_disposition` | output is always a valid (ASCII, control-free) header value |

## Run

```bash
# Requires nightly + cargo-fuzz:  rustup toolchain install nightly && cargo install cargo-fuzz
cd backend
cargo +nightly fuzz run resolve -- -max_total_time=60
```

Reproduce a crash: `cargo +nightly fuzz run <target> fuzz/artifacts/<target>/<crash-file>`.

CI runs each target for 60s on the weekly schedule (see `.github/workflows/security.yml`).

[`cargo-fuzz`]: https://github.com/rust-fuzz/cargo-fuzz
