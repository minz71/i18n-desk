# i18n desk 發行版整理計畫（調查報告）

> 唯讀調查，沒有改動任何程式碼。基準：`main` @ `b9d0f56`（working tree clean）。

## 0. 結論摘要

- **整體狀態健康**：lint / test（64 個）/ typecheck / build 全部通過，沒有 TODO/FIXME、沒有 `console.*`、沒有被註解掉的程式碼區塊，`dist/` 沒有進 git。
- **「舊做法和新做法並存」的情況已經不存在**：原本的 vanilla JS 版（`legacy/app.js` 等 5,600 行）和 `MIGRATION.md` 已在 `56809f0` 刪掉。現在剩下的遺留物是**零碎的殘渣**，不是整塊的重複實作：
  - 沒用到的 shadcn 元件 2 個（`badge`、`toggle`）、空資料夾 `src/hooks/`、死函式 `totalDirtyCells`
  - 指向已刪除 `legacy/` 的 ESLint 設定、進了 git 的工具設定 `.claude/launch.json`
  - 為了接舊版資料留的相容碼（草稿 v2 升級）與一堆「沿用舊版」的註解
  - 正式版也會掛上的 `window.i18nDeskDebug`
- **真正的工作量在文件與發行中繼資料**：README 有 460 行，混了大量內部專案脈絡（43 語系、PM、i18next 具名 import、Vercel），漏了聚焦模式等功能；`GITLAB.md` 是一份過時的評估稿，裡面有公司內部 GitLab 網域。沒有 LICENSE、沒有 favicon、`package.json` 缺 license / repository / engines。
- **Prettier 有裝但從沒強制**：52 個檔案不符格式，而且 `tests/fixtures/**` 必須逐位元保留，直接 `--write` 會弄壞測試樣本。

建議分 5 個階段做（§5），每一階段都能單獨驗證、單獨 commit。

**已經確定的事**（使用者決定，已經併進下面的計畫）：
- 部署在 **Vercel**，產物是靜態檔
- README **只寫繁體中文**
- 授權用 **MIT**
- **GitLab 整合是必要功能**，要保留，設定方式要完整寫進文件
- 版號 **1.0.0**

Vercel 部署的檢查結果：`base` 維持預設的 `/` 就可以；沒有 router，所以不需要 SPA rewrites；程式沒有用到任何環境變數，所以 Vercel 上不用設；GitLab 整合用的是使用者自己貼的 PAT，**沒有 OAuth，所以不需要 redirect URI**；`src/` 裡沒有寫死的主機或 client ID。剩下要你決定的幾件小事放在 §6。

---

## 1. 基準健康度

| 指令 | 結果 | 備註 |
| --- | --- | --- |
| `npm run lint`（`eslint .`） | ✅ 通過，0 warning | 3 處 `eslint-disable-next-line`，都有註明理由（`GitLabWizard.tsx:117`、`Grid.tsx:26`、`Sidebar.tsx:99`） |
| `npm test`（`vitest run`） | ✅ 2 檔 / 64 個測試通過，約 0.6 秒 | `tests/core.test.ts`（671 行）、`tests/gitlab.test.ts`（137 行） |
| `npm run typecheck`（`tsc -b`） | ✅ 通過 | 已包含在 build 裡 |
| `npm run build`（`tsc -b && vite build`） | ✅ 通過 | JS 543.12 kB（gzip 173.30 kB）、CSS 50.94 kB；`chunkSizeWarningLimit: 600` 把 500 kB 的警告壓掉了 |
| `npx --no-install prettier --check .` | ❌ 52 個檔不符 | 沒有對應的 npm script，也沒有 `.prettierignore`；名單裡有 6 個 `tests/fixtures/**` 檔案 |

環境：Node v24.19.0、npm 11.17.0。各工具要求的最低版本：vite `^20.19.0 || >=22.12.0`、vitest `^22.12.0 || ^24.0.0 || >=26.0.0`，所以**實際最低是 Node 22.12**。

---

## 2. 遺留／無用程式碼清單

### 2.1 建議處理

| # | 路徑 / 符號 | 是什麼 | 證據 | 建議 | 信心 | 風險 |
| --- | --- | --- | --- | --- | --- | --- |
| L1 | `src/components/ui/badge.tsx` | shadcn Badge | 整個 `src/` 沒有任何 `ui/badge` import。Topbar 的 `ModeBadge` 是自己寫的 `<span>` | 刪除 | 高 | 低 |
| L2 | `src/components/ui/toggle.tsx` | shadcn Toggle | 沒有任何 `ui/toggle` import | 刪除 | 高 | 低 |
| L3 | `src/hooks/` | 空資料夾（0 個檔，git 也沒追蹤） | `MIGRATION.md` 原本規劃放 `useDropZone` 等 hook，後來直接寫在 `App.tsx` 裡 | 刪除資料夾。`components.json` 的 `aliases.hooks` 保留，那是 shadcn CLI 的設定，不需要資料夾存在 | 高 | 無 |
| L4 | `eslint.config.js` 的 `ignores: ["dist", "legacy", ...]` | 忽略 `legacy/` | `legacy/` 在 `56809f0` 已刪除 | 拿掉 `"legacy"` | 高 | 無 |
| L5 | `.claude/launch.json` | Claude Code 的啟動設定，有進 git | `git ls-files` 裡有它；`vite.config.ts:8` 的註解寫「port 固定是為了對上 .claude/launch.json」 | `git rm --cached`，把 `.claude/` 加進 `.gitignore`（本機檔案留著）；`vite.config.ts` 註解改成說明 port 固定的真正原因 | 高 | 低 |
| L6 | `totalDirtyCells`（`src/core/doc.ts:204`） | 死函式 | `src/`、`tests/` 都沒有任何引用（`dirtyCellCount` 本身有在用，要留） | 刪除 | 高 | 無 |
| L7 | `useGitLabDialogs()`（`src/components/gitlab/gitlab-dialogs.ts:32`） | 名字像 hook，其實只回傳兩個普通函式 | 只有 `Topbar.tsx:108` 用到；`GitLabWizard.tsx` 已經直接 import `openGitLabLoad` | Topbar 直接 import `openGitLabLoad` / `openGitLabCommit`，刪掉 wrapper | 中 | 低 |
| L8 | `upgradeDraft()` 的 v2 分支（`src/core/doc.ts:355-369`）＋ 測試 `tests/core.test.ts:623` | 把「一份草稿一份檔」的舊格式（v2）升級成 v3 | v3 是在 `5ad7619`（多檔語系）才出現；v2 是 legacy app.js 和之前的 React 版寫的 | 依 D7：發行版建議刪掉 v2 分支與對應測試，保留 `parts` 驗證 | 中 | 低：還留著 v2 未存草稿的內部使用者，下次打開不會被詢問還原 |
| L9 | 提到「舊版」的註解 | 已經不存在的舊版本 | `store/notify.ts:3`（「跟舊版的 toast() 一樣」）、`io/draft.ts:5`、`io/prefs.ts:5`、`io/prefs.ts:45`、`core/doc.ts:71`、`components/gitlab/GitLabWizard.tsx:27-28`（「一頁五個欄位的版本」） | 改寫成描述**現在的行為**。程式碼不動（例如 `doc.ts:71` 備註檔不列入平層判斷，這個行為要留） | 高 | 無 |
| L10 | `src/debug.ts` + `main.tsx` 的 `installDebugHook()` | 在 `window.i18nDeskDebug` 掛 `state` / `serialize` / `changedFiles` | 正式 build 也會掛（只有 `actions` / `dialog` 限 DEV）。state 不含 token | 依 D6：建議改成只在 `import.meta.env.DEV` 時動態 import，正式 bundle 就不會包進去 | 中 | 低：失去正式站上的 console 支援工具 |
| L11 | `GITLAB.md` | 2026-09-17 的 GitLab 整合**評估稿**，開頭補了一段「現況」 | 第 15、25、41、90 行出現公司內部 GitLab 網域；內容是 PAT 與 OAuth 的取捨，OAuth 並沒有實作 | 刪除。使用者需要知道的部分（token 申請、權限、限制）併進新 README，評估過程留在 git 歷史 | 高 | 低 |
| L12 | `vite.config.ts:17` 註解 | 「對一個內部工具可以接受」 | 內部工具的說法 | 改寫成中性的理由 | 高 | 無 |

### 2.2 檢查過、建議保留

| 項目 | 理由 |
| --- | --- |
| `?nofsa` 開發開關（`src/io/directory.ts:9-11`） | 只在 `import.meta.env.DEV` 生效，正式 build 會被 tree-shake 掉。用來在 Chrome 上測 Safari 的唯讀路線，寫進開發文件就好 |
| `localStorage` key 名稱 `i18n-desk-layout`、`i18n-desk-patterns`、`i18n-desk-gitlab`、`i18n-desk-gitlab-token`；IndexedDB `i18n-desk/state/draft` | 改名等於把所有人的偏好、記住的 token 和草稿清掉，沒有好處。只要改 L9 的註解 |
| `prefs.ts:64` 寫入的 `version: 2` | 讀取端不檢查，但留著對以後的遷移有用，沒有成本 |
| `core/keys.ts:20`「不用 lookbehind：舊版 Safari 不支援」 | 這是瀏覽器相容，不是本專案的遺留物（`2f7eb60 safari downgrade`） |
| `gitlab/api.ts:231` 提到 GitLab 舊版 token 頁路徑 | 講的是 GitLab 的版本，不是本專案 |
| 大約 30 個「有 export 但只在自己檔案裡用」的符號（例如 `filters.ts` 的 `isMissing` / `matchesQuery`、`layout.ts` 的 `fillPattern`、`api.ts` 的 `projectApi`） | 都有被呼叫，只是 export 多了。拿掉 export 的價值很低，diff 又雜，**建議不做** |
| `vercel.json` | 部署目標就是 Vercel，保留。現在的設定是對的，不需要 rewrites |
| npm 依賴 | 全部都有用到：`class-variance-authority` 與 radix `Slot` 刪掉 badge/toggle 後 `button.tsx` 還在用；`@types/node` 給 `vite.config.ts` 與 `tsconfig.test.json` 用；`globals` 給 ESLint 用；`tw-animate-css` 在 `index.css` 裡。只有 `prettier` 沒有任何 script 用到（見 D9） |
| `dist/` | 沒進 git（`.gitignore` 有 `dist`），本機有舊的 build 產物，不需要處理 |

### 2.3 搜尋過但沒找到的

TODO / FIXME / HACK / XXX：0 個。`console.*` / `debugger`：0 個。被註解掉的程式碼區塊：0 個（用正規式找 `// const|let|if|return|import|<Tag|}` 這類開頭）。`@ts-ignore` / `@ts-expect-error`：0 個。

---

## 3. 發行準備缺口

| 項目 | 現況 | 建議 |
| --- | --- | --- |
| `package.json` | `name: i18n-desk`、`version: 2.0.0`（legacy 時代是 1.0.0）、`private: true`、`description` 有寫；**沒有** `license`、`repository`、`homepage`、`engines` | 跑 `npm version 1.0.0 --no-git-tag-version`，`package.json` 和 `package-lock.json` 的兩處版號會一起改。程式碼不讀版號，只有草稿和偏好有自己的 `version`，跟這個無關。補上 `"license": "MIT"`、`"repository": "github:minz71/i18n-desk"`（取自 `git remote`）、`homepage`（Vercel 網址，見 D-a）、`engines.node: ">=22.12.0"`。`private: true` 保留（這是網頁應用，不發佈到 npm）。scripts 加 `format` / `format:check` |
| LICENSE | 沒有 | 新增 MIT `LICENSE`，`Copyright (c) 2026 <持有人>`（見 D-b） |
| 寫死的主機、client ID、秘密 | `src/` 裡**沒有**。只有 placeholder `git.example.com` / `gitlab.example.com`，GitLab 主機是使用者在精靈第一步自己填的。沒有用到 `VITE_*` 環境變數，也沒有 `.env` | 不需要改成設定項。公司內部網域只出現在 `GITLAB.md`（L11） |
| Vercel：環境變數 | 不需要。唯一用到的 `import.meta.env` 是 `DEV`（`debug.ts:16`、`directory.ts:10`），是 Vite 內建的 | Vercel 專案不用設任何環境變數 |
| Vercel：SPA rewrites | 不需要。沒有 router，只有 `index.html` 一個入口，也沒有任何 `history.pushState` | `vercel.json` 不用加 `rewrites`。現在的 `framework: vite` / `buildCommand` / `outputDirectory: dist` 設定是正確的 |
| GitLab OAuth redirect URI | 不適用。授權只用 PAT（`gitlab/auth.ts`），從瀏覽器帶 `PRIVATE-TOKEN` 標頭直接呼叫 API，沒有 OAuth 流程，也沒有 client ID | Vercel 網域**不用**在 GitLab 註冊 application。README 要寫清楚：(1) 使用者自己申請 PAT；(2) 自架 GitLab 必須允許來自 Vercel 網域的跨來源請求；(3) 不支援 OAuth。以後要做 OAuth PKCE 才需要 client ID 和 redirect URI，到那時候再改成 `VITE_GITLAB_CLIENT_ID` 這類建置期設定 |
| 憑證保存 | PAT（需要 `api` scope）預設放 `sessionStorage`，勾「記住」才寫進 `localStorage`（key：`i18n-desk-gitlab-token`）。草稿和 state 裡都沒有 token | README 要把風險講清楚（現有內容可以沿用）。可以考慮在 `vercel.json` 加安全標頭（見下面「選做」） |
| 錯誤訊息 | 都是可行動的中文句子（`gitlab/host.ts` 的 `glMessage`、`api.ts:33` 的 CORS / 網路錯誤）。UI 只有繁中 | 不用改。UI 只支援繁中這件事要寫進 README |
| 靜態託管路徑 | `vite.config.ts` 沒設 `base`，預設是 `/` | Vercel 從網域根目錄提供檔案，`/` 就是對的，**不用改** |
| `index.html` | 有 `<title>i18n desk</title>`、`lang="zh-Hant"`；**沒有 favicon**（每次載入都會 404 `/favicon.ico`）、沒有 `<meta name="description">` | 新增 `public/favicon.svg` 並在 `<head>` 引用，補 description |
| 瀏覽器 API 需求（要寫進文件） | 可寫回的資料夾模式需要 `showDirectoryPicker`（只有 Chrome / Edge）；Firefox / Safari 改走 `webkitdirectory` 或拖放，只能唯讀；需要 secure context（HTTPS 或 `http://127.0.0.1`）；草稿用 IndexedDB；build target 是 Vite 預設的 `baseline-widely-available` | README 加一張瀏覽器支援表 |
| GitLab 的限制（要寫進文件） | 自架 GitLab 必須允許跨來源請求；不支援裝在子路徑的 GitLab（`normalizeHost` 只保留 origin，見 `host.ts:5-9`）；沒有 OAuth，只能用 PAT | README 的 GitLab 段落列出來 |
| 測試範圍 | 只有純函式（core + gitlab helper），UI 沒有自動化測試 | 發行前跑 §5 的手動驗收清單 |
| CI | 沒有（沒有 `.gitlab-ci.yml` 或 `.github/`） | 選做，不在這次範圍內 |
| 選做：安全標頭 | `vercel.json` 沒有 `headers` | 可以加 `X-Content-Type-Options: nosniff`、`Referrer-Policy: no-referrer`。CSP 的 `connect-src` 必須放行任意 GitLab 主機，效益有限，要做的話先在瀏覽器驗過 |

---

## 4. README

### 4.1 現有文件內容

- **README.md（460 行）**：用法、三種來源與輸出、資料夾版面與路徑樣板、多檔分頁、顯示欄位 / 凍結 / 欄寬 / 列高、新增刪除、分區、對話框、設計決定、GitLab 模式（token、權限、commit、衝突、MR）、備註檔、鍵盤、草稿、開發、程式結構、效能數字、除錯 hook、Vercel 部署。
- **GITLAB.md（約 150 行）**：GitLab 整合的事前評估（CORS 實測、PAT 與 OAuth PKCE 的取捨、工作量估計），開頭補了一段「現況」。

### 4.2 跟程式碼對不上或不適合發行版的地方

| 問題 | 位置 | 實際情況 |
| --- | --- | --- |
| 沒有寫**聚焦模式 / 對照語系** | 全文 | `LocaleBar.tsx` 有「聚焦」按鈕、對照語系選單、`Alt + ←/→` 換目標語系，語系 chip 會顯示缺幾個 key、點了會捲到那一欄 |
| 「沒有來源語系」一節跟「對照語系」容易混淆 | 「設計上的幾個決定」 | 對照語系只影響顯示，要講清楚兩者的差別 |
| 鍵盤表不完整 | 「鍵盤」 | 還有 `Ctrl/⌘ + ↑/↓`（`GridRow.tsx:42`）、`Alt + ←/→`（`LocaleBar.tsx:25`）；輸入法選字中的 Enter 會被略過 |
| 略過的資料夾清單不完整 | 「資料夾版面」 | `layout.ts:21` 還會跳過 `dist`、`local`、`profiles` |
| 拖放資料夾沒講清楚 | 「來源與輸出」 | `App.tsx` 整頁都能拖放；在 Chrome / Edge 拖進來的資料夾可以寫回（`directory.ts` 的 `captureDrop`） |
| 深色模式沒寫 | — | 跟著系統設定（`main.tsx:10-14`） |
| 遺留的說法 | 第 7 行「跟以前完全一樣」、凍結一節「跟以前一樣」、平層一節「注意：舊版不認得平層…」 | 發行版沒有「以前」，要拿掉 |
| 內部專案脈絡 | 「43 個語系」「key 有到 44 字」「PM 看不懂」「i18next 那邊是逐一具名 import」「原本 Excel 的欄序」「實測 0 個換行」 | 改成通用的說法 |
| 連到 GITLAB.md 的 OAuth 說明 | GitLab 一節 | OAuth 沒有實作；GITLAB.md 是評估稿 |
| 部署段落太簡略 | 「部署」 | 部署目標是 Vercel。要補上：不需要環境變數、不需要 rewrites、HTTPS 是 File System Access API 的前提 |
| 開發者細節混在使用者文件裡 | 效能實測數字、`window.i18nDeskDebug`、CSS 變數 `--cw-N` | 移到「開發」段落並精簡 |
| 缺少的段落 | — | Node 版本需求、瀏覽器支援表、截圖、授權 |

### 4.3 新 README 大綱（建議）

1. **i18n desk**：一句話介紹（純前端的 i18n JSON 語系編輯器，表格介面，可以直接寫回本機資料夾或 GitLab）＋截圖 placeholder（`docs/screenshot.png`）。
2. **特色**：6–8 點（多語系並排編輯、保留原檔格式與 key 順序讓 diff 最小、自動判斷資料夾版面、多檔分頁、佔位符一致性檢查、備註檔、草稿自動保存、GitLab 一鍵 commit + MR）。
3. **資料去哪裡**：檔案只在瀏覽器裡處理；GitLab 模式只連你填的那台主機；token 存在哪裡。
4. **瀏覽器支援**：表格列出 Chrome/Edge（可寫回）、Firefox/Safari（唯讀資料夾 + 下載）、所有瀏覽器（GitLab）；需要 HTTPS。
5. **快速開始**：線上版網址（Vercel，見 D-a）；本機：`npm install` → `npm run dev` → `http://127.0.0.1:5180`。
6. **使用方式**
   - 三種來源與輸出（沿用現有的表格，精簡）
   - 編輯、篩選、搜尋、分區
   - 新增 / 改名 / 刪除 key；新增 / 刪除 / 復原語系
   - 聚焦模式與對照語系
   - 顯示欄位、凍結、欄寬、列高
   - 草稿與還原
   - 鍵盤快捷鍵（完整的表）
7. **支援的檔案版面**：路徑樣板 `{code}` / `{ns}`、三種常見版面的範例樹、自動判斷規則、手動修改樣板、平層與巢狀、key 本身含 `.`、備註檔 `_comments*.json`、格式保留（EOL / 縮排 / 檔尾換行）、Cocos Creator `.meta`。
8. **GitLab 整合**（必要功能，寫完整）：
   - 前置條件：GitLab.com 或自架 GitLab；自架的必須允許來自部署網域的 CORS；不支援裝在子路徑底下的 GitLab
   - 申請 token：Personal Access Token 只勾 `api`，要說明為什麼 `read_repository` / `write_repository` 不夠；Project Access Token 是範圍更小的選擇；舊版 GitLab 的 token 頁路徑
   - 四步精靈：連線 → 專案 → 分支 → 語系資料夾；「直接載入上次的」
   - token 存在哪裡：預設 `sessionStorage`，勾「記住」才進 `localStorage`，怎麼清除
   - commit：所有變更打包成一個原子 commit；新增的檔用 create、既有的用 update；刪除語系時連 `.meta` 一起刪
   - 衝突偵測、預設分支 `i18n/<日期>`、自動開 MR、推回原分支
   - 權限的現實：能 commit 就看得到整個倉庫；替代做法（獨立的語系倉庫、改用下載）
   - 常見錯誤：對照 `glMessage` 的 401 / 403 / 404 與「連不上」，各自該怎麼處理
   - 沒有 OAuth，所以不用註冊 application，也不用設 redirect URI
9. **部署（Vercel）**：匯入 repo，`vercel.json` 已經設好 `framework: vite`、`npm run build`、`dist`；不需要環境變數；不需要 rewrites；Vercel 預設就是 HTTPS（File System Access API 需要 secure context）。最後補一句：產物是純靜態檔，放其他 HTTPS 靜態空間也可以。
10. **開發**：Node ≥ 22.12、scripts 表（dev / build / preview / test / test:watch / lint / typecheck / format）、技術棧、程式結構表（沿用現有的）、效能設計（2 點）、除錯工具（`window.i18nDeskDebug`、`?nofsa`）。
11. **授權**：MIT，連到 `LICENSE`。

整份 README 只寫繁體中文，不另外做英文版。

**GITLAB.md**：建議**刪除，不另外保留**。使用者需要的內容放進第 8 節就夠了；評估過程是決策紀錄，不是使用文件，留在 git 歷史即可，而且裡面有內部網域。

---

## 5. 分階段執行計畫

每一階段做完都跑同一組指令：**`npm run lint` → `npm test` → `npm run build`**，三個都要通過，然後 commit 一次。

### P1 安全刪除（行為不變）
- 刪除：`src/components/ui/badge.tsx`、`src/components/ui/toggle.tsx`、`src/hooks/`
- `src/core/doc.ts`：刪掉 `totalDirtyCells`
- `eslint.config.js`：`ignores` 拿掉 `"legacy"`
- `.claude/launch.json`：`git rm --cached`；`.gitignore` 加上 `.claude/`
- `vite.config.ts`：改寫第 8 行和第 17 行的註解
- 驗證：三個指令通過；`npm run dev` 開頁面，確認 Topbar 的模式徽章、顯示欄位選單、所有對話框正常顯示

### P2 遺留相容碼與除錯碼（依 D6、D7）
- `src/core/doc.ts`：`upgradeDraft` 拿掉 v2 分支，同時刪掉 `tests/core.test.ts:623` 的「舊版（v2）草稿」測試
- `src/main.tsx` / `src/debug.ts`：改成 `if (import.meta.env.DEV) void import("./debug").then((m) => m.installDebugHook())`
- `src/components/Topbar.tsx` + `gitlab-dialogs.ts`：拿掉 `useGitLabDialogs`，改成直接 import
- 改寫 L9 列出的註解（`notify.ts`、`draft.ts`、`prefs.ts` ×2、`doc.ts:71`、`GitLabWizard.tsx:27`）
- 驗證：三個指令通過。手動：(1) dev 改一格 → 重新整理 → 會詢問還原草稿；(2) `npm run build && npm run preview`，console 裡 `window.i18nDeskDebug` 是 `undefined`，dev 底下仍然存在；(3) dev 加 `?nofsa` 會走唯讀路線

### P3 工具鏈與格式（依 D9）
- 新增 `.prettierignore`：`tests/fixtures/`、`dist/`、`package-lock.json`、`node_modules/`
- `package.json`：scripts 加 `"format": "prettier --write ."`、`"format:check": "prettier --check ."`；加 `engines.node: ">=22.12.0"`
- 單獨一個 commit 跑 `npm run format`（純格式化）
- 驗證：`npm run format:check` 通過；`git diff --stat -- tests/fixtures` **必須是空的**；三個指令通過

### P4 發行中繼資料
- `npm version 1.0.0 --no-git-tag-version`：會同時改 `package.json` 和 `package-lock.json`
- `package.json` 補上 `"license": "MIT"`、`"repository": "github:minz71/i18n-desk"`、`homepage`（D-a）
- 新增 `LICENSE`（MIT，持有人見 D-b）
- 新增 `public/favicon.svg`；`index.html` 加 `<link rel="icon" href="/favicon.svg">` 和 `<meta name="description">`
- `vercel.json`：保留現在的設定，**不加** rewrites。選做（D-c）：加 `headers`，帶 `X-Content-Type-Options: nosniff` 和 `Referrer-Policy: no-referrer`
- `vite.config.ts`：`base` 不動
- 驗證：三個指令通過；`npm run preview` 頁面正常，Network 裡沒有 404（包括 favicon）；`npm ls --depth=0` 第一行顯示 `i18n-desk@1.0.0`

### P5 文件
- 依 §4.3 重寫 `README.md`；刪除 `GITLAB.md`
- 驗證：README 裡的錨點連結都點得到；照 §4.2 的表逐條確認新 README 都有涵蓋；README 寫到的指令實際跑一次

### P6 發行驗收（手動）
- Chrome / Edge：選資料夾 → 編輯 → 新增 / 改名 / 刪除 key → 新增 / 刪除 / 復原語系 → 儲存到資料夾 → 用 `git diff` 確認只有預期的行變了
- Firefox 或 Safari：選資料夾（唯讀）→ 下載變更 → zip 裡的路徑正確
- 拖放 JSON 檔、拖放資料夾；多檔版面（`tests/fixtures/multi`）的分頁
- GitLab：拿測試專案跑完四步精靈 → commit + MR → 在另一邊推一個 commit 後再送出，確認衝突偵測會擋下來
- 聚焦模式、`Alt + ←/→`、凍結 / 欄寬 / 列高、重新整理後偏好還在
- Vercel Preview 部署：在 Preview 網址上把上面的流程再跑一次，重點確認 (1) HTTPS 底下 Chrome 可以寫回資料夾；(2) GitLab 精靈連得到（CORS）；(3) 重新整理後偏好和草稿還在
- 全部通過後打 tag `v1.0.0`，合併到 main，讓 Vercel 部署正式環境

---

## 6. 需要你決定的事項

**已經確定**：部署在 Vercel；README 只寫繁中；授權 MIT；保留 GitLab 並完整寫進文件；版號 1.0.0。

還沒決定的事項。每一項都附了預設值，你不回覆的話就照預設值做：

| # | 問題 | 預設 |
| --- | --- | --- |
| D-a | 正式的 Vercel 網址（用在 `homepage` 和 README） | 先用 `https://i18n-desk.vercel.app` 當 placeholder，部署後再換成真的網址 |
| D-b | MIT 的著作權持有人 | `minz71`（取自 GitHub remote） |
| D-c | 要不要在 `vercel.json` 加安全標頭 | 加 `nosniff` 和 `Referrer-Policy`；不加 CSP |
| D6 | 正式版要不要掛 `window.i18nDeskDebug` | 只在 DEV 掛 |
| D7 | 草稿 v2 升級相容碼 | 刪除（v2 只存在於發行前的版本） |
| D9 | Prettier | 採用，獨立一個 commit 全面格式化，並排除 fixtures |
| D10 | `.claude/` | 從 git 移除，本機保留 |
