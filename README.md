# 可重複部署的研討會管理系統

**一份程式碼，每場研討會獨立部署，每個實例只服務一場。** 帳號、Session、token、資料、佇列與郵件各自獨立；不是全域帳號跨研討會平台。主辦單位是介紹／聯絡資料，不是 tenant。產品決策見 [SPEC](docs/SPEC.md)／[ADR 0003](docs/adr/0003-single-conference.md)。

目前有 Phase 0 工程底座、Phase 1.1 帳號生命週期、Phase 1.1b 單研討會校正，以及 Phase 1.2 固定角色、權限與受控管理員初始化。CMS、邀請、報名、付款、投稿尚未實作；後續單元需要另行授權。

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

開啟 `/auth/register` → 使用合成 `@example.invalid` 信箱 → 在該實例 Mailpit 找驗證信 → 明確送出新密碼 → `/auth/login` → `/auth/account`。支援重寄、重設與登出。頁面標題、登入頁、帳號頁與郵件由 runtime `CONFERENCE_NAME` 呈現；`/` 保留服務診斷頁。一般新帳號沒有管理角色，也不代表已完成研討會報名。管理員由部署者明確執行一次性 CLI 初始化，見下方及 [OPERATIONS](docs/OPERATIONS.md#phase-12-controlled-administrator-bootstrap-and-handoff)。

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

`down` 保留 volumes；不要對使用者資料執行 `down -v`，不要刪除設定後沿用失去密碼的 volume。尚無檔案 adapter 或私有下載；不宣稱檔案功能已驗證。此 Compose 是 HTTP／Mailpit 開發模板，production TLS、備份還原、外部 provider 等限制見 [OPERATIONS](docs/OPERATIONS.md)。

## 驗證與協作

```sh
pnpm exec playwright install chromium
pnpm check
pnpm test:instances
```

`check` 依序執行 lint、typecheck、unit、真實 PostgreSQL／Redis／Mailpit integration、contract、clean build、Playwright E2E。E2E 不重用已佔用服務，host E2E 與選定容器 Web 不能同時使用相同 port。雙實例入口使用 45173–45174、45432–45433、46379–46380、48025–48026、41025–41026，需先確認空閒。精確步驟、測試替換對照與安全清理見 [TESTING](docs/TESTING.md)；本輪證據見 [PHASE1_2_DELIVERY](docs/PHASE1_2_DELIVERY.md)。

API/DB/policy/contracts/SDK/hooks/CI 由 Codex 負責；後期 Claude 改善純呈現元件、layout、tokens 與 accessibility。`presentation → hooks → SDK → contracts/API`，元件不讀 token、不 fetch、不定義業務授權。[ARCHITECTURE](docs/ARCHITECTURE.md)、[PERMISSIONS](docs/PERMISSIONS.md)、[UI_CONTRACT](docs/UI_CONTRACT.md)、[DATA_CONTRACT](docs/DATA_CONTRACT.md) 提供入口與責任邊界。

只使用合成資料與 Mailpit；沒有 production seeds／真信／金流。完成本輪本地提交後停止，不 push、merge 或開始下一階段。

## 本研討會管理員初始化與管理

先在此實例自行完成註冊及驗證，在自己的帳號頁取得本地 UUID。部署者選定此實例 env，預覽目標再明確 apply：

```sh
CONFSYS_ENV_FILE=/absolute/path/instance.env pnpm admin:bootstrap --user-id <local-user-uuid>
CONFSYS_ENV_FILE=/absolute/path/instance.env pnpm admin:bootstrap --user-id <local-user-uuid> --apply --reason 'Initial conference administrator' --confirm-origin https://conference.example
```

使用實際 env 路徑、UUID 與該實例 origin。成功後重新登入 → 帳號管理 → 搜尋已驗證的本地帳號 → 確認角色／狀態、理由與 Session 失效效果 → 執行。只有 conference_admin 可寫與讀稽核；conference_staff 只能查目錄。高風險操作要求五分鐘內密碼驗證；不可改自己的角色／停用自己，不能失去最後管理員。bootstrap 永不自動重開。完整矩陣見 PERMISSIONS，鎖與升級限制見 ADR 0004，維運步驟見 OPERATIONS。

`pnpm test:access` 是可重跑的真 PostgreSQL／Redis／CLI 存取控制驗證入口，限定此輪合成 `confsys_test`。`pnpm check` 包含它所用的整合案例與完整 UI E2E。沒有新增依賴／環境變數；需要向前 migration 0004。MFA 尚未實作，本地測試不代表高權限 production ready。
