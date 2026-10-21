# i18n desk 1.0.0 發行整理：刪遺留碼、統一格式、補發行中繼資料、重寫 README

這條分支把 `main` 整理成 1.0.0 發行版，分成六個 commit，跟計畫的 P1–P5 對得上：刪掉沒用的 shadcn 元件、死函式和 `.claude/`；拿掉草稿 v2 升級碼，除錯 hook 改成只在 DEV 載入；導入 Prettier，全面格式化另外放一個 commit；補上版號、MIT 授權、favicon 和 Vercel 安全標頭；最後用繁體中文照 §4.3 大綱重寫 README，並刪掉 GITLAB.md。每個 commit 訊息都附了 lint / test / build 的結果，P2、P4、P5 另外記了瀏覽器裡的手動檢查。

Watch for：`.prettierrc.json` 多加了 `endOfLine: "auto"`，計畫沒寫到，但 commit 裡有說明理由（confirmed，不擋發行）。`homepage` 和 README 的線上網址還是 placeholder，README 截圖也還在註解裡，都要在 P6 正式部署前換掉（confirmed，計畫 D-a 本來就這樣安排）。

**Verdict**: APPROVED

## High-level view

P1 只刪計畫列出的項目。`totalDirtyCells` 已刪，`dirtyCellCount` 保留；`.claude/` 不再追蹤，`.gitignore` 也加了 `.claude/` 和 `.worktrees/`。`vite.config.ts` 兩段註解改寫後，講的是 port 固定的原因（偏好、草稿、token 都綁在 origin 上），已經沒有「內部工具」的說法。

P2 的程式改動只拿掉 v2 草稿分支和 `useGitLabDialogs` wrapper，其餘都是註解。還留著 v2 未存草稿的人，下次打開不會被問要不要還原，這是 D7 已經接受的風險。除錯 hook 改成 DEV 才動態 import，所以 `debug.ts` 不再需要自己判斷 DEV；dev 底下會掛的東西不變。正式 bundle 裡沒有這個 hook，P2 commit 記錄的「dist grep → 0 筆」可以證明。儲存用的 key、prefs 的 `version: 2`、`?nofsa`、`keys.ts` 和 `api.ts` 的註解都沒動。

P3 把 Prettier 的設定和全面格式化分成兩個 commit。`tests/fixtures/` 跟 main 比完全沒有差異。P4 跟計畫一致：`private: true` 保留，`vercel.json` 只多了兩個標頭，沒有 rewrites。

README 的說法抽查後都有程式碼依據，§4.2 每一條也都處理了。追蹤中的檔案裡已經找不到公司內部的 GitLab 網域，`.agents/` 也沒有被 commit。

<details>
<summary>Issues (3)</summary>

1. **計畫外的 Prettier 換行設定**：P3 在 `.prettierrc.json` 加了 `endOfLine: "auto"`，計畫沒列到。理由是 Windows 上開了 `core.autocrlf` 的 checkout 要能通過 `format:check`，說得通。保留就好，但這樣 Prettier 就不會統一換行字元，之後如果要強制 LF，應該寫在 `.gitattributes`。
2. **homepage 與線上網址還是 placeholder**：`package.json` 的 `homepage` 和 README「快速開始」都寫 `https://i18n-desk.vercel.app`。Vercel 正式網址確定後，打 `v1.0.0` tag 之前要把兩處一起換掉。
3. **README 截圖還沒補**：`docs/screenshot.png` 只出現在 HTML 註解裡，repo 裡沒有這張圖。發行前補上圖並把註解拿掉，或者決定 1.0.0 不放截圖。

</details>

<details>
<summary>Details</summary>

### README 對照程式碼

抽查了以下說法，每一條都找得到對應的程式碼：

- `Alt + ←/→` 掛在 window 上，焦點在輸入格裡也有效，而且會跳過對照語系（`LocaleBar.tsx`、`stepFocus`）。
- 預設對照語系依序挑繁中、簡中、中文、英文（`SOURCE_HINTS`）。
- `Ctrl/⌘ + ↑/↓`、Esc 還原，以及輸入法選字中略過按鍵（`GridRow.tsx`）。
- 略過的資料夾含 `dist` / `local` / `profiles`，最多看五層（`layout.ts`）。
- 整頁都能拖放（`App.tsx` 的 `captureDrop`）。
- 深色模式跟著系統（`main.tsx`）。
- 凍結區上限七成（`pinnedLimit`）。
- token 頁路徑與預填參數、先打 `/user` 驗證、`i18n/<日期>` 分支名、MR 帶 `remove_source_branch`、`.meta` 跟著刪。
- 常見錯誤表的每一列都對得上 `glMessage`、`request` 和 `actions.ts` 的訊息。
- port 5180 / 5181 和 `strictPort`。
- `.gitattributes` 確實對 `tests/fixtures/**` 設了 `-text`。

瀏覽器最低版本（Chrome 111 / Firefox 128 / Safari 16.4）用的是 Tailwind CSS v4 公開的需求。README 有導言加 10 個段落，等於 §4.3 的 11 節。

</details>

<details>
<summary>File map</summary>

- `src/components/ui/badge.tsx`、`toggle.tsx`：刪除
- `src/core/doc.ts`：刪掉 `totalDirtyCells` 和 v2 草稿分支，改寫兩段註解
- `src/main.tsx`、`src/debug.ts`：除錯 hook 改成只在 DEV 動態載入
- `src/components/Topbar.tsx`、`gitlab/gitlab-dialogs.ts`：拿掉 `useGitLabDialogs`
- `src/store/notify.ts`、`src/io/draft.ts`、`src/io/prefs.ts`、`gitlab/GitLabWizard.tsx`：只改註解
- `tests/core.test.ts`：刪掉 v2 測試，其餘是格式化
- `eslint.config.js`、`.gitignore`、`.claude/launch.json`：拿掉 legacy 忽略規則、加入忽略項、不再追蹤 `.claude/launch.json`
- `vite.config.ts`：改寫註解
- `.prettierignore`、`.prettierrc.json`、`package.json` scripts / engines：導入 Prettier
- 其餘 `src/**`、`tsconfig*.json`：純格式化（commit `bc13598`）
- `package.json`、`package-lock.json`、`LICENSE`、`public/favicon.svg`、`index.html`、`vercel.json`：發行中繼資料
- `README.md`：重寫；`GITLAB.md`：刪除

完整 diff：`git diff main..release/1.0.0`

</details>
