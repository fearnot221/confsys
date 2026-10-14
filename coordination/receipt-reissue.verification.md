# Receipt reissue

SPEC6.4 gap fixed: void receipts can now be explicitly reissued using a new number, preserving source/successor links, immutable reason and original financial snapshot. Existing issue/reprint/correction semantics remain. New POST `/api/receipts/reissue` requires finance.receipt and current full verified settlement on an open order. Registration-state lock serializes with refunds/cancellation; one predecessor/one child plus partial unique issued-order index prevent concurrency duplication. Identical retries return the same child; changed buyer/reason retries conflict. Source must be void; reissue does not void/refund implicitly.

Owner-authorized GET `/api/receipts/detail?id=...` enables actual clickable history navigation, with backend RLS. UI selected receipt derives from latest server list to avoid stale post-void actions. Issued PDF prints original void receipt number. Old PDFs remain visibly VOID. Reissue notification/outbox, audit, number/snapshot/link commit atomically.

Executed at07:28:15:
`node --env-file=/Users/fearnot/Desktop/confsys-phase-1-4-to-6-continuous/.env node_modules/vitest/vitest.mjs run tests/integration/documents.test.ts`: **4/4 passed**. New checks: concurrent identical request one new number/link/notification, owner denied administration, cross-owner detail denied, mismatched retry/source issued rejected, direct lineage mutation rejected, refund reducing current settlement blocks reissue, historical revisions and PDFs remain accessible. Existing correction rollback/revoked download tests preserved.

Typecheck passed. Existing registration-finance browser E2E extended after real full-payment issue/PDF: void→new-number reissue→owner source/successor link navigation, before existing activity/refund coverage. Browser extension awaits primary build/run; not claimed passed.

Central0037 supplied by main; local516b772 only consumes central migrations/browser baseline and must not be cherry-picked. Forward0039 terminal-state guard proposed separately; do not rewrite applied0037.

Maintainability: same finance permission, lock, balance helper, snapshot schema, outbox and PDF renderer. SDK owns network; hooks own current linked receipt, presentation receives callbacks. No new dependency. DTO additive fields defaultnull for older fixture compatibility, and old PDF snapshots retain compatibility via optional source number.
