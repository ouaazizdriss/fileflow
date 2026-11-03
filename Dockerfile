# ─── Stage 1: Frontend Build ──────────────────────────────────────────────────
FROM node:25-slim AS frontend-builder
RUN npm install -g pnpm@10
WORKDIR /build
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm run build

# ─── Stage 2: Backend Build (fully static, musl) ──────────────────────────────
# Build against x86_64-unknown-linux-musl so the binary is fully static and can
# run on distroless/static (no glibc/openssl/gcc runtime → no base-image CVEs).
# musl-tools provides musl-gcc, needed because rusqlite bundles SQLite (C) via cc.
# Our JWT backend is pure-Rust (rust_crypto), so no OpenSSL/aws-lc is required.
FROM rust:slim-bookworm AS backend-builder
WORKDIR /build

RUN apt-get update \
    && apt-get install -y --no-install-recommends musl-tools musl-dev \
    && rm -rf /var/lib/apt/lists/*
RUN rustup target add x86_64-unknown-linux-musl
# crt-static + non-PIE (relocation-model=static) yields a fully static ELF with
# NO interpreter, so it runs on distroless/static (which ships no musl loader).
# Without this, musl defaults to static-PIE, which still references
# /lib/ld-musl-x86_64.so.1 and fails to exec there.
ENV CC_x86_64_unknown_linux_musl=musl-gcc \
    CARGO_TARGET_X86_64_UNKNOWN_LINUX_MUSL_LINKER=musl-gcc \
    RUSTFLAGS="-C target-feature=+crt-static -C relocation-model=static"

# Dependency cache layer: build deps against a stub lib+bin before copying src.
RUN cargo new --bin backend
COPY backend/Cargo.toml backend/Cargo.lock ./backend/
WORKDIR /build/backend
RUN echo '' > src/lib.rs \
    && cargo build --release --target x86_64-unknown-linux-musl
RUN rm src/*.rs

COPY backend/src ./src
RUN touch src/lib.rs src/main.rs \
    && cargo build --release --target x86_64-unknown-linux-musl

# Pre-create /data for distroless (UID 65532 = nonroot)
RUN mkdir -p /data && chown 65532:65532 /data

# ─── Stage 3: Final Runtime (static distroless) ───────────────────────────────
FROM gcr.io/distroless/static-debian12:nonroot

WORKDIR /app
COPY --from=backend-builder /build/backend/target/x86_64-unknown-linux-musl/release/fileflow ./fileflow
COPY --from=frontend-builder /build/dist ./dist

COPY --from=backend-builder /data /data

USER nonroot
ENV ROOT_DIR=/data
ENV PORT=8080

EXPOSE 8080

# Self-contained health probe (the distroless image has no shell/curl/wget).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["./fileflow", "healthcheck"]

CMD ["./fileflow"]
