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
| Missing/partial tenant context; invalid tenant IDs | No tenant parameter/resolver or DB selector exists. `contract/instance` checks canonical Host; auth regressions deny absent/invalid sessions/CSRF. Local account permissions are now verified by integration/access; future business resource permissions remain unimplemented |
| Non-owner/non-superuser/non-bypass; SET ROLE/ALTER/TRUNCATE denied | `integration/database.test.ts` exercises both actual roles; `integration/auth.test.ts` retains sensitive-table/column-grant denials |
| Commit/rollback/pool reuse/concurrent callbacks | `integration/database.test.ts` uses one-connection pools and real transactions; auth integration retains atomic outbox rollback and concurrency/race cases |
| Composite tenant FK rejects cross-tenant parent | No production tenant FK existed. Ordinary FK/check/unique constraints remain enforced in database/auth integration; separate-instance DBs cannot reference another instance's rows |
| Drizzle tenant demo | Removed with unused demo helper; existing dependency pin retained, no speculative replacement abstraction |

The old 16 tenant integration cases and one tenant-input unit case are replaced by four DB privilege/transaction cases, two instance contract/config cases and the real dual-instance suite. Deployment isolation does not substitute for future local role/resource tests.

Redis integration uses a unique queue in local test DB 1; it executes a real worker, verifies output/deduplication and two failed attempts for an unsupported job, then removes only its own queue. No FLUSHALL and no application data mutation. Unit/contract tests deliberately inject dependency probes or in-memory HTTP transport; they do not substitute for real service tests.

## Coverage limits

Account/login/CSRF/session/outbox and capture-mail regression exists. No CMS/payment/submission/upload/private-download or external provider is implemented. Network-error E2E deliberately aborts requests while healthy flows use real services. TLS, full browser/WCAG, load/penetration, backup restore and cloud CI are unverified. Historical counts in PHASE0/PHASE1_1 delivery files are not current evidence; see PHASE1_2_DELIVERY.

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

`pnpm test:instances` creates fresh `.instances/<random-run>/a.env` and `b.env`, distinct `confsys-p12-<run>-a/b` projects, one versioned `confsys:p12-<run>` image and actual independent PostgreSQL/Redis/Mailpit/API/worker/Web. It refuses to replace existing containers by using fresh names; occupied ports cause failure, never stop other services. Required free ports: Web 45173/45174, DB 45432/45433, Redis 46379/46380, Mailpit 48025/48026, SMTP 41025/41026. Browser canonical origins are `http://a.localhost:45173` and `http://b.localhost:45174`. Install Chromium first.

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

For host full regression while the user's 25173/28025 are occupied, initialize this worktree with COMPOSE_PROJECT_NAME=confsys-p12-regression, WEB_PORT=45175, API_PORT=43000, WORKER_PORT=43001, POSTGRES_PORT=45434, REDIS_PORT=46381, MAILPIT_PORT=48027, SMTP_PORT=41027 before env:setup. Then infra:up/db:migrate/check use only those resources. Standalone E2E requires db:migrate:test and build first. No production data is used.

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

The dual-instance runner now uses the 45xxx/46xxx/48xxx/41xxx port ranges above so retained Phase 1.1b containers are untouched. Same source and one built image still run all six Web/API/worker containers. It invokes original `smoke:stack` and `smoke:auth` against A. `pnpm check` runs the extended integration/E2E suites; CI already runs check/build/migrations/smokes/instances, so no duplicate or weakened gate is added. Exact counts/results and run/image IDs are recorded only in PHASE1_2_DELIVERY and sanitized evidence after execution. No cloud CI run is implied.
