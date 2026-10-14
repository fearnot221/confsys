# Repository Agent Instructions

## Product and scope

Build reusable academic conference software: one codebase and one independently deployed instance per conference. Read `docs/SPEC.md` before implementation. The supplied legacy screenshots are functional references only; never reproduce their visual design.

Each deployment serves exactly one conference with its own accounts, sessions, tokens, database, Redis, mail and storage. A host organization is descriptive/contact data, not a tenant. No global identity, organization membership, conference switching, default tenant or cross-instance SSO. This Phase 1.1b user decision supersedes the earlier multi-tenant product premise (ADR 0003).

The owner requested PostgreSQL, Redis, Node.js and Vite. Proposed additions are React, TypeScript, Fastify, Drizzle ORM / node-postgres, BullMQ, Tailwind CSS / shadcn/ui, React Router, TanStack Query, React Hook Form / Zod, REST / OpenAPI, Vitest and Playwright. Use compatible, supported, stable versions; verify and pin them. Do not silently replace an existing repository's stack.

## Before changing code

Inspect README, existing agent instructions, package manifests, Git status, branch, migrations and CI. Preserve unrelated and uncommitted work. Do not reinitialize a non-empty repository.

Implement only the authorized phase. Make a short plan, then perform real implementation. Record assumptions and blockers. Do not ask about matters already specified in SPEC. Do not proceed to the next phase without approval.

## Architecture and ownership

Use a modular monolith API plus an independently running worker, not premature microservices. PostgreSQL is authoritative. Redis handles queues, reconstructible caching and rate limits.

Codex owns architecture, domain logic, API, database, policies, SDK, data hooks, tests, CI and infrastructure. Later Claude Code work owns presentation components, tokens, styling, layout and accessibility improvements.

Presentation components receive props / view models and callbacks. They must not perform network requests, access tokens, import DB code, or redefine business permissions. Shared API contracts must not expose DB rows directly. Protect these boundaries through lint/import rules where feasible.

Every agent uses a separate branch/worktree. Do not modify another agent's worktree or overwrite its changes. Contract changes require coordinated review; presentation-only work cannot silently modify schemas or endpoints.

## Maintainability — applies to every phase

Maintainability, handoff, debugging and extension are ongoing acceptance criteria, not a final refactoring phase. Apply these rules within the currently authorized scope; they do not authorize the next phase, production operations or architectural rewrites.

- Organize code by business domain with clear, one-way dependencies. HTTP handlers handle input, validation, invocation and response; application/domain services explicitly own authorization, business rules and transaction boundaries; repositories perform scoped persistence without HTTP or UI behavior.
- API and worker reuse the same business rules. Generic helpers, generic CRUD and repository abstractions must never bypass trusted actor/resource context, authorization or database constraints. Introduce layers when a real responsibility exists, not to populate empty folders.
- Use clear business names, small cohesive functions and readable control flow. Comments explain why and important constraints. Judge responsibility and complexity rather than arbitrary file-line limits.
- Abstract existing duplication or stable boundaries. Do not speculate with large frameworks, generic engines or redundant wrappers. Avoid unrelated renaming, moves and formatting rewrites.
- Do not conceal type, contract or runtime errors with excessive `any`, unchecked assertions, silent catches or false-success fallbacks. Deliberate error translation must preserve a truthful failure outcome and safe diagnostic information.
- Browser network access belongs in the SDK; feature data layers own server state and mutations. Presentation receives only props/view models/callbacks, never implements business authorization. Maintain UI/data import boundaries and the existing Codex/Claude ownership split.
- Schema changes use versioned migrations, never required ad hoc installation SQL or rewrites of applied migrations. Significant data changes document compatibility, backfill and failure/recovery strategy. Keep bootstrap provisioning scripted and repeatable.
- Centrally validate new environment variables and update `.env.example` and relevant documentation. Use consistent error, log and job-state formats with necessary correlation information; never record passwords, session/invitation/reset tokens, provider secrets or unnecessary personal data.
- Explain every added dependency's purpose; record the reasons and tradeoffs for important technical choices in an ADR. Do not add dependencies without a concrete need.
- Keep core rules independently testable; verify PostgreSQL/RLS/transactions/Redis with real integration tests. Bug fixes include regression coverage; never delete or weaken existing checks to obtain a pass.
- Update relevant documentation with API, permission, model, environment or operational changes. A new maintainer must be able to find feature entry points, start the environment, run tests and locate common failures. Details belong in the existing architecture/contracts/testing documents rather than duplicated manuals.

Before the next authorized development unit, perform a focused Phase 0 review against these rules. Fix evidenced safety/correctness blockers first; record nonblocking debt with evidence, practical risk, acceptance criteria and an appropriate phase in `docs/ROADMAP.md`. The dated review is a baseline to recheck when the relevant code changes, not perpetual approval or permission to start Phase 1.

## Security and business invariants

- Resolve local actor, permissions and resource ownership from server authentication and persisted relationships, never client-supplied scope. Each deployment has a fixed database; requests cannot select another instance.
- Enforce authorization on every relevant backend action and file access. Public endpoints return explicit published projections only.
- Test cross-instance account/session/token/mail/data isolation and local resource authorization as implemented. Missing actor/resource authorization is deny-by-default.
- Use composite constraints and appropriate PostgreSQL RLS. App/worker roles must not silently bypass RLS. Pool context must be transaction-local, and tests must use the actual non-privileged role.
- Use server-side sessions with safe cookies and CSRF protection. Do not store long-lived bearer tokens in localStorage or send plaintext passwords.
- Separate registration, order, payment, submission, review decision, presentation and competition states. Draft submission is never a rejection.
- Keep immutable revisions/snapshots where historical correctness matters: submissions, form versions, prices, decisions, program publication and receipts.
- Use PostgreSQL transactions and constraints for money, capacity, numbering and redemption. Redis locks are not the only correctness mechanism.
- Persist domain changes and outbox events atomically. Make jobs retry-safe; do not claim exactly-once external email/payment effects.
- Keep uploads private, bounded and authorized; validate actual content and quarantine when required. Do not publish raw submissions by default.
- Never log passwords, session secrets, provider keys or unnecessary manuscript/personal content.
- Development, CI and previews cannot send real bulk mail, trigger real charges, or access production data by default.

## Workflow and quality

Use feature branches and Conventional Commits. Never auto-merge or deploy production without explicit approval.

Each phase must include usable UI, real APIs, authorization, validation, errors, tests, migrations where needed, and updated documentation. Explicitly unfinished functionality must not masquerade as working through production mock data.

Do not replace required tests with no-op scripts, empty success responses or assertions that do not exercise behavior. Do not skip or weaken checks just to make CI green.

Required quality gates: lint, typecheck, unit tests, integration tests, contract checks and build. Add Playwright E2E as real user flows become available. Use PostgreSQL and Redis for integration behavior that depends on those systems, rather than SQLite-only or mock-only tests.

The Phase 0 task establishes executable repository commands. After creation, document the exact commands in README/TESTING and keep this file aligned. Do not report a command as passing unless it actually ran successfully.

Use synthetic fixture data only. No production seeds with known passwords. Keep migrations separate from concurrent API startup. Document backup/restore and deployment limitations.

## Delivery report

Report: branch/commit; implemented scope; usable flow; schema/API/env changes; exact executed commands and results; instance/permission test evidence; limitations and unverified areas; next minimal step.

Distinguish implemented, mocked, unconfigured and unverified. No invented benchmark, external-provider verification, test result, PR URL or production-readiness claim.

Every delivery must include a **Maintainability check / 可維護性檢查** covering:

1. Changed modules and their responsibility boundaries.
2. Any new duplicated rules, cross-module coupling or dependencies (explicitly say none when applicable).
3. Tests and documentation updated together, with actual verification results.
4. Known technical debt, practical risks and recommended treatment phase.

## Phase 0 executable commands

Use Node 24.21.0 and pnpm 10.34.7. Setup: `pnpm install --frozen-lockfile`, `pnpm env:setup`, `pnpm infra:up`, `pnpm db:migrate`; run `pnpm dev`. Do not use `pnpm setup` (pnpm internal command).

Required gates: `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm test:integration`, `pnpm test:contract`, `pnpm build`, `pnpm test:e2e`; `pnpm check` runs them in order. Install Chromium first with `pnpm exec playwright install chromium`. Standalone E2E also requires `pnpm db:migrate:test` (local `confsys_test` only). Container smoke: `pnpm smoke:stack` after starting the app profile. See README and docs/TESTING.md for exact prerequisites and limitations.

The retired Phase 0 tenant fixture is historical, not deployment-isolation evidence. Phase 1.2 is the current authorized unit: fixed local roles/permissions, controlled one-time CLI bootstrap and account administration. Later units require fresh approval. Use CONFSYS_ENV_FILE to select configuration for all commands and pnpm compose for explicit project operations. pnpm test:instances builds one image and verifies two synthetic deployments; see TESTING for ports and cleanup. Original worktrees and existing services must remain untouched.

Phase 1.2: `pnpm admin:bootstrap --user-id <uuid>` previews only; apply requires `--apply --reason <reason> --confirm-origin <exact-origin>`. See OPERATIONS before use. `pnpm test:access` runs isolated real-service access/CLI regression. Migration 0004 is forward-only; preserve historical migrations and user resources. Do not auto-reopen bootstrap or implement invitations/CMS/business modules in this unit.
