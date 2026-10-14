# Local operations and deployment limits

Compose services are project-namespaced, persistent volumes are local, mapped ports bind to 127.0.0.1 only. PostgreSQL official entrypoint bootstraps roles before accepting application use; app images run as node (non-root). Redis is persistent AOF/noeviction; cache and queues share only the development instance. Mailpit has no relay configuration. No real email sender or payment adapter exists.

Migration is a separate command/container under confsys_migrator, serialized by a PostgreSQL advisory transaction lock. The ledger tracks SHA-256 checksums, rejecting edited applied migrations. Migrations are forward-only; write an explicit repair/forward migration after review, not automatic down migrations. API and worker readiness require the foundation migration and safe database roles. Applications never get migrator/admin credentials through Compose service env.

Development app images contain build dependencies; do not treat them as hardened production images. Before production: separate queue/cache instances, TLS/reverse-proxy controls, managed secrets, restricted network access, backup policy, object storage, logs/metrics/alerts, vulnerability review, public rendering, capacity testing, provider sandbox verification and actual authorization/session flows. `NODE_ENV=production` is a runtime optimization, not a production-readiness certification.

## Shutdown and recovery

`pnpm dev` runs all three processes with signal propagation; API closes DB/Redis on Fastify close, worker stops accepting jobs and waits for the active synthetic processor before closing dependencies. Containers use init and 15-second grace. Future long-running handlers need explicit cancellation/deadlines and crash/retry tests.

Restart infrastructure with `pnpm infra:up`; restart app containers with `docker compose --profile app up -d --no-build --wait api worker web`. Readiness must recover; liveness is intentionally independent of dependency outages. Host `pnpm dev` and container Web share port 25173; choose one at a time. Never stop unrelated host processes to free these ports.

## Backup/restore procedure (documented, restore drill unverified)

For an isolated local rehearsal, after generating local credentials and starting the matching Compose project:

```sh
docker compose exec -T postgres pg_dump -U postgres -Fc confsys > /tmp/confsys-local.dump
# Create a separate restore database; never overwrite the source database.
docker compose exec -T postgres createdb -U postgres -O confsys_migrator confsys_restore
docker compose exec -T postgres pg_restore -U postgres -d confsys_restore --exit-on-error < /tmp/confsys-local.dump
```

A real production plan must also back up cluster roles/ownership, encrypted secrets and private storage with coordinated retention. Validate checksums, migration state, counts, referenced objects, keys and authorization in the restored isolated environment. Define RPO/RTO with the organization; no values or successful restore claim is invented here. Dumps contain sensitive data once real records exist and need encryption/access controls. Do not commit backups. Phase 0 has no real user data or object storage to restore.

## Phase 1.1 local identity/mail operations

The earlier Phase 0 descriptions of no sender/session are historical. Phase 1.1 adds capture-only auth mail, still no external provider or production credentials. Run `pnpm env:setup` once to append missing auth settings while preserving existing secrets. `pnpm infra:up`, `pnpm db:migrate`, `pnpm dev`; use `/auth/register`, then Mailpit at `http://127.0.0.1:28025` to locate the exact synthetic recipient. Follow the verification link, explicitly submit a new password, then login. Forgot/reset uses the same mailbox. Do not share a Mailpit link/token or expose Mailpit publicly.

| Setting | Default / effect |
|---|---|
| `PUBLIC_APP_ORIGIN` | required exact origin; local generated `http://127.0.0.1:25173`; used for Origin allowlist and links |
| `SESSION_IDLE_SECONDS` | 1800 (30 min); refreshed by valid `/me`; absolute bound still applies |
| `SESSION_ABSOLUTE_SECONDS` | 43200 (12 h); server enforced, cookie max-age same |
| `VERIFICATION_TTL_SECONDS` | 86400 (24 h) |
| `RESET_TTL_SECONDS` | 1800 (30 min) |
| `CSRF_SIGNING_KEY` | required random 32-byte hex; anonymous CSRF cookie signature; also keyed rate identifiers |
| `MAIL_ENCRYPTION_KEY` / `MAIL_KEY_VERSION` | required random 32-byte hex / nonsecret version, generated `v1` |
| `SMTP_HOST` / `SMTP_PORT` | only 127.0.0.1/localhost/mailpit and 21025/1025; Compose uses mailpit:1025 |

TTL values centrally validate 60 seconds to 30 days; idle may not exceed absolute. Production rejects HTTP public origins. Local HTTP exceptions are limited to explicit development/test with loopback. Compose intentionally sets development because it is a local HTTP capture environment, not a production configuration.

Source limit: 100 mutations per 15 minutes; per email/purpose: login 10, register/resend shared 5, forgot 5. Token submissions also have 5 per token plus source limit. Counters expire, no permanent account lock. API never trusts arbitrary forwarded source headers. Behind a proxy all requests currently share its source address: configure/test a trusted proxy policy before production, never blindly trust X-Forwarded-For. Rate Redis unavailable → 503 for public authentication/mail operations; DB-backed `/me` and logout do not depend on Redis/worker health. Already-committed outbox waits for recovery.

### Delivery and diagnostics

Structured logs contain service/event and applicable request/event/attempt IDs, not body/query/headers, addresses, links, DSNs or raw exceptions. Correlate API `x-request-id` with `auth_audit.request_id` and `notifications.request_id`. Read-only local diagnostics (not a public endpoint):

```sh
docker compose exec -T postgres psql -U postgres -d confsys -c \
  'SELECT id, request_id, kind, status, stage, attempts, result_code, lease_until FROM confsys.notifications ORDER BY created_at DESC LIMIT 20'
```

Use an authorized operator connection for diagnosis; do not give superuser/migrator credentials to runtime. `accepted` is SMTP acceptance only. `pending` survives queue delay/loss; dispatcher polls every second in batches of 100. `processing/claimed` leases expire back to pending after 60s. `processing/sending` expires to `unknown`, never auto-resends. Known DNS/connection failure at SMTP CONN retries at most three attempts, 30s apart; ambiguous failures are unknown. `cancelled` means token expired/used/revoked or identity state changed; `failed/SECRET_UNAVAILABLE` means key/version/decryption issue. Unexpected DB/queue failures preserve their failure outcome and leave durable state for recovery.

For unknown delivery, check Mailpit by message ID (`<notification-id@confsys.invalid>`) and recipient through authorized local access. Do not blindly change status to pending. A user may explicitly request a new link; previously issued unexpired links remain valid until successful consumption revokes siblings. A duplicate accepted or unknown job does nothing. No exactly-once or inbox-delivery guarantee.

### Secret lifecycle and recovery

Setup generates independent random encryption/CSRF keys with Node crypto into ignored mode-0600 `.env`; it never prints them. Real deployments must use a managed secret store and independent access controls. Keep encryption keys out of DB backups, but back them up separately with strict access and matching version. A version marker is not the secret.

The current worker supports one active key version. For deliberate rotation: stop new API mail requests, let pending/processing work finish or expire, confirm no remaining nonterminal secrets with read-only counts, stop API/worker, securely provision a new random key and a new version, then restart both consistently. Do not rotate only one process. No online multi-key re-encryption facility is implemented. Losing a key makes pending ciphertext unreadable; workers mark failed/SECRET_UNAVAILABLE and remove it. Users request new links after configuration repair. Already delivered token hashes and passwords are unaffected. CSRF key rotation invalidates CSRF cookies/rate identifiers; obtain a new CSRF cookie before retrying, server-side login sessions remain DB-backed.

Worker automatically deletes ciphertext on accepted/failed/unknown/cancelled or expiry. Expired tokens/session hashes remain inert because every use validates DB state/time; lifecycle retention/purge beyond delivery secrets is tracked in ROADMAP and must preserve required audit history. Do not dump secret tables, reset shared volumes, clear all Redis keys or delete others' Mailpit messages for cleanup. E2E leaves only identifiable synthetic recipients in the guarded test DB/Mailpit. Backup/restore with encrypted secrets, retention periods and production monitoring still require an operator-approved rehearsal.
