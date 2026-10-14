# 研討會管理平台

可供多組織、多研討會與跨年度重複使用的平台。**已實作 Phase 0 工程底座與 Phase 1.1 帳號生命週期／Session**；組織、會議、報名、付款、投稿等功能尚未實作。原始需求保留於 [SPEC](docs/SPEC.md)，舊截圖只作功能參考。

## 本地啟動

需要 Docker Compose v2、Node **24.21.0**（`.nvmrc` / `.node-version`）及 pnpm **10.34.7**。請先切換 Node 版本；全域原有 Node 不會由本專案修改。

```sh
npm install --global pnpm@10.34.7
pnpm install --frozen-lockfile
pnpm env:setup
pnpm infra:up
pnpm db:migrate
pnpm dev
```

`env:setup` 產生隨機本地密碼；既有值不覆寫，只補齊缺少的 auth 設定與隨機金鑰。不要使用 `pnpm setup`，那是 pnpm 自身的 shell 設定指令。migration 必須獨立執行，API 不會代跑。

- Web：[http://127.0.0.1:25173](http://127.0.0.1:25173)，真實服務狀態、繁中／英文、手動更新／錯誤重試。
- API：`http://127.0.0.1:23000/api/health/live` 與 `/api/health/ready`。
- Worker：`http://127.0.0.1:23001/health/ready`，只在本地開發暴露。
- 郵件捕捉：[http://127.0.0.1:28025](http://127.0.0.1:28025)，SMTP 21025；獨立 worker 寄送驗證／重設／密碼變更通知。
- PostgreSQL：localhost:25432；Redis：localhost:26379。

開發埠避免與機器上既有服務衝突。帳號入口：[登入](http://127.0.0.1:25173/auth/login)、[註冊](http://127.0.0.1:25173/auth/register)。註冊後到 Mailpit 找合成信箱的郵件，開啟連結並明確設定密碼，再正常登入。忘記密碼亦由 Mailpit 取信；重設會撤銷既有登入。登入不授予組織／會議權限。未實作路由仍為 404。

## 全容器啟動

```sh
pnpm env:setup
pnpm infra:up
docker compose --profile app build
docker compose --profile app run --rm migrate
docker compose --profile app up -d --no-build --wait api worker web
pnpm smoke:stack
pnpm smoke:auth
```

Web 同樣在 25173；容器內 API／worker 不映射到宿主機。API 與 worker 以 node 非 root 使用者執行；有 readiness、資源上限及 graceful shutdown。此映像保留開發依賴以便 Phase 0 review，正式映像瘦身與安全部署仍待後續工作。

```sh
docker compose --profile app stop web api worker
pnpm infra:down
```

`down` 保留資料 volumes；`down -v` 會刪除本地資料，僅 CI 使用。不要任意刪除 `.env` 後沿用舊 volume，因資料庫密碼不會因環境檔改變而自動輪換。

## 品質指令

先完成 `infra:up`、`db:migrate`，確保未有本專案 dev／容器 Web 佔用 E2E 埠：

```sh
pnpm db:migrate:test
pnpm exec playwright install chromium
pnpm check
```

`check` 順序執行 `pnpm lint`、`pnpm typecheck`、`pnpm test:unit`、`pnpm test:integration`、`pnpm test:contract`、`pnpm build`、`pnpm test:e2e`。Linux CI 安裝瀏覽器用 `pnpm exec playwright install --with-deps chromium`。

契約改動後用 `pnpm contract:generate` 更新已提交 OpenAPI，再跑 contract checks。各指令與覆蓋限制見 [TESTING](docs/TESTING.md)，本輪實際結果見 [PHASE1_1_DELIVERY](docs/PHASE1_1_DELIVERY.md)，Phase 0 歷史見 [PHASE0_DELIVERY](docs/PHASE0_DELIVERY.md)。GitHub Actions 覆蓋 PR／main push；尚未 push，不能將本地通過稱作雲端 CI 通過。

## 結構與協作

`apps/web` → data hooks → `packages/sdk` → `packages/contracts`；`apps/api` 是 modular monolith，`apps/worker` 獨立執行。`packages/db` 封裝連線與交易、`packages/ui` 只接受 props／callbacks、`packages/config` 驗證環境。

- [Architecture](docs/ARCHITECTURE.md) / [Permissions](docs/PERMISSIONS.md)
- [UI contract](docs/UI_CONTRACT.md) / [Data contract](docs/DATA_CONTRACT.md)
- [Roadmap](docs/ROADMAP.md) / [Operations](docs/OPERATIONS.md) / [ADR](docs/adr/0001-phase0-foundation.md)

不含 production seeds、外部郵件／金流 credentials、production data。Phase 0 的 tenant 範例只存在 `confsys_test.phase0_rls`，測試後刪除；它不是登入授權系統。Phase 1.1 完成後停止，Phase 1.2 需另行授權。高權限正式上線仍需 MFA，不能將本輪稱作 production-ready。

## 帳號流程與本輪設定

UI 路由為 `/auth/register`、`/auth/waiting`、`/auth/verify`、`/auth/login`、`/auth/forgot`、`/auth/reset`、`/auth/account`。密碼 15–128 個 Unicode 字元，不 trim；禁止部分常見／重複密碼。Email trim + 全部小寫，保留 `+tag` 與點。

`PUBLIC_APP_ORIGIN` 決定寄信連結及唯一允許的 Origin；正式模式必須 HTTPS。本地開發／測試只允許 loopback HTTP。`MAIL_ENCRYPTION_KEY`、`MAIL_KEY_VERSION`、`CSRF_SIGNING_KEY` 由 setup 產生，不能提交或印到日誌。完整 TTL、限流、故障與金鑰操作見 [OPERATIONS](docs/OPERATIONS.md)。

Host dev 與 E2E 的 API／worker 由 `scripts/run-process.ts` 啟動，子程序只收到各自驗證過的設定。E2E 使用 `confsys_test`／Redis DB 1、每次新的 CSRF key；必須先跑 `pnpm db:migrate:test`。測試不刪除既有 volumes 或清空 Mailpit。
