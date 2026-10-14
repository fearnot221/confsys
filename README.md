# 研討會管理平台

可供多組織、多研討會與跨年度重複使用的平台。**目前僅完成 Phase 0 工程底座**；帳號、會議、報名、付款、投稿等業務功能尚未實作。原始需求保留於 [SPEC](docs/SPEC.md)，舊截圖只作功能參考。

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

`env:setup` 產生隨機本地密碼，既有 `.env` 不覆寫。不要使用 `pnpm setup`，那是 pnpm 自身的 shell 設定指令。migration 必須獨立執行，API 不會代跑。

- Web：[http://127.0.0.1:25173](http://127.0.0.1:25173)，真實服務狀態、繁中／英文、手動更新／錯誤重試。
- API：`http://127.0.0.1:23000/api/health/live` 與 `/api/health/ready`。
- Worker：`http://127.0.0.1:23001/health/ready`，只在本地開發暴露。
- 郵件捕捉：[http://127.0.0.1:28025](http://127.0.0.1:28025)，SMTP 21025；目前沒有應用程式寄信器。
- PostgreSQL：localhost:25432；Redis：localhost:26379。

開發埠避免與機器上既有服務衝突。未建立假登入或假業務 API；未定義路由一律 404。狀態頁是基礎設施診斷，不是多租戶產品流程。

## 全容器啟動

```sh
pnpm env:setup
pnpm infra:up
docker compose --profile app build
docker compose --profile app run --rm migrate
docker compose --profile app up -d --no-build --wait api worker web
pnpm smoke:stack
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
pnpm exec playwright install chromium
pnpm check
```

`check` 順序執行 `pnpm lint`、`pnpm typecheck`、`pnpm test:unit`、`pnpm test:integration`、`pnpm test:contract`、`pnpm build`、`pnpm test:e2e`。Linux CI 安裝瀏覽器用 `pnpm exec playwright install --with-deps chromium`。

契約改動後用 `pnpm contract:generate` 更新已提交 OpenAPI，再跑 contract checks。各指令與覆蓋限制見 [TESTING](docs/TESTING.md)，本輪實際結果見 [PHASE0_DELIVERY](docs/PHASE0_DELIVERY.md)。GitHub Actions 覆蓋 PR／main push；尚未 push，不能將本地通過稱作雲端 CI 通過。

## 結構與協作

`apps/web` → data hooks → `packages/sdk` → `packages/contracts`；`apps/api` 是 modular monolith，`apps/worker` 獨立執行。`packages/db` 封裝連線與交易、`packages/ui` 只接受 props／callbacks、`packages/config` 驗證環境。

- [Architecture](docs/ARCHITECTURE.md) / [Permissions](docs/PERMISSIONS.md)
- [UI contract](docs/UI_CONTRACT.md) / [Data contract](docs/DATA_CONTRACT.md)
- [Roadmap](docs/ROADMAP.md) / [Operations](docs/OPERATIONS.md) / [ADR](docs/adr/0001-phase0-foundation.md)

不含 production seeds、外部郵件／金流 credentials、production data。Phase 0 的 tenant 範例只存在 `confsys_test.phase0_rls`，測試後刪除；它不是登入授權系統。完成本輪後停止，Phase 1 需另行確認。
