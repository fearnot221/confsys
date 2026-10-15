# Preserved pending integration — 2026-10-16

These are recoverable unfinished source fragments, **not applied features or verified tests**. Folder consolidation does not change the previous WIP acceptance status.

- `submission-filters.patch`: uncommitted submission query/UI/contract/tests delta from codex/continuous-submissions at582b71d; compare with main before applying, then regenerate contracts and run meaningful tests.
- `registration-authority.test.ts.pending`: unfinished new test from codex/continuous-invitations at925c43b; compare against canonical0059/0060 before adding to the executable suite.
- `review-tests.patch`: agent working-copy test delta; some content may already be in main, so compare before applying.

Original worktrees, ignored configuration, generated artifacts and dependencies are preserved intact. Full branch bundle and per-worktree working/index patches are kept privately in the common Git directory under `consolidation/20261016/`. Do not copy old agent dependency/schema snapshots over the canonical main tree.
