# Repository Agent Instructions

## Product and scope

Build a reusable academic conference management platform, not a single-event website. Read `docs/SPEC.md` before implementation. The supplied legacy screenshots are functional references only; never reproduce their visual design.

One organization can operate multiple conferences. Different organizations share the application but must not share private data. Conference-level boundaries also apply within one organization.

The owner requested PostgreSQL, Redis, Node.js and Vite. Proposed additions are React, TypeScript, Fastify, Drizzle ORM / node-postgres, BullMQ, Tailwind CSS / shadcn/ui, React Router, TanStack Query, React Hook Form / Zod, REST / OpenAPI, Vitest and Playwright. Use compatible, supported, stable versions; verify and pin them. Do not silently replace an existing repository's stack.

## Before changing code

Inspect README, existing agent instructions, package manifests, Git status, branch, migrations and CI. Preserve unrelated and uncommitted work. Do not reinitialize a non-empty repository.

Implement only the authorized phase. Make a short plan, then perform real implementation. Record assumptions and blockers. Do not ask about matters already specified in SPEC. Do not proceed to the next phase without approval.

## Architecture and ownership

Use a modular monolith API plus an independently running worker, not premature microservices. PostgreSQL is authoritative. Redis handles queues, reconstructible caching and rate limits.

Codex owns architecture, domain logic, API, database, policies, SDK, data hooks, tests, CI and infrastructure. Later Claude Code work owns presentation components, tokens, styling, layout and accessibility improvements.

Presentation components receive props / view models and callbacks. They must not perform network requests, access tokens, import DB code, or redefine business permissions. Shared API contracts must not expose DB rows directly. Protect these boundaries through lint/import rules where feasible.

Every agent uses a separate branch/worktree. Do not modify another agent's worktree or overwrite its changes. Contract changes require coordinated review; presentation-only work cannot silently modify schemas or endpoints.

## Security and business invariants

- Scope business resources by organization and conference. Resolve trusted context from authentication, memberships and resource ownership, not arbitrary request fields.
- Enforce authorization on every relevant backend action and file access. Public endpoints return explicit published projections only.
- Test cross-organization AND same-organization/cross-conference access. Missing context is deny-by-default.
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

Report: branch/commit; implemented scope; usable flow; schema/API/env changes; exact executed commands and results; tenant/permission test evidence; limitations and unverified areas; next minimal step.

Distinguish implemented, mocked, unconfigured and unverified. No invented benchmark, external-provider verification, test result, PR URL or production-readiness claim.

## Phase 0 executable commands

Use Node 24.21.0 and pnpm 10.34.7. Setup: `pnpm install --frozen-lockfile`, `pnpm env:setup`, `pnpm infra:up`, `pnpm db:migrate`; run `pnpm dev`. Do not use `pnpm setup` (pnpm internal command).

Required gates: `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm test:integration`, `pnpm test:contract`, `pnpm build`, `pnpm test:e2e`; `pnpm check` runs them in order. Install Chromium first with `pnpm exec playwright install chromium`. Container smoke: `pnpm smoke:stack` after starting the app profile. See README and docs/TESTING.md for exact prerequisites and limitations.

Do not claim the RLS fixture is a real authenticated tenant resolver. Phase 1 is not authorized by the existence of Phase 0 files.
