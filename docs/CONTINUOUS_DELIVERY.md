# 連續開發交付與中斷收尾 — 2026-10-15

## 時間、基線與實際狀態

- 工作樹：`/Users/fearnot/Desktop/confsys-phase-1-4-to-6-continuous`。
- 分支：`codex/phase-1-4-to-6-continuous`；起始基線9642a62（包含d4c0788）。開始06:08:11 Asia/Taipei。
- 授權截止10:00 Asia/Taipei（02:00Z），沒有延長。
- 最後可見開發操作約08:37：0059/0060已套用合成測試資料庫，相關測試開始，但未取得結束結果。其後子代理工具回報額度限制；不能宣稱中斷期間持續工作或在10:00完成交付。
- 使用者再次接續時，真實時鐘為14:05:13。此後僅保存既有成果、檢查型別及製作本交付，未開始新功能。收尾時間見CONTINUOUS_RUN。
- 最後完整通過的程式基線：593bab1。其後8cdf17d批次結果發布、ab02937撤銷指派、b3b273c掃描稽核競態、d833ca2報名資料庫防護及0059/0060，具有不同程度的驗證，不能套用舊完整通過結論。

## 各 Phase

| 範圍 | 已實作與實際證據 | 剩餘／限制 |
|---|---|---|
| Phase1剩餘 | 私有檔案、實際內容檢查／ClamAV、安全下載／媒體、角色邀請；完整基線及跨實例通過。後續掃描競態6/6真PG＋ClamAV通過 | 最新整合版本未再完整回歸；正式S3未配置 |
| Phase2 | 報名、版本化表單／費率、候補、訂單、人工核帳、團體分配／退款紀錄、餐飲活動、收據及更正歷程；完整基線含瀏覽器核帳流程 | 0059資料庫容量／設定權限防護已套用，但中斷前針對性測試未取得結果；線上金流未配置 |
| Phase3 | 作者／報告者、track/topic、草稿、正式提交、修訂附件、撤稿、作者／行政工作台、報告者同意與核准；完整基線通過 | 狀態／track／標題或編號列表篩選尚在代理工作樹未整合；不計完成 |
| Phase4 | 指派、衝突、評分、內外評語、初檢、補件、主席決議、發布通知、輪次及期限修訂；593bab1通過，後續第二輪browser通過 | 批次發布與指派撤銷已整合，靜態／契約檢查通過，但新增整合與browser未取得完成結果；自動到期催審未實作，已有明確人工操作 |
| Phase5 | 議程、場地／人員衝突、緩衝、公開快照、個人議程、競賽資格、評分與名單發布；基線及實際跨模組service流程通過 | 同時段壁報目前依開始時間／ID排序，壁報號排序尚未修補；0060評分終態資料庫防護尚未取得測試結論 |
| Phase6 | QR報到／核銷、名牌模板／批次PDF、通知受眾預覽／模板／排程／重試、統計、Email／背景CSV、收據管理、網站內容、受控作者預覽；完整基線通過 | 最新整合完整回歸待跑；基本證書與設定白名單匯入匯出為既定延伸項，未實作不計完成；未承諾XLSX已有實作 |

**整體為多 Phase 核心已驗證、最新增量仍待驗證的交付；不是完整 Phase6 完成或 production-ready 宣告。**

## 操作入口與主線

本輪合成設定：`http://continuous-20261015.localhost:56179`，API54000、worker54001、PostgreSQL56442、Redis57392、Mailpit59032／SMTP52032。實際服務是否啟動須以本輪compose／health為準；沒有對外部署。

沿用Node24.21.0／pnpm10.34.7（本機工具`/tmp/confsys-tools/node_modules/.bin`）。先讀README及TESTING。自己的合成環境可用`pnpm infra:up`、獨立`pnpm db:migrate`及`pnpm dev`；安全掃描還需已記錄的本地ClamAV，不能以假掃描取代。不要在原工作樹執行這些設定或對既有環境套用本輪資料。

- 官網`/`；帳號`/auth/account`；帳號權限`/access/accounts`；官網管理`/admin/site`。
- 報名`/registration`，財務催繳`/finance/reminders`，收據`/receipts`及`/admin/receipts`。
- 投稿`/submissions`，審查／主席結果`/reviews`。
- 公開議程`/program`、行政議程`/admin/program`；其他競賽／現場／通知／匯出由登入後工作台的授權入口進入。
- 合成帳號透過真註冊／Mailpit驗證建立；首次管理員沿用`admin:bootstrap`受控CLI，無預設公開密碼。財務、主席、評審、現場角色必須明確授予，管理員不代表所有業務角色。

主線service整合已真正串通：報名付款→人工核帳→真掃描稿件→審查決議→議程競賽→QR核銷→PDF／CSV。單一參與者全程browser案例已建立，但首次在投稿設定因期限相等遭INVALID_REQUEST；修正設定為投稿截止後一天，修正後尚未重跑，不能稱該新browser通過。

## 精確驗證與證據

以下命令在主工作樹、上述Node/pnpm PATH及本輪私有.env執行；未列者不代表已通過。

| 命令／基線 | 實際結果 |
|---|---|
| `pnpm check`，593bab1，08:22–29 | lint／import boundaries、typecheck、70 unit、190 integration、16 contract、build、27 Chromium E2E全部通過（E2E5.2分鐘） |
| `pnpm db:migrate:test && node --env-file=.env node_modules/vitest/vitest.mjs run tests/integration/reviews.test.ts tests/integration/competitions.test.ts`，0058 | 32/32通過，08:29 |
| `pnpm build && pnpm test:e2e tests/e2e/participant-lifecycle.spec.ts tests/e2e/reviews.spec.ts` | build通過；第二輪reviews1通過、participant lifecycle1失敗（設定期限）；後續4b9af68修正，未重跑 |
| `pnpm lint && pnpm test:contract`，批次發布增量 | lint及17契約通過；不代表PG/browser通過 |
| `pnpm typecheck && pnpm contract:generate && pnpm test:contract`，含撤銷契約 | typecheck及17契約通過，08:35 |
| files代理`node --env-file=.env node_modules/vitest/vitest.mjs run tests/integration/files.test.ts` | 6/6真PG／ClamAV通過；另files unit4/4、指定ESLint／typecheck通過，fc2bf1d→主b3b273c |
| `pnpm db:migrate:test && node --env-file=.env node_modules/vitest/vitest.mjs run tests/integration/reviews.test.ts tests/integration/competitions.test.ts tests/integration/registration.test.ts` | 0059／0060套用成功；測試開始後中斷，恢復時process ID不存在，結果未知 |
| `pnpm test:instances --native-scanner --scanner-port 53310 --restore-fixtures --image confsys:p6-881b7181` | run25868fe4通過；image僅到0053，不是最新整合版本 |
| `node --conditions=development --import tsx scripts/backup-drill.ts --source-env .instances/25868fe4/a.env --validate-only`，再去掉`--validate-only` | restore6e7a3772通過；1私有檔／引用、2生成PDF／CSV、1加密郵件、1有效QR；表／序列／migration一致，真app／worker RLS與claim隔離通過 |

本輪PDF已渲染檢視：繁中姓名／單位、收據歷程、卡片／大型名牌及QR無明顯裁切。生成檔`output/pdf/synthetic-qr-badge.pdf`保留於主樹未追蹤檔案。這不是完整WCAG或印刷廠認證。

## 模型、契約、設定及依賴

- 向前migration0006–0060；原0001–0005及既有歷史保留，未用清空DB升級。主庫未自動宣稱已套用最新版本；測試庫已觀察到0060套用。最新readiness要求0060。
- 主要領域表：私有檔案與引用、邀請、報名設定／價格快照、訂單／付款／分配／退款、收據修訂、稿件修訂、審查表／輪次／決議／發布、議程快照、競賽評分、核銷、文件／匯出工作及通知批次。詳細增量見DATA_CONTRACT與migration本身。
- 單一`@confsys/policy`權限來源；REST／SDK／hooks／presentation同步，OpenAPI已生成。0059設定權限獨立於一般報名管理，0060撤銷歷程不可變。
- 本地私有storage、ClamAV、QR簽章及文件／匯出worker沿用集中config驗證與.env.example；實際secret只存私有未追蹤env，不在報告公布。Mailpit而非真郵件、人工核帳而非假金流。
- 新增sharp0.35.5、pdf-lib1.17.1、@pdf-lib/fontkit1.1.1、qrcode1.5.4的用途與取捨記於ADR0006。最近批次發布／撤銷／容量防護沒有新增依賴。
- ClamAV1.5.4已驗證官方套件並在本輪.tools中使用；Docker記憶體不足時採native override，未更動既有容器或全域安裝。

## 可維護性檢查

1. handler保留輸入／回應邊界；service負責授權、規則與交易；repository負責SQL。批次與單筆結果發布共用同一helper，publication persistence移入repository。SDK管理網路、hooks管理伺服器資料、presentation只接props／callbacks。
2. 未新增第二套授權registry、金額引擎或CMS。0059／0060的DB約束是必要縱深保護，需與service規則一起維護並以真PG回歸驗證；未額外新增依賴。
3. 測試與DATA_CONTRACT／OPERATIONS／CONTINUOUS_RUN同步。最後完整通過593bab1；之後的未驗證增量在上表明列，不以舊結果替代。
4. 已知風險：高權限MFA、TLS／proxy／金鑰輪替、留存政策、正式供應商、負載與完整可存取性仍是上線前事項。全域行政鎖之吞吐量未量測。Docker共享宿主曾OOM及network pool耗盡，功能通過不能推論容量。

## 未完成清單與恢復順序

1. 先對最新0059／0060及批次發布／撤銷重跑上述範圍PG測試，診斷修復後再完整gate；不要直接宣稱可發布。
2. `/Users/fearnot/Desktop/confsys-continuous-invitations/tests/integration/registration-authority.test.ts`仍為未提交新測試，尚未整合／驗證；保留工作樹。
3. `/Users/fearnot/Desktop/confsys-continuous-submissions`的投稿filters source/contracts/UI/tests仍未提交，保留且未整合；先review契約再整合，不能漏掉原有測試。
4. 重跑修正後participant lifecycle browser及新增batch/revoke browser；再執行`pnpm check`。
5. 最新image重新執行雙實例／容器smoke／升級與還原驗證；現有25868fe4／6e7a3772只證明較早0053image。
6. 壁報同時段的號碼排序、自動deadline偵測／催審仍未實作；基本證書與下屆設定匯入匯出依既定延伸分類，未宣稱完成。

## 環境與資料保護

未push、未merge到main或其他既有分支、未production部署、未寄真信／操作真金流／付費服務。原工作樹與既有使用者資料沒有修改。只使用本輪可識別的合成環境。

雙實例25868fe4與restore6e7a3772已停止，volumes／evidence保留；早先失敗本輪資源有受控移除container/network以解決network pool不足，未加`-v`且未清除原有資料。14:08收尾核對`pnpm compose ps --format json`：本輪PostgreSQL、Redis、Mailpit仍healthy running；未宣稱Web／API已啟動。如需停止只指定本輪project，保留volumes。原.env、.instances、.restore-drills與agent工作樹請保持私有，不發布secret。

收尾檢查：目前整合原始碼`pnpm typecheck`通過；`git diff --check`通過。這不補足中斷的PG／browser驗證。
