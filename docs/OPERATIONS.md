# Local operations and deployment limits

Compose services are project-namespaced, persistent volumes are local, mapped ports bind to 127.0.0.1 only. PostgreSQL official entrypoint bootstraps roles before accepting application use; app images run as node (non-root). Redis is persistent AOF/noeviction; cache and queues share only the development instance. Mailpit has no relay configuration. No real email sender or payment adapter exists.

Migration is a separate command/container under confsys_migrator, serialized by a PostgreSQL advisory transaction lock. The ledger tracks SHA-256 checksums, rejecting edited applied migrations. Migrations are forward-only; write an explicit repair/forward migration after review, not automatic down migrations. API and worker readiness require the current `REQUIRED_SCHEMA_VERSION` in `packages/db/src/index.ts` and safe database roles. Run all migrations supplied with the matched image before starting applications. Applications never get migrator/admin credentials through Compose service env.

Development app images contain build dependencies; do not treat them as hardened production images. Before production: separate queue/cache instances, TLS/reverse-proxy controls, managed secrets, restricted network access, backup policy, object storage, logs/metrics/alerts, vulnerability review, public rendering, capacity testing, provider sandbox verification and local business authorization. `NODE_ENV=production` is a runtime optimization, not a production-readiness certification.

## Shutdown and recovery

`pnpm dev` runs all three processes with signal propagation; API closes DB/Redis on Fastify close, worker stops accepting jobs and waits for the active synthetic processor before closing dependencies. Containers use init and 15-second grace. Future long-running handlers need explicit cancellation/deadlines and crash/retry tests.

Restart infrastructure with `pnpm infra:up`; restart app containers with `pnpm compose --profile app up -d --no-build --wait api worker web`. Readiness must recover; liveness is intentionally independent of dependency outages. Host `pnpm dev` and container Web share the selected WEB_PORT (default 25173); choose one at a time. Never stop unrelated host processes to free these ports.

## Isolated synthetic backup and restore

Use the guarded [same-instance backup drill](BACKUP_DRILL.md) for this repository's generated synthetic environments. It requires a successfully completed `test:instances` run and its exact private env file; pause only that source instance's API/worker, then validate and restore into new named resources. It never overwrites the source database or mounts source private files writable. The local backup directory and secret files use restricted permissions; it is not encrypted at rest by the script.

The07:42 drill restored one actual private attachment/reference and verified database counts, sequences, migrations, app-role RLS and pooled-context reset. That fixture had no generated PDF/CSV/QR or retained encrypted mail, so populated-artifact recovery remains pending until separately recorded in CONTINUOUS_RUN. A probe did verify the restored mail key. Do not infer production disaster-recovery objectives, retention, encryption-at-rest or a tested production rollout from this synthetic result.

A production plan must coordinate database/private bytes/signing and encryption keys, preserve exact role ownership/grants, restrict and encrypt backups, and define RPO/RTO with the organization. Never use a recovered account/database/key set to create a different conference. New conferences require fresh accounts, credentials, volumes and keys.

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
| `SMTP_HOST` / `SMTP_PORT` | only 127.0.0.1/localhost/mailpit and a validated local capture port; Compose uses mailpit:1025 |

TTL values centrally validate 60 seconds to 30 days; idle may not exceed absolute. Production rejects HTTP public origins. Local HTTP exceptions are limited to explicit development/test with loopback or one-level *.localhost. Compose defaults to development because it is a local HTTP capture environment, not a production configuration.

Source limit: 100 mutations per 15 minutes; per email/purpose: login 10, register/resend shared 5, forgot 5. Token submissions also have 5 per token plus source limit. Counters expire, no permanent account lock. API never trusts arbitrary forwarded source headers. Behind a proxy all requests currently share its source address: configure/test a trusted proxy policy before production, never blindly trust X-Forwarded-For. Rate Redis unavailable → 503 for public authentication/mail operations; DB-backed `/me` and logout do not depend on Redis/worker health. Already-committed outbox waits for recovery.

### Delivery and diagnostics

Structured logs contain service/event and applicable request/event/attempt IDs, not body/query/headers, addresses, links, DSNs or raw exceptions. Correlate API `x-request-id` with `auth_audit.request_id` and `notifications.request_id`. Read-only local diagnostics (not a public endpoint):

```sh
pnpm compose exec -T postgres psql -U postgres -d confsys -c \
  'SELECT id, request_id, kind, status, stage, attempts, result_code, lease_until FROM confsys.notifications ORDER BY created_at DESC LIMIT 20'
```

Use an authorized operator connection for diagnosis; do not give superuser/migrator credentials to runtime. `accepted` is SMTP acceptance only. `pending` survives queue delay/loss; dispatcher polls every second in batches of 100. `processing/claimed` leases expire back to pending after 60s. `processing/sending` expires to `unknown`, never auto-resends. Known DNS/connection failure at SMTP CONN retries at most three attempts, 30s apart; ambiguous failures are unknown. `cancelled` means token expired/used/revoked or identity state changed; `failed/SECRET_UNAVAILABLE` means key/version/decryption issue. Unexpected DB/queue failures preserve their failure outcome and leave durable state for recovery.

For unknown delivery, check Mailpit by message ID (`<notification-id@confsys.invalid>`) and recipient through authorized local access. Do not blindly change status to pending. A user may explicitly request a new link; previously issued unexpired links remain valid until successful consumption revokes siblings. A duplicate accepted or unknown job does nothing. No exactly-once or inbox-delivery guarantee.

### Secret lifecycle and recovery

Setup generates independent random encryption/CSRF keys with Node crypto into ignored mode-0600 `.env`; it never prints them. Real deployments must use a managed secret store and independent access controls. Keep encryption keys out of DB backups, but back them up separately with strict access and matching version. A version marker is not the secret.

The current worker supports one active key version. For deliberate rotation: stop new API mail requests, let pending/processing work finish or expire, confirm no remaining nonterminal secrets with read-only counts, stop API/worker, securely provision a new random key and a new version, then restart both consistently. Do not rotate only one process. No online multi-key re-encryption facility is implemented. Losing a key makes pending ciphertext unreadable; workers mark failed/SECRET_UNAVAILABLE and remove it. Users request new links after configuration repair. Already delivered token hashes and passwords are unaffected. CSRF key rotation invalidates CSRF cookies/rate identifiers; obtain a new CSRF cookie before retrying, server-side login sessions remain DB-backed.

Worker automatically deletes ciphertext on accepted/failed/unknown/cancelled or expiry. Expired tokens/session hashes remain inert because every use validates DB state/time; lifecycle retention/purge beyond delivery secrets is tracked in ROADMAP and must preserve required audit history. Do not dump secret tables, reset shared volumes, clear all Redis keys or delete others' Mailpit messages for cleanup. E2E leaves only identifiable synthetic recipients in the guarded test DB/Mailpit. Backup/restore with encrypted secrets, retention periods and production monitoring still require an operator-approved rehearsal.

## Independent conference operations (Phase 1.1b)

Select `CONFSYS_ENV_FILE=/path/instance.env` before every migration, smoke, startup or stop command. `pnpm compose` validates local tooling settings and passes that file's explicit project name and values; do not use a different project's env to recover authentication. `CONFERENCE_NAME` (1–160 printable characters) is shared by API/worker at runtime. `PUBLIC_APP_ORIGIN` is a normalized exact origin with no userinfo/path/query/fragment; production requires HTTPS. `APP_IMAGE` must use an explicit tag/digest; record the actual resolved image ID/digest for each instance. `COMPOSE_PROJECT_NAME` is the deployment identifier; no additional account-level INSTANCE_ID is necessary.

New local port settings and `MAILPIT_URL` are validated in packages/config's local loader. `SMTP_PORT` is configurable for loopback capture; SMTP_HOST still cannot name an external provider. Defaults and setup are in .env.example. No VITE_ configuration contains secrets or conference identity. Public DTO is explicitly projected; never serialize server config.

Host-only cookies have no Domain and are not port-isolated. Use different hostnames for different conferences; browsers resolve run-specific a-<run>.localhost/b-<run>.localhost in the executable dual-instance test. Node test transport maps only local names to loopback while preserving Host. This is test runner code, never a product DNS/tenant resolver. Web checks Host and forwards canonical Host; API checks it except internal health probes. Links always use server config; forwarded host/IP are untrusted. Current trustProxy=false still has the shared-IP rate limit limitation in ROADMAP.

The template uses independent project bridges with no shared external network, no explicit global volume names and no shared data bind mounts. The sole source bind is read-only bootstrap SQL. Each project owns PostgreSQL, Redis/AOF and Mailpit data volumes. Private file metadata, quarantine and a project-local private-storage volume are now implemented; scanner health and authorized access are required before download. For production remove local infra port publication, design private backend and ingress networks deliberately, separate queue/cache Redis and restrict operators. Shared host root/Docker admins can access containers; projects do not provide VM-level isolation or resource availability guarantees.

Upgrade one instance at a time: choose version/digest, review required env changes, make and verify an instance-specific backup, stop only its app processes as needed, run its migration, start its matching image, then smoke that instance. Phase 1.1b preserves 0001–0003 byte-for-byte and requires no schema/data backfill; old hashes/sessions/outbox remain valid. Rollback to an earlier image requires compatible settings and image-specific review; do not rewrite migration history. Synthetic same-instance restore evidence is recorded separately above; production disaster recovery, TLS, provider and load drills remain unverified.

A new conference is always a fresh instance with new credentials. Future whitelisted settings export/import is separate from disaster recovery and must exclude accounts, sessions, tokens, manuscripts, payments and secrets. No central auto-upgrade/control plane exists.

## Phase 1.2 controlled administrator bootstrap and handoff

1. Select the exact instance env file and matching software. The person registers and verifies through its real auth flow, then copies **their local account ID** from `/auth/account`.
2. From an operator shell authorized to access this instance's migration connection, preview the target and compare conference name, public origin, UUID/email/status. Do not publish this output; it contains a local account email.
3. Apply once with an explicit reason and exact public origin. No password/token appears in args. The following are executable script forms; replace only the example path/UUID/origin with the selected deployment's values:

```sh
CONFSYS_ENV_FILE=/absolute/path/instance.env pnpm admin:bootstrap --user-id <local-user-uuid>
CONFSYS_ENV_FILE=/absolute/path/instance.env pnpm admin:bootstrap --user-id <local-user-uuid> --apply --reason 'Initial conference administrator' --confirm-origin https://conference.example
```

The selected file supplies `MIGRATION_DATABASE_URL`, `CONFERENCE_NAME`, `PUBLIC_APP_ORIGIN`, `NODE_ENV`; all are centrally validated. No API or worker receives the migration credential. There is no HTTP bootstrap endpoint, automatic startup/migration/seed admin, force flag or default password. `operator_cli` records shell authority and a correlation UUID; it does not certify who physically used the shell. Reasons must omit secrets and unnecessary personal information.

Preview changes no account/role/session/audit data and sends no mail. Apply serializes on the persistent control row, requires an active verified password-bearing target, and commits binding/marker/audit/session revocation/credential epoch together. Exactly one competing initialization can succeed. Same completed target returns unchanged (even if its admin binding was later removed); another target rejects. A disabled/missing/unverified target fails. A crash before commit rolls back; after uncertain completion, rerun preview then same-target apply to inspect the durable result, never delete the marker.

After bootstrap the target logs in again, opens 帳號管理, finds another already-verified local account and grants conference_admin with reason/confirmation. That account must log in again before handoff. Use a second admin to revoke the previous admin or disable it; self role/status changes are prohibited and at least one eligible admin must remain. Staff only read the minimal directory. Effective role changes and disable/restore revoke old sessions; disable also invalidates recovery links. Restore preserves any displayed remaining roles, never revives removed ones. Forced logout always fences in-progress login, even if the account has no visible active sessions.

Password proof is valid for less than five minutes; use 目前密碼 / 重新驗證密碼 then separately reconfirm the action. Password failure uses the existing safe error and Redis source limit plus five reauth attempts per session per 15 minutes. Redis failure denies reauthentication; existing recent proof and DB-only management remain available. Admin is not exempt from Origin/CSRF. Review security audit with request ID when diagnosing; logs never contain passwords/reasons/body/SQL.

For 520607e → Phase 1.2: stop only the selected instance's app processes, preserve/verify its backup, run `pnpm db:migrate` separately, start matching new API/worker/Web images, run smoke and `pnpm test:access` only against an isolated test DB. Migration 0004 preserves existing identities and sessions; old sessions require reauth before management. New DTOs are strict and require matching Web/SDK. Do not mix old/new API versions for privileged operations. Roll-forward is supported by versioned migrations; automatic down migration, emergency admin recovery, production backup restoration and mixed-version compatibility are not validated. If all administrators lose access, bootstrap stays closed: commission a separately reviewed operator recovery procedure rather than editing production data ad hoc.

MFA remains mandatory before high-privilege production launch. Key rotation, stronger password screening, trusted proxy, TLS, retention/backup rehearsal, real provider and full WCAG work remain ROADMAP items. This round uses synthetic data/Mailpit only.

## Phase 1.3 settings authority and upgrade

| Setting | Authority / when effective |
|---|---|
| DB/Redis/SMTP identity, keys, cookies, canonical PUBLIC_APP_ORIGIN, project identifier | Existing validated deployment config; site API cannot edit or restore these |
| CONFERENCE_NAME | Bootstrap display only before first publication; also legacy pending-mail fallback |
| Name/subtitle/summary/date/timezone/venue/organizers/contact/languages/fixed page content and metadata | Current DB draft for private editing, active immutable publication for public output |
| New account-mail brand | Effective official name captured at outbox creation; retries keep it; public contact email does not change From/Reply-To/envelope |

Login as local administrator → `/admin/site` → save → preview → confirm publication. Saving alone intentionally does not update `/`, auth shell or new mail. History load is a new draft, not an immediate public rollback. Inspect `/api/site` publicationId and `/api/site/draft` activePublicationId as an authorized administrator to diagnose versions. On 409 preserve local text, fetch server draft for comparison, then explicitly discard or manually reapply changes. Never retry with a guessed newer version to overwrite another editor.

Upgrade only the selected instance: back up using the existing operational procedure, stop its app processes, run the matching image's separate migrate command, start matching Web/API/worker. 0005 preserves 0004 accounts/roles/marker/epoch/sessions/tokens/audit/outbox; old pending jobs have NULL snapshot and keep former runtime-brand fallback. Do not edit applied migrations, clear outbox, force logout or reopen bootstrap. No downgrade/mixed-version/production backup restore claim. Failure rolls back a migration; use reviewed roll-forward or an actually rehearsed same-instance restore. Public DB failure returns 503 without reading env as an apparent reset.

Host `pnpm dev` builds public renderer before startup. After shared public presentation edits, run `pnpm --filter @confsys/web build:public`; `pnpm build` builds both browser and server artifacts. Production uses only built Node artifacts. No new env/dependency/provider required. Existing TLS/MFA/proxy/retention/restore constraints remain release gates.

### Capture sender identities

The current transport remains Mailpit-only. `MAIL_FROM_ADDRESS`, `MAIL_REPLY_TO_ADDRESS`, and `MAIL_ENVELOPE_FROM` are separately validated email addresses restricted to the reserved `.invalid` suffix. They control the MIME From header, Reply-To header and SMTP envelope respectively. Defaults preserve existing local environments; setup and Compose propagate explicit values. No provider credentials, DNS verification or production sender authorization is implied. Production sender adapters, approved identities and provider delivery/bounce ingestion remain unconfigured until a real provider and organizational policy are supplied. Accepted SMTP messages are not reported as delivered.
