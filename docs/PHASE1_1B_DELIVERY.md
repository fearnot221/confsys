# Phase 1.1b delivery — 2026-10-15

Delivered scope is single-conference independent deployment correction only. No Phase 1.2 implementation or production-readiness claim. The user explicitly selected A; the attachment supplies detailed acceptance requirements for that request.

## Baseline, branch and environment preservation

Verified `f1126ad3e9dd615268e90e3ba8f841f6a2ea290f` contains `c10b0251cc06f4a43c4bd81b5f72704a362348ea` and `c6f1d5f` using `git merge-base --is-ancestor` (both exit 0). Original checkout `/Users/fearnot/Desktop/confsys` on `codex/maintainability-rules` and Phase 1.1 checkout `/Users/fearnot/Desktop/confsys-phase-1-1-auth` on `codex/phase-1-1-auth` were clean before work and remain unchanged.

Created `/Users/fearnot/Desktop/confsys-phase-1-1b-single-conference`, branch `codex/phase-1-1b-single-conference`, directly from the complete f1126ad commit. Managed worktree tool failed to validate the ref; normal `git worktree add -b` succeeded. No merge/cherry-pick/reset. Implementation/test commit: `ab7120f` (`feat: isolate single-conference runtime and deployments`). The subsequent documentation/delivery commit contains this report; its exact hash is reported in chat.

The existing `confsys-phase0-*` and `cert-app-*` containers were never targeted by stop/down/migrate or tests. New regression infrastructure is `confsys-p11b-regression`, using Web 35175/API 33000/worker 33001, DB 35434/Redis 36381/Mailpit 38027/SMTP 31027. Host E2E processes terminated after tests; its synthetic infra volumes remain. Only this round's generated test runs c9ffeaec, dae76d1e and ef1e7c85 were cleaned with their exact env/project files before retries; no global prune/user data deletion.

## Retained, corrected, cancelled and unfinished

| Classification | Result |
|---|---|
| Retained implementation | Register/resend/verify/set-password/login/logout/session recovery/reset, Argon2, CSRF/Origin, safe cookies, Redis limits, credential race protection, transactional outbox, minimal audit, independent worker, capture SMTP, retry/unknown/crash recovery and private-cache/late-response protections |
| Corrected implementation | Runtime conference-name DTO/SDK/hook/UI/title/mail; canonical Host ingress/API checks; selected project/env/ports/image for Compose and scripts; local *.localhost HTTP exception; same-build dual-instance tests |
| Removed unused infrastructure | Phase 0 withTenant/tenantScopeSchema and test-only RLS fixture/tests; no production table, policy or applied migration removed |
| Cancelled plans | Global account/multi-organization tenancy, memberships/scope resolver, conference switch, platform role and platform-internal next-edition clone |
| Still planned, not implemented | Local roles/resource permissions/controlled administrator bootstrap, editable/versioned conference settings/CMS, invitations, private files, registration/finance/submission/review/competition/program/on-site/mail/statistics modules, later whitelist config export/import |

Usable flow: visit the selected conference's `/auth/register`, request capture mail, follow its own canonical verification link and explicitly set a password, login, refresh account, logout or request/reset password. Auth shell and title use its runtime display name; no role/admin/business data is fabricated. No default organization/membership or request-selected database was introduced. Config unavailable renders a real error/retry and hides auth forms.

## Contracts, schema, environment and documentation

- `GET /api/instance` is an explicit `{conferenceName}` projection. Strict contract, generated OpenAPI and SDK reject extra fields. No server env/secrets/DB rows are serialized. Auth API schemas stay compatible.
- `CONFERENCE_NAME` is validated once by shared config for API/worker; `PUBLIC_APP_ORIGIN` remains canonical and server-controlled. HTTPS is required for production; controlled one-level *.localhost joins loopback HTTP development exceptions. Cookies remain host-only, HttpOnly, SameSite=Lax; Secure/__Host- remains the HTTPS policy. No live TLS test was performed.
- Local tooling config validates project/image/port/capture settings. `CONFSYS_ENV_FILE` selects the file for setup, Compose, migration, smoke, dev and test entry points. `COMPOSE_PROJECT_NAME` identifies deployment operationally; no unnecessary INSTANCE_ID columns. `APP_IMAGE`, WEB/POSTGRES/REDIS/MAILPIT ports and MAILPIT_URL are documented in .env.example. SMTP remains local capture only, with configurable local port.
- Compose uses separate projects and nonprivileged per-process DB credentials. All Web/API/worker services refer to the same selected image. No global container_name, external volume, fixed shared data path or shared proxy network. Only bootstrap SQL is a read-only source bind. Setup preserves existing secrets on rerun; env/test output directories are excluded from Git and Docker context.
- **No schema migration needed.** `git diff --exit-code f1126ad -- packages/db/migrations pnpm-lock.yaml` exited 0: migrations 0001–0003/checksums and dependency pins are unchanged. Existing local identity tables already fit this model; no conference_id/backfill/rebuild. Clean initialization and retained blank/Phase 0 forward-migration tests pass. A new f1126ad data-upgrade migration test is not claimed: there is no new SQL migration to apply. Existing identity lifecycle/data constraints remain tested.
- Updated AGENTS, SPEC, ARCHITECTURE, PERMISSIONS, UI/DATA contracts, ROADMAP, README, TESTING, OPERATIONS, CI and PR template. ADR 0003 records the user decision/tradeoffs. Historical delivery reports, prior ADRs and original Phase 0 prompt retain their original facts with a superseded notice.

## Actual dual-instance evidence

Committed sanitized machine-readable result: [phase1-1b-instances.json](evidence/phase1-1b-instances.json). Local screenshots `.instances/6a184271/a.png` and `b.png` were visually inspected; A is logged out while B remains logged in with its own name. Synthetic env/capture tokens are intentionally not included.

| Property | A | B |
|---|---|---|
| Project | confsys-p11b-6a184271-a | confsys-p11b-6a184271-b |
| Canonical browser URL | http://a.localhost:35173 | http://b.localhost:35174 |
| Display | Synthetic Conference A | Synthetic Conference B |
| Selected file | .instances/6a184271/a.env | .instances/6a184271/b.env |
| DB / Redis ports | 35432 / 36379 | 35433 / 36380 |
| Mailpit UI / SMTP ports | 38025 / 31025 | 38026 / 31026 |
| Network | confsys-p11b-6a184271-a_default | confsys-p11b-6a184271-b_default |
| Data volumes | project-prefixed postgres-data, redis-data, mailpit-data | independent project-prefixed counterparts |

All six app containers use tag `confsys:p11b-6a184271` and actual identical image ID `sha256:7406a2fa4bf9a0559f8015ba04e8599ed3bdada2ce83e3008817c463c6c47c99`. Built once via A's `compose --profile app build api`; B starts `--no-build`. No two-source-tree or per-conference Vite build. Each database/role/encryption/CSRF credential is independently generated. Inspect confirmed API lacks worker/migration credentials, worker lacks API/CSRF credentials and Web lacks mail key. `/app/.env` and `/app/.instances` are absent inside the image.

| Acceptance scenario | Observed result / assertion |
|---|---|
| Simultaneous auth screens | Same Chromium context resolves both hostnames and actual Mailpit links; separate names/titles, no switch/global-account copy |
| A-only registration | B DB contains no such user, B Mailpit has no message; B login with A password returns 401 INVALID_CREDENTIALS |
| Same email, distinct passwords | Both independently verify/login; cross-password login rejected |
| Simultaneous browser sessions | Separate a.localhost/b.localhost cookies with distinct opaque values, HttpOnly/Lax; reload preserves both accounts |
| Manually send A session to B | 401; no local session or account auto-created |
| A verification token to B | 400; original A link subsequently activates A through browser |
| A reset token to B | 400; original token then resets A successfully |
| A reset/revoke | Old A session/password rejected; B password/session valid; B users/session credential/revocation state/audit count/migration ledger unchanged |
| A logout | B reload stays authenticated; retained browser regression also proves late/private responses cannot restore prior account |
| Mail isolation / canonical URL | Name and origin checked in both mailboxes; X-Forwarded-Host cannot poison links, forged Host receives 403 |
| Stop A worker | A new outbox stays pending and neither mailbox receives A mail; B sends its own new mail; restarting A delivers A mail only |
| Stop/restart A app | B remains usable; B container IDs, start times and image IDs unchanged |
| A-only migration/smoke | B state/ledger snapshot unchanged; A stack and auth smoke pass |
| DB/network/volume isolation | Docker inspect shows disjoint project networks/data mounts. From each API container, TCP attempts to the other project's DB and Redis private IPs cannot connect. B DB password against A DB fails 28P01 |
| Public data/bundle secrecy | DTO equals display-only shape; bundle lacks conference build-time name and configured DB/mail/CSRF secrets |
| Storage | No file metadata, adapter or private-download feature exists; not tested or claimed |

The localhost Node HTTP helper maps local test names to loopback preserving Host; actual browser DNS/cookies and canonical-link navigation are separately exercised. Port differences are not used as cookie isolation. Independent Docker networks do not protect against host root/Docker administrators; no VM, load/resource availability or production firewall claim.

## Exact executed verification

All host pnpm commands used `PATH=/tmp/confsys-tools/node_modules/.bin:$PATH`, verified Node **24.21.0** / pnpm **10.34.7**, without replacing global tools. Commands run from this independent worktree.

| Command | Result |
|---|---|
| `git status --short`, `git branch --show-current`, `git worktree list --porcelain`, `git show -s ... f1126ad`, ancestry checks | Baselines/worktrees verified; originals preserved |
| `pnpm install --frozen-lockfile` | Pass; lock/pins unchanged |
| `COMPOSE_PROJECT_NAME=confsys-p11b-regression POSTGRES_PORT=35434 REDIS_PORT=36381 WEB_PORT=35175 MAILPIT_PORT=38027 SMTP_PORT=31027 API_PORT=33000 WORKER_PORT=33001 pnpm env:setup` | Pass; independent random local config |
| `pnpm infra:up`, `pnpm db:migrate`, `pnpm db:migrate:test` | Pass against this worktree's regression services |
| `pnpm contract:generate` | Pass; committed schema exact-match check passes |
| `pnpm exec playwright install chromium` | Pass |
| `pnpm check` | **Pass all seven gates in order**; final log `/tmp/confsys-p11b-gates-final.log` |
| `pnpm lint` | Pass, including import boundaries |
| `pnpm typecheck` | Pass |
| `pnpm test:unit` | **12 passed**, 5 files; includes setup preservation/config guards |
| `pnpm test:integration` | **23 passed**, 6 files; real PG/Redis/Mailpit, actual roles, rollback/races and SMTP acceptance/SIGKILL recovery |
| `pnpm test:contract` | **9 passed**, 3 files |
| `pnpm build` | Pass; clean TS/Vite build |
| `pnpm test:e2e` | **6 passed**; five retained flows plus runtime config failure/retry |
| `pnpm test:instances` | Pass; fresh same-image A/B, all assertions above; `/tmp/confsys-p11b-instances-final.log` |
| Runner: selected A `pnpm compose --profile app build api`; selected A/B `up -d --wait postgres redis mailpit`, `--profile app run --rm migrate`, `--profile app up -d --no-build --wait api worker web` | Pass; executed via the same compose wrapper using exact env files |
| `CONFSYS_ENV_FILE=.instances/6a184271/a.env pnpm smoke:stack` | Pass; real stack and independent synthetic worker |
| `CONFSYS_ENV_FILE=.instances/6a184271/a.env pnpm smoke:auth` | Pass; real container Web/CSRF/Mailpit/token/browser/session/logout |
| `git diff --check`, unchanged migrations/lock check | Pass |

Earlier attempts failed honestly and were repaired: Vite executable needed the Web workspace path and explicit 127.0.0.1 binding; Vite's string proxy defaults changeOrigin=true so canonical Host requires object config changeOrigin=false; Compose run does not accept --no-build on this installed version; Node fetch did not send the requested Host for an internal probe, replaced with node:http. One manually overlapped E2E worker consumed a shared test-DB crash fixture; stopped that own test process and reran the ordered check successfully. No timeout/negative assertion/auth protection was weakened. Final safety-only boolean assertions avoid printing secret values on comparison failures; lint/unit were rerun afterward.

Current synthetic A/B stacks and regression infrastructure remain for review. Previous generated retries were removed by exact selected env only. For safe cleanup use the per-run commands in TESTING; never target original user projects. Cloud CI is configured with the dual-instance gate but was not run (no push).

## Old tests → new protection

Detailed matrix is in [TESTING](TESTING.md#retired-tenant-fixture-and-replacement-evidence). Removed 16 tests of a test-only shared-tenant schema and one tenant-input unit case, not failing production auth tests. Added four actual-role/transaction/FK cases, two config/contract cases, two tooling unit cases, one browser config-state case and the real deployment suite. Retained all identity/session/token/CSRF/rate-limit/column-grant/outbox/race/crash regression. No applied RLS was globally disabled; local resource permissions remain unimplemented and will require their own tests.

## Maintainability check / 可維護性檢查

1. **Responsibilities:** config owns validation; API instance route owns explicit public projection/Host boundary; SDK owns HTTP; useInstance owns public server state; auth/health components consume props. Auth service/repository/transaction rules are retained. Worker changes only display text. Compose/setup own deployment selection; local HTTP helper and dual runner are test-only. No default tenant or hidden authorization shim.
2. **Duplication/coupling/dependencies:** no new dependency or duplicated credential/permission rule. Canonical origin validation is shared by API/ingress. Minimal name schema is reused by API/worker; public DTO is deliberately separate from server config. Existing Drizzle pin retained; no generic replacement for the retired helper. New test helpers serve observed local DNS/transport and deployment verification needs.
3. **Tests/docs together:** SPEC/ADR/permissions/contracts/env/Compose/CI/scripts/UI and old-test replacement matrix changed together. Actual gate counts and Docker/browser/mail/network observations are above, not mocked service claims. Logs never substitute for assertions or cloud execution.
4. **Debt/risk/treatment:** ROADMAP retains key rotation, retention, trusted proxy/IP rate limits, stronger compromised-password screening/Argon2 capacity, MFA launch gate and accessibility/browser review. Shared-host network/resource hardening, TLS, backup/restore and provider readiness remain pre-launch work. Local roles/resource authorization and controlled bootstrap are Phase 1.2 proposals only. Editable settings/CMS/files and all business phases remain later work.

## Limits and next minimal unit

Unimplemented/unconfigured: roles/admin bootstrap/MFA product, membership or global registry (cancelled), CMS/editable settings, private files, registration/submission/payment/review/competition, external mail/payment provider, settings import and central deployment controller. Only Mailpit synthetic email was used; accepted means capture SMTP accepted, not external inbox delivery.

Unverified: production TLS/Secure-cookie traffic, real provider delivery/bounce, cloud CI, backup/restore rehearsal, rotation in production, load/DoS, penetration testing, full browsers/assistive tech/WCAG. Local pass is not production readiness.

Next proposed unit, awaiting approval: **Phase 1.2a local conference permission model and service policies**, then **1.2b operator-authorized one-time audited administrator initialization**, then bounded local role grant/revoke UI. No first-public-user administrator and no cross-conference membership/switch. Stop after local commit; no push, merge, production deployment, real mail/payment or Phase 1.2 work.
