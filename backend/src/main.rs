// Thin binary shim: all logic lives in the library crate (`lib.rs`) so it can
// also be linked by the fuzz targets and integration tests.
#[tokio::main]
async fn main() {
    fileflow::run().await
}
