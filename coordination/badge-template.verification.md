# Badge template delivery checkpoint

- API domain `apps/api/src/badge-template`: scoped repository, role-checked transactional service, input/CSRF handlers. `GET /api/badge-template` and stored-only `GET /api/badge-template/preview` require onsite.read; save requires admin-only documents.template.manage. Preview uses fixed synthetic Chinese name and noncredential QR, private/no-store/noindex headers.
- Save checks optimistic version, validates actual printable preview before inserting immutable template version and audit in one transaction. Unsupported or oversized footer fails truthfully without changing current template.
- Renderer supports fixed 86×54mm and100×140mm, left/centered layout, affiliation/number visibility and bounded plain footer. No external fonts/URLs/HTML. Legacy snapshots with absent template still use original100×150mm rendering exactly.
- New document jobs embed selected version plus entire template; retries preserve it. Worker uses snapshot, retaining all existing authorization/token checks.
- SDK owns requests; data hook owns account/server/mutation state; pure props/callback editor `BadgeTemplateScreen` belongs at `/admin/badge-template`. Main wires route and central permission navigation.

Executed:

1. `pnpm exec tsc --noEmit -p tsconfig.json`: pass.
2. Targeted eslint across API, renderer/worker, SDK, hook/UI and tests: pass.
3. `pnpm exec vitest run tests/unit/badge-template.test.ts tests/unit/documents.test.ts`:4/4 pass. First attempt failed because root lacks pdf-lib; package-local test now resolves its existing dependency without a new package.
4. Real PDFs generated with renderer and built-in licensed CJK font: `output/pdf/template-credit_card.pdf`, `output/pdf/template-large.pdf`.
5. `pdftoppm -scale-to 1000 -png -singlefile` rendered both; PNGs visually inspected: Chinese readable, no overlaps/clipping, QR separated from text.
6. Native macOS Vision decoded exactly one `CONFSYS_TEMPLATE_PREVIEW_NOT_A_PASS` in each raster. No real pass in preview.

Executed shared PostgreSQL gate at07:25:07: `node --env-file=/Users/fearnot/Desktop/confsys-phase-1-4-to-6-continuous/.env node_modules/vitest/vitest.mjs run tests/integration/badge-template.test.ts tests/integration/onsite.test.ts`: **7/7 passed**. Covers admin/staff/owner authorization, RLS, immutable version grant denial, stale edit conflict, invalid-render rollback and job snapshot/idempotency pin. `tests/e2e/badge-template.spec.ts` editor/save/reload/real preview download awaits main wiring and browser gate. Browser gate is not claimed passed.

Maintainability: no new dependency or permission registry fork; shared renderer stays API/worker implementation. Template repository only loads scoped persisted config, no HTTP. Central migration0033 and contracts/policy supplied by main. Own central snapshot e7d6539 must not be cherry-picked back. Package-local tests should be excluded by primary tsconfig.build (`**/*.test.ts`) to keep test runner out of deployed artifacts.
