# 一鍵本機 Demo / One-command local demo

在任何安裝 Docker（含 Compose v2）的機器上啟動一個完整的單一研討會實例：PostgreSQL、Redis、Mailpit、migration、worker、API、web，以及自動填入的合成示範資料。

```sh
./deploy/demo/demo.sh up
```

完成後會印出網址、管理員 Email 與首次啟動時隨機產生的密碼。之後可隨時用 `./deploy/demo/demo.sh password` 再查詢。

| 指令 | 作用 |
| --- | --- |
| `demo.sh up` | 建置映像、啟動並等待服務就緒、執行 seed、印出登入資訊（可重複執行） |
| `demo.sh password` | 顯示 demo 管理員密碼 |
| `demo.sh logs` | 追蹤 api / worker / web / seed 日誌 |
| `demo.sh down` | 停止容器，保留資料 |
| `demo.sh reset` | 停止並刪除所有 demo 資料與密鑰 |

不使用腳本時：`docker compose -f deploy/demo/compose.yaml up -d --build`，再以 `docker compose -f deploy/demo/compose.yaml logs seed` 查看 seed 結果。

## 內容

- `secrets` 一次性工作：首次啟動時把資料庫角色密碼、CSRF/QR/郵件加密金鑰與管理員密碼以隨機值寫入 `demo-secrets` volume。檔案不進 Git、不寫入日誌；`reset` 會一併刪除。
- `migrate` 完成後才啟動 worker 與 API；資料庫角色沿用 `infra/init-db.sh` 的非特權角色與 RLS 設定。
- `seed`（`scripts/demo-seed.ts`）：透過真實 HTTP 流程註冊 `admin@demo.invalid`、由 Mailpit 取得驗證信、以既有 bootstrap 服務授予 `conference_admin`，再發布中英雙語示範官網。重複執行會偵測既有帳號、角色與發布並跳過。
- 所有郵件由 Mailpit 擷取（預設 <http://localhost:8025/>），不會寄出真信；沒有任何金流供應商。

## 設定（環境變數）

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `DEMO_PORT` | `8080` | 網站對外埠 |
| `DEMO_ORIGIN` | `http://localhost:$DEMO_PORT` | 正式網址；瀏覽器必須使用完全相同的主機名稱（不同的 host 會被拒絕） |
| `DEMO_MAIL_PORT` | `8025` | Mailpit 介面埠 |
| `DEMO_BIND` | `127.0.0.1` | 綁定位址 |
| `DEMO_CONFERENCE_NAME` | 合成研討會名稱 | 首次發布前的顯示名稱與示範官網名稱 |
| `DEMO_ADMIN_EMAIL` | `admin@demo.invalid` | demo 管理員信箱 |
| `DEMO_PROJECT_NAME` | `confsys-demo` | Compose 專案名稱，可同時跑多份互不干擾 |
| `DEMO_SUBNET` | （未設定） | 例如 `10.231.78.0/24`；Docker 出現 “all predefined address pools have been fully subnetted” 時指定 |
| `COMPOSE_PROFILES` | （未設定） | 設為 `scanner` 時啟動 ClamAV（約 3 GB 記憶體，首次需下載病毒碼） |

範例：`DEMO_PORT=9090 DEMO_SUBNET=10.231.78.0/24 ./deploy/demo/demo.sh up`

## 限制

- 這是本機 demo，不是正式部署：未啟用 HTTPS，因此設定檢查只接受 `localhost`、`127.0.0.1`、`*.localhost` 這類本機網址；要讓其他機器連線需另行建置 HTTPS 反向代理並使用正式環境設定。
- 未啟用 `scanner` profile 時，上傳檔案會如實維持「掃描器無法使用」的隔離狀態。
- 示範資料只有官網內容與一位管理員；議程、投稿、報名等模組為空，可在介面中自行操作建立。
- 首次 `up` 需要建置應用程式映像，依機器速度約需數分鐘。
