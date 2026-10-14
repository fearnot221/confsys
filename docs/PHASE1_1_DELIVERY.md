# Phase 1.1 delivery — 2026-10-15

> Historical record. The shared multi-tenant/global-account premise and membership/switch follow-up are superseded by [ADR 0003](adr/0003-single-conference.md). Original implementation/test claims below describe their dated delivery, not current authorization.


Scope: account lifecycle and server-side sessions, including the minimum identity outbox/independent worker/Mailpit/audit needed to complete verification and password recovery. Phase 1.2 is not started; this is not completion of all Phase 1 or a production-readiness claim.

## Git baseline and workspace

Verified original worktree `/Users/fearnot/Desktop/confsys` was clean on `codex/maintainability-rules`, HEAD `c10b025`. `git merge-base --is-ancestor c6f1d5f HEAD` and the corresponding `c10b025` check both exited 0. Original worktree list contained only that checkout; remote list was empty. No merge/cherry-pick/reset was used.

Created branch `codex/phase-1-1-auth` at `c10b025` in independent worktree `/Users/fearnot/Desktop/confsys-phase-1-1-auth`. The desktop managed-worktree call could not validate the starting ref, so a normal `git worktree add -b ... c10b025` created it. Original checkout remains clean on its original branch. Delivery commit is the commit containing this report; exact hash is reported in chat. At delivery the feature worktree is committed/clean; generated .env, dist and test artifacts remain ignored. No remote, PR, push, merge or production deployment.

## Implemented and usable

- Email-only registration → pending identity → real Mailpit verification link → explicit set-password POST → activation → normal login. Resend also travels through worker/Mailpit. Duplicate registration does not overwrite active credentials.
- Login, own account/session lookup, refresh restoration and idempotent logout. Real opaque server sessions, hash-only lookup, idle/absolute expiry and credential-version race protection.
- Forgot password → real worker/Mailpit reset link → reset and revoke all sessions atomically → normal login. Old password/session cannot authenticate; reset does not auto-login.
- CSRF for anonymous/authenticated mutations, exact Origin checks, cookie policies, bounded Argon2id/password policy, real Redis source/account limits, safe HTTP errors/no-store/no-referrer and minimum durable security audit.
- Durable identity notification outbox with encrypted short-lived delivery material, reference-only BullMQ jobs, independent dispatcher/worker, bounded retries, lease recovery, accepted/failed/unknown/cancelled outcomes and terminal secret deletion.
- Real API-backed forms/account page and query cancellation/removal, including background session expiry and delayed prior-account responses. No mocked user/conference data, no role/admin UI and no fake tenant resolver.

Start in this worktree with pinned tools: `pnpm install --frozen-lockfile`, `pnpm env:setup`, `pnpm infra:up`, `pnpm db:migrate`, `pnpm dev`. Web `http://127.0.0.1:25173`, Mailpit `http://127.0.0.1:28025`. UI paths: `/auth/register`, `/auth/waiting`, `/auth/verify`, `/auth/login`, `/auth/forgot`, `/auth/reset`, `/auth/account`. Use unique synthetic `@example.invalid` recipients, find their messages in Mailpit and follow the link. GET/reload does not activate or reset; explicit submit is required.

## Data, contracts, configuration and dependencies

Additive migration `0002_identity.sql` adds global users, one-time tokens, sessions, minimal auth audit, notification outbox, restricted encrypted delivery secrets and worker eligibility view. 0001 is unchanged. Actual app/worker roles remain non-owner/NOSUPERUSER/NOBYPASSRLS. Worker cannot query password/session/token tables; API cannot SELECT delivery secrets. Identity is explicitly global, not a missing-tenant bypass.

Auth API schemas/DTO/error codes are in contracts, generated OpenAPI is updated, SDK owns network/cookie/CSRF handling. See DATA_CONTRACT for the nine endpoints and HTTP map. No password/session/token hash or membership is exposed in DTOs. No arbitrary Host/returnUrl is used for mail links.

New settings: `PUBLIC_APP_ORIGIN`, `CSRF_SIGNING_KEY`, `MAIL_KEY_VERSION`, `MAIL_ENCRYPTION_KEY`, `SMTP_HOST`, `SMTP_PORT`, `SESSION_IDLE_SECONDS`, `SESSION_ABSOLUTE_SECONDS`, `VERIFICATION_TTL_SECONDS`, `RESET_TTL_SECONDS`. Defaults/constraints/key-loss and rotation procedure are in OPERATIONS. Setup preserves existing values and appends missing settings; keys are generated locally and ignored, never shared constants. Compose and host child processes receive separate validated configs. Added `db:migrate:test` and `smoke:auth`; CI configuration includes both.

Added pinned dependencies: argon2 0.45.1, Fastify cookie 11.1.3 / CSRF protection 8.0.2, nodemailer 10.1.1 / types 8.0.2. Explicit API Zod/root test ioredis reuse existing pins. Purposes, native-install cost and decisions are in ADR 0002; original framework/runtime pins retained. No provider credentials are configured.

## Actual executed verification

All host pnpm commands used `PATH=/tmp/confsys-tools/node_modules/.bin:$PATH`, Node **24.21.0**, pnpm **10.34.7**. No script below is marked passing solely because it exists.

| Executed command | Result |
|---|---|
| `git status --short`, `git branch --show-current`, `git log -8 --oneline`, `git worktree list`, `git remote -v`, ancestry checks | Baseline verified as above; original checkout preserved |
| `pnpm install --frozen-lockfile` | Passed before implementation and again with updated lockfile |
| `npm view argon2 version engines`, `npm view @fastify/cookie version`, `npm view @fastify/csrf-protection version`, `npm view nodemailer version engines`, `npm view @types/nodemailer version` | Registry metadata checked; exact installed versions pinned |
| `pnpm install`, `pnpm env:setup` | Passed; generated missing auth secrets without printing/overwriting existing values |
| `pnpm infra:up`, `pnpm db:migrate`, `pnpm db:migrate:test` | Passed; persistent local infrastructure and additive schema, no volume cleanup |
| `pnpm contract:generate` | Passed; committed schema snapshot matches source |
| `pnpm lint` | Passed, including resolved import/re-export/UI-data checks |
| `pnpm typecheck` | Passed |
| `pnpm test:unit` | **11 passed**, 4 files |
| `pnpm test:integration` | **35 passed**, 6 files; actual PostgreSQL/Redis/Mailpit and process-kill scenario |
| `pnpm test:contract` | **7 passed**, 2 files |
| `pnpm build` | Passed; generated outputs cleaned before TS/Vite build |
| `pnpm exec playwright install chromium` | Passed |
| `pnpm test:e2e` | **5 passed**; existing 2 Phase 0 + 3 real account flow cases |
| `pnpm check` | Passed all seven gates in order; final run recorded in local delivery log |
| `docker compose --profile app build` | Passed; native Argon2 install and Linux build included |
| `docker compose --profile app run --rm migrate` | Passed; existing migrations reused without checksum edits |
| `docker compose --profile app up -d --no-build --wait api worker web` | Passed; app profile healthy |
| `pnpm smoke:stack` | Passed; built Web/API/Mailpit plus independent synthetic worker |
| `pnpm smoke:auth` | Passed; Chromium through actual container reverse proxy, register/Mailpit/verify/login/refresh/logout |
| `docker compose exec -T api node -e 'if(process.env.WORKER_DATABASE_URL || process.env.MIGRATION_DATABASE_URL)process.exit(1); console.log("API config separation verified")'` | Passed |
| `docker compose exec -T worker node -e 'if(process.env.DATABASE_URL || process.env.MIGRATION_DATABASE_URL || process.env.CSRF_SIGNING_KEY)process.exit(1); console.log("Worker config separation verified")'` | Passed |
| `git diff --check` | Passed; applied migration and original Phase 0 test files unchanged |

Ephemeral raw logs: `/tmp/confsys-phase1-check-delivery.log`, `/tmp/confsys-phase1-containers-final.log`. Final local app-profile containers are running from this worktree; PostgreSQL/Redis/Mailpit volumes are retained. Stop only this project’s app services before host dev/E2E (`docker compose --profile app stop web api worker`).

Screenshots in ignored `test-results/phase1-auth-mobile.png`, `phase1-account-desktop.png`, `phase1-container.png`; mobile and desktop inspected. These local artifacts are supplementary, not a substitute for executable tests. No cloud CI execution or external-provider verification is claimed.

Resolved test findings: invalid-URL validation could throw before safe field reporting (fixed; original config test retained); Argon2 PHC parameter order differed (assert actual parameter values independently of order); delayed-response test attempted to fulfill a route after cancellation (synchronized/cancellation-aware harness, account-isolation assertions retained); background expired-session refetch retained TanStack stale data (explicit private query removal plus browser regression). No existing test was removed/skipped/weakened. Cosmetic Playwright FORCE_COLOR/NO_COLOR warnings do not affect results.

## Security and isolation evidence

- Token purpose/expiry/disabled state/reuse/concurrent consumption; concurrent unique registration; successful reset revokes sibling tokens and all sessions.
- Reset/login race uses an explicit barrier after actual Argon2 verification, then resets before session creation. Credential version blocks old-password session resurrection.
- Controlled session clock tests cover exact idle and absolute boundaries; forged/revoked/pre-login cookies cannot authenticate. Account refresh uses real `/me`.
- Real CSRF bootstrap, missing/wrong token and foreign/missing Origin rejection; proper local cookie flags, production configuration unit cases; no long-lived browser storage.
- Real Redis source and per-account throttles; actual disconnected Redis rejects public auth with 503 while valid session read/logout continue. Refused DB connection returns safe 503 and no cached authentication.
- Outbox failure rolls back registration and reset credential/token/session updates. Queue pause/recovery retains work; duplicate claims do not resend. Expired/revoked jobs cancel. Actual SIGKILL after Mailpit accepts mail becomes unknown after lease recovery; one captured message remains and no retry occurs.
- API response/log capture excludes password, raw token, sensitive URL, cookie and DSN markers. Audit carries IDs/stable events only; BullMQ payload is exactly `{eventId}`. Terminal encrypted secrets are deleted.
- All **17 retained Phase 0 integration tests** pass, including actual app/worker cross-organization AND same-organization cross-conference denial, missing/partial context, rollback, pool reuse, constraints and Redis jobs. This remains a fixture proof, not real membership/tenant authorization.
- Temporary blank and isolated Phase 0 databases upgrade forward, preserve checksum and fixture data, and permit expected nonprivileged access. They are individually removed afterward; shared app/test data and volumes are not reset.

## Five improvements and Maintainability check / 可維護性檢查

M1–M5 were reread in full and rechecked against actual source. M1 configuration separation and M5 HTTP semantics were blocking; M2 safe diagnostics/durable failure handling and M3 new-feature boundary checks were directly required; M4 was adjacent to the required clean build. All five scoped acceptance changes are implemented/tested; original findings plus exact treatment and remaining bounded debt remain in ROADMAP.

1. **Responsibilities:** HTTP routes validate/translate/cookie/CSRF; auth service owns policy and transactions; identity repository owns explicit global persistence; password/rate helpers own their single rules. Notifications have a transaction writer, authenticated encryption envelope and isolated dispatcher/worker/SMTP boundary. Contracts→SDK→hook→props-only UI remains one-way. No speculative domain framework or empty layers.
2. **Duplication/coupling/dependencies:** no new duplicated credential or browser authorization implementation. SQL delivery eligibility intentionally rechecks current identity/token state before external effect; it does not create a second login policy. API and worker share notification writer/encryption contracts, while API does not import the worker/provider entry point. SDK errors are shared without an index/auth circular import. New dependencies are limited to required password/cookie/CSRF/SMTP functions and recorded in ADR 0002.
3. **Tests/docs:** schemas, error contracts, env/setup/Compose/CI, architecture/permissions/UI/testing/operations/roadmap changed together. Actual results above include failure/race/crash and existing isolation tests, not only happy-path mocks or screenshots.
4. **Debt/risk/phase:** ROADMAP tracks retention/purge policy, trusted proxy/source-IP deployment policy, single-key rotation/provider observability, broader compromised-password screening/capacity measurement, MFA before high privilege, full accessibility/browser review. These are not permission to start Phase 1.2 or production operations.

## Unconfigured, unverified and next unit

Unconfigured/not implemented by scope: organization/conference membership and scoped permissions, invitations, conference CRUD/settings, file access, payments/submission/reviews, high-privilege MFA product, production SMTP/provider credentials. No fake entities or success endpoints stand in for them.

Unverified: cloud GitHub Actions, production TLS/proxy deployment, real inbox/bounce/delivery, production key rotation and backup/restore drill, load/DoS capacity, penetration testing, full browser/assistive-technology/WCAG certification. SMTP accepted means capture server accepted, not external delivery. Single-key rotation and retention remain documented constraints. No known local Phase 1.1 acceptance blocker remains after the executed tests.

Next smallest proposed unit is **Phase 1.2a: membership model + trusted organization/conference scope resolver + scoped permission/RLS tests**, then separate **1.2b switch/membership UI** and **1.2c invitation lifecycle**. Requires user approval. Stop here; no push, merge, production deployment, real email or payment.

Migration `0003_identity_grants.sql` narrows runtime UPDATE privileges to required lifecycle/delivery columns and limits the worker eligibility projection to pending/processing notifications. It is a separate forward migration because 0002 had already been exercised locally; 0001/0002 are not rewritten. Actual-role regression rejects recipient/token reassignment, email edits and expiration/hash rewrites outside the implemented services.
