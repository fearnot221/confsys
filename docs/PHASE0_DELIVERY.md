# Phase 0 delivery — 2026-10-15

Branch: `codex/phase-0`. Delivery commit is the commit containing this report (`git log -1 --oneline`); final chat records its exact hash. No remote, PR, merge or production deployment was created. User approved initializing this folder as a standalone repository because Git initially resolved to the home directory. Other project work was not staged or committed here.

## Implemented and usable

- pnpm workspace with Web, modular monolith API, independent BullMQ worker and contracts/SDK/UI/DB/config packages.
- Actual service status screen: Traditional Chinese/English, manual refresh, network failure/retry, responsive layout and error boundary. No mock user/conference records.
- Local PostgreSQL, persistent noeviction Redis, Mailpit; full app-profile containers run as non-root with readiness/resource limits/shutdown handling.
- Zod DTOs → Fastify serialization/OpenAPI → typed SDK → hooks → pure presentation. Import/network boundary checks.
- Separate migrator/API/worker DB logins, transaction-local scope helper and isolated RLS example with two organizations/three conferences. Synthetic queue jobs only.
- CI configuration for PR/main; architecture, permissions, contracts, testing, roadmap, operational limitations and ADR.

## Schema, APIs and environment

Migration `0001_foundation.sql` installs no business tables: infrastructure ledger/grants only. A checksum-verified runner serializes migrations with an advisory transaction lock. `phase0_rls` tables are installed and dropped only by integration tests in `confsys_test`.

Public API: GET `/api/health/live` (200), GET `/api/health/ready` (200/503); structured 404 on all unimplemented routes. No login/payment/submission endpoint. Worker health is internal in Compose. OpenAPI snapshot is in `packages/contracts/openapi.json`.

Environment names: local role passwords, `MIGRATION_DATABASE_URL`, `DATABASE_URL`, `WORKER_DATABASE_URL`, their `TEST_*` URLs, `REDIS_URL`, `TEST_REDIS_URL`, `WORKER_HEALTH_URL`, ports/hosts and `NODE_ENV`. `.env` generated with random values and mode 0600, ignored by Git and Docker context. No provider credentials. See `.env.example`.

## Actual commands and results

Host originally had Node 24.1.0/pnpm 11.25.0; validation used isolated tools installed via `npm install --prefix /tmp/confsys-tools --no-audit --no-fund node@24.21.0 pnpm@10.34.7`. For the commands below, local invocations prefixed `PATH=/tmp/confsys-tools/node_modules/.bin:$PATH`. Users can instead activate the pinned versions normally.

| Executed command | Result |
|---|---|
| `pnpm install` | Passed, exact lockfile created, peer checks enabled |
| `pnpm install --frozen-lockfile --offline` | Passed; lockfile consistent |
| `pnpm env:setup` | Passed; random local credentials generated |
| `pnpm dev` + `pnpm smoke:stack` | Passed after launcher fixes; all three host dev processes served real health and job results; stopped with Ctrl-C |
| `docker compose up -d --wait postgres redis mailpit` | Passed after resolving occupied host ports; all three healthy |
| `pnpm db:migrate` | Passed; 0001 applied |
| `pnpm contract:generate` | Passed; committed snapshot generated |
| `pnpm lint` | Passed; ESLint and AST boundary check |
| `pnpm typecheck` | Passed |
| `pnpm test:unit` | **5 passed**, 2 files |
| `pnpm test:integration` | **17 passed**, 2 files; real PostgreSQL and Redis |
| `pnpm test:contract` | **3 passed**, 1 file |
| `pnpm build` | Passed; TypeScript and Vite build |
| `pnpm exec playwright install chromium` | Passed |
| `pnpm test:e2e` | **2 passed**; Chromium real stack status, locale, refresh/mobile, network-error recovery |
| `pnpm check` | Passed end-to-end, exit 0; all seven gates above rerun together |
| `docker compose --profile app build` | Passed for API/worker/Web/migrate images |
| `docker compose --profile app run --rm migrate` | Passed; existing migration safely reused |
| `docker compose --profile app up -d --no-build --wait api worker web` | Passed; app and dependencies healthy |
| `pnpm smoke:stack` | Passed; built Web/API/Mailpit + real job handled by independent worker |
| `docker compose --profile app stop worker` + HTTP probe | Readiness **503**, worker `down`; liveness **200** |
| `docker compose --profile app up -d --no-deps --wait worker` + `pnpm smoke:stack` | Passed; recovered and processed another synthetic job |
| `docker compose exec -T api id` / `... worker id` | Both uid/gid 1000 (`node`) |
| `docker compose exec -T api sh -c 'test ! -f /app/.env'` | Passed; no generated .env in image |
| Browser probe of built container Web | Chromium rendered real ready status; screenshot saved |
| `git diff --check` / `git check-ignore .env` | Passed / .env ignored |
| `git diff --cached --check -- . ':!docs/SPEC.md'` | Passed for new work; supplied SPEC retained its two Markdown hard-break spaces |

Worker outage HTTP probe used Node `fetch` against `http://127.0.0.1:25173/api/health/ready` and `/api/health/live`, asserting 503 + worker down and 200 respectively. Browser probe used Playwright Chromium against the container Web and waited for the real ready status. No external mail or payment calls.

Screenshots (ignored local artifacts): `test-results/phase0-desktop.png`, `phase0-mobile.png`, `phase0-container.png`. Desktop and mobile screenshots were visually inspected. Raw final gate output is in `/tmp/confsys-check.log`, image build output in `/tmp/confsys-image-build.log`; those ephemeral machine logs are not required for reproduction and are not committed.

## Tenant / permission evidence

For **each** actual app and worker login, tests prove own-scope CRUD, cross-organization and same-organization cross-conference denial, WITH CHECK on insertion/scope reassignment, denial with missing/partial context, nonprivileged role properties, forbidden role escalation/ALTER/TRUNCATE, composite foreign keys, rollback and single-pool-connection reuse. Concurrent tenant callers return only their own synthetic values. See `tests/integration/tenant.test.ts` and `docs/TESTING.md`.

Redis test executes actual jobs, stable-ID duplicate detection and two attempts for an unsupported job. Retry safety is limited to the pure synthetic function; no exactly-once external effect claim.

## Resolved failures / environment adjustments

- New React patch publication conflicted with a self-imposed 24-hour minimum package age setting. Removed that optional age policy; stable versions remain pinned and engine/peer/lockfile checks stay enforced.
- `pnpm setup` invoked pnpm's built-in shell configuration command. Removed the block it appended and renamed the project command to `pnpm env:setup`.
- Existing unrelated services occupied initial default ports; moved this project to 25432/26379/28025/21025 and 23000/23001/25173. Did not stop those unrelated services.
- Initial typecheck exposed Fastify error typing, CSS declarations, BullMQ 6 readiness API and Drizzle transaction type issues; fixed and all gates reran successfully.
- First built-server E2E exposed pnpm module resolution from root-level dist. Build now distributes compiled files into package-local dist; built-server E2E and full containers pass.
- Final review kept the RLS fixture advisory-lock connection checked out for its full lifetime; targeted integration tests reran successfully. Source files were formatted with Prettier 3.9.10; lint/typecheck reran successfully.
- Explicit dev-start verification found a changed concurrently CLI path, tsx watch argument ordering and environment propagation through Node --run. Replaced the launcher with the public concurrently binary and per-process `node --env-file=.env --watch --conditions=development --import tsx`; actual `pnpm dev` plus `pnpm smoke:stack` then passed.
- Playwright emitted a cosmetic FORCE_COLOR/NO_COLOR warning; no failed or skipped test remained.

## Unconfigured / unverified / blockers

**Unconfigured:** remote Git hosting and branch-protection reviewers, deployment target, real mail/payment providers, SSO, object storage, retention/receipt policies. No fake adapters substitute for them.

**Unverified:** cloud GitHub Actions execution (YAML only; local equivalent passed), production deployment, backup restore drill, load/performance limits, complete WCAG and browser matrix, provider sandbox behavior. Application images retain build/dev dependencies; production hardening is not complete. No claims of production readiness.

**Environment blockers:** none remain for local Phase 0. A clean install needs the pinned Node/pnpm, Docker and free documented ports. Do not run dev and container Web simultaneously. The host's default Node/pnpm remain unchanged; activate pinned tools before local commands.

**Not implemented (by scope):** real authentication/session/CSRF, organizations/conference management, business permissions, persistent audit/outbox, uploads, registration/payments/submission/review/program. RLS fixtures are not a complete account or tenancy system. UI library/form/router additions are deferred until an actual Phase 1 feature needs them, per ADR.

## Next minimal work; stop condition

Phase 1 is not started. Proposed reviewable slices: (1) real identity/session and audit/outbox base, (2) organization/conference memberships and trusted scope with switching, (3) versioned conference/series settings, (4) draft/published public pages with crawlable HTML, (5) invitation/outbox/private-file reliability completion. Details and gates in ROADMAP. Await explicit confirmation before beginning any slice.

## Maintainability requirements follow-up — 2026-10-15

Branch: `codex/maintainability-rules`, based on `c6f1d5f`. Earlier sections describe the original Phase 0 delivery; the results below are the fresh verification for this documentation-only follow-up. No Phase 1 implementation, external service operation, merge or production deployment is included.

Added all-phase maintainability requirements to AGENTS, module/entry-point guidance to ARCHITECTURE, change/diagnostic discipline to DATA_CONTRACT, feature-layer guidance to UI_CONTRACT, and regression/handoff/troubleshooting guidance to TESTING. Updated the existing PR template with the required four-part delivery check. Existing document content was retained; no new document or framework was created. The focused source review and five evidence-based deferred items are in [ROADMAP.md](ROADMAP.md#phase-0-maintainability-review--2026-10-15).

Actual commands (Node 24.21.0 / pnpm 10.34.7, using the same isolated tool PATH documented above): `pnpm lint` and `pnpm typecheck` passed; `pnpm test:unit` passed 5 tests, `pnpm test:integration` passed 17 tests against local PostgreSQL/Redis, and `pnpm test:contract` passed 3 tests. `git diff --check` passed. A Python inline check verified that original document lines remain in order and relative links/anchors resolve. No build, E2E, container rebuild or full `pnpm check` was rerun for this documentation-only change; their earlier results remain historical. No new behavioral test was warranted because runtime behavior was not changed.

### Maintainability check / 可維護性檢查

1. **Modules and boundaries:** changed only engineering instructions, architecture/UI/data/testing guidance, roadmap, delivery record and PR template. No runtime module, schema, API, environment variable or startup flow changed.
2. **Duplication/coupling/dependencies:** no duplicated business rules, new cross-module runtime coupling or dependencies. AGENTS holds the enduring policy; existing specialized documents explain their own boundaries; the roadmap holds the single debt list.
3. **Tests and documentation:** no test implementation changed; existing relevant gates reran as above, including both real nonprivileged DB logins and cross-organization/cross-conference isolation. Original documentation content and local links were checked.
4. **Debt and practical risks:** the focused review found no demonstrated blocker for the current health/synthetic-job scope. M1–M5 track role-specific config, safe diagnostics, import-check coverage, stale build artifacts and future HTTP error semantics with treatment points and acceptance criteria. They are not claimed fixed. Reassess before the related authorized unit; Phase 1 still requires confirmation.

No local environment blocker was encountered. Cloud CI, production behavior and the broader coverage limits above remain unverified. Current local services and existing startup instructions are unchanged.
