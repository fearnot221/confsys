# Two-instance full-stack validation update

Source-only gate completed before authorization to launch new stacks:

- `pnpm exec tsc --noEmit -p tsconfig.json`: passed.
- `pnpm exec eslint scripts/test-instances.ts`: passed.
- `node --conditions=development --import tsx scripts/test-instances.ts --prepare-only --native-scanner --image confsys:validation-pending`: passed; generated `.instances/717f3f49/plan.json` plus two private env files, no Docker mutation or app launch.

The script reserves 10 free loopback ports until each new stack starts. Unique `confsys-p6-<run>-a/b` project labels are checked for preexisting containers, networks and volumes, and rejected if any exist. Every instance still gets independent databases, Redis, worker, private storage, Mailpit and generated credentials including QR signing keys. Native scanner is an explicit opt-in stateless host service, checked using clean/EICAR/scan-limit probes before startup. `--image` uses a previously built immutable image rather than rebuilding a possibly moving source tree.

All existing Phase 1 checks remain. Additional real flows upload/scan private manuscripts, configure submissions, create/submit immutable revisions, assert revision file references, authorized downloads, denied public/cross-instance downloads, foreign-session rejection and absent foreign resources/references in the other database.

After primary integration gates approve the current image, run from the primary checkout:

```
pnpm exec tsx --conditions=development scripts/test-instances.ts --native-scanner --scanner-port 53310 --image <approved-versioned-image>
```

Use the repository's usual Node `--conditions=development --import tsx` invocation if the installed tsx CLI does not forward the condition. Full container execution and new assertions remain **unverified** until that run. Synthetic resources are retained for inspection; no automatic global cleanup. Failure checkpoints retain only test assertion messages, run metadata and completed checks; environment files remain private.

Own central setup snapshot commit `34583d0` is NOT a feature commit and must not be cherry-picked back; it only consumes the primary checkout's QR setup addition for prepare-only verification.
