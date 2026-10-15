# 可重複部署的研討會管理系統

工作樹入口與歷史資料夾整理見 [WORKSPACE_CONSOLIDATION](docs/WORKSPACE_CONSOLIDATION.md)。本目錄是主要整合工作樹；未完成程式片段集中保存在 `integration-pending/20261016`，尚未套用或驗證。

**一份程式碼，每場研討會獨立部署，每個實例只服務一場。** 帳號、Session、token、資料、佇列與郵件各自獨立；不是全域帳號跨研討會平台。主辦單位是介紹／聯絡資料，不是 tenant。產品決策見 [SPEC](docs/SPEC.md)／[ADR 0003](docs/adr/0003-single-conference.md)。

目前開發分支已接上私有檔案／邀請、報名與人工核帳、投稿、審查、議程／競賽及現場／行政作業。這些功能使用真實 PostgreSQL、Redis、worker 與 Mailpit；各項驗證與尚未完成範圍見 [連續開發紀錄](docs/CONTINUOUS_RUN.md)。2026-10-15 本輪明確授權連續推進至 Phase 6，截止台北時間 10:00；不代表已全數驗收或可正式上線。

## 本地啟動

使用 Docker Compose v2、Node **24.21.0** 與 pnpm **10.34.7**。先選未使用的 ports；不得停止其他專案服務。

```sh
pnpm install --frozen-lockfile
# 可指定 CONFSYS_ENV_FILE=/absolute/path/conference.env，預設本工作樹 .env
# 初次建立可另指定 COMPOSE_PROJECT_NAME、CONFERENCE_NAME、PUBLIC_APP_ORIGIN 與各 *_PORT
pnpm env:setup
pnpm infra:up
pnpm db:migrate
pnpm dev
```

`env:setup` 產生 mode-0600 隨機密碼與密鑰，重跑保留已有值，僅補缺少的設定。不要用 pnpm 內建的 `pnpm setup`。設定檔不可提交；自訂路徑亦須自行排除於 Git/build context。`.instances/` 已同時排除。API／worker 僅收到各自經驗證的設定。

預設 Web 25173、API 23000、worker 23001、PostgreSQL 25432、Redis 26379、Mailpit UI 28025／SMTP 21025，全部本地。可用 `WEB_PORT`、`API_PORT`、`WORKER_PORT`、`POSTGRES_PORT`、`REDIS_PORT`、`MAILPIT_PORT`、`SMTP_PORT` 避免衝突；canonical `PUBLIC_APP_ORIGIN` 必須對應 Web URL。不同實例必須使用不同 hostname，僅換 port 不隔離 Cookie。範例雙實例由 `pnpm test:instances` 建立。

開啟 `/auth/register` → 使用合成 `@example.invalid` 信箱 → 在該實例 Mailpit 找驗證信 → 明確送出新密碼 → `/auth/login` → `/auth/account`。支援重寄、重設與登出。`/` 是官網（未發布時準備中），診斷頁移至 `/system/status`。頁面標題、登入頁及新郵件品牌由正式發布內容決定；從未發布時才使用 runtime `CONFERENCE_NAME`。一般新帳號沒有管理角色，也不代表已完成研討會報名。管理員由部署者明確執行一次性 CLI 初始化，見下方及 [OPERATIONS](docs/OPERATIONS.md#phase-12-controlled-administrator-bootstrap-and-handoff)。

## 全容器啟動與選擇實例

```sh
# 設定 env 的 APP_IMAGE 為本次明確版本 tag／digest；勿默默升級其他實例
pnpm compose --profile app build api
pnpm infra:up
pnpm compose --profile app run --rm migrate
pnpm compose --profile app up -d --no-build --wait api worker web
pnpm smoke:stack
pnpm smoke:auth
# 只停止已選定實例；保留資料
pnpm compose --profile app stop web api worker
pnpm infra:down
```

`CONFSYS_ENV_FILE=... pnpm compose ...` 明確載入該檔的 project name；沒有隱藏的 `confsys-phase0` 預設。所有 pnpm migration／smoke／dev／測試命令亦支援此選擇。不同 project 的 volumes/networks 不共享；只讀 bootstrap SQL 共用原始碼。Web/API/worker 使用同一 image，不需為名稱或網域重建。資料庫與 runtime 憑證分離，migration 不在 API 啟動時執行。

`down` 保留 volumes；不要對使用者資料執行 `down -v`，不要刪除設定後沿用失去密碼的 volume。檔案需要實際 ClamAV 掃描；無法連線時保持隔離，不能下載或引用。標準容器 scanner 請以 `pnpm compose up -d clamav` 啟動；Docker Desktop 記憶體不足時可用已驗證的 [本地 scanner 流程](docs/LOCAL_SCANNER.md)，不改動其他服務。此 Compose 是 HTTP／Mailpit 開發模板，production TLS、備份還原、外部 provider 等限制見 [OPERATIONS](docs/OPERATIONS.md)。

## 操作入口

登入後從 `/dashboard` 開啟個人工作台；入口依伺服器回傳權限顯示，每個 API 仍重新驗權。

| 流程 | 入口 |
|---|---|
| 官網、帳號 | `/`、`/auth/account`、`/auth/email-change`；管理 `/admin/site`、`/access/accounts`、`/admin/invitations` |
| 報名、表單、候補、異動 | `/registration`、`/admin/registration` |
| 人工付款、團體分配、退款紀錄 | `/finance`、`/admin/finance`（財務角色） |
| 餐飲與活動 | `/activities`、`/admin/activities` |
| 投稿與版本、私有附件 | `/submissions`、`/admin/submissions`、`/account/files`、`/presenter-changes`、`/admin/presenter-changes` |
| 初檢、審查、決議與已發布結果 | `/reviews`（依角色／分組／指派顯示） |
| 議程與競賽 | `/program`、`/admin/program`、`/competitions`、`/admin/competitions`、`/judging`、`/competition-awards` |
| 報到、核銷、名牌 | 報名紀錄內的 QR 入口、`/admin/onsite`、`/admin/documents`、`/admin/badge-template` |
| 收據 | `/receipts`、`/admin/receipts` |
| 通知、統計、受控作者預覽、完整匯出 | `/notifications`、`/admin/notifications`、`/admin/exports` |

建立帳號、上傳憑證、報名、人工核帳、正式投稿、結果發布各有獨立狀態。金額以最小貨幣單位字串傳輸；無信用卡實際扣款。郵件只送本地 Mailpit；SMTP accepted 不等於實際到達收件匣。批次 PDF／CSV 為真實佇列工作，失敗／到期／撤權會阻止下載。

## 驗證與協作

```sh
pnpm exec playwright install chromium
pnpm check
pnpm test:instances
```

`check` 依序執行 lint、typecheck、unit、真實 PostgreSQL／Redis／Mailpit integration、contract、clean build、Playwright E2E。E2E 不重用已佔用服務，host E2E 與選定容器 Web 不能同時使用相同 port。雙實例演練會預留空閒 loopback ports 並產生唯一 project／hostname／volume；可使用 `pnpm test:instances --native-scanner --scanner-port 53310` 搭配已啟動的本地掃描器。精確步驟、測試替換對照與安全清理見 [TESTING](docs/TESTING.md)；本輪證據見 [CONTINUOUS_RUN](docs/CONTINUOUS_RUN.md)。

API/DB/policy/contracts/SDK/hooks/CI 由 Codex 負責；後期 Claude 改善純呈現元件、layout、tokens 與 accessibility。`presentation → hooks → SDK → contracts/API`，元件不讀 token、不 fetch、不定義業務授權。[ARCHITECTURE](docs/ARCHITECTURE.md)、[PERMISSIONS](docs/PERMISSIONS.md)、[UI_CONTRACT](docs/UI_CONTRACT.md)、[DATA_CONTRACT](docs/DATA_CONTRACT.md) 提供入口與責任邊界。

只使用合成資料與 Mailpit；沒有 production seeds／真信／金流。本輪依 AGENTS.md 的期限例外連續推進至 Phase6；不 push、merge 或操作 production。

## 本研討會管理員初始化與管理

先在此實例自行完成註冊及驗證，在自己的帳號頁取得本地 UUID。部署者選定此實例 env，預覽目標再明確 apply：

```sh
CONFSYS_ENV_FILE=/absolute/path/instance.env pnpm admin:bootstrap --user-id <local-user-uuid>
CONFSYS_ENV_FILE=/absolute/path/instance.env pnpm admin:bootstrap --user-id <local-user-uuid> --apply --reason 'Initial conference administrator' --confirm-origin https://conference.example
```

使用實際 env 路徑、UUID 與該實例 origin。成功後重新登入 → 帳號管理 → 搜尋已驗證的本地帳號 → 確認角色／狀態、理由與 Session 失效效果 → 執行。只有 conference_admin 可寫與讀稽核；conference_staff 只能查目錄。高風險操作要求五分鐘內密碼驗證；不可改自己的角色／停用自己，不能失去最後管理員。bootstrap 永不自動重開。完整矩陣見 PERMISSIONS，鎖與升級限制見 ADR 0004，維運步驟見 OPERATIONS。

`pnpm test:access` 是可重跑的真 PostgreSQL／Redis／CLI 存取控制驗證入口，限定此輪合成 `confsys_test`。`pnpm check` 包含它所用的整合案例與完整 UI E2E。Phase 1.2 使用 migration 0004；目前啟動必須先套用本版本全部 migrations，readiness 會檢查目前必要版本。後續依賴與環境變數見 ADR0006、`.env.example` 及 DATA_CONTRACT。MFA 尚未實作，本地測試不代表高權限 production ready。

## 會議設定與基本官網

管理員登入 →「會議設定與官網」(`/admin/site`) → 填基本資訊與四頁 metadata／內容 → 儲存草稿 → 預覽與發布 → 明確確認。一般訪客在 `/` 或 `/zh-Hant/home` 閱讀真實初始 HTML，英文啟用後可用 `/en/home`。修改草稿不影響官網；歷史版本可載入為新草稿，再另行發布。版本衝突會保留未儲存內容以供人工比對。

`pnpm test:site` 是真 PostgreSQL 官網／SSR／撤權／交易驗證入口；`pnpm check` 包含完整回歸。`pnpm dev` 先建公開 renderer，修改共用呈現後可用 `pnpm --filter @confsys/web build:public` 更新；production build 自動包含兩種 artifact。部署設定與 DB 內容權威、舊郵件品牌相容政策見 [OPERATIONS](docs/OPERATIONS.md#phase-13-settings-authority-and-upgrade)。需向前 migration 0005；沒有新依賴／環境變數。
