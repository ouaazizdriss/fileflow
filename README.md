# FileFlow

**[Take the interactive product tour →](https://ouaazizdriss.github.io/fileflow/)**

FileFlow is a self-hosted file platform: resumable uploads, rich in-browser previews, share links,
team folders and upload requests, in a single container on your own server. Files stay on your disk
as plain files, with no per-seat fees.

- **Backend:** Rust (Axum), SQLite
- **Frontend:** React, TypeScript, Vite, Tailwind
- **Languages:** English and French

## Features

| Area | What you get |
|---|---|
| Uploads | Drag and drop, chunked and resumable, with a blocklist of executable types and per-user quotas |
| Previews | Images, video, audio, PDF, Markdown, CSV, Excel, Word, PowerPoint and code |
| Sharing | Public links with an expiry, an optional password and a download limit; direct shares between users; team folders |
| Upload requests | A drop-box link that lets people without an account send you files |
| History | Previous versions kept on overwrite, and a Trash to restore from |
| Organisation | Search, tags and favorites |
| Administration | Users, groups, roles, per-path rules, quotas, sessions and an exportable audit log |
| Security | TOTP two-factor authentication, strict CSP, Secure and SameSite cookies, rate-limited logins and links, path-traversal and symlink protection |

## Quick start

```bash
echo "ADMIN_PASSWORD=change-me" > .env
make up            # builds the frontend, the backend and the Docker image, then starts it
```

FileFlow is then running at http://localhost:8080. Sign in as `admin` with the password from `.env`.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | | The first administrator, created on first start |
| `ROOT_DIR` | | Where files are stored |
| `CONFIG_DIR` | | Users, settings and the generated secret |
| `PORT` | `8080` | HTTP port |
| `MAX_UPLOAD_MB` | `200` | Largest file a signed-in user can upload |
| `PUBLIC_UPLOAD_MAX_MB` | `100` | Largest file sent through an upload request, capped by `MAX_UPLOAD_MB` |
| `COOKIE_SECURE` | `true` | Set to `false` only for local HTTP |
| `TRUST_PROXY_HEADERS` | `false` | Set to `true` only behind a reverse proxy that sets `X-Forwarded-For` |
| `JWT_SECRET` | generated | Session signing secret; generated into `CONFIG_DIR` when unset |

## Development

```bash
cd backend && cargo test            # backend tests
cd frontend && pnpm install && pnpm test && pnpm dev
```

CI runs linting, tests and builds on every push, plus Semgrep, cargo-audit, cargo-deny, pnpm audit,
Trivy, Gitleaks and fuzzing.

## Documentation

The engineering documentation (architecture, ADRs, threat model, GDPR, API, operations, security
audit) is in [`documentation/`](documentation/README.md), in French.
