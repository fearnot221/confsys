# Phase 1.2 交付 — 2026-10-15

本輪只交付本研討會固定角色、權限與受控管理員初始化。使用者訊息是本輪授權；附件 PHASE1_2_RBAC_BOOTSTRAP_CODEX.md 是驗收要求，沒有把附件中的舊測試數字當成本輪證據。未實作邀請、CMS、報名、投稿、金流或後續業務。

## 基線、分支與保留環境

- 基線：`520607e28dfaa3fc3ce284a8f36c4355671d0ba8`。實際執行四次 `git merge-base --is-ancestor`，確認含 `ab7120f`、`f1126ad`、`c10b025`、`c6f1d5f`，全部 exit 0。
- 分支：`codex/phase-1-2-access-control`。
- 工作樹：`/Users/fearnot/Desktop/confsys-phase-1-2-access-control`。
- 實作／測試／契約／維運文件 commit：`cc2361d703c51a5a9ac032e98e0e8c64fca7c936`。本報告與已驗證的 root package.json CLI／test scripts 為其後的交付 commit；最終 hash 於交付訊息提供。
- 受管工作樹工具回報 Failed to validate the worktree starting ref，改用 `git worktree add -b codex/phase-1-2-access-control /Users/fearnot/Desktop/confsys-phase-1-2-access-control 520607e`。未 merge、rebase、cherry-pick、reset。
- 最後 read-only 檢查三個原工作樹均 clean，HEAD 仍為原目錄 `c10b025`、Phase 1.1 `f1126ad`、Phase 1.1b `520607e`。只修改本輪工作樹。
- 未停止／重建／migrate 原有 `confsys-phase0`、`confsys-p11b-*`、`cert-app-*` 服務或其資料。測試只使用新建資源；沒有 global prune、FLUSHALL、清空 Mailpit 或刪除既有 volume。

新 regression project：`confsys-p12-regression`。Web 45175、API 43000、worker 43001、PostgreSQL 45434、Redis 46381、Mailpit 48027／SMTP 41027。其基礎服務與本輪 A/B 合成環境保留；E2E 自己啟動的 host app processes 已由 runner 結束。整合測試只清理自己的隨機 email-prefix fixtures／臨時升級 DB，未清除其他資料。

## 可操作流程與範圍

1. 普通帳號在本實例註冊 → Mailpit 驗證信 → 明確設定密碼 → 登入。第一個註冊者沒有角色；帳號建立不代表研討會報名。
2. 在自己的帳號頁取得本地 UUID；部署者選定此實例 env，CLI 預覽名稱、origin、目標 UUID/email/state，再明確 apply。
3. Bootstrap 原 Session 失效，目標重新登入取得帳號管理入口。
4. 管理員搜尋／分頁查本地帳號，檢視目標，確認固定角色或狀態變更、理由、Session/token 效果後執行。五分鐘外需以當前密碼重新驗證，再另行確認操作。
5. 授予 staff 後目標重新登入只能查目錄；授予第二位 admin 後才可管理。可撤角色、停用／恢復、強制登出及查閱最小安全稽核。自己不能改角色／停用自己；自己強制登出可用。
6. 撤權／停用／強制登出後舊 Cookie 的下一個新授權判定拒絕。管理畫面偵測失效時清除 private queries、目標與晚到 response；已在撤權前讀出的資料無法追溯收回。

正式矩陣以 [PERMISSIONS](PERMISSIONS.md) 為唯一文件權威：普通帳號只有本人認證流程；staff 有 `accounts.directory.read`；admin 明列 directory、roles.manage、status.manage、sessions.revoke、security_audit.read 五項。未來 finance/chair/reviewer/judge/on-site/author 資源規則保留在規格／roadmap，未建立無用途的可授予角色或空 API。沒有 wildcard、自動取得未來 permission、全域會員、組織 membership、conference_id 或跨會議授權。

## Schema、API、設定與邊界

- 新向前 migration `0004_access_control.sql`：`user_roles` 多對多 composite PK／role check／FK、`access_control` 一次性 singleton marker、Session `password_verified_at`、audit actor/source/reason/before/after 欄位及查詢索引。沒有改寫 0001–0003；lockfile/pins 亦未改。
- Bootstrap marker 只能由 operator 的 migrator connection 更新；API 有 row-lock 所需的最小 singleton column grant，不能重設 marker。API／worker 不能 UPDATE/DELETE audit；worker 不能讀角色／marker／audit，沒有新權限快取或 RLS bypass。新的本地目錄以服務政策＋DB grants 控制，未宣稱已有未來稿件的 resource RLS。
- `/api/auth/me`／login 的本人 DTO 新增 roles／permissions；`POST /api/auth/reauthenticate`；`GET /api/access/accounts`、`GET /api/access/accounts/:id`、`GET /api/access/roles`、`POST /api/access/accounts/:id/actions`、`GET /api/access/audit`。詳細 input/projection/error/pagination 見 [DATA_CONTRACT](DATA_CONTRACT.md)。沒有通用 user PATCH／profile 編輯／秘密欄位回傳。
- 管理寫入取得 control row lock，再重新驗證 actor Session／帳號／當前角色及近期 proof，然後鎖 target；狀態／binding／既有 credential version／Session/token revocation／必要 audit 同交易。最後管理員檢查在變更後、commit 前。普通登入不拿 control lock。
- 重複 grant/revoke 或相同狀態回傳 changed false，不再次撤 Session／寫成功事件。每次明確強制登出都遞增 epoch，即使沒有 live Session，避免仍在密碼驗證中的登入產生有效 Session。
- Bootstrap 不在 HTTP、startup、migration 或 seed 掛載。已完成同目標重跑不再授權，另一目標明確拒絕；無 force-admin／永久復原後門。
- 無新增 dependency、環境變數或 Compose service。新增 `loadBootstrapConfig` 只驗證／選取既有 operator connection、名稱與 origin。沿用 Node 24.21.0、pnpm 10.34.7、既有 lockfile。沒有 framework／UI library 替換。
- SDK 維持唯一 browser HTTP／CSRF transport；access hook 管理 query／mutation／能力 view model；presentation 只接 props／callbacks。使用 [fixing-accessibility skill](/Users/fearnot/.codex/skills/fixing-accessibility/SKILL.md) 檢查原生標籤、鍵盤、錯誤關聯與確認流程，沒有藉此宣稱完整 WCAG。

## 真實 CLI 與初始化證據

可執行形式（替換自己的 env／UUID／origin；理由不可含秘密）：

```sh
CONFSYS_ENV_FILE=/absolute/path/instance.env pnpm admin:bootstrap --user-id <local-user-uuid>
CONFSYS_ENV_FILE=/absolute/path/instance.env pnpm admin:bootstrap --user-id <local-user-uuid> --apply --reason 'Initial conference administrator' --confirm-origin https://conference.example
```

整合／E2E／雙實例 runner 實際以 `node --conditions=development --import tsx scripts/bootstrap-admin.ts --user-id <generated-local-uuid>` 執行同一入口，apply 加上 `--apply --reason <synthetic-reason> --confirm-origin <selected-origin>`。host E2E 明確使用 TEST_MIGRATION_DATABASE_URL；雙實例使用 `--env-file=.instances/9dc62bba/a.env`。沒有命令列密碼/token 或公開 operator endpoint。

已驗證：preview 不改 role／marker／audit／Session；不存在／pending／disabled／錯誤 origin／runtime connection 拒絕；兩個 process 對不同目標恰一個成功；audit trigger 故障回滾全部資料；同目標重跑與撤權後重跑不重新授權；另一目標拒絕。另實際執行 pnpm alias 對不存在 UUID `00000000-0000-4000-8000-000000000000`，預期 exit 1、`NOT_FOUND`，不是通過初始化的證據。

## 實際執行命令與結果

以下均在本工作樹，以 `PATH=/tmp/confsys-tools/node_modules/.bin:$PATH` 使用已核對的 Node 24.21.0／pnpm 10.34.7；沒有更換全域工具。

| 命令 | 本輪結果 |
|---|---|
| `git status --short`、`git branch --show-current`、`git worktree list --porcelain`、`git log`、四個 ancestry checks | 基線／分支／原工作樹核對完成 |
| `pnpm install --frozen-lockfile` | Pass；既有 pins／lockfile 保持 |
| `COMPOSE_PROJECT_NAME=confsys-p12-regression POSTGRES_PORT=45434 REDIS_PORT=46381 WEB_PORT=45175 MAILPIT_PORT=48027 SMTP_PORT=41027 API_PORT=43000 WORKER_PORT=43001 pnpm env:setup` | Pass；本輪隨機新 credentials，未輸出秘密 |
| `pnpm infra:up`、`pnpm db:migrate`、`pnpm db:migrate:test` | Pass；新合成 project，完整 0001–0004 |
| `pnpm contract:generate` | Pass；OpenAPI exact-match contract gate 通過 |
| `pnpm exec playwright install chromium` | Pass |
| `pnpm check` | **Pass，七道 gate 按序完成**；最終 `/tmp/confsys-p12-gates-final.log` |
| `pnpm lint` | Pass，ESLint 與 presentation/contracts import boundaries |
| `pnpm typecheck` | Pass，apps/packages/scripts/tests strict TypeScript |
| `pnpm test:unit` | **15 passed / 6 files** |
| `pnpm test:integration` | **33 passed / 7 files**，真 PG／Redis／worker／Mailpit，保留 SMTP SIGKILL recovery 等前序回歸 |
| `pnpm test:contract` | **11 passed / 4 files** |
| `pnpm build` | Pass，clean TS／Vite build |
| `pnpm test:e2e` | **8 passed**，其中 2 個新 access 流程、6 個保留流程 |
| `pnpm test:access` | **10 passed / 1 file**；獨立入口再次通過，`/tmp/confsys-p12-access-final.log` |
| `pnpm test:instances` | Pass；`/tmp/confsys-p12-instances.log`，同 image A/B 與原有 assertions 全保留 |
| runner：A `pnpm compose --profile app build api`；A/B `up -d --wait postgres redis mailpit`、`--profile app run --rm migrate`、`--profile app up -d --no-build --wait api worker web` | 全部 Pass，由 compose wrapper 以各自 env 執行 |
| runner：A `smoke-stack.ts`／`smoke-auth.ts`（同 `pnpm smoke:stack`／`pnpm smoke:auth` 入口） | Pass；真容器 Web／API／獨立 worker／Mailpit、CSRF／Cookie lifecycle |
| `git diff --check` | Pass |
| `git diff --exit-code 520607e -- packages/db/migrations/0001_foundation.sql packages/db/migrations/0002_identity.sql packages/db/migrations/0003_identity_grants.sql pnpm-lock.yaml` | Pass，歷史 migrations 與 lockfile 未變 |

早期修正如實記錄：TypeScript 發現 exact-optional state 型別與 Playwright timeout 呼叫形式；lint 發現 control-character regex；初輪 access tests 把 role 多送到 disable／force-logout，被 strict schema 正確拒絕，修正測試輸入後通過。收尾加強 force logout 在零 live Session 時的 login fencing，並新增 regression 後重跑完整 check 與容器雙實例。沒有刪除／skip／削弱現有檢查。第一輪全套為 32 integration，最終增加 reset-versus-disable 案例後為 **33**，不混用舊數字。

### 交易、權限與升級證據

`integration/access.test.ts` 直接呼叫服務證明 guard 不只存在 HTTP：普通／staff 不能寫或讀 audit；self mutation 拒絕；直接移除所有 admin bindings 的交易被 `LAST_ADMIN` 回滾，沒有只靠 UI 禁用。兩 admin 並發互撤／互停只允許一方成功，等待者被新 Session/角色狀態拒絕。故障 trigger 證明 role/state/epoch/Session 與 audit 無部分提交。實際 app/worker role 的 grant denial 有斷言。

登入驗證 barrier 對 disable/grant/force-logout、reauth barrier 對 disable、reset-versus-disable 與舊 token／舊 proof 都有真 PG 測試。HTTP 測試使用真 Redis 限流、CSRF／Origin、strict fields、401/403/409／projection/no-store。E2E 不用直接 SQL 授角色，先 UI 註冊／Mailpit 驗證，再真正 CLI bootstrap。

`integration/migrations.test.ts` 在本輪新建的臨時資料庫，先套用 520607e 的 0001–0003，放入合成已驗證帳號／真 Argon2 hash／Session／reset token／outbox／測試 envelope／audit，再套用 0004。快照保留、舊 Session 仍能讀本人且角色為空、proof 為 NULL、marker 未完成，repeat migration 成功。保留 blank／Phase 0 升級原有斷言。這是合成升級驗證，不是 production backup restore 演練或 downgrade 保證。

### 同 image 雙實例證據

已提交 [phase1-2-instances.json](evidence/phase1-2-instances.json)，不含 secrets。

| 項目 | A | B |
|---|---|---|
| Project | confsys-p12-9dc62bba-a | confsys-p12-9dc62bba-b |
| Browser origin | http://a.localhost:45173 | http://b.localhost:45174 |
| Env | .instances/9dc62bba/a.env | .instances/9dc62bba/b.env |
| PG／Redis | 45432／46379 | 45433／46380 |
| Mailpit／SMTP | 48025／41025 | 48026／41026 |

六個 Web/API/worker containers 全部使用 `confsys:p12-9dc62bba`，實際同一 image ID `sha256:04f030aedd50264fbe11feaf577674c7b97328cd718ae341ffe3dfedc48a20ab`。A 建一次、B no-build。獨立 network／volumes／secrets，且 runtime env 沒有 migrator 交叉外洩。

同 Email 在 A/B 各自註冊；A-only bootstrap 不改 B role/marker；A admin Cookie 手動傳 B 拒絕；A reauth/grant/revoke/disable/restore/force-logout 不改 B user/session/audit/role/marker snapshot。錯誤 CLI origin 拒絕。原 A-only registration、密碼、Cookie/token、canonical mail、worker 停啟、網路／DB credential、只升級 A、兩個 smoke 與 B container 不變等 checks 全通過。沒有重建兩份不同前端來冒充同 image。

## Maintainability check / 可維護性檢查

1. **責任邊界：** handler 只驗證／轉接；service 擁有授權、不變條件與交易；policy 是固定規則權威；repository 擁有 SQL／投影；auth/session 與既有 credential/session/token primitives 共用；CLI operator path 與 HTTP 分離。SDK／hook／presentation import boundaries 實際通過。架構與 entry points 已更新，沒有空框架。
2. **重複規則／耦合／依賴：** 沒有新增 dependency 或第二份 role→permission mapping、password verifier、revocation epoch。新增的明確耦合是 local identity 的 auth account projection／access management 共用角色讀取與既有 user/session repository；沒有跨 instance 或 generic CRUD bypass。分頁選 bounded offset 的 tradeoff、control-row lock／operator trust／復原限制記於 ADR 0004。
3. **測試與文件同步：** AGENTS、README、SPEC、PERMISSIONS、ARCHITECTURE、DATA/UI_CONTRACT、TESTING、OPERATIONS、ROADMAP、ADR／OpenAPI 與新增測試一起更新。實際結果為 15 unit／33 integration／11 contract／8 E2E，加上 10-case access 入口、容器 build/migration/smokes/dual-instance；CI 沿用既有 required commands，沒有 no-op／mock 成功替代真服務。手機 screenshot 已檢視，僅為基本版面佐證。
4. **已知債務與實際風險：** bounded-offset／substring 搜尋在大資料量下尚未 benchmark；control-row 管理鎖的負載未量測；所有 admin 失聯的 recovery 另需受控設計。ROADMAP 記錄 acceptance／treatment phase。原 MFA、密鑰輪替、trusted proxy/IP limits、密碼安全／Argon2 capacity、資料保留、TLS、備份還原、真 provider、完整 WCAG/browser 與 shared-host 風險全部保留。

## 未實作、未配置與未驗證

- 未實作：邀請／代建帳號、任意角色編輯器、MFA/SSO/passkey、緊急 force-admin、CMS／設定編輯器、上傳／報名／付款／投稿／審查／議程／競賽等後續功能。全域帳號／organization membership／跨會議授權是取消的產品方向，不是本輪待補功能。
- 未配置：外部真實 mail/payment provider、production credentials／部署。
- 未驗證：雲端 CI（未 push）、production TLS/Secure cookie traffic、production restore／downgrade／混版部署、密鑰輪替演練、負載／DoS／滲透、完整 assistive-tech／跨瀏覽器／WCAG。單元／契約層的 transport/probe doubles 沒有被當成基礎服務證據。
- 近期密碼驗證不是 MFA；本地通過不代表 production ready。已知工具／部署安全界線與復原注意事項見 OPERATIONS／ADR 0004。

下一最小單元建議為版本化本場會議設定／公開網站，仍需另行批准。本輪完成本地提交後停止；沒有 push、merge、production deploy、真信、金流或清除既有使用者資料。
