# 給 Codex 的第一輪提示詞：Phase 0

請在目前 repository 建立一套「可供多組織、多場研討會與跨年度重複使用」的完整研討會管理平台。

先完整閱讀 `AGENTS.md` 與 `docs/SPEC.md`。規格中的完整功能是產品路線圖，**本輪只授權 Phase 0，不要一口氣實作全部系統，也不要自行進入 Phase 1**。

## 不可改變的要求

1. 使用 PostgreSQL、Redis、Node.js、Vite。採提案的 React／TypeScript、Fastify、Drizzle ORM／node-postgres、BullMQ、REST／OpenAPI；不要擅自改成 Next.js、Firebase、MongoDB 或把全部服務拆成微服務。
2. 平台不是單一研討會網站；架構與契約須從一開始容納多組織、多會議、各自權限、各自設定及歷屆複用。
3. 舊系統截圖只供功能參考，禁止照抄舊 UI；新 UI 從清楚、現代、可存取、可維護的設計開始。
4. 前期由 Codex 完成包含實際可用前端在內的核心系統，後期 Claude Code 才優化 UI。現在就劃清 presentation 與 data/business logic 邊界。
5. 不可寄真實信件、操作真實金流、使用 production 資料、提交 secrets，亦不可未經核准 merge／部署 production。

## 工作順序

### A. 盤點與執行計畫

先檢查現有檔案、README／AGENTS、package manifests、Git branch/status、CI 與 migrations。不能重建或覆寫既有專案，也不能丟棄未提交修改。

提出簡短的 Phase 0 計畫與 ADR 摘要後，直接開始本輪授權的實作。非阻擋性問題採 SPEC 預設並記錄 assumptions，不要只輸出另一份規劃書就停止。

確認實際執行環境、套件 registry 與官方相容性，鎖定受維護的穩定版本。不得依記憶捏造版本，也不要使用 beta／RC／浮動 latest 作正式基底。建立 `codex/phase0-foundation` 或不與現有分支衝突的同意圖分支。

### B. Workspace 與最小可啟動程式

建立 pnpm workspace，至少有：

- `apps/web`：React + Vite + TypeScript，具備新的基本 shell、繁中／英文文字結構、error boundary 與 API health 狀態。
- `apps/api`：Fastify + TypeScript，config validation、structured logging、health/readiness、錯誤格式及 request ID。
- `apps/worker`：獨立 Node.js process；連接 Redis-backed BullMQ，可執行無外部副作用的合成測試 job，有 graceful shutdown。
- `packages/contracts`：開發者維護的 Zod schemas／DTO，與 OpenAPI 產生管線的最小實例；不得從 DB 表直接暴露完整 row。
- `packages/sdk`：typed API client；Web 元件不得各自散落 fetch。
- `packages/ui`：基礎 Button／Input／Status／Layout，不能依賴 SDK、DB 或儲存登入 token。
- `packages/db`：Drizzle／SQL migration 基礎、連線池、transaction／tenant context helpers。
- 必要的共用 config／domain package；不要為空資料夾湊架構。

可先採 Web→API health 的實際垂直切片，不得假造登入、付款、投稿或寄信功能。API 未實作的功能不得回傳假成功。

### C. 環境與可靠性基礎

建立可供本地使用的 Docker Compose：PostgreSQL、Redis queue、Redis cache 或清楚文件化的開發共享模式、郵件捕捉服務、API、worker、Web。提供有效 healthchecks、持久化開發 volumes、安全預設及 `.env.example`。

本地檔案儲存若存在，放在私有位置並抽象成 storage adapter，不放 `public/uploads`。本輪不要求完成 S3 provider 實際整合。

DB migration role 與 app/worker role 分離。建立最小的 transaction-local tenant-context／RLS 驗證範例，使用測試專用資料／表，證明 DB pool 不會讓上一個請求的 tenant scope 洩漏給下一個請求。

用真實 PostgreSQL／Redis 做整合測試：同 tenant 可讀寫、cross-tenant 被拒、缺少 context 被拒、application role 沒有 RLS bypass。這個測試骨架不得包裝成完整多租戶登入已完成。

建立 outbox／idempotency 的 ADR 與介面約定；完整持久化 notification 流程於 Phase 1 實作，不為了本輪一次建立整套郵件產品。

### D. CI 與文件

建立真正執行的：lint、typecheck、unit tests、integration tests、contract check、build、最小 Web/API smoke E2E。沒有可測完整流程時，保持 smoke 測試範圍誠實；不可放永遠成功的 placeholder。

GitHub Actions 覆蓋 pull request 及 main push；使用隔離的測試 DB／Redis，不連 production。建立 PR template、ownership 規則與適合後續 preview deployment 的容器建置。

文件至少包括：

- `README.md`：實際啟動／建置／測試／migration 指令。
- `docs/ARCHITECTURE.md`：模組、tenant scope、API/worker 邊界、storage／outbox。
- `docs/PERMISSIONS.md`：角色／scope 與規劃中的 permission matrix，區分未實作部分。
- `docs/UI_CONTRACT.md`：presentation props、callbacks、view models 與 Codex/Claude ownership。
- `docs/DATA_CONTRACT.md`：DTO、錯誤、pagination、時間／幣別、idempotency 與 scope 規則。
- `docs/TESTING.md`：真實測試命令與現階段覆蓋範圍。
- `docs/ROADMAP.md`：沿用 SPEC Phase 0–7，標明進度及下一步。
- `docs/adr/`：技術選型、租戶隔離、session／RLS、queue/outbox、UI/data 分工及版本鎖定。

不要寫「CI passed」而只新增 YAML，亦不能把文件列出的計畫當作已實作功能。

## Phase 0 驗收與停止條件

完成可啟動的 Web/API/worker、受控依賴環境、真實 tenant 隔離範例測試、基本契約與 CI 後，實際執行驗證命令並修復本次引入的問題。

交付報告請包含：

1. 分支與 commit；repository 是否有既有工作需要保留。
2. 已完成的 Phase 0 項目及可實際操作的內容。
3. 鎖定版本、重要 ADR、環境變數、schema/migration 與 API 契約。
4. 執行過的每條指令及真實結果；未執行、環境阻擋或外部服務未配置的部分獨立列出。
5. PostgreSQL／Redis 整合、RLS／pool scope 隔離、Web/API smoke 的測試證據。
6. 本機重現步驟、已知限制與 Phase 1 的最小拆分計畫。

完成後停止並等待我確認，不要 auto-merge、不開始 Phase 1。環境不支持的操作要保留明確阻擋項，不可捏造 PR、測試或部署成功。
