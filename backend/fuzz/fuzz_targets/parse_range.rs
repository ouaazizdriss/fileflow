#![no_main]
// Fuzzes the HTTP Range-header parser (attacker-controlled `Range:` header).
// Invariant: it never panics, and any satisfiable range is well-formed and
// strictly in-bounds.
use libfuzzer_sys::fuzz_target;
use fileflow::files::{parse_range, RangeSpec};

fuzz_target!(|data: &[u8]| {
    if data.len() < 8 {
        return;
    }
    let total = u64::from_le_bytes(data[..8].try_into().unwrap());
    let header = String::from_utf8_lossy(&data[8..]);
    if let RangeSpec::Range(start, end) = parse_range(&header, total) {
        assert!(start <= end, "start {start} > end {end} for total {total}");
        assert!(end < total, "end {end} >= total {total}");
    }
});
