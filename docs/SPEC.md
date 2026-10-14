# 可重複使用的研討會管理平台｜產品與工程規格

版本：0.3（單研討會部署與 Phase 1.2 本地權限）
日期：2026-10-15  
狀態：產品目標與工程契約；已實作範圍以 Phase 0、1.1、1.1b 與 1.2 交付證據為準，其餘仍待分階段授權與驗證。

## 0. 需求來源與決策界線

### 使用者已指定

- 建置完整研討會系統，提供的三張舊系統截圖作為功能基線。
- **不得沿用截圖的前端樣式或版面**；視覺與操作方式需要重新設計。
- 同一套軟體及部署模板可供多個研討會重複使用；每個獨立實例只服務一場。
- 核心技術：PostgreSQL、Redis、Node.js、Vite。
- 前期主要由 Codex 開發；後期才加入 Claude Code 優化前端。

### 本規格提出的實作預設

依使用者正式選擇 A，採一份程式碼、共同版本與部署模板，每場研討會獨立部署。帳號、Session、token、角色及業務資料均為實例本地資料；不做全域帳號平台或各會議專用 fork。前端補上 React／TypeScript，後端採 Fastify，資料層採 Drizzle ORM／node-postgres。這些是本提案的選型，不應描述成使用者原本已指定。

產品新增規則、狀態機、資安與驗收要求是本規格提出的設計，不代表能從截圖證明舊系統已具備這些機制。尚未確認的外部整合不得以假流程宣稱完成。

## 1. 產品定位與基本假設

核心是學術研討會的完整生命週期：建立會議 → 官網與徵稿 → 報名／投稿 → 審查與決議 → 議程與競賽 → 現場報到 → 收據／名牌／會後文件 → 封存與下屆複用。

第一版假設：

- 主辦單位可營運多場會議，但每場使用獨立實例；主辦單位是介紹／聯絡／收據資料，不是 Organization tenant。
- 同一 Email 可在不同實例分別註冊，帳號互不連結；不跨實例搜尋或同步。
- 預設語系為繁體中文及英文；每場會議可選擇啟用語系。
- 每場會議設定 IANA 時區與單一結算幣別，範例使用 Asia/Taipei 與 TWD，但不得寫死。
- 第一個可運作的收費流程以人工匯款／人工核帳為基線；線上金流供應商待確認，不假裝已有串接。
- 第一版現場報到採線上核銷；離線同步不是預設承諾。
- 使用者直接進入本研討會 hostname；沒有選組織／選會議入口。正式環境使用不同 hostname、HTTPS 與 host-only Cookie。
- 不先建置 SaaS 訂閱計費、直播平台、任意程式碼網站編輯器、任意工作流程引擎或 AI 自動決定論文錄取。
- 基本證書屬延伸功能，不要求第一版開發完整自由排版證書編輯器。

## 2. 建議技術棧

| 層級 | 選型 | 主要責任 |
|---|---|---|
| Web | React + Vite + TypeScript | 官網、參與者／作者／審查者入口、行政後台 |
| UI | Tailwind CSS + shadcn/ui | 新設計系統、表單、表格、對話框與可存取性基礎 |
| Routing / Data | React Router + TanStack Query | 路由、伺服器資料狀態、查詢快取與更新失效 |
| Forms / Contracts | React Hook Form + Zod；REST + OpenAPI | 型別、靜態 API schema、輸入驗證與契約 |
| API | 維護中的 Node.js LTS + Fastify + TypeScript | 模組化業務 API、授權、狀態轉換 |
| DB | PostgreSQL + Drizzle ORM + node-postgres | 權威資料、交易、關聯約束與 migration |
| Async | Redis + BullMQ + 獨立 Node.js worker | 郵件、匯出、PDF、檔案檢查、提醒 |
| Files | S3-compatible storage adapter | 私有稿件、簡報、匯出及列印文件；開發可用本地私有儲存 adapter |
| Testing | Vitest + Playwright | 單元、整合、契約及端到端測試 |
| Delivery | pnpm workspace、Docker Compose、GitHub Actions | 一致環境、驗證、建置及部署；容器需可配合 Coolify |

只採執行當時已確認受維護、非 beta／RC 的相容穩定版本。版本須寫入 lockfile、packageManager、Node 版本設定與映像標籤；不得盲用 `latest`。既有 repository 若已有其他選型，先提出差異 ADR，不得無聲重建或替換。

Vite 是建置工具，React 負責介面。[R1] Fastify 的路由驗證採 schema-based 機制；開發者維護的 API schemas 與使用者可編輯表單定義必須分開，不可把使用者提供的任意 schema／程式直接送進編譯式驗證流程。[R2]

## 3. 系統架構

採 **modular monolith + independent worker**，不是一開始拆成微服務。

```text
Browser
  → Reverse proxy / TLS
      → Web 靜態資產與公開頁面
      → /api → Fastify API
                 → Domain services → PostgreSQL
                 → Transactional outbox
                 → Redis cache / rate limits
                 → Private storage adapter

Outbox dispatcher → Redis-backed BullMQ → Node.js worker
                                         → PostgreSQL
                                         → Mail provider
                                         → PDF / export / file processing
                                         → Private storage
```

API 與 worker 共用同一組 domain services 與 repository 邊界，以不同 process／container 執行。Controller 只處理 HTTP 邊界，不塞完整業務流程；worker 不複製另一套繳費、寄信或授權規則。

PostgreSQL 是所有不可遺失業務狀態的權威來源。Redis 丟失／重啟後，系統應能從 DB 中的 outbox、任務與業務紀錄恢復處理，不以 Redis key 是否存在判定已繳費、已錄取或已寄達。

## 4. 單研討會部署與跨年度複用

### 4.1 部署邊界

同一 repository、版本及 images 可部署 A、B；各自有 Web、API、worker、PostgreSQL、Redis 與未來私有儲存。開發／測試各自 Mailpit。每個實例固定連到自己的服務，不依 request Host、header 或 conference ID 動態選 DB。API／worker 維持最小權限與 migration 身分分離；無 default organization／membership。

Compose project 隔離 network、volume 及服務命名；不得用固定全域 container_name、external 共用資料 volume 或把所有 DB／Redis 接到共享 proxy network。只有必要 ingress 接代理網路。各實例獨立資源仍共用宿主 kernel，不能視為 VM 等級隔離；宿主／Docker 管理者及資源耗盡風險需獨立管理。

### 4.2 各場會議設定

本輪只有經 server config 驗證的名稱與 canonical origin，公開 DTO 明確只含顯示名稱；同一 build 在 runtime 載入。正式可編輯會議設定／版本管理與 CMS 留待後續：Logo、主題色、聯絡資訊、時區、語系、日期、業務窗口、track／topic、費率、模板及公開範圍。不寫死學會、年份或活動日期。

### 4.3 下屆複用

部署全新實例。後續才開發白名單設定匯出／匯入：品牌、官網草稿、表單定義、票種／費率規則、topic、評分表及模板。匯入草稿須重新確認日期及產生 ID；不複製帳號、密碼 hash、Session、token、角色、參與紀錄、稿件、付款、通知、稽核或密鑰。不以完整 DB 複製初始化新會議。備份還原是同一場會議災難復原，與新實例初始化分開。

### 4.4 實例內安全

角色、資源擁有者、track 與審查指派仍須在後端授權。資料庫約束及適用的資源級 RLS 作縱深保護；runtime 非 owner／superuser／BYPASSRLS，交易 context 如有需要必須 transaction-local。worker 從可信 DB 工作載入當前資料並重檢政策；快取、檔案、匯出與下載不可只依前綴授權。不預建尚未採用的 tenant resolver 或把缺少授權視為放行。

### 4.5 Cookie、token、郵件

Cookie 不以 port 隔離，正式不同會議使用不同 hostname，不設父網域 Domain；HTTPS 使用 Secure／HttpOnly／SameSite 及 CSRF／Origin 檢查。開發 HTTP 只允許 loopback 或單層受控 *.localhost。Session／token 即使手動跨送另一實例也必須因本地 DB 無有效紀錄被拒。郵件 URL 僅由可信 server config 產生，不讀任意 Host／轉址輸入。

## 5. 帳號、角色與權限

### 5.1 身分與參與資料分離

User 是本實例帳號，可有本場報名、投稿與審查指派；未來外部登入 identity 也只屬於本實例。

使用者個人檔案、該場會議報名快照及論文作者資料不是同一張資料。更新個人資料不能無提示地改寫已發行收據、歷史作者單位或已發布議程。

共同作者可以是尚未註冊平台的人；不能因表單填入某個 email，就自動綁定該平台帳號或授予存取權。帳號連結與變更須經驗證／邀請接受。

### 5.2 預設角色

| 範圍 | 角色 | 邊界 |
|---|---|---|
| Conference | 會議管理員／秘書處 | 指定會議行政作業 |
| Conference | 財務人員 | 報名費、核帳、退款、收據；不因此取得匿名審查資料 |
| Conference / Track | 主席／分組召集人 | 被授權會議或 track 的指派與決議 |
| Assignment | 審查委員 | 僅獲派且可接受的論文及允許欄位 |
| Competition assignment | 競賽評審 | 被分配的口頭／壁報競賽與評分 |
| Conference | 現場工作人員 | 報到、名牌、餐券／活動核銷所需最小資料 |
| Own resources | 參與者／作者／報告者 | 自己有權管理的報名、稿件及文件 |

實作採 scoped roles + granular permissions + resource relationships。同一個本地帳號可在本會議兼作者與審查者，但不能自審或自行決議自己的論文。Phase 1.2 實作 conference_staff／conference_admin 固定角色與受控管理員初始化，正式矩陣見 PERMISSIONS；第一個公開註冊者不能自動成為管理員。先提供固定角色模板與明確 permission matrix，不在首輪開發任意權限規則 DSL。

### 5.3 登入與安全

使用 server-side opaque session，DB 保存 session token hash 與撤銷狀態。Cookie 為 host-only、Secure、HttpOnly、適當 SameSite；寫入請求另有 CSRF 與 Origin 驗證。不要把长期 bearer token 放 localStorage。session rotation／登出／密碼重設／權限撤銷均須可驗證。[R6]

密碼使用維護中的 library 處理 Argon2id 等合適雜湊，不自行設計密碼演算法。高權限帳號上線前必須有 MFA。邀請與密碼重設採短效、單次 token，不寄明文密碼。

作者 email 變更需確認新信箱、適當重新驗證與稽核。不得直接改 email 欄位就完成身分移轉。OIDC／校務 SSO 後續以 identity adapter 擴充，不因 email 相同而無條件連結未受信任的登入來源。

### 5.4 「模擬作者」

附圖有此功能，但新系統改為受控「作者視角預覽」：初期 read-only、顯示預覽橫幅、指定會議與資源、記錄 actor／subject／理由／時間；不取得作者密碼或真實登入 session。代為修改／代投稿另設明確的 delegated action 與稽核，不隱藏成作者自行操作。

## 6. 功能範圍

### 6.1 公開官網與內容

提供歡迎頁、會議介紹、主辦／承辦／委員會、重要日期、最新消息、徵稿說明、邀請演講、議程、交通住宿、贊助商、FAQ 與聯絡資訊。內容支援繁中／英文，具有 draft／published 與預覽。

以固定、安全的內容區塊組合與品牌變數提供差異化，不讓租戶注入任意 JavaScript／任意伺服器模板。公開頁面要有各會議獨立 title、description、分享 metadata、sitemap／canonical 設計；Phase 1 至少讓核心公開頁面能輸出可被抓取的 HTML，不把 SPA 路由存在等同 SEO 已完成。可採 Vite 配合受控預渲染或 server-rendered public shell，不因此換成另一套完整 Web framework。

### 6.2 個人工作台

顯示本會議報名、繳費、餐飲／活動、稿件、補件、錄取結果、發表時間與地點、待辦 deadline、可下載文件及最新通知。審查者看到受派任務，不混入無關的行政入口。

### 6.3 報名

支援身分／票種、早鳥與一般時段、報名名額、候補、必要欄位、限定型態的自訂欄位、名牌姓名／單位、同意事項、報名編號、資料異動及取消。

首版自訂欄位限文字、長文字、數字、單選、多選、日期、核取與說明；條件欄位採有限且安全的規則集合。核心識別、金額、權限等欄位不可被表單設定覆蓋。

表單有版本，正式送出的回答綁定版本。重複送出使用 idempotency key 與唯一約束防止同人同會議重複建立有效報名。名額與訂單狀態要在 DB transaction／鎖定或原子條件更新中處理，不靠 Redis lock 單獨決定。

### 6.4 費用、付款、團體繳費、退款與收據

區分 Registration、Order、OrderItem、Payment、PaymentAllocation、Refund 與 Receipt。

- 每筆訂單限同一研討會、單一幣別；伺服器計算價錢，建立後保存價格與規則快照。
- 金額以最小貨幣單位整數或合適 exact numeric 保存，不用 JavaScript 浮點加總；API 明定序列化方式。
- 人工匯款：參與者提交參考資訊／憑證，財務確認後建立可稽核的付款與分配紀錄。上傳憑證不等於已繳費。
- 團體繳費：付款負責人不等於所有參加人；一筆付款可分配到多筆本會議訂單，有部分付款、未分配款與取消的明確規則。
- 個人可付金額、分配總額、退款可退金額等以 DB 不變條件與交易保護。
- 取消報名、取消訂單、退款是不同操作；保留歷史，不刪除已發生金流事件。
- 收據編號在設定的會議／發行主體範圍唯一；保存發行快照，重印同版本不重開新號；更正／作廢／重開保留關联與理由。
- 本規格的收據不是承諾已符合任何特定電子發票制度；正式格式與法規／校務流程必須由主辦單位確認。
- 金流 adapter 未選定時僅完成介面與人工核帳，不宣稱信用卡可用。接入後 webhook 必須驗簽、驗金額／幣別／歸屬、去重；不能相信前端付款成功 redirect。

### 6.5 餐飲、宴會與附加活動

每個日期／活動有獨立項目、截止時間、名額、費用及餐食類型。支援午餐、茶會、晚宴、眷屬或加購票、領取狀態與統計。截止後變更需行政權限及理由，已下訂／已領取數量不得被一般表單修改覆蓋。

### 6.6 投稿

支援摘要或完整論文模式、題目、摘要、關鍵字、主題／track、作者順序與單位、通訊作者、報告者、口頭／壁報偏好、附件、簡報 PDF、影片連結、競賽意願、草稿、預覽、正式提交、修訂與撤稿。

投稿人、作者、通訊作者、報告者分開建模。預設可以要求以報告者帳號送出，但這是會議設定，不是所有會議通用硬限制。報告者變更經驗證與授權，並檢查是否影響參賽資格與議程。

版本資料應不可變；每次正式提交／補件留下 SubmissionRevision，審查與結果引用對應版本。單純儲存草稿不等於正式投稿。投稿不必與繳費綁死，可依會議規則設定「投稿時需報名」或「錄取後需在 deadline 前完成報名」。

檔案上傳成功也不等於提交成功；正式提交檢查附件完成、檔案安全狀態、必填欄位與截止時間。

### 6.7 論文審查與總編／主席決議

支援行政初檢、指派、委員接受／拒絕、利益衝突申報、工作量、催審、版本化評分表、評語、草稿與送出、補件、最終決議、批次結果通知及審查統計。

提供單盲／雙盲等會議模式。匿名性必須涵蓋 API response、檔案、檔名、metadata、郵件與匯出，不只隱藏 UI 姓名。雙盲模式應要求作者提供合規匿名稿並由流程確認；不得宣稱能可靠自動去除所有 PDF／文字身分線索。

分組召集人只能處理獲授權 track。利益衝突不能只警告；需要禁止不合規的指派／評分／決議與可稽核例外流程。作者身分、同組單位與人工申報可作衝突訊號，但不承諾自動找出所有衝突。

未公開的審查分數、內部評語與暫定結果不可出現在作者端、公開 API 或預先寄出的信件中。改決議需產生新版本與理由，不覆蓋舊決議。

### 6.8 口頭／壁報競賽

競賽報名、資格審核、類別、評審指派、獨立評分表、評分鎖定、缺評提醒、總分、同分處理、人工確認與得獎名單草稿／發布。論文 peer review 與競賽評分是不同模組、不同權限。

不將分數最高者自動公告為得獎者；須有明確決議與發布步驟。評審不能評自己或有利益衝突的作品。

### 6.9 議程

管理日期、會場、session、主持人、邀請講者、oral slot、poster number、發表資料與排序。排程檢查會場重疊、報告者撞期、主持人撞期及不相容的時段條件。預留緩衝／不可排時段設定。

行政端先有可用表單與表格，再做拖拉；衝突判斷必須在後端，不只在 drag-and-drop UI。議程具有 draft／published snapshot；每次發布有版本與變更通知，修改草稿不能直接改壞公開議程。

### 6.10 現場與列印

名牌／識別證模板、批次 PDF、報到 QR code、工作人員查詢、報到、活動入場與餐券核銷。QR 不放明文個資，也不作成可存取完整帳號的登入憑證；掃碼者仍需具備該會議核銷權限。

相同資源重複掃描應回傳既有結果，DB 唯一約束防止重複核銷。撤銷核銷需權限、理由與稽核。

### 6.11 郵件與通知

邀請、信箱驗證、密碼重設、報名確認、核帳結果、繳費提醒、投稿確認、審查邀請、補件／錄取通知、議程異動及活動通知。

提供依會議與角色／狀態篩選受眾、收件預覽、模板版本、排程、寄送進度、provider message ID、失敗與退信紀錄。舊畫面的「郵件備份」重新定義為可稽核的通知紀錄／必要內容保存，不默認要備份整個外部信箱。

每個實例獨立設定並驗證本會議寄件身分；From、Reply-To、envelope sender 各自明確。只有已被郵件服務／管理員政策授權的寄件身分可啟用；填入網域或 DNS 設定存在不等於一定能從該地址寄信。密鑰不得送到前端或出現在日誌。

Dev／CI／Preview 使用郵件捕捉服務或 allowlist，不對真實參與者寄信。SMTP／provider 回覆接受只標記 submitted／accepted，不宣稱已送達收件匣；delivery／bounce 以可取得的供應商事件為準，無事件則維持未知。

### 6.12 統計、匯出與稽核

按會議／日期／身分統計報名、費用、核帳、團體付款、餐飲、投稿、審查進度、口頭／壁報、競賽、報到與通知。定義每個指標包含哪些狀態與資料時間點。

匯出 CSV／必要時 XLSX；Email 清單視為個資匯出，需特定權限、欄位限制、用途與稽核。大量匯出走背景任務，下載權限在建立任務與實際下載時都重新檢查。防止 CSV formula injection。

網站瀏覽統計預設為會議級聚合統計，不追蹤使用者個人閱讀行為；實際 analytics 與同意／保存政策待組織確認。

## 7. 狀態機與不可破壞的規則

不同維度分開，不能用一個 `status` 同時表示投稿、錄取、競賽與繳費。

| Aggregate／維度 | 建議狀態／模型 |
|---|---|
| Conference | draft → published → archived；各業務窗口另行設定 |
| Registration | draft／submitted／waitlisted／confirmed／cancelled；confirmed 條件由會議規則定義 |
| Order | open／cancelled／closed；應付、實付、可退金額由帳務紀錄計算 |
| Payment attempt | pending／succeeded／failed／cancelled；退款另建紀錄 |
| Submission | draft／submitted／under_review／revision_requested／revised／withdrawn |
| Review assignment | invited／accepted／declined／in_progress／submitted／revoked |
| Decision | undecided／accepted／rejected，另有 draft／published 與 decision version |
| Presentation | preference 與 assigned_type 分開；assigned_type 可 oral／poster |
| Competition entry | not_entered／requested／eligible／ineligible／withdrawn；結果另發布 |
| Program | draft version／published version |
| Notification | pending／processing／provider_accepted／delivered／failed／unknown；依 provider 能力處理 |

上述表列的是模型方向，不是允許任意跳轉的清單；各 phase 須補上合法 transition、授權、前置條件、可逆性及測試。

特別規則：

- Draft 不等於 Rejected；尚未正式投稿不能顯示為審查不通過。
- 審查決議、公開結果與是否寄出通知分開記錄。
- 一般截止時間以 server time 和半開區間 `opens_at <= now < closes_at` 判定，設定與 UI 清楚顯示時區。
- 定義提交判定點並測試邊界；不因 browser 時鐘或開始上傳時間在截止前就自動接受截止後的送出。
- 延期／重新開放需權限、理由、時間範圍及稽核，不直接從資料庫亂改狀態。
- 重複 HTTP request、重送 webhook、worker retry、重複掃碼不新增第二次業務結果。
- 已發布／已發行結果引用不可變的設定／資料版本，而非隨設定修改而漂移。

## 8. 檔案與背景工作可靠性

### 8.1 檔案

DB 保存 FileAsset metadata、資源關聯、owner、用途、storage key、size、checksum、檔案版本、安全檢查狀態與公開狀態；bytes 放儲存服務。

限制檔案大小／數量、允許類型、實際內容與用途；不相信副檔名或瀏覽器 Content-Type。使用 server-generated key，私人稿件不存 public webroot；上線前需完成適當的掃描／隔離措施。外部服務掃描不得擅自外送保密論文。[R7]

檔案屬於 uploading／quarantined 時，不允許一般下載或正式引用。私有檔案經 API 授權後短效下載；高度敏感文件可使用受控代理。不能把無限期 public URL 當權限設計。短效簽名 URL 在到期前仍可被持有人使用，其限制須記入 threat model。

影片連結先只保存與顯示受允許的 https URL，不預設從任意 URL 後端抓取。未選定的第三方影片平台只做連結功能，不假裝完成影片上傳／轉碼。

### 8.2 Outbox／worker

業務提交與 OutboxEvent 在同一 DB transaction 保存；dispatcher 重試投遞 BullMQ，worker 以穩定的事件／業務 idempotency key 做去重。不要把 DB commit 和 Redis enqueue 當作原子操作。

每種 job 有明確 retry policy、backoff、attempt count、timeout、失敗狀態、人工重試與 audit；payload 以 ID 為主，避免放整份個資或機密內容。

BullMQ job 需要可重試與冪等。[R8] 外部寄信／金流不能僅憑 job ID 宣稱 exactly-once：外部成功、內部尚未記錄的中斷要透過 provider idempotency／查詢／對帳處理；純 SMTP 無法確認時保留 unknown 狀態，避免無限自動重寄。

作業執行前檢查最新狀態與授權／系統工作政策，避免向已撤銷結果、取消活動或錯誤資源擁有者寄出舊通知。

### 8.3 Redis 用途與部署

`redis-queue` 供 BullMQ，採持久化、記憶體監控與 `maxmemory-policy=noeviction`；BullMQ 官方明確不支持 queue keys 被任意 eviction。[R9]

`redis-cache` 供可重建快取／限流；正式環境與 queue 分開 instance。不同 logical DB number 仍共用實例記憶體／eviction，不當成真正隔離。開發可共享單一 noeviction instance，但正式部署需保持清楚分工。

cache key 依功能含 locale／版本；私人資料另含 subject／permission version。不同實例不共用 Redis；登出及撤權不能留下可用的私人資料頁面。

Redis queue 不可用時，可在 PostgreSQL 已可靠保存 outbox 的前提下回報已接收業務、通知待處理；不能回報「已寄信」。登入限流等安全依賴故障需明定 fail-safe 行為，不能全域無條件放行。

## 9. 資料模型模組

以下是規劃範圍，不要求 Phase 0 預先建立全部表。

| 模組 | 核心 entities |
|---|---|
| Identity | User、AuthIdentity、Session、Invitation、VerificationToken |
| Local access | 本地 RoleBinding、固定 Permission（Phase 1.2）；Resource relationship 待其業務單元 |
| Configuration / CMS | ConferenceSettingsVersion、DeadlineWindow、FormDefinitionVersion、Page、PageRevision、News、Sponsor |
| Registration | Registration、RegistrationAnswerSnapshot、TicketType、PriceRule、CapacityReservation |
| Finance | Order、OrderItem、Payment、PaymentAllocation、Refund、Receipt、ReceiptRevision |
| Activities | Activity、MealOption、ActivitySelection、Redemption |
| Submission | Track、Topic、Submission、SubmissionRevision、SubmissionAuthor、PresenterAssignment |
| Review | ReviewRound、ReviewAssignment、ConflictDeclaration、ReviewFormVersion、Review、ReviewDecision |
| Competition | Competition、CompetitionEntry、JudgeAssignment、RubricVersion、Score、Award、AwardPublication |
| Program | Venue、Room、SessionBlock、ProgramSlot、ProgramPublication |
| Operations | CheckIn、BadgeTemplate、DocumentJob、CertificateTemplate／Certificate（後續） |
| Infrastructure | FileAsset、OutboxEvent、JobExecution、Notification、NotificationAttempt、SenderIdentity、AuditLog |

內部 UUID 與人可讀的報名／稿件編號分開。人可讀編號以會議範圍唯一產生，避免 `count + 1`；取消後不任意重用。所有涉及業務不變條件的 unique／foreign key／check constraint 都要在 migration 與測試中驗證。

可擴充問卷答案、主題及模板配置可以使用 JSONB，但費用、參與者關聯、付款分配、審查指派等核心關係不要全部塞進單一 JSON 欄位。

## 10. 前端重新設計與協作邊界

### 10.1 新介面原則

- 公開官網以品牌、重要日期、徵稿／報名 CTA 與可搜尋議程為主；不沿用舊表格首頁。
- 參與者首頁是任務／狀態工作台，不是堆滿全部行政選單。
- 行政後台採側邊導覽、清楚的本會議識別、篩選表格、批次操作、側邊詳細資訊／編輯表單。
- 審查工作台將稿件閱讀、評分、評語、儲存／送出、截止時間與利益衝突放在同一條明確流程。
- 本會議識別持續可見；登出／撤權清除私人表單、快取與批次選取，拒絕晚到回應恢復私人資料。
- 具備 loading、empty、error、retry、permission denied、session expired、deadline closed 與 unsaved changes 狀態。
- 使用鍵盤可操作的語意元件、清楚 focus、表單 label、錯誤關聯與不只靠顏色的狀態提示；以 WCAG 2.2 AA 為驗收目標，但不得未測試就宣稱完全符合。
- Codex 階段必須已是可操作、接真 API 的介面。Claude Code 進場是改善資訊架構／視覺／互動，不是補做全部功能前端。

### 10.2 Repository 建議

```text
apps/
  web/src/
    app/                 # 路由、providers、shell
    features/*/
      hooks/             # Codex：資料、mutation、view model
      components/        # 後期 Claude：呈現元件
    design/              # tokens、布局、視覺規範
  api/src/modules/       # Codex：HTTP、service、policy、repository
  worker/src/            # Codex：dispatcher、jobs
packages/
  contracts/             # Zod schemas、DTO、errors、OpenAPI source
  sdk/                   # typed API client
  ui/                    # 純 UI；不得依賴 sdk／db
  db/                    # schema、migrations、transaction helpers
  domain/                # 可共用狀態機／業務規則，無 Web UI 依賴
  config/                # lint／TypeScript 共用設定
infra/
docs/
  SPEC.md
  ARCHITECTURE.md
  PERMISSIONS.md
  UI_CONTRACT.md
  DATA_CONTRACT.md
  TESTING.md
  ROADMAP.md
  adr/
```

可依規模合併薄封裝，不能為了資料夾數量增加無用抽象。contracts 不能匯入 DB model 直接當 response；匿名審查、財務與公開頁面需各自明確 DTO projection。

### 10.3 Codex／Claude Code

Codex 擁有 API、DB、domain、授權、資料 hooks、SDK、session、tests、CI／部署。Claude Code 後期擁有 UI components、tokens、CSS、layout、動畫與可存取性改善。

Presentation components 只接 props／view models 和 callback，不直接 fetch、讀 token、改 permission policy 或接 ORM。API 的授權永遠不依賴前端權限判斷。

Claude 進場前先 read-only audit 並提交改造方案；契約改動由 Codex 先／同步受控調整，不讓兩個 agent 在同一工作目錄同時改同一接合面。每個 agent 使用獨立 branch／worktree，遵守 ownership 與 review。

## 11. 交付與 CI/CD

採 GitHub Flow：feature branch → commit／push → PR → CI／可用時 preview → review／修正 → 經核准 merge main → production deployment。

- Conventional Commits；不得未授權自動 merge。
- CI 至少有 lint、typecheck、unit tests、DB／Redis integration tests、contract checks、build；可操作頁面加入 Playwright E2E。
- 必要檢查同時覆蓋 PR 與 main，避免 squash merge 後 main 無任何驗證。
- 權限／實例隔離測試為 merge gate，不是選做。
- 開發使用 Docker Compose；API／worker 依賴 readiness，容器有非 root 執行、資源限制及 graceful shutdown。
- PostgreSQL／Redis 不直接暴露公網；預設不把 production secrets 寫入 `.env.example` 或映像。
- preview 與 production 的 DB、Redis、storage、寄信設定完全隔離；preview 不跑真實金流、不寄真實批次信。
- migration 為獨立受控步驟，不由每個 API replica 同時執行；大變更採相容的 expand／contract 演進。
- 維運包含 structured logs／request ID、queue backlog、失敗率、DB／storage 容量、備份與實際還原演練。
- 上線前由主辦單位確認保存／刪除政策、RPO／RTO 目標與聯絡窗口。備份成功不等於還原已驗證。
- 負載測試規模與效能門檻依實際報名／投稿量訂定；未量測不可宣稱支援某個人數或 TPS。

## 12. 分階段開發與驗收

每一 phase 都包含正式資料、UI、驗證、錯誤處理、授權、稽核及文件；功能未實作的頁面不能用假資料讓人誤認完成。大 phase 拆成多個可 review PR。

### Phase 0：工程底座與架構契約

完成 repository 盤點、ADR、workspace、Web／API／worker 最小可啟動程式、DB／Redis／郵件捕捉開發環境、健康檢查、CI、contracts 基礎及 ownership 文件。

Phase 0 曾有測試專用 tenant-context／RLS 範例；Phase 1.1b 退役未採用的租戶示範。保留實際 runtime 最小權限、交易回滾／pool reuse／FK 測試，並以雙部署測試驗證目前隔離邊界；不宣稱範例等於真實資源授權。

交付：乾淨 clone 可啟動、實際執行驗證指令、API／worker readiness、真實 PostgreSQL／Redis 整合測試、版本鎖定與 Phase 1 計畫。完成後停止，未經確認不開始 Phase 1。

### Phase 1：本地帳號、權限、會議設定與基礎官網

1.1 已實作註冊／驗證／登入／登出／重設、Session、CSRF、audit／outbox／worker／Mailpit。
1.1b 已校正單研討會獨立部署、runtime 名稱及雙實例隔離，保留既有安全回歸。
原 membership／scope resolver 計畫取消。1.2 本輪實作本研討會固定角色與帳號管理權限、可稽核的一次性 CLI 管理員初始化、角色授予／撤銷、停用／恢復、Session 撤銷及近期密碼驗證；未來稿件等資源權限留待相應業務單元；不得以第一個公開註冊者取得權限。管理員 MFA 仍為上線門檻。
後續再實作版本化會議設定、基礎公開內容、邀請與私有檔案框架。只用合成資料；公開投影不含私人資料，角色撤銷與資源 ID 替換應被拒絕。不同實例帳號／Cookie／Session／token／worker／mail／資料隔離需實測。

### Phase 2：報名、費率、人工核帳、團體繳費與餐飲

完成個人工作台、報名表、版本化規則、費率快照、訂單、付款分配、人工核帳、取消／退款紀錄、餐飲／活動、基本收據。

驗收：早鳥邊界、名額競爭、重複送出、團體部分付款、跨實例資料不可引用、退款上限、收據重印／作廢與行政紀錄。人工核帳端到端可用；外部金流未選定則仍明列未完成。

### Phase 3：投稿與版本／檔案

完成作者、共同作者、報告者、track／topic、稿件草稿／提交／修改／撤稿、簡報與影片連結、必要的競賽意願欄位及上傳安全。

驗收：草稿不誤判拒稿、deadline 邊界、版本不可變、私有檔案依本地資源權限隔離、非作者不可編輯、投稿與報名關係符合會議設定。

### Phase 4：審查與決議發布

完成審查者工作台、利益衝突、指派與接受、評分表、評語／補件、主席決議、正式發布與結果通知。

驗收：自審被阻止、track scope、雙盲 DTO／檔案／匯出、舊版／新版審查引用、結果發布前保密、重試不重複建立決議。

### Phase 5：議程與口頭／壁報競賽

完成会場、時段、排程、衝突檢查、已發布議程版本、poster number、評審指派、競賽評分、得獎名單發布。

驗收：報告者／會場撞期、草稿不污染公開議程、評審 scope、資格與同分規則、未發布名單不外洩。

### Phase 6：現場、批次作業與完整行政功能

完成報到、餐飲／活動核銷、名牌／批次 PDF、通知中心、批次寄信、進阶收據管理、統計／Email 清單與大型匯出、受控作者視角預覽。基本證書可以作本階段後續子項，未實作則不計為完成。

完成選定的外部郵件／付款 adapter 整合與 sandbox 驗證；未選定供應商不阻止其他功能，但正式對外收費／寄信前必須解除該阻擋項。

驗收：重複掃碼、worker 中斷／重試、Redis 復原、匯出下載撤權、真實 provider sandbox、寄送 unknown／bounce 邊界及匿名審查保密。

### Phase 7：Claude Code 介面優化與上線驗證

先 read-only UI／UX audit，接著獨立 UI PR：官網、後台、工作台、審查流程、手機版、鍵盤操作與視覺一致性。Codex 保持 core ownership 並做 regression／contract review。

最後以真實流程演練報名至現場結案，完成備份還原、負載、寄信、資安、權限、跨實例與桌機／行動裝置驗證。安全與測試從 Phase 0 持續進行，這一階段不是第一次做資安。

## 13. 核心驗收矩陣

| 情境 | 期望 |
|---|---|
| A Session／token 手動傳到 B 實例 | 本地 DB 沒有有效紀錄，拒絕；A token 不被消耗 |
| 本會議工作人員讀取無權限稿件 | 即使同一實例仍拒絕，不洩漏資源細節 |
| 審查者也是投稿作者 | 自己或有衝突稿件不得被指派／自評／自行決議 |
| 同一表單重複按送出 | 一筆業務結果，回傳一致的 idempotent response |
| 兩人競爭最後一個名額 | 至多一人取得名額，另一人依規則候補／拒絕 |
| 付款 webhook 重放 | 不重複認列付款／開收據 |
| 團體款跨會議分配 | 拒絕，交易不留下半套狀態 |
| 論文仍是草稿 | 顯示未提交，不顯示審查拒絕 |
| 修改投稿檔案 | 產生新版本；既有審查可追溯原版 |
| 決議已存但尚未發布 | 作者／public API／mail 不看到結果 |
| 投稿截止時 browser 時鐘錯誤 | 以 server／會議時區規則判定 |
| 偽装副檔名／超大檔案 | 被拒絕／隔離，不變成公開內容 |
| 決議通知 worker retry | 不重複建立業務事件；外部不確定送信狀態可追蹤 |
| QR code 再掃一次 | 顯示已核銷，不新增第二次核銷 |
| 重印收據 | 原號碼與原內容快照；新更正有明确歷程 |
| 下屆部署新實例 | 日後只匯入白名單設定草稿，重確認日期；無帳號／Session／稿件／付款／密鑰 |
| 撤銷使用者權限後下載匯出 | 重新授權並拒絕，既有短效 URL 限制已文件化 |
| 從備份還原 | 在隔離環境實際驗證資料、檔案引用與必要金鑰可用 |

## 14. 每次 Codex 交付格式

1. 分支、commit 與本次 phase／範圍。
2. 實作內容與可操作的使用流程。
3. migration／API／契約／環境變數變更。
4. 實際執行的指令、結果與失敗原因；未執行的明列未驗證。
5. 權限／實例隔離／狀態機／重試的驗證證據。
6. 截圖或 preview（環境允許時），但截圖不取代端到端驗證。
7. 已知限制、阻擋項、未選定供應商、下一個最小工作單元。
8. 未經授權不得 merge／部署 production／寄真信／操作真金流。

## 15. 尚待確認，但不阻擋 Phase 0 的問題

最大預估報名／投稿量、部署主機與機房政策、外部寄信方式、線上金流供應商、正式收據格式、是否需校務／學會 SSO、自訂網域、第一場會議時程、匿名審查規範、論文公開授權與資料保存年限。

在未確認前使用本文件預設並記錄 assumptions；碰到會影響真實資料、外部費用或安全界線的決策才升級確認，不自行捏造機構政策。

## 16. 技術參考

以下官方文件用於確認工具能力與安全邊界；本文件的業務設計與驗收條件是專案提案。

- [R1] React／Vite：`https://react.dev/learn/build-a-react-app-from-scratch`、`https://vite.dev/guide/`
- [R2] Fastify validation：`https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/`
- [R3] OWASP Authorization：`https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html`
- [R4] PostgreSQL Row Security：`https://www.postgresql.org/docs/current/ddl-rowsecurity.html`
- [R5] OWASP Multi-Tenant Security：`https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html`
- [R6] OWASP Session Management：`https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html`
- [R7] OWASP File Upload：`https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html`
- [R8] BullMQ Idempotent Jobs：`https://docs.bullmq.io/patterns/idempotent-jobs`
- [R9] BullMQ Production：`https://docs.bullmq.io/guide/going-to-production`
- [R10] Drizzle Transactions／RLS：`https://orm.drizzle.team/docs/transactions`、`https://orm.drizzle.team/docs/rls`
- [R11] Node.js release policy：`https://nodejs.org/en/about/previous-releases`
- [R12] Codex AGENTS.md：`https://developers.openai.com/codex/agent-configuration/agents-md`
