# Testing

## Reproduce

Use pinned Node 24.21.0 and pnpm 10.34.7. Install dependencies, generate local env, start infrastructure and migrate as README describes. Tests never read production environment URLs by default. Integration helpers require loopback hosts and the exact `confsys_test` database / Redis DB 1. This guard reduces accidental misuse; operators must still point local ports at isolated development services.

| Command | Behavior |
|---|---|
| `pnpm lint` | ESLint + AST presentation/import boundaries |
| `pnpm typecheck` | strict TypeScript across apps, packages and tests |
| `pnpm test:unit` | config secrecy/failure, context validation, HTTP readiness failure, real structured 404/request ID |
| `pnpm test:integration` | real PostgreSQL RLS/constraints/transaction tests and Redis BullMQ jobs |
| `pnpm test:contract` | committed OpenAPI drift, Fastify schemas/SDK and invalid DTO responses |
| `pnpm build` | TS server/packages and Vite production build |
| `pnpm test:e2e` | starts built API/worker + Vite, Chromium real health, locale/refresh/mobile, network failure/retry |
| `pnpm check` | all seven gates above in order |
| `pnpm smoke:stack` | running container stack health + Mailpit health + synthetic job through independent worker process |
| `pnpm smoke:auth` | fixed loopback container Web → real CSRF/register/Mailpit/verify/login/refresh/logout through reverse proxy (Chromium required) |

Playwright requires `pnpm exec playwright install chromium`; Linux CI adds `--with-deps`. E2E intentionally refuses to reuse an existing server, so it cannot accidentally validate unrelated local processes. Stop this project's dev/app stack first. E2E uses built API/worker; run `pnpm build` before standalone E2E. It captures screenshots under ignored `test-results/` and traces only on failure.

## RLS evidence

`tests/fixtures/rls.sql` creates `phase0_rls` only in `confsys_test`, under an advisory lock. Fixtures use random UUIDs, two organizations, three conferences (two in one organization), synthetic notes and attachments. No passwords/users or production seeds. Schema is dropped on completion; next run cleans stale fixture after acquiring the same lock. Test fixture is not part of production migrations.

Both actual `confsys_app` and `confsys_worker` logins exercise:

1. Non-owner/NOSUPERUSER/NOBYPASSRLS and cannot SET ROLE migrator, ALTER RLS or TRUNCATE.
2. Scoped SELECT/INSERT/UPDATE/DELETE, including Drizzle on the transaction connection.
3. Cross-organization AND same-organization cross-conference SELECT/UPDATE/DELETE return no rows; INSERT and scope reassignment fail with 42501.
4. Missing/partial context deny; single-connection pool verifies same backend PID after commit with no remaining data visibility.
5. Rollback removes inserted data and transaction context.
6. Composite foreign keys reject cross-scope parent references (23503).
7. Concurrent callers queue on a single pooled connection without scope leakage.

Redis integration uses a unique queue in local test DB 1; it executes a real worker, verifies output/deduplication and two failed attempts for an unsupported job, then removes only its own queue. No FLUSHALL and no application data mutation. Unit/contract tests deliberately inject dependency probes or in-memory HTTP transport; they do not substitute for real service tests.

## Coverage limits

No account/login, CSRF, session, payment, submission, upload, outbox, email-delivery or full business E2E exists. Network-error E2E deliberately aborts a browser request; healthy E2E uses real servers. Full browser matrix, WCAG certification, load/security penetration, production deployment and backup restore drills remain unverified. GitHub Actions YAML is configured for PR and main; cloud execution requires a remote repository and push.

Exact local execution results, resolved failures and counts live in `PHASE0_DELIVERY.md`. Never mark checks passing solely because scripts or CI YAML exist.

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

Log-format limitations currently make some worker/DB failures harder to distinguish; the roadmap schedules sanitized correlation and failure tests. That limitation does not justify exposing raw secrets for debugging.

## Phase 1.1 verification (current)

The Phase 0 coverage limitations above describe its original delivery. Account/CSRF/session/outbox/capture-mail tests now exist; production providers, complete tenancy, MFA and production operations still do not. Run `pnpm db:migrate:test` before standalone E2E. `pnpm check` runs all gates, including the integration suite that prepares the test schema. Existing Phase 0 files/assertions are retained.

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

Integration requires Docker Compose access for temporary migration databases. It uses existing local cluster roles and creates only `confsys_test_blank_<random>` / `confsys_test_upgrade_<random>` databases, drops only those it created, never existing app/test DBs or volumes. Auth fixtures delete only their unique email-prefix records. Mailpit queries use unique synthetic recipient addresses; no inbox wipe. No real provider credentials.

E2E starts built API/worker with role-filtered environment, `confsys_test` and Redis DB 1, fresh per-run CSRF key (same actual rate thresholds), plus Vite. No bypass of password hashing, CSRF or sessions. Token links come only from actual Mailpit messages in UI tests. Test-only helper `mail-crash.ts` has no production fault toggle: it signals SMTP acceptance through IPC, and the parent terminates the process before the accepted DB write. Lease expiry is advanced in isolated test records rather than waiting/sleeping for a minute. Race tests use explicit Promise barriers. Final exact results and unverified areas are in [PHASE1_1_DELIVERY](PHASE1_1_DELIVERY.md).
