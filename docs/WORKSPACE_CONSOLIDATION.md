# 單一專案資料夾 — 2026-10-16

依使用者後續要求，桌面的封存資料夾及8個舊相容連結已移除。桌面只保留：

`/Users/fearnot/Desktop/confsys`

此目錄現在是獨立Git repository，`.git`為實際目錄，不再依賴任何其他桌面資料夾。分支維持`codex/phase-1-4-to-6-continuous`；所有分支／tags／Git物件與主樹index均保留，沒有merge、reset或push。

## 保存與移除內容

- 原始confsys、3個代理與4個歷史工作樹，共8棵已移除；封存資料夾confsys-worktree-archive亦已刪除，不是另移入隱藏工作樹。
- 刪除前將8,248個檔案／連結做私有壓縮備份並逐檔SHA-256／連結目標驗證。包含完整舊Git metadata、未提交tracked/untracked程式、.env、生成文件、測試證據及本地工具。只排除可由各自lockfile重建的node_modules。
- 私有恢復備份：`.git/consolidation/20261016/retired-worktrees/retired-worktrees.tar.gz`；同目錄有manifest及說明，不能發布（含本地測試秘密）。這是單一主資料夾內的備份檔，不是仍在運作的多份checkout。
- 所有分支bundle與先前工作差異仍保存在`.git/consolidation/20261016/`。相關功能尚未整合時，可由[integration-pending/20261016](../integration-pending/20261016/README.md)開始review；不因目錄整併而宣稱完成或通過測試。
- 目前主樹的.env、node_modules、生成PDF、本輪.tools、.instances、.restore-drills保持原樣。

## 驗證

1. 轉換前後主樹HEAD、分支、所有refs與index完全相同。
2. `git fsck --connectivity-only --no-dangling`成功；`git worktree list --porcelain`只列出此主資料夾。
3. 桌面confsys*僅有這一個實體資料夾，無封存資料夾或隱藏相容連結。
4. 產品source／migration／contracts／lockfile未修改；本次沒有執行業務測試，也不改寫既有WIP驗證結論。

## 後續注意

- IDE／Codex應開啟上述主要路徑。舊文件中的其他桌面工作樹路徑為歷史紀錄，檔案已轉存私有備份。
- 未修改、啟停或刪除容器／volume。舊停止容器confsys-p13-30694026-b-postgres-1曾bind舊phase1.3的infra/init-db.sh；舊路徑已依本次要求移除，後續若要重建該舊合成環境，需先選正確來源路徑，不可假稱原bind仍可用。
- 復原時將備份解到另外選定的目錄並修復Git路徑，不可覆蓋目前主專案；必要時可從bundle建立乾淨checkout再套用所需patch。

## 可維護性檢查

主專案改為自含Git資料庫，消除對外部封存資料夾的依賴。沒有新增業務規則、權限來源或套件依賴；未完成片段與已驗證程式仍清楚分開。歷史分支與未提交成果可恢復，最新功能仍依CONTINUOUS_DELIVERY所列項目待驗證。

## 最終目錄名稱
依使用者要求，唯一專案資料夾已改名為`/Users/fearnot/Desktop/confsys`。主.env的PRIVATE_STORAGE_ROOT及本地ClamAV設定中的絕對路徑同步更新，原設定私有備份保存在`.git/consolidation/rename-20261016`。Git分支／歷史不變，沒有保留舊桌面路徑連結。舊交付文件及測試證據中的原路徑屬歷史紀錄。未重啟本地服務或修改Docker容器；後續啟動應使用新路徑。
