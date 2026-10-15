# 桌面工作樹整理 — 2026-10-16

本次依使用者「先整合目前桌面的多個資料夾」整理工作樹與保存未完成成果，不恢復已到期的連續開發授權，不新增業務功能。

## 固定入口

| 位置 | 用途 |
|---|---|
| `/Users/fearnot/Desktop/confsys-phase-1-4-to-6-continuous` | 唯一主要開發工作樹，分支codex/phase-1-4-to-6-continuous；程式基線仍61d1c11，保留WIP驗證狀態 |
| `/Users/fearnot/Desktop/confsys-worktree-archive/confsys` | 原始checkout與共用Git資料庫；仍是codex/maintainability-rules，不是最新產品版本，不可刪除.git |
| `/Users/fearnot/Desktop/confsys-worktree-archive` | 集中8個原始／歷史／代理工作樹；均保留原分支、HEAD與未提交資料 |

封存項目：原始confsys、continuous-files、continuous-invitations、continuous-submissions、phase-1-1-auth、phase-1-1b-single-conference、phase-1-2-access-control、phase-1-3-conference-site（各目錄保留原confsys-前綴）。7個linked worktree使用`git worktree move`移動；原始repository整棵原子搬移後執行`git worktree repair`，全部9棵worktree都重新驗證。未複製成失去Git關聯的普通資料夾。

## 相容性與安全

- 舊桌面路徑保留隱藏symlink，供舊容器bind mount、歷史報告及工具路徑相容。Finder一般視圖只顯示主要開發與封存兩個資料夾；顯示隱藏檔時仍可看到相容連結。
- 檢查到舊confsys-p13-30694026-b-postgres-1（停止狀態）引用phase1.3的infra/init-db.sh；相容路徑仍解析至相同檔案。未修改、啟停或重建任何容器／volume。
- 未刪資料夾、分支、node_modules、.env、生成檔、測試證據或未提交修改。未將私有環境設定提交Git。
- 每棵移動的工作樹比對全部檔案及symlink路徑、inode、大小／修改時間或連結目標，並確認搬移前後HEAD及完整Git status相同；共127053項保留項目。

## 歷史與待整合片段

所有分支bundle（已`git bundle verify`）及各工作樹working/index差異、未追蹤檔清單、移動對照紀錄：`/Users/fearnot/Desktop/confsys-worktree-archive/confsys/.git/consolidation/20261016/`。此備份目錄為私有，完整本地ignored檔仍保留在各實際工作樹。

主要工作樹的[integration-pending/20261016](../integration-pending/20261016/README.md)集中保存：

1. 投稿filters的未提交source／contract／UI／tests patch。
2. 未完成registration-authority測試原文（`.pending`副檔名，未冒充已啟用測試）。
3. review測試工作副本patch，可能包含已在主樹的內容，套用前需比對。

代理樹大量舊schema／lockfile／模組副本與主樹重複或落後，未覆蓋目前主版本。這次集中保管不等於功能整合完成；上一份CONTINUOUS_DELIVERY的未驗證事項仍成立。

## 驗證與可維護性

- 9棵Git工作樹全部可定位；8棵搬移前後HEAD/status及檔案metadata相同，舊相容路徑可讀。
- 主要產品source／migration／contracts／lockfile沒有修改，不需要重跑業務測試；只執行搬移完整性、Git與備份驗證。
- 無新增業務依賴、重複授權／狀態邏輯。責任分界仍是主樹整合、歷史樹封存、pending片段待review與測試。
- 後續如要以短路徑confsys取代主要入口，必須另處理共用Git目錄、環境設定與相容路徑，不能直接刪除封存內confsys或相容連結再rename。
