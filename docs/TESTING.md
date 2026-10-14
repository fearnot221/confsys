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
