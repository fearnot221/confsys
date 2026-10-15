# 網域 HTTPS Demo

目標網址：**https://confsys.fearnot.tw**。這是可供外部試看的合成資料 demo；保留 Mailpit 測試郵件與人工核帳，不會寄真信或觸發實際付款。API／worker 各只掛載自身所需的 runtime 密鑰檔；web 不掛載應用密鑰。完整 operator 密鑰僅提供 secrets 派生、migration 與 seed 工作。基於 [本機 demo](../demo/README.md) 的 Compose overlay，不另建第二套產品或資料模型。

## 伺服器準備

- Git、Docker Engine、**Docker Compose >= 2.24.4**、curl。主機不需要安裝 Node 或 pnpm，映像內固定 Node 24.21.0／pnpm 10.34.7。
- Cloudflare 使用 DNS only（灰雲）：`confsys.fearnot.tw` 的 A 記錄指向此伺服器。若有 AAAA，IPv6 也必須可達；沒有 IPv6 就移除錯誤的 AAAA。
- 雲端安全群組、主機防火牆、NAT 均允許外部 TCP **80、443** 到這台機器，且埠未被 Nginx／Apache／其他容器占用。不要停止不明服務來搶埠；已有反向代理時先規劃整合，本方案預設直接獨占 80／443。
- 容器可連外下載映像與向 ACME CA 簽證／續期。CAA 若有限制，需允許所用 CA。沒有 Cloudflare API token 或 DNS API 權限需求。
- 開啟 scanner 時，ClamAV 額外約需 3 GB RAM；還需為 app、DB、Redis 與映像建置預留空間。未做容量基準測試，不能據此推定最低可用規格。

Caddy 會自動簽發／續期公開憑證並將 HTTP 轉至 HTTPS；要求與行為見 [Caddy 官方文件](https://caddyserver.com/docs/automatic-https)。Compose overlay 的 port replacement 要求見 [Docker 官方 merge 文件](https://docs.docker.com/reference/compose-file/merge/)。

## 一鍵部署

以下在伺服器的獨立 checkout 執行；私有 repository 需先設定你自己的 GitHub 讀取權限。

```sh
git clone --branch main https://github.com/fearnot221/confsys.git
cd confsys

DEMO_DOMAIN=confsys.fearnot.tw ./deploy/https-demo/demo.sh up
```

腳本會保存設定、驗證 Compose 與 Caddy、建置映像、啟動依賴、獨立執行 migration、透過真實 HTTP／Mailpit 流程 seed，最後啟動代理。會以 curl 驗證 **公開信任的 TLS 憑證及 readiness HTTP 200**，不使用 `--insecure`；成功才印出 ready。DNS／防火牆／ACME 失敗會非零結束，保留服務與資料供排錯，修正後可重跑。重跑 seed 不會覆寫既有帳號、角色或已發布官網。

首次憑證驗證最多嘗試 18 次，每次連線上限 10 秒、間隔 5 秒。這不包含映像建置或依賴啟動時間。伺服器若不能經公開網址回連自身，最後檢查仍會失敗；應修正 DNS／路由或由外部另行確認，不能將失敗當成部署完成。

管理員登入：`https://confsys.fearnot.tw/auth/login`，Email：`admin@demo.invalid`。密碼只透過私有終端查詢：

```sh
./deploy/https-demo/demo.sh password
```

預設只有雙語官網與一位管理員。報名、議程、投稿等需在介面自行建立；新註冊帳號不會自動成為管理員。不要把管理員密碼貼到公開 demo 頁。

## 檔案掃描

若要演示上傳後下載／引用流程，首次啟動時：

```sh
DEMO_DOMAIN=confsys.fearnot.tw COMPOSE_PROFILES=scanner ./deploy/https-demo/demo.sh up
```

若已啟動，將 `deploy/https-demo/.env` 中 `COMPOSE_PROFILES=` 改為 `COMPOSE_PROFILES=scanner` 後重跑 `up`。掃描器病毒碼需先準備好；未就緒或未啟用時保持隔離，不能當作可用附件。網站 readiness 不表示 scanner 已就緒。

## 設定與管理

首次 `up` 以 mode 0600 建立本目錄的 `.env`（Git／Docker context 均忽略）。只接受純 `key=value`，不要引號、shell expansion 或執行片段；內容不會被當 shell 程式執行。設定集中由 `config.sh` 驗證，應用程式既有 config loader 仍驗證 HTTPS origin 等 runtime 設定。範例見 [.env.example](.env.example)。

| 設定 | 預設／限制 |
| --- | --- |
| `DEMO_DOMAIN` | 首次必填；小寫完整公用 DNS 名稱，不含 `https://`、port、路徑、wildcard 或 IP |
| `DEMO_PROJECT_NAME` | `confsys-https-demo`；Compose volumes／network 的實例名稱 |
| `DEMO_MAIL_PORT` | `18025`，1024–65535；永遠只綁 `127.0.0.1` |
| `COMPOSE_PROFILES` | 空或 `scanner` |
| `CONFSYS_ENV_FILE` | 選擇設定檔；預設本目錄 `.env`。相對路徑以呼叫時工作目錄解讀 |

日後命令會自動讀取保存的設定；如果外部環境指定了不同的已保存值，會拒絕執行，避免誤選實例。使用自訂 `CONFSYS_ENV_FILE` 時，每次操作都須使用同一檔案，並自行確保該路徑不進 Git／build context。不要在有資料後任意改 project name（會選到新 volumes）或 domain（影響 Cookie、CSRF 與舊郵件連結）。

```sh
./deploy/https-demo/demo.sh status    # 包含已完成的一次性工作
./deploy/https-demo/demo.sh check     # 驗證設定與公開 HTTPS readiness
./deploy/https-demo/demo.sh logs      # proxy / API / worker / web 日誌
./deploy/https-demo/demo.sh down      # 停止並移除此專案容器，保留資料與憑證
./deploy/https-demo/demo.sh up        # 重新啟動／建置
```

無 reset 指令。不要加 `down -v`；它會刪除帳號、資料、隨機密鑰、私有檔案與 Caddy 憑證。停機保留 volumes 不等於備份。更新前應保存同一實例的 DB、private-storage、demo-secrets、Caddy data/config，採取一致且受限制的備份；本 demo 的完整災難復原尚未驗證，參考 [OPERATIONS](../../docs/OPERATIONS.md)。不要單獨刪除密鑰 volume 後沿用既有 DB。

此方案只公開 proxy 的 80／443；web 的原本 8080 publication 被移除，API、worker、DB、Redis 無 host publication。Mailpit 僅 loopback。容器有 `unless-stopped` restart policy，Docker daemon 重啟後可恢復長駐服務；手動 `down` 後需再次 `up`。憑證持續保存在專案 volume，不應每次重新簽發。

Mailpit 由管理者使用 SSH 通道存取：

```sh
ssh -N -L 18025:127.0.0.1:18025 使用者@伺服器位址
```

然後只在自己的電腦開啟 `http://localhost:18025`。不將 Mailpit 加入 Caddy 路由、不對外開放 18025。測試註冊／重設信件由管理者私下從 Mailpit 取得；外部參觀者不會收到真信。

## 排錯與限制

- **80／443 已占用**：`docker ps`、`sudo ss -ltnp` 檢查；不要讓本腳本停止其他服務。
- **憑證未就緒**：從另一台機器確認 A／AAAA、灰雲、80／443 可達；檢查 Caddy 日誌、CAA 與系統時間。避免反覆刪除 Caddy volumes 觸發 CA rate limits。
- **403／CSRF**：只用保存的 `https://confsys.fearnot.tw` 存取；不要改用 IP、另一個 hostname 或 HTTP 登入。Host、Origin、cookies 由代理原樣傳入，Secure／HttpOnly Cookie 保持啟用。
- **登入／註冊 429**：目前 API 維持 `trustProxy=false`，經 web 代理的訪客共享來源 rate limit。不要為 demo 任意信任 `X-Forwarded-For`；大批多人同時操作需另做 trusted-proxy policy 與濫用測試。
- **檔案持續隔離**：確認 scanner profile 與病毒碼就緒；無掃描器不會回報假成功。

本次不修改應用授權、MFA、真實寄信、付款或 provider。此公開 demo 不等於正式會議上線驗收；只填入合成資料，不接既有 production DB。公用 ACME 簽發及續期只能在網域／伺服器就位後驗證，不能以本地內部 CA 測試替代。

## 驗證

```sh
pnpm exec vitest run tests/unit/https-demo-config.test.ts
pnpm test:demo:https
```

後者需要 Docker／Compose，建立隨機名稱的獨立合成實例及空閒 loopback ports；真實 PostgreSQL、Redis、Mailpit、app、Caddy 執行 migration 與 seed。本地僅在測試 overlay 使用 `tls internal`，客戶端明確信任該臨時 CA，仍驗證 TLS／hostname；不使用 `rejectUnauthorized:false`，不對公用 CA 發請求。也檢查 API／worker 只能讀取自身的 runtime 密鑰檔，無完整 operator 密鑰或另一角色的 DB 連線。涵蓋 exposure、redirect、Secure Cookie、登入／CSRF、私有 draft 存取／登出撤權與 down/up 後資料、CA 及 seed 冪等性。finally 只清除此隨機專案的容器／volumes。它不取代既有 `pnpm check` 或 `pnpm test:instances`。
