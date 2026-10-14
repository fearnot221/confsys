# Testing

## Reproduce

Use pinned Node 24.21.0 and pnpm 10.34.7. Install dependencies, generate local env, start infrastructure and migrate as README describes. Tests never read production environment URLs by default. Integration helpers require loopback hosts and the exact `confsys_test` database / Redis DB 1. This guard reduces accidental misuse; operators must still point local ports at isolated development services.

| Command | Behavior |
|---|---|
| `pnpm lint` | ESLint + AST presentation/import boundaries |
| `pnpm typecheck` | strict TypeScript across apps, packages and tests |
| `pnpm test:unit` | config secrecy/failure,  HTTP readiness failure, real structured 404/request ID |
| `pnpm test:integration` | real PostgreSQL runtime grants/constraints/transaction tests and Redis BullMQ jobs |
| `pnpm test:contract` | committed OpenAPI drift, Fastify schemas/SDK and invalid DTO responses |
| `pnpm build` | TS server/packages and Vite production build |
| `pnpm test:e2e` | starts built API/worker + Vite, Chromium real health, locale/refresh/mobile, network failure/retry |
| `pnpm check` | all seven gates above in order |
| `pnpm smoke:stack` | running container stack health + Mailpit health + synthetic job through independent worker process |
| `pnpm smoke:auth` | selected local container Web → real CSRF/register/Mailpit/verify/login/refresh/logout through reverse proxy (Chromium required) |

Playwright requires `pnpm exec playwright install chromium`; Linux CI adds `--with-deps`. E2E intentionally refuses to reuse an existing server, so it cannot accidentally validate unrelated local processes. Stop this project's dev/app stack first. E2E uses built API/worker; run `pnpm build` before standalone E2E. It captures screenshots under ignored `test-results/` and traces only on failure.

## Retired tenant fixture and replacement evidence

Phase 0's test-only `phase0_rls` schema, `withTenant` helper and tenant input unit case are retired because there is no shared tenant deployment. No applied migration/table RLS is disabled. Authentication/grant/race/crash tests are retained.

| Old check | Current protection and executable evidence |
|---|---|
| Two orgs / three conferences SELECT/INSERT/UPDATE/DELETE and scope-reassignment denial | Independent PostgreSQL databases and runtime credentials; `test:instances` proves A-only account absent in B, foreign Session/token rejected, resets preserve B state, and independent DB/network/volumes |
| Missing/partial tenant context; invalid tenant IDs | No tenant parameter/resolver or DB selector exists. `contract/instance` checks canonical Host; auth regressions deny absent/invalid sessions/CSRF. Local account permissions are now verified by integration/access; private files, submissions, finance, review, program, onsite and export resource permissions are verified in their domain integration suites |
| Non-owner/non-superuser/non-bypass; SET ROLE/ALTER/TRUNCATE denied | `integration/database.test.ts` exercises both actual roles; `integration/auth.test.ts` retains sensitive-table/column-grant denials |
| Commit/rollback/pool reuse/concurrent callbacks | `integration/database.test.ts` uses one-connection pools and real transactions; auth integration retains atomic outbox rollback and concurrency/race cases |
| Composite tenant FK rejects cross-tenant parent | No production tenant FK existed. Ordinary FK/check/unique constraints remain enforced in database/auth integration; separate-instance DBs cannot reference another instance's rows |
| Drizzle tenant demo | Removed with unused demo helper; existing dependency pin retained, no speculative replacement abstraction |

The old 16 tenant integration cases and one tenant-input unit case are replaced by four DB privilege/transaction cases, two instance contract/config cases and the real dual-instance suite. Deployment isolation does not substitute for future local role/resource tests.

Redis integration uses a unique queue in local test DB 1; it executes a real worker, verifies output/deduplication and two failed attempts for an unsupported job, then removes only its own queue. No FLUSHALL and no application data mutation. Unit/contract tests deliberately inject dependency probes or in-memory HTTP transport; they do not substitute for real service tests.

## Coverage limits

Account/login/CSRF/session/outbox and capture-mail regression exists. Phase1–6 core flows now include real private uploads, registration/manual payment, submissions/reviews/program, onsite and document/export workers. External payment/mail delivery providers remain unconfigured. Network-error E2E deliberately aborts requests while healthy flows use real services. TLS, full browser/WCAG, load/penetration, backup restore and cloud CI are unverified. Historical counts in PHASE0/PHASE1_1 delivery files are not current evidence; see CONTINUOUS_RUN for current run evidence.

## Test and documentation maintenance

Core business rules need independently runnable tests at the service/domain boundary. Use real PostgreSQL for RLS, constraints and transaction behavior, and real Redis for queue-dependent behavior. Injected transport/probe tests remain useful at their own boundary; they cannot replace those integration checks.

For a bug fix, first capture the failing behavior in a regression test at the responsible layer, then verify the fix and relevant existing checks. Preserve negative authorization/error assertions. Never remove, skip or weaken a check merely to get a pass. New API, policy, schema, environment and operational behavior must update the corresponding contract, examples, runbook and tests in the same change.

The existing required gates still apply to executable changes. Documentation-only changes need review for consistency, working relative links and diff cleanliness; do not invent behavioral tests or claim the full suite was rerun. Record actual commands, skipped/unverified areas and the four-part maintainability check in each delivery. Historical Phase 0 results in `PHASE0_DELIVERY.md` are not fresh evidence for later code changes.

## Handoff and common failures

Start with README setup, the [architecture entry-point map](ARCHITECTURE.md#entry-points-for-handoff) and the command table above. Inspect status/configuration without printing `.env`, credentials, request payloads or raw tokens.

| Symptom | Inspect / next step |
|---|---|
| Engine mismatch or install refusal | Check `node --version`, `pnpm --version` against `.node-version` / `packageManager`; activate pinned tools, do not disable engine/peer checks |
| Port conflict or Playwright refuses existing server | `docker compose ps`; choose host dev or app containers, stop only this project's conflicting process; never enable E2E reuse to test an unrelated server |
| API ready returns 503 | Inspect dependency statuses; verify PostgreSQL/Redis/worker health and safe-role/migration setup; use `pnpm db:migrate`, never bypass the runtime-role check |
| DB authentication fails after regenerating `.env` | Existing volume retains original passwords; follow OPERATIONS/README and a deliberate credential recovery plan, not automatic volume deletion |
| Integration refuses URL | Verify local test DB is `confsys_test` and Redis DB is 1; do not remove production-protection guards |
| OpenAPI drift | Review intended contract change, run `pnpm contract:generate`, then contract tests; never blindly bless unexpected private fields |
| Presentation import fails | Trace component → feature hook → SDK; move data behavior to its owner rather than disabling the boundary rule |
| Built behavior differs from source | Check package-local `dist` and staging `dist`; investigate stale artifacts before changing source or migrations; scheduled build-cleanup work is in ROADMAP |

Structured sanitized logging exists; full metrics/alerts and deployment diagnostics remain roadmap work. Never expose secrets to debug failures.

## Phase 1.1 verification (current)

Account/CSRF/session/outbox/capture-mail tests exist; production providers, future resource permissions, MFA and production operations still do not. Run `pnpm db:migrate:test` before standalone E2E. `pnpm check` runs all gates, including the integration suite that prepares the test schema. The tenant fixture is retired with replacement evidence above; non-tenant auth regressions remain.

| Test entry | Evidence |
|---|---|
| `unit/auth.test.ts` | role-specific config, HTTPS/loopback cookie policy, password Unicode/limits/Argon2 parameters, GCM integrity/version/AAD, safe diagnostics |
| `unit/tooling.test.ts` | absent UI folders, allowed UI imports, forbidden relative/alias/re-export paths; compile/delete/clean/recompile excludes obsolete output |
| `integration/auth.test.ts` | unique concurrent registration, state/purpose/expiry/reuse/concurrent token consumption, reset/session revocation, controlled reset/login race, controlled idle/absolute deadlines, rollback including outbox failure, actual runtime role grants |
| `integration/auth-http.test.ts` | actual Fastify CSRF/Origin/cookies, anonymous nonenumeration, real Redis source/account limits, Redis disconnect and DB outage, session/logout independence, captured log secrecy |
| `integration/mail.test.ts` | real BullMQ/SMTP/Mailpit, queue pause/recovery, reference-only payload, duplicate claims, token eligibility, retry/lease recovery, SIGKILL after real SMTP acceptance → unknown without resend |
| `integration/migrations.test.ts` | ephemeral blank and Phase 0 databases, unchanged 0001 checksum, preserved fixture data, repeatable forward migration and nonprivileged access |
| `contract/auth.test.ts` | auth OpenAPI/DTO field exclusion, status codes including 413/415, SDK CSRF/error behavior |
| `e2e/auth.spec.ts` | real register/verify/login/refresh/logout/reset, old password/session rejection, late A response after logout/B login, invalid link/network retry/mobile layout |

Integration requires Docker Compose access for temporary migration databases. It uses existing local cluster roles and creates only `confsys_test_blank_<random>` / `confsys_test_upgrade_<random>` / `confsys_test_phase11b_<random>` databases, drops only those it created, never existing app/test DBs or volumes. Auth fixtures delete only their unique email-prefix records. Mailpit queries use unique synthetic recipient addresses; no inbox wipe. No real provider credentials.

E2E starts built API/worker with role-filtered environment, `confsys_test` and Redis DB 1, fresh per-run CSRF key (same actual rate thresholds), plus Vite. No bypass of password hashing, CSRF or sessions. Token links come only from actual Mailpit messages in UI tests. Test-only helper `mail-crash.ts` has no production fault toggle: it signals SMTP acceptance through IPC, and the parent terminates the process before the accepted DB write. Lease expiry is advanced in isolated test records rather than waiting/sleeping for a minute. Race tests use explicit Promise barriers. Final exact results and unverified areas are in [PHASE1_1_DELIVERY](PHASE1_1_DELIVERY.md).

## Dual-instance same-build acceptance

`pnpm test:instances` creates fresh `.instances/<random-run>/a.env` and `b.env`, distinct `confsys-p13-<run>-a/b` projects, one versioned `confsys:p13-<run>` image and actual independent PostgreSQL/Redis/Mailpit/API/worker/Web. It refuses to replace existing containers by using fresh names; occupied ports cause failure, never stop other services. Required free ports: Web 55180/55181, DB 55440/55441, Redis 56390/56391, Mailpit 58030/58031, SMTP 51030/51031. Each run has unique hostnames, avoiding Cookie collisions with retained test projects. Browser canonical origins are `http://a-<run>.localhost:55180` and `http://b-<run>.localhost:55181`. Install Chromium first.

The suite checks runtime titles/names, explicit DTO/bundle secrecy, distinct random secrets, same image IDs, mounts/networks, A-only registration, same-email separate passwords, browser host-only cookies in one context, manually cross-sent Session/verification/reset tokens, A reset/revoke/logout versus B password/session/audit, canonical capture mail and forged Host, stopped A worker while B processes mail, restart A, A-only migration and both original smoke commands with unchanged B state. Existing browser regression separately proves late responses/private cache invalidation. Output `.instances/<run>/evidence.json` contains no secrets; screenshots are supplementary. Raw env/tokens/traces remain ignored and must not be published.

The runner keeps its identifiable synthetic resources for inspection on success or failure. Free its ports before rerunning, using only the files for that run:

```sh
CONFSYS_ENV_FILE=.instances/<run>/a.env pnpm compose --profile app down -v
CONFSYS_ENV_FILE=.instances/<run>/b.env pnpm compose --profile app down -v
```

These delete only that test run's synthetic volumes. Never run global prune or apply these commands to user environments. Keep env files until cleanup/recovery is finished; no script automatically resets existing secrets. For one selected instance:

```sh
CONFSYS_ENV_FILE=.instances/<run>/a.env pnpm compose --profile app run --rm migrate
CONFSYS_ENV_FILE=.instances/<run>/a.env pnpm smoke:stack
CONFSYS_ENV_FILE=.instances/<run>/a.env pnpm smoke:auth
```

For host full regression while the user's 25173/28025 are occupied, initialize this worktree with COMPOSE_PROJECT_NAME=confsys-p13-regression, WEB_PORT=55179, API_PORT=53000, WORKER_PORT=53001, POSTGRES_PORT=55442, REDIS_PORT=56392, MAILPIT_PORT=58032, SMTP_PORT=51032 before env:setup. Then infra:up/db:migrate/check use only those resources. Standalone E2E requires db:migrate:test and build first. No production data is used.

## Phase 1.2 verification additions

`pnpm test:access` runs `tests/integration/access.test.ts` against guarded local `confsys_test`, real runtime/migrator roles and Redis. It creates unique synthetic fixture accounts; cleanup removes only those records and a bootstrap marker belonging to its fixture. Never run this against an operator's DB. Core E2E obtains accounts via UI/Mailpit and uses actual CLI bootstrap, without SQL role grants. Test cleanup is privileged fixture cleanup only, not a supported operator recovery path.

| Entry | Actual exercised assertions |
|---|---|
| unit/access | deny unknown/missing roles and future permissions; fixed explicit mapping; five-minute proof boundary; strict mass-assignment/search/role rejection |
| integration/access | inert CLI preview; missing/pending/disabled targets; wrong origin/runtime connection; two independent CLI processes; bootstrap audit-failure rollback; completed re-run never regrants; ordinary/staff restrictions; idempotent roles; self-change denial; direct last-admin transaction invariant; mutual revoke/disable concurrency and post-lock actor check; disable/restore/token/epoch rules; zero-live-session forced logout versus login; login and reauth races; reset versus disable; audit rollback and actual grants; real HTTP/CSRF/Origin/Redis/projections |
| integration/migrations | retained blank/Phase 0 tests plus 520607e schema upgrade preserving synthetic user/hash/verified/token/session/outbox/envelope/audit; original session usable without roles/proof; migration repeatability and actual runtime role |
| contract/access | access route OpenAPI coverage; strict secret exclusion; typed SDK CSRF/mutation/error/projection |
| e2e/access | real UI registration → Mailpit → verification → real CLI preview/apply → old-session rejection → admin grant/staff read-only/revoke/disable/restore/second admin/forced logout/audit/reauth; private late-response cancellation; direct ordinary URL/API denial; mobile overflow assertion/screenshots |
| test:instances | all retained auth/token/mail/worker/network/isolation assertions plus A-only bootstrap, origin mismatch, foreign admin cookie, grants/revoke/disable/restore/reauth/forced logout preserving B roles/marker/accounts/sessions/audit |

The dual-instance runner now uses the 55xxx/56xxx/58xxx/51xxx port ranges above so retained Phase 1.1b containers are untouched. Same source and one built image still run all six Web/API/worker containers. It invokes original `smoke:stack` and `smoke:auth` against A. `pnpm check` runs the extended integration/E2E suites; CI already runs check/build/migrations/smokes/instances, so no duplicate or weakened gate is added. Exact counts/results and run/image IDs are recorded only in PHASE1_2_DELIVERY and sanitized evidence after execution. No cloud CI run is implied.

## Phase 1.3 verification and site troubleshooting

`pnpm test:site` runs the dedicated real PostgreSQL/Redis site suite (also included in `pnpm test:integration`). `pnpm check` includes all previous and new unit/contract/integration/E2E tests. `pnpm test:instances` builds a single current image and tests the original auth/access/worker/smokes plus independent A/B publications, HTML/canonical/languages, immutable history load, official mail brand and unchanged B containers/data during A updates. Runner creates fresh names, never replaces prior projects; free ports are prerequisites. Stop only your own prior synthetic run if needed; never stop user-retained environments to make ports available. Exact delivery counts/image/run IDs are in PHASE1_3_DELIVERY.

| Entry | Protection exercised |
|---|---|
| unit/site | date-only leap/order, IANA timezone, enabled-language metadata, strict/length constraints, script/data/userinfo/protocol-relative URL denial |
| unit/tooling | presentation type-only DTO import allowed; runtime contract import and server-entry DB import denied, existing relative/alias/re-export regression retained |
| integration/site | real first-save race/stale version, staff/user/anonymous denial, recent proof, duplicate concurrent publication, draft secrecy, history new draft, audit-trigger rollback for all writes, actual grants, retry/legacy mail snapshots, queued publish vs revoke/disable/session revocation, public consistency under concurrent publication, real HTTP CSRF/Origin/mass assignment/size/SSR/XSS/canonical/no-store/404/failure |
| integration/migrations | blank, Phase 0, Phase 1.1b and 0004 Phase 1.2 upgrade; preserved accounts/hash/credential version/role/marker/session/token/outbox/audit, old reset token actually usable, repeat migration |
| contract/site | OpenAPI GET+POST coexist on draft route, private-field rejection, SDK existing CSRF transport and conflict preservation |
| e2e/site | real UI account/Mailpit/CLI admin → edit/save/reload → competing editor conflict retains input → same-component preview → confirm publish → JS-disabled anonymous HTML/date/canonical → private new draft → republish/history load; late private response after session expiry, ordinary direct URL denial, desktop/mobile captures |

Public source renderer is exercised in HTTP integration, built artifact in E2E and same-image containers. Earlier test doubles remain unit/contract boundary checks, never evidence for PostgreSQL/SMTP. E2E fixtures remove only their own prefix accounts/publications and restore the prior singleton; no global data wipe. Site tests run sequentially against this project's guarded `confsys_test`; do not concurrently run independent suites against the same singleton.

On `/admin/site` save 409, keep local input and fetch server version for manual comparison, then explicitly discard/reapply. On 403 REAUTH_REQUIRED, enter current password and separately confirm publication again. On Session revoked, private queries/forms/preview/history clear. Public 503 means check database/migration and safe request ID logs; never change env to force a draft fallback. Public renderer changes in host dev require `pnpm --filter @confsys/web build:public`; normal clean build always creates both artifacts.

The old root health assertions remain at `/system/status`; production ingress now serves `/access/accounts` and `/admin/site` SPA directly. Static hash assets may cache, dynamic content/auth/private previews cannot. No service worker. No complete search-engine indexing, TLS, provider, WCAG, load or production restore claim.

## Local invitations

After the additive invitation migration, run `pnpm exec vitest run tests/integration/invitations.test.ts` with the selected isolated synthetic environment loaded (for example `node --env-file=<isolated-env> node_modules/vitest/vitest.mjs run tests/integration/invitations.test.ts`). It uses real PostgreSQL app/worker roles, Redis, and Mailpit SMTP. Cases exercise verified-recipient prerequisites, recent password proof, idempotent creation, concurrent acceptance, wrong-user tokens, expiration/revocation, issuer and recipient credential fencing, rollback on audit failure, worker recipient restrictions and HTTP CSRF/strict input checks. Fixture cleanup affects only generated test accounts and associated records.

Invitation checkpoint verification (2026-10-15 06:14 Asia/Taipei): `PATH=/tmp/confsys-tools/node_modules/.bin:$PATH node --env-file=/Users/fearnot/Desktop/confsys-phase-1-4-to-6-continuous/.env node_modules/vitest/vitest.mjs run tests/integration/invitations.test.ts` passed 7/7; `pnpm typecheck` and focused invitation/worker ESLint passed. `node scripts/check-boundaries.mjs` passed. Full `pnpm lint` was blocked by an unrelated new files contract control-character regex lint error. Browser navigation/visual validation and business-mail branch await integration wiring/schema; do not treat these as verified by service tests.

Business mail checkpoint (2026-10-15 06:18 Asia/Taipei): `PATH=/tmp/confsys-tools/node_modules/.bin:$PATH node --env-file=/Users/fearnot/Desktop/confsys-phase-1-4-to-6-continuous/.env node_modules/vitest/vitest.mjs run tests/integration/business-mail.test.ts` passed 2/2 using real PostgreSQL and Mailpit SMTP, including captured subject/body, event deduplication, caller rollback and disabled-recipient suppression. Invitation browser flow is provided in `tests/e2e/invitations.spec.ts`; execution awaits the integrated app routing. Unit permission expectations now enumerate the explicit new grant set instead of merely counting entries.

Review checkpoint: `tests/unit/reviews.test.ts` verifies rubric completeness, per-criterion bounds and duplicate/unknown score denial; the focused review/access unit run passed 5/5. `tests/integration/reviews.test.ts` is prepared for real app-role PostgreSQL, real private storage and ClamAV: role/track/self/coauthor restrictions, assignment acceptance, draft/final review concurrency, immutable revision and publication behavior, blinded DTOs, conflict-fenced downloads, decision rollback/outbox, session revocation and chair conflicts. Integration execution is pending the shared synthetic-environment slot and real scanner readiness at this checkpoint; no browser or integration pass is implied by the static checks.

Review verified checkpoint (2026-10-15 06:32 Asia/Taipei): `PATH=/tmp/confsys-tools/node_modules/.bin:$PATH node --env-file=/Users/fearnot/Desktop/confsys-phase-1-4-to-6-continuous/.env node_modules/vitest/vitest.mjs run tests/integration/reviews.test.ts` passed **8/8**, including real ClamAV-backed upload and anonymous authorized download. Earlier scoped run passed 7/7 while scanner startup was pending; the complete run supersedes that limitation. Snapshot preservation after a later conflict, chair conflict declaration and transaction rollback are exercised. No browser review flow has yet been executed at this checkpoint.

### Phase 6 notification/reporting checks

- `pnpm exec vitest run tests/unit/reporting.test.ts`: CSV escaping and formulas,
  including leading whitespace/control characters.
- `node --env-file=/path/to/synthetic.env node_modules/vitest/vitest.mjs run tests/integration/reporting.test.ts`:
  real app-role notification RLS/ownership, read idempotency, session/permission/proof,
  safe export/preview projections, audited principal preservation, pagination and HTTP CSRF.
- Reporting exports are bounded live pages, not an asynchronous snapshot export job.
  Full snapshot exports are now a distinct durable worker flow described below.

### Bounded bulk mail

`node --env-file=/path/to/synthetic.env node_modules/vitest/vitest.mjs run tests/integration/notification-batches.test.ts`
exercises3 cases with real PostgreSQL and Mailpit SMTP: current permission/recent
proof, recipient eligibility, concurrent idempotency, immutable body/key binding,
accepted status, explicit cancellation, issuer-role/credential revocation and disabled
recipient cancellation. `tests/e2e/notification-batches.spec.ts` exercises the browser
queue command, actual worker-to-Mailpit capture and the recipient's notification center.


### Durable CSV export and aggregate statistics

`node --env-file=/path/to/synthetic.env node_modules/vitest/vitest.mjs run tests/integration/export-jobs.test.ts tests/integration/reporting.test.ts`
passed 10/10 on 2026-10-15 07:07 Asia/Taipei against the isolated real PostgreSQL,
Redis and non-privileged runtime roles. Export tests cover over 1,000 source rows,
keyset batching, a coherent historical read despite a subsequent source edit,
formula-safe CSV, SHA-256 verification, owner isolation, fresh-password checks,
revocation between snapshot and publication, credential epochs, expiry, concurrent
request bounds, lease recovery and actual BullMQ processing. Reporting checks one
statement timestamp and exact currency aggregates without private detail leakage.

`pnpm exec vitest run tests/unit/export-csv.test.ts tests/unit/reporting.test.ts`
passed 2/2: CSV escaping/formula neutralization and actual UTF-8 byte accounting;
exceeding the configured 64 MiB ceiling cannot yield partial successful output.
The integration test is over 1,000 rows; no throughput benchmark or maximum-size
performance claim is made. `tests/e2e/export-jobs.spec.ts` exercises request, real
worker completion and the downloaded browser file (browser verification tracked
in the integration run report).

Notification retry regression (`tests/integration/notification-batches.test.ts`) uses
an actual closed ephemeral loopback SMTP port for three exhausted connection
attempts, then Mailpit for the explicit retry child. It covers same/different-key
concurrency, immutable source statuses, unknown/accepted/in-progress exclusions,
seven-day expiry, cancellation, recipient/issuer revocation, recent proof and
transaction rollback when auditing fails. No uncertain SMTP result is resent.

`tests/integration/finance-activity-boundaries.test.ts` covers real `confsys_app`
RLS without actor context and across owners, forged booking foreign keys, disabled
payer revocation/reactivation, and HTTP cancellation deadline equivalence between
activity and registration endpoints. It creates only synthetic records and
restores the previous registration configuration pointer after cleanup.

The finance/activity boundary suite also creates 101 real partial allocations,
walks the independent allocation pager with an order filter, verifies own/admin
scope separation, and refunds an older allocation through authenticated HTTP.
Payment/order pagination cannot silently hide this allocation history.

### Verified mailbox change regression (2026-10-15)

Use the isolated instance's env file and canonical migration 0040. Executed:

```sh
PATH=/tmp/confsys-tools/node_modules/.bin:$PATH node --env-file=/Users/fearnot/Desktop/confsys-phase-1-4-to-6-continuous/.env node_modules/vitest/vitest.mjs run tests/integration/email-change.test.ts tests/integration/email-change-http.test.ts tests/integration/reviews.test.ts tests/integration/competitions.test.ts
```

Mailbox service 6/6, HTTP 1/1 and competition 11/11 passed. The initial review run had one failure because this independent branch still held the pre-0027 private-file module; after copying the current integrated file source, `... vitest.mjs run tests/integration/reviews.test.ts` passed 9/9 including the same private download/scanner assertion and new alias conflict test. No assertion was removed. Cases include real Mailpit target delivery, original-account binding, confirmation CSRF, stale proof/epoch, expiry/replay, concurrent consumption and competing target claims, audit-failure rollback, obsolete notification suppression, append-only history RLS, stable ownership, reviewer assignment/candidate exclusion and competition assignment/read/score exclusion.

`pnpm typecheck`, targeted ESLint of changed source/tests and `node scripts/check-boundaries.mjs` passed. `tests/e2e/email-change.spec.ts` is authored for the integrated built application; its browser execution remains pending the main integrator's route/build cycle. This test reads the actual captured confirmation mail, proves GET alone does not mutate, confirms the target and verifies a second browser's old session is revoked.
