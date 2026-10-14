# Phase 1.3 交付 — 2026-10-15

本輪只交付會議設定與固定官網的草稿、受保護預覽、正式發布、發布歷程及載入歷史為新草稿。使用者訊息是執行授權；附件 `PHASE1_3_CONFERENCE_SITE_CODEX.md` 是驗收要求，不是基線或測試通過證明。產品維持同一程式碼、每場研討會獨立部署；沒有恢復 organization tenant、跨會議帳號或授權。

## 基線與環境保留

- 基線 `9d3e7880ce17102e35318b585cae5c96f83c358f`；六次 `git merge-base --is-ancestor <commit> 9d3e788` 全部 exit 0，確認包含 `cc2361d`、`520607e`、`ab7120f`、`f1126ad`、`c10b025`、`c6f1d5f`。
- 分支 `codex/phase-1-3-conference-site`；工作樹 `/Users/fearnot/Desktop/confsys-phase-1-3-conference-site`。實作 commit 與最終交付 commit 見本文末及交付訊息。
- 受管工具回報無法驗證 starting ref，改用 `git worktree add -b codex/phase-1-3-conference-site /Users/fearnot/Desktop/confsys-phase-1-3-conference-site 9d3e788`。沒有 merge、rebase、cherry-pick、reset。
- 讀取現行 AGENTS、SPEC、ROADMAP、PERMISSIONS、架構／契約／測試／維運文件、ADR、CI／PR template、Phase 1.2 報告及相關實作。focused Phase 0 recheck 與風險已記於 ROADMAP；修正已證實的 ingress `/access/accounts` 路由缺漏，沒有展開無關重構。
- 四個前序工作樹保持 clean，HEAD 分別仍為原目錄 `c10b025`、Phase 1.1 `f1126ad`、Phase 1.1b `520607e`、Phase 1.2 `9d3e788`。沒有修改它們或停止、重建、升級使用者原先保留的容器、volumes、hostname。

新 host regression project 是 `confsys-p13-regression`：Web 55179、API 53000、worker 53001、PostgreSQL 55442、Redis 56392、Mailpit 58032／SMTP 51032。整合測試只使用此新 project 的合成 test DB、隨機 fixture prefixes 與臨時升級資料庫。E2E 啟動的 host processes 由 runner 結束，基礎容器保留。

## 實際可用流程

1. 既有註冊 → Mailpit 驗證 → 設定密碼 → CLI bootstrap → 管理員重新登入流程保留；帳號頁增加官網管理入口。
2. `/admin/site` 分為基本資訊、官網內容、預覽／發布、發布歷程。輸入名稱、日期、時區、聯絡資料與固定四頁文字／metadata，儲存後可重新載入。部分內容允許留空草稿；發布有完整驗證。
3. 預覽只讀已儲存的指定草稿版本，明示未發布；未儲存內容需先存檔。同版官網和預覽共用 `PublicSiteContent` 純呈現元件。
4. 發布確認列出整站範圍、草稿版本、主要變更；近期 proof 過期時重新驗證密碼，再另行確認發布。成功只在交易及正式 DTO 重新讀取完成後顯示。
5. 訪客打開 `/` 或 `/{zh-Hant|en}/{home|about|participation|contact}`，初始 HTML 即含內容、導覽、日期、title、description、canonical、lang、hreflang；不需 JavaScript。`/sitemap.xml` 只列正式啟用頁面。未知頁／語系真實 404。
6. 新草稿不變更官網、auth shell 或新郵件品牌。衝突保留本地表單，讀取伺服器版本人工比對，再明確捨棄／重新套用；不靜默覆寫。
7. 發布歷程每頁 20 筆，含時間、操作者 UUID、版本及欄位摘要。「載入此版本為新草稿」檢查目前版本與確認、拒絕未儲存表單，產生新草稿；另行發布才改官網。
8. 失去權限或 Session 後清除私人表單／preview／history／query，忽略晚到 response。staff、普通帳號、匿名都不能讀未發布內容。

auth、`/access/accounts`、`/admin/site` 維持 SPA；原診斷頁移至 `/system/status`。未發布只顯示準備中與真實帳號入口，沒有假報名／投稿 CTA、假人物或統計。

## 設定與品牌權威

| 資料 | 權威及生效時點 |
|---|---|
| DB／Redis／SMTP 寄件身分與 provider、secrets、Cookie／CSRF、canonical origin、project identifier | 既有 centrally validated server config；官網 API 不能修改或還原 |
| `CONFERENCE_NAME` | 尚未發布的最小公開識別、第一次表單初始值；不在 migration/startup 寫入草稿，不覆蓋已發布 DB |
| 名稱／副標題／簡介／日期／IANA 時區／場地／主承辦／聯絡／語系／四頁內容與 metadata | 本地 PG 草稿供私人編輯；active immutable publication 是唯一公開權威 |
| 新帳號郵件名稱 | `effectivePublicSite` 在 outbox 交易建立時擷取正式名稱快照；重試不換品牌 |
| 升級前沒有快照的待寄工作 | 保留 NULL，沿用舊 worker bootstrap 名稱；token／outbox 不清除，canonical／From 不改 |

`/api/instance` 仍只有既有 `{conferenceName}`；auth shell、`/api/site`、新郵件共用有效品牌 resolver。DB 故障回 503 並記安全定位事件，不能回退成「未設定」或讀草稿。公開 DTO 不含管理者／權限／歷史欄位；未啟用語系文字清空，私人草稿保留。

日期是驗證後的 YYYY-MM-DD，檢查真實日曆日期及起訖順序，不轉 browser-local Date。繁中初始預設，可啟用英文；每個啟用語系必須有名稱及四頁 metadata。選填文字／列表／連結缺譯按完整欄位回退預設語系，標記實際文字 lang；場地空白顯示待公告。

## Schema、API 與建置變更

- 新 `0005_conference_site.sql`：singleton `site_state`、唯一 source draft version 的 `site_publications`、active FK、歷程索引；通知新增 nullable `conference_name`。沒有改寫已套用的 0001–0004、帳密、epoch、bootstrap marker 或既有 Session。
- app runtime 可讀、有限更新草稿及新增發布；沒有 publication/audit UPDATE／DELETE。worker 沒有 site table 權限，讀自己的郵件快照。實際非特權 app／worker roles 測試 grants；這不是未來稿件 resource RLS 或多租戶 resolver 的宣稱。
- 延用 registry，只對 admin 明列新增 `site.draft.read`、`site.draft.write`、`site.publish`；staff 原有目錄權限不變。沿用 control row → 新讀 actor Session/user/role → site 的鎖序，發布沿用五分鐘 password proof，沒有第二個撤權 counter 或 MFA 宣稱。
- API：GET `/api/site`、GET/POST `/api/site/draft`、GET `/api/site/preview?version=N`、POST `/api/site/publish`、GET `/api/site/history?offset=N`、POST `/api/site/restore`。嚴格 DTO、expectedVersion、CSRF／可信 Origin、128 KiB body 限制；沒有 generic PATCH。完整 projection/errors 見 DATA_CONTRACT／產生的 OpenAPI。
- 公開指標與 immutable document 一個 JOIN statement 讀取，避免 Read Committed 多次讀混版。存稿／還原／發布所需 audit 同交易；同版重複發布不新增快照或成功 audit。所有動態 HTML／DTO／private API no-store；hash assets 保留快取，SPA noindex。
- Fastify 由 Vite 建好的 `entry-server.js` 呼叫 React `renderToStaticMarkup`；renderer 只接公開 view model。API 不跑 production Vite。精確 server-entry allowlist 與 presentation type-only import tests 保留其他邊界。既有 Docker image 自動包含 public server artifact，沒有第二個 framework。
- ingress 明列 SPA／assets，其餘交 API；未知公開頁保持 404。修正 malformed URL 回 400，驗證其後仍可服務。沒有放寬 CSP、Origin 或使用 inline script。
- 無新增 dependency、環境變數、Compose service、Dockerfile 或 CI workflow。既有 Node 24.21.0／pnpm 10.34.7／lockfile pins 不變。新增 `test:site`，`pnpm dev` 先 build:public，正式 build 產出 browser/server 兩者。

## 實際驗證

所有 pnpm 命令在本工作樹，以 `PATH=/tmp/confsys-tools/node_modules/.bin:$PATH` 使用已核對的 Node 24.21.0／pnpm 10.34.7；不更換全域工具。數字是本輪實跑結果，不沿用附件。

| 命令 | 結果 |
|---|---|
| `git status --short`、`git branch --show-current`、`git worktree list --porcelain`、六次 ancestry check | 基線／獨立工作樹核對完成 |
| `pnpm install --frozen-lockfile` | Pass，lockfile 不變 |
| `COMPOSE_PROJECT_NAME=confsys-p13-regression WEB_PORT=55179 API_PORT=53000 WORKER_PORT=53001 POSTGRES_PORT=55442 REDIS_PORT=56392 MAILPIT_PORT=58032 SMTP_PORT=51032 pnpm env:setup` | Pass，新建測試設定／隨機 credentials |
| `pnpm infra:up`、`pnpm db:migrate` | Pass，新 project 完整 0001–0005；整合 runner 另遷移 test DB |
| `pnpm contract:generate` | Pass，OpenAPI exact-match 檢查通過 |
| `pnpm exec playwright install chromium` | Pass |
| `pnpm check` | 七道 gate 依序通過；最終日誌 `/tmp/confsys-p13-check-delivery.log` |
| `pnpm lint`、`pnpm typecheck` | Pass，ESLint、AST import boundaries、strict TS |
| `pnpm test:unit` | 17 passed／7 files |
| `pnpm test:integration` | 41 passed／8 files，真 PostgreSQL／Redis／worker／Mailpit |
| `pnpm test:contract` | 13 passed／5 files |
| `pnpm build` | Pass，clean TS、browser Vite、public server Vite |
| `pnpm test:e2e` | 10 passed，含兩個 site 流程及原有八個流程 |
| `pnpm test:site` | 8 passed／1 file，獨立入口再次實跑 |
| `pnpm test:access` | 10 passed／1 file，獨立入口再次實跑 |
| `pnpm test:instances` | Pass，同 image 容器建置、遷移、原有 auth/access/worker 與新增官網驗證；最終日誌 `/tmp/confsys-p13-instances-final-unique.log` |
| runner 的 build／migrate／app start／A-only restart，以及 `smoke-stack.ts`、`smoke-auth.ts` | Pass，真容器 Web/API/worker/Mailpit；對應 `pnpm smoke:stack`／`pnpm smoke:auth` 的同一入口 |
| `git diff --check`；`git diff --exit-code 9d3e788 -- pnpm-lock.yaml packages/db/migrations/0001_foundation.sql packages/db/migrations/0002_identity.sql packages/db/migrations/0003_identity_grants.sql packages/db/migrations/0004_access_control.sql` | Pass；舊 migrations、lockfile 不變 |

### 行為證據

- `integration/site.test.ts` 用真 PG 競爭第一次儲存及同版本編輯／發布；驗證 409、同版冪等、近期 proof、原子指標／snapshot／audit。故障 trigger 驗證 save／publish／restore 全回滾。等待 control lock 時真實撤 role、disable 或 revoke session，透過 `pg_stat_activity` 確認排隊後才釋鎖，失權者均不能提交。
- 公開連續讀與發布並行，整份輸出固定一個 publication；HTTP 測試包含 strict mass assignment、CSRF／Origin、128 KiB、惡意 URL、引號／尖括號／`</script>`、初始 HTML／metadata／sitemap／404、no-store、DB 503。HTML 字串只是 React escaped text，不成為 HTML 語言。
- 真 worker 測試新名稱快照、品牌變更後重試不漂移、舊 NULL 工作 fallback；保留既有 crash/retry/SIGKILL、token 安全與 access 最後管理員測試。
- `integration/migrations.test.ts` 覆蓋 blank、Phase 0、Phase 1.1b、Phase 1.2 0004 升級至 0005。合成帳密 hash、roles、marker、epoch、Session/proof、audit、pending outbox/envelope/token 均保留；升級後實際使用舊 reset token，成功並按既有規則撤 Session。不是 production restore 或 downgrade 演練。
- Playwright 從真 UI 註冊、Mailpit、CLI bootstrap 開始，編輯→存稿→重載→指定預覽→發布→匿名官網→新草稿保密→再發布→歷史載入；兩 editor 衝突保留文字，晚到草稿不能在 Session 失效後復活。關閉 JS、America/Los_Angeles 時區仍有正確日期／HTML；390px 無橫向 overflow。
- 單元／契約層仍有明確 transport/probe doubles，但交易／權限／SSR／migration／worker 與雙實例證據沒有用它們替代真服務。

早期失敗如實記錄：通知 SQL 新增參數的綁定位置、契約測試缺少必要 brand resolver、lock-wait 測試使用錯誤觀察角色、原生 select 的可存取標籤包含 option 文字、同步 schema rejection 與 Promise 測試形式均已修正。HTTP async service 保持一致 rejection；表單改明確 id/htmlFor；lock-wait 以實際 app role 觀察。完整 gates 重新執行，未刪除／skip／削弱原有 assertions。早期測試留下的合成 fixture 僅按本輪獨有 IDs/prefix 清理，不碰既有使用者資料。

### 同 image 雙實例與畫面

正式證據檔 [phase1-3-instances.json](evidence/phase1-3-instances.json) 記錄最終 run、單一 image ID、兩組 project/origin/network/volumes，沒有 secrets。A build 一次，A/B 六個 Web/API/worker containers 的 image ID 相同；B 使用 no-build。

最終 run `dc3f0715`，image `confsys:p13-dc3f0715`，實際 ID `sha256:b30350f8265a8fa5c97c2e8c1e78a811707fcb45287d7837564dd9ef525c18dd`。

| 項目 | A | B |
|---|---|---|
| Project | confsys-p13-dc3f0715-a | confsys-p13-dc3f0715-b |
| Browser origin | http://a-dc3f0715.localhost:55180 | http://b-dc3f0715.localhost:55181 |
| Env | .instances/dc3f0715/a.env | .instances/dc3f0715/b.env |
| PG／Redis | 55440／56390 | 55441／56391 |
| Mailpit／SMTP | 58030／51030 | 58031／51031 |

runner 以各自 env 呼叫既有 compose wrapper，實際參數為 A `--profile app build api`、A/B `up -d --wait postgres redis mailpit`、`--profile app run --rm migrate`、`--profile app up -d --no-build --wait api worker web`。A-only `--profile app stop worker`／`--profile app start worker` 及 `--profile app stop web api worker` 後再次 `--profile app up -d --no-build --wait api worker web` 驗證停止／恢復；只針對本輪新建 A，不操作使用者既有環境。

使用真註冊／CLI bootstrap 及網站 API 發布不同雙語內容，瀏覽器檢查頁面；A 修改／發布／載入歷史不改 B 的完整 site/accounts/roles/sessions/audit snapshot 或 container IDs。相同 Email 在 A 為 admin、B 為普通帳號；A Cookie 搭配 B 有效 CSRF 仍不能讀 B 草稿／preview／history 或發布。A/B 初始 HTML、canonical、啟用語系、新 Mailpit 名稱與原有 canonical mail URL 正確，沒有 rebuild 會議專用前端。原帳號/token/cookie/worker/network/bootstrap/access/只重啟升級 A 的 checks 保留。

截圖只作呈現證據，不代替上述斷言；已檢視桌機／手機：

- [公開桌機](evidence/phase1-3-public-desktop.png)、[公開手機](evidence/phase1-3-public-mobile.png)
- [管理桌機](evidence/phase1-3-admin.png)、[管理手機](evidence/phase1-3-admin-mobile.png)

本輪較早的 `.instances/09386574`、`f9645d02`、`30694026` 為同一工作中的合成試跑；僅以各自 env 的 `pnpm compose --profile app stop` 釋出固定 ports，所有容器／資料卷保留，沒有 down -v／prune。最終 A/B 保持運行。之後若使用者要停止某次測試，先核對 evidence 中的 project/origin，再分別執行 `CONFSYS_ENV_FILE=.instances/<run>/a.env pnpm compose --profile app stop`（B 同理）；此為保留資料的停止方法。本輪未執行任何既有資料刪除或通用清理。

## Maintainability check / 可維護性檢查

1. **責任邊界：** site routes 只驗證與轉接；service 擁有現行授權、版本規則與交易；repository 做固定 SQL/projections；branding 是唯一有效名稱入口；server loader 固定正式版本後交純 renderer。SDK 擁有 browser HTTP／CSRF，hook 擁有 server state／conflict／撤權清理，presentation 只接 props/callbacks。共用原生欄位 helper 修正真實標籤重複；沒有空層或通用 CMS。
2. **單一權威、重複與依賴：** 沒有新增 dependency、第二份 role mapping／撤權 epoch／密碼 verifier／公開 HTML 欄位規則。明確的新耦合是 auth outbox 使用 site branding resolver、site 使用 access fence，兩者皆直接服務本輪不變條件。公開／預覽共用呈現，部署設定和內容不混用。取捨記於 ADR 0005。
3. **測試／文件同步：** AGENTS、README、SPEC、PERMISSIONS、架構、DATA/UI_CONTRACT、TESTING、OPERATIONS、ROADMAP、ADR、OpenAPI 與測試同輪更新。實跑 17 unit／41 integration／13 contract／10 E2E、獨立 site/access 入口及同 image 容器回歸。使用 [fixing-accessibility skill](/Users/fearnot/.codex/skills/fixing-accessibility/SKILL.md) 檢查原生 labels／語意／焦點及錯誤，沒有完整 WCAG 宣稱。
4. **技術債與風險：** 單例管理鎖可能在長交易下阻塞；offset 歷程在並行插入時頁面會移動；未 benchmark。擴大管理規模前測負載／timeout、必要時 keyset。schemaVersion 1 後續演進須有 decoder／immutable fixture／roll-forward 策略。host dev 修改共用 renderer 後需 `pnpm --filter @confsys/web build:public`；自動 watcher 留待開發體驗單元。原生表單／手動差異比較可於 Claude 呈現階段改善，不移動業務邊界。證據、實際風險及 acceptance/treatment phase 均記 ROADMAP。

## 未實作、未配置、未驗證與停止點

- 未實作：檔案／媒體／上傳／掃描／下載、邀請、自訂角色、MFA/SSO、報名、投稿、付款、審查、議程、任意 CMS／HTML／theme、排程發布、歷史刪除、設定匯入匯出或跨實例管理。
- 未配置：真實外部 mail/payment provider、production credentials 或 production 部署。
- 未驗證：雲端 CI（未 push）、TLS／Secure cookie 真實流量、production backup restore／downgrade／混版部署、密鑰輪替、負載／DoS／滲透、完整 WCAG／assistive technology／跨瀏覽器、搜尋引擎收錄。MFA、可信 proxy/IP rate limits、強密碼／Argon2 capacity、retention 與 shared-host 資源風險仍為上線前工作。

下一最小單元建議回到私有檔案／媒體 metadata、內容驗證／隔離、受權限保護存取及安全生命週期，另行批准後才實作；之後再按 roadmap 處理邀請與報名。完成本地提交後停止，沒有 push、merge、production deploy、寄真信、操作金流或開始下一階段。

實作、測試、契約、維運文件與畫面／雙實例證據 commit：`d4c0788b4687539ee5ccc77075c7f81160d73421`（`feat(site): add versioned conference website publishing`）。本報告為後續純文件交付 commit；最終 hash 於交付訊息提供。
