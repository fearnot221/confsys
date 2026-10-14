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

`HealthView` exposes phase (`loading | error | ready | degraded`), dependency status, busy, `onRefresh`, locale and `onLocaleChange`. No token, pool, ORM model or fetch function enters UI props. Unknown/unavailable states must remain explicit. Data hooks decide how to load; components decide how to present. Infrastructure status and Phase 1.1 account lifecycle are usable; no fictitious conference or user records.

ESLint forbids forbidden packages and network/browser credential globals in UI. AST boundary check restricts presentation imports including relative imports/dynamic calls; new permitted UI modules require updating the allowlist in review. Contracts cannot import DB packages. These static controls help prevent accidental coupling, but do not prove all possible JavaScript behaviors safe; review is still required.

Accessibility baseline: semantic main/header/section, one h1, labeled language button, 44px controls, visible focus, text status in addition to color, polite live status, mobile wrapping. Playwright verifies language/document lang, status, manual retry and no horizontal overflow at 390px. Full WCAG 2.2 AA, assistive technology and all-browser testing are unverified.

Future private hooks must use subject/resource/permission-version keys as applicable; logout/revocation must clear sensitive state and form selections. Instances do not share a browser origin or server cache. This health screen has only a global, public infrastructure key. Future states include empty, permission denied, expired session, closed deadline and unsaved changes; not fabricated in Phase 0.

## Maintaining the boundary during feature work

Mutations, server-state transitions, invalidation and error translation belong in feature hooks/data modules using the SDK. Components may manage local presentation state but must not duplicate business rules or decide backend access from hidden controls. DTOs remain explicit projections defined by the core owner; an ORM row or asserted cast is not an API contract.

When a boundary genuinely needs to change, update the contract/view model, its tests and import rules together with core review. Do not relax lint merely to make a presentation import pass. Existing checks are an allowlist, not a complete dependency-graph proof; expansion work and its regression cases are tracked in [ROADMAP.md](ROADMAP.md#phase-0-maintainability-review--2026-10-15). Presentation-only improvements should not trigger unrelated renaming, file moves or format rewrites.

## Phase 1.1 account presentation

Auth routes use the existing primitives and CSS. `AuthScreen` receives the runtime conference name, mode, busy/loading, safe message/error, optional account email, submit callback and retry callback. Email/password inputs are local form state; no CSRF/session/verification token, DB object, SDK instance or permission policy enters presentation props. The hook reads the verification fragment and passes it directly through SDK on explicit submission.

SDK bootstraps CSRF for every mutation, sends same-origin cookies and validates contract schemas. Auth hook owns cancellation, query removal, mutation outcomes and error translation. Login/logout perform a full navigation to discard the previous query client. Session-expired refetch also clears private data, including stale successful query results. All GET/POST auth responses are no-store. No localStorage/sessionStorage credential or identity persistence.

Forms cover pending submit, accepted-but-not-delivered mail, explicit verification/reset success, invalid/expired links, session expiry, rate limit, temporary failure and retry. Inputs have native labels/autocomplete, associated error/help text and live announcements. Browser E2E tests use real passwords, CSRF, sessions, worker and Mailpit; no fake account fixture renders. Full WCAG/browser-matrix certification remains unverified.

The AST check now resolves relative/aliased imports and re-exports, traverses each presentation source and the contracts sources, accepts UI-to-UI dependencies, and tolerates feature folders without components. Auth is included automatically. Regression fixtures prove forbidden indirect source paths; this does not claim a complete JavaScript security proof.

`useInstance` loads the minimal `/api/instance` DTO through SDK. Auth forms wait for configuration and provide an explicit error/retry state; no fabricated account or default tenant is rendered. Document title, shell and account copy refer to this conference. Names never enter Vite build settings.

## Phase 1.2 account administration

`/access/accounts` renders the same conference shell and current email, bounded search/state filter/pagination, selected-account details, management confirmation and read-only paged security audit. Auth account displays its local UUID so an operator can select it for CLI preview. Ordinary users have no directory link and direct directory API calls deny; staff have directory/detail with no management/audit controls; admin capabilities come from the backend DTO, never a duplicated role matrix.

The access hook owns server-state, error translation, capabilities, selected-account clearing, retry, cancellation and mutation orchestration. `AccessScreen` receives plain view models and callbacks, never credentials/network/policies. It uses native labeled inputs/selects/checkbox/button, visible existing focus tokens and live result/error messages. Inline confirmation (no modal focus trap needed) includes target, action, role/status, reason, retained roles on restore and session/token effects. Reauthentication is a separate password form and does not auto-run a previously selected mutation.

Loading/empty/error/retry/denied/expired and conflict/reauth-required outcomes are explicit. Session expiry clears every private query and target, aborts requests and ignores late responses; an E2E holds a real directory response, logs out, detects expiry, then releases the old response. Another E2E exercises real CLI bootstrap and admin/staff/ordinary flows, captures desktop/mobile and checks no 390px overflow. This is baseline usability/accessibility, not full WCAG or cross-browser certification. No fictional business dashboard data.

## Phase 1.3 routes and workflows

Fixed public routes: `/` (default-language home), `/{zh-Hant|en}/{home|about|participation|contact}`, `/sitemap.xml`, `/public-site.css`. Disabled/unknown locales and unknown pages are 404; unknown paths never become a fake-200 SPA. Public initial HTML contains real content/navigation/date/title/description/canonical/lang/alternate. Before first publication show preparation and account entry points; never draft. Existing diagnostics move to `/system/status`; auth routes and `/access/accounts` remain SPA, plus `/admin/site`. Account creation is not registration for conference attendance.

Admin sections: basic information, fixed page content, preview/publication, publication history. A saved draft version and active publication are always visible. Unsaved edits clear prior preview/confirmation and show save-first state; navigation with unsaved changes warns. Conflicts retain local input; explicit refresh fetches server version for manual comparison, explicit discard reloads. Preview only loads the requested saved version with private API authorization/noindex/no-store and labels it unpublished. Its navigation switches the same pure content component's locale/page, not a second renderer.

Publishing requires complete fields, explicit whole-site/version confirmation and valid server proof; reauthentication does not auto-publish. Success follows server commit and public DTO refetch, then query invalidation. Loading history confirms replacement of saved draft, refuses unsaved edits, creates a new version and leaves official site unchanged. Failure, denied, expired/revoked, loading, empty and retry states are visible. Revocation clears private queries/form/history/preview and ignores late results. `beforeunload` warns on unsaved form navigation; no browser storage.

Presentation imports only contract types, React/UI and other presentation components. It does not fetch, read secrets or duplicate business permissions. Semantic fields/labels/live errors/focus and 390px behavior are baseline usability, not a complete WCAG claim. No uploaded images, arbitrary theme CSS, fake CTA, sponsor/speaker/count placeholders or new UI framework.

## Role invitation surfaces

`features/invitations/hooks` owns account state, invitation mutations, abort/epoch guards, retry idempotency and private-cache clearing. `components/invitations-screen.tsx` and `invitation-acceptance-screen.tsx` only render props and call callbacks. The SDK owns all fetch/CSRF operations. `/admin/invitations` is for role managers; `/auth/invitation#token=…` requires the recipient to log in first and explicitly confirm their password. The fragment is removed immediately and is never persisted in browser storage. After accepting, all previous sessions are revoked and the UI directs the recipient to log in again. Missing/expired/wrong-account invitations show errors rather than granting fallback access.

## Review workbench

`/reviews` is shared by authors, reviewers and scoped chairs; the feature data hook receives authoritative permissions and only enables appropriate server queries. Pure `ReviewsScreen` subcomponents render form configuration, assignment selection, rubric draft/final review, conflict declaration, chair draft/publication and published author results. The SDK owns CSRF, JSON validation and private file fetches. Server errors preserve truthful state; expired sessions clear private queries and abort in-flight mutations. All board candidate/result collections use bounded pages with `nextOffset`; historical form versions remain pinned to assignments.

### Notification and reporting workspace

Mount `ReportingScreen` with `useReporting()` at `/notifications`. Presentation owns
only local form controls; SDK owns network calls, hook owns permission-derived view
flags, abort/lifecycle and server state. The notification list separates read state
from SMTP acceptance and labels uncertain delivery truthfully. Admin exports offer
individual bounded CSV pages. Controlled preview has an explicit read-only banner,
a required reason, no impersonated principal and a close action. All form controls
have native labels; asynchronous failures/status use alert/status announcements.
