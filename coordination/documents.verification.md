# Receipt/document slice evidence

Entry points: `apps/api/src/documents/{service,repository,routes,pdf}.ts`; browser
`features/documents/{hooks/use-receipts,components/receipts-screen}`; SDK
`packages/sdk/src/documents.ts`. Main wiring: createReceiptsService(pool,config),
registerReceiptRoutes(app,config,service); routes `/receipts` (useReceipts()) and
`/admin/receipts` (useReceipts(true)). API contracts centrally installed as documents.ts,
migration0014. Docker runtime requires `COPY apps/api/assets`.

Real PostgreSQL test `node --env-file=<main .env> node_modules/vitest/vitest.mjs run
 tests/integration/documents.test.ts` passed 3/3 at 2026-10-15 06:30 Asia/Taipei, pinned
Node/pnpm PATH. It checks ordinary+unpaid denial, explicit finance role, concurrent
idempotent issue, one notification event, actual app RLS+worker denial, correction
history+same number/amount, old PDF, stale version denial, immutable grant, audit rollback,
void idempotency/no invented refund, and revoked session downloads. Setup failures
before that run (finance role not granted, then self-grant forbidden) were fixed by using
an explicitly granted separate finance account, preserving production access policies.

`pnpm typecheck` passed; targeted ESLint passed. Unit files+documents and file contracts
8/8 passed after PDF semantic-validator fix. PDF money displays test zero/two/three-decimal
currencies and exact maximum minor-unit string. Parser verifies real generated documents;
unsupported glyph/overlong badge fields fail explicitly instead of silently dropping text.

Actual app renderer outputs in own worktree `output/pdf/synthetic-receipt.pdf` and
`synthetic-badges.pdf`; Poppler `pdftoppm` rendered 3 pages to `tmp/pdfs` and all were
visually inspected at06:28: no missing characters, clipping or overlap. Text extraction
confirmed Traditional Chinese. Early variable/subset/OTF font experiments failed visual
QA and were replaced; do not treat those initial files as delivered results. Static
TrueType full font embedding is intentional (~4.2MiB per document/batch). OFL license,
upstream hash and optional reproducible font preparation script included.

Maintainability: service owns current auth, RLS context, finance serialization and
snapshot lifecycle; repository owns explicit projection/persistence; PDF renderer only
accepts immutable DTOs, and font source is pinned. SDK handles network; hook projects
currency labels and handles expired permissions; pure presentation uses callbacks.
No second finance authorization registry or payment computation engine. Net verified
balance uses actual allocations/refunds under existing finance serialization; correction
can only alter buyer fields, not amounts. Receipt void never records a refund. Generic
business notices use existing transactional outbox/worker. External legal invoice policy
is explicitly not asserted. Batch badge renderer exists; onsite QR and batch workflows
remain separate work in progress until wired/verified.
