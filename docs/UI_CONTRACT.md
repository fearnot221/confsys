# UI / data ownership

Codex owns architecture, API, DB, contracts, policies, SDK, hooks, tests, CI and infrastructure. Later Claude Code work owns presentation components, tokens, CSS, layout and accessibility improvements. Every agent uses a separate branch/worktree. Contract changes need core-owner review; no automatic merge.

Current vertical slice:

- `packages/contracts`: explicit health DTO/error schemas, not DB rows.
- `packages/sdk`: only place browser HTTP transport occurs, runtime validates responses.
- `apps/web/src/features/health/hooks/use-health.ts`: query key, refresh/cancellation policy, view model mapping.
- `apps/web/src/features/health/components/health-screen.tsx`: pure props/callbacks; no SDK, DB, network, storage, session or business permission logic.
- `packages/ui`: Button, labeled Input, Status and Layout primitives.
- `apps/web/src/app`: root providers, locale/document metadata and error boundary.
- `apps/web/src/design`: current minimal tokens/CSS, deliberately unrelated to legacy screenshots.

`HealthView` exposes phase (`loading | error | ready | degraded`), dependency status, busy, `onRefresh`, locale and `onLocaleChange`. No token, pool, ORM model or fetch function enters UI props. Unknown/unavailable states must remain explicit. Data hooks decide how to load; components decide how to present. Only infrastructure status is usable today; no fictitious conference or user records.

ESLint forbids forbidden packages and network/browser credential globals in UI. AST boundary check restricts presentation imports including relative imports/dynamic calls; new permitted UI modules require updating the allowlist in review. Contracts cannot import DB packages. These static controls help prevent accidental coupling, but do not prove all possible JavaScript behaviors safe; review is still required.

Accessibility baseline: semantic main/header/section, one h1, labeled language button, 44px controls, visible focus, text status in addition to color, polite live status, mobile wrapping. Playwright verifies language/document lang, status, manual retry and no horizontal overflow at 390px. Full WCAG 2.2 AA, assistive technology and all-browser testing are unverified.

Phase 1 hooks must use keys including organization/conference/subject/permission version as applicable; switch/logout must clear sensitive query state and form selections. This health screen has only a global, public infrastructure key. Future states include empty, permission denied, expired session, closed deadline and unsaved changes; not fabricated in Phase 0.
