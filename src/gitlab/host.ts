import { isLocaleCandidate, localeDirs } from "@/core/layout";
import type { ChangedFile } from "@/core/types";
import type { GitLabSession, GlAction, GlTreeEntry } from "./types";

/* 使用者會貼各種東西進來：結尾斜線、專案頁網址、沒有 https://、
   甚至 git@host:group/repo.git 的 SSH clone 網址。一律只留 scheme + 網域(+port)。
   代價是裝在子路徑底下的 GitLab（example.com/gitlab）不支援 —— 那種很少見，
   而從網址分不出哪段是子路徑、哪段是 group。 */
export function normalizeHost(raw: string | undefined): string {
  let s = String(raw || "").replace(/\s+/g, "");
  if (!s) return "";
  const ssh = /^[\w.-]+@([^:/]+):/.exec(s);
  if (ssh) s = "https://" + ssh[1];
  else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = "https://" + s.replace(/^\/+/, "");
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    if (!u.hostname) return "";
    return u.origin;
  } catch {
    return "";
  }
}

export function glJoin(dir: string, name: string): string {
  return dir ? dir.replace(/^\/+|\/+$/g, "") + "/" + name : name;
}

export function glShort(sha: string | undefined | null): string {
  return sha ? String(sha).slice(0, 8) : "?";
}

/* GitLab 的錯誤訊息藏在 body 裡，而且 401 / 403 / 404 的原因常常不只一種。
   直接把 HTTP 碼丟出去沒人看得懂，所以在這裡翻成能行動的句子。 */
export function glMessage(status: number, text: string): string {
  let detail = "";
  try {
    const data = JSON.parse(text);
    const raw = data && (data.message || data.error || data.error_description);
    detail = typeof raw === "string" ? raw : raw ? JSON.stringify(raw) : "";
  } catch {
    /* 回的不是 JSON（例如反向代理的錯誤頁），那就只報 HTTP 碼 */
  }
  if (status === 401) return "token 無效或已過期（401）。到 GitLab 重開一個有 api scope 的";
  if (status === 403) {
    return (
      "權限不足（403）" +
      (detail ? "：" + detail : "") +
      "。寫入需要 api scope，帳號也要有這個分支的推送權限"
    );
  }
  if (status === 404) {
    return "找不到（404）。專案、分支或路徑可能打錯了，也可能是這個 token 看不到這個專案";
  }
  return "GitLab 回 HTTP " + status + (detail ? "：" + detail : "");
}

/** 樹狀列表裡的檔案，換成相對於語系根目錄的路徑 */
export function treeRels(
  entries: GlTreeEntry[],
  dir: string,
): { rel: string; entry: GlTreeEntry }[] {
  const prefix = dir ? dir.replace(/\/+$/, "") + "/" : "";
  const out: { rel: string; entry: GlTreeEntry }[] = [];
  for (const e of entries) {
    if (e.type !== "blob" || (prefix && !e.path.startsWith(prefix))) continue;
    out.push({ rel: prefix ? e.path.slice(prefix.length) : e.path, entry: e });
  }
  return out;
}

/* 值得考慮的 JSON（規則跟讀本機資料夾一樣，見 isLocaleCandidate）。
   要讀哪些等樣板判斷完才決定 —— 一個檔一個請求，不能全部抓回來再挑。 */
export function wantedTreeEntries(entries: GlTreeEntry[], dir: string): GlTreeEntry[] {
  return treeRels(entries, dir)
    .filter((x) => isLocaleCandidate(x.rel))
    .map((x) => x.entry);
}

/* 這次的變更會落在倉庫的哪些路徑上。
   新增的語系、還不存在的備註檔在倉庫裡沒有對應檔案，要用 create ——
   GitLab 會直接拒絕對不存在的路徑 update。 */
export function glActions(g: GitLabSession, changed: ChangedFile[], pattern = ""): GlAction[] {
  const actions: GlAction[] = [];
  const gone = new Set<string>();
  const dirs = new Set<string>();
  for (const f of changed) {
    const path = glJoin(g.dir, f.rel);
    if (f.deleted) {
      // 空資料夾 git 本來就不記，刪掉最後一個檔資料夾自然就沒了
      actions.push({ action: "delete", file_path: path });
      gone.add(path);
      // Cocos Creator 每個檔旁邊有一個 .meta，留著的話打開專案會報找不到檔案
      if (g.known[path + ".meta"]) {
        actions.push({ action: "delete", file_path: path + ".meta" });
        gone.add(path + ".meta");
      }
      if (pattern) for (const d of localeDirs(pattern, f.rel)) dirs.add(glJoin(g.dir, d));
      continue;
    }
    actions.push({
      action: g.known[path] ? "update" : "create",
      file_path: path,
      content: f.text || "",
      encoding: "text",
    });
  }
  // 語系資料夾的 .meta（eng/json.meta、eng.meta）：資料夾裡已經沒有別的檔才刪。
  // 由深到淺，刪掉的 eng/json.meta 算在 eng/ 裡面，所以 eng 接著也會被判斷成空的
  for (const dir of [...dirs].sort((a, b) => b.length - a.length)) {
    const meta = dir + ".meta";
    if (!g.known[meta] || gone.has(meta)) continue;
    const left = Object.keys(g.known).some((p) => p.startsWith(dir + "/") && !gone.has(p));
    if (left) continue;
    actions.push({ action: "delete", file_path: meta });
    gone.add(meta);
  }
  return actions;
}

/** commit 成功後更新路徑紀錄：刪掉的之後要走 create，新建的之後走 update */
export function applyActions(g: GitLabSession, actions: GlAction[]): void {
  for (const a of actions) {
    if (a.action === "delete") delete g.known[a.file_path];
    else g.known[a.file_path] = true;
  }
}

export function defaultBranchName(d = new Date()): string {
  const pad = (n: number) => (n < 10 ? "0" + n : String(n));
  return "i18n/" + d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

export function branchNameError(branch: string): string {
  if (!branch) return "請填分支名稱";
  if (/[\s~^:?*[\\]/.test(branch) || /^[-/]|\/$|\.\./.test(branch)) {
    return "分支名稱有 git 不接受的字元";
  }
  return "";
}

/** commit 訊息的預設值 */
export function defaultCommitMessage(changed: ChangedFile[]): string {
  const removed = changed.filter((f) => f.deleted);
  const updated = changed.length - removed.length;
  // 一個語系有好幾份檔時，刪掉的代碼只列一次
  const gone = [...new Set(removed.map((f) => f.code))];
  return (
    "i18n: " +
    [updated ? "更新 " + updated + " 個語系檔" : "", gone.length ? "刪除 " + gone.join("、") : ""]
      .filter(Boolean)
      .join("，")
  );
}
