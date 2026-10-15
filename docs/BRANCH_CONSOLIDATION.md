# GitHub 分支整合 — 2026-10-16

依使用者要求盤點 GitHub 所有分支與 commit，將最新狀態集中至 `main`，並將 GitHub 預設分支改為 `main`。保留原分支及 commit 歷史，不 squash、不 rebase、不 force push、不刪除分支。

## 來源快照與整合方式

Repository: `fearnot221/confsys`。盤點前執行 `git fetch origin --prune`，再以 `git ls-remote --heads origin` 確認遠端恰有以下三支分支；當時無開啟中的 PR。

| GitHub 分支 | 完整 tip commit | 尚未包含於整合基底的 commit |
| --- | --- | --- |
| `codex/phase-1-3-conference-site`（原預設） | `cf7a994dffdeaafb4ebecce47167b11b0094d7c6` | 0 |
| `claude/project-ui-redesign-f4dece` | `a6c9c732655d4e5a424db87d8b05ea13126fffd3` | 0 |
| `codex/phase-1-4-to-6-continuous` | `54c648fab898bf93cc85e1f7375f91a3f71e2d67` | 0 |

`cf7a994` 已經透過 PR #1、#2 包含連續開發、CI 修復、Proceedings UI 與本機 demo。逐支 `git merge-base --is-ancestor <tip> cf7a994` 均成功，`git rev-list --count cf7a994` 為 175。因此直接以此基底建立 `main`，保留全部 GitHub 歷史，再加入本整合紀錄；不需要製造額外產品合併或解衝突。`git fsck --connectivity-only --no-dangling` 成功。

本次在獨立 `codex/consolidate-main` 工作樹作業。原工作樹未提交的 `output/`、其他代理工作樹、既有環境／容器／資料不納入變更。本機歷史代理分支與 `integration-pending/20261016` 的未完成片段不是本次 GitHub 分支盤點的新增來源，仍需另行授權、review 及測試，不能因本次整合宣稱完成。

## 驗證與已知限制

使用 Node 24.21.0、pnpm 10.34.7；執行結果見下方交付驗證。此次沒有修改產品程式、schema、migration、API、權限、環境變數或套件，也沒有操作真實郵件／付款或正式部署。

盤點時最近的 UI PR CI [38803307612](https://github.com/fearnot221/confsys/actions/runs/38803307612) 為失敗：`tests/e2e/site.spec.ts:233` 登出預期 200、收到 500；27 項 browser tests 通過、1 項失敗。先前連續開發 CI [38787300361](https://github.com/fearnot221/confsys/actions/runs/38787300361) 成功，只代表該歷史版本。不得將其當成目前合併版本的完整通過證據。

本次不啟停或重設既有實例，因此沒有在既有本機環境重跑 PostgreSQL／Redis integration、E2E、smoke 或雙實例隔離演練；目前版本的完整 gate 交由 `main` push 觸發的 GitHub CI，實際結果應以該次 Actions 為準。已知登出 500 的原因仍未確定，不在此文件中推定為偶發或產品漏洞。

## 本次交付驗證

工作樹：`/Users/fearnot/.codex/worktrees/consolidate-main/confsys`。以下 pnpm 指令均以 `PATH=/tmp/confsys-tools/node_modules/.bin:$PATH` 選定上述固定版本執行，exit code 均為 0：

| 實際執行指令 | 結果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 成功，lockfile 未變更 |
| `pnpm lint` | 成功，含 presentation／contract import boundaries |
| `pnpm typecheck` | 成功 |
| `pnpm test:unit` | 28 files、70 tests 通過 |
| `pnpm test:contract` | 8 files、17 tests 通過 |
| `pnpm build` | 成功，含 client 及 public SSR renderer |

沒有新增使用者操作流程；保留原本 UI、API 與 demo。此次本機沒有新增 instance／permission integration 通過證據，請勿把 unit／contract 結果當成隔離驗證。

## Maintainability check / 可維護性檢查

1. 僅更新 README、分支整合文件與 ROADMAP 風險紀錄；產品各模組責任與 UI／SDK／domain／repository 邊界不變。
2. 沒有新增重複規則、跨模組耦合或依賴。
3. 測試程式與品質門檻不修改、不削弱；文件如實區分本次本機結果、歷史 CI 與尚待執行的驗證。
4. 已知風險為 UI 合併後登出 E2E 的 500 與既有未完成片段；下次維護先確認完整 main CI，再依 ROADMAP 驗收修復。分支集中不代表 Phase 1–6 全數驗收或正式上線就緒。
