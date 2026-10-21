/* 手動改過的路徑樣板，依來源（資料夾名稱 / GitLab 專案路徑）記在瀏覽器裡。
   下次載入同一個來源時先試它 —— 對不到任何檔案就當作沒記過，照常自己猜。 */
const KEY = "i18n-desk-patterns";

function readAll(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

export function savedPattern(source: string): string {
  const p = readAll()[source];
  return typeof p === "string" ? p : "";
}

/** 空字串代表忘掉（改回自動判斷） */
export function rememberPattern(source: string, pattern: string): void {
  try {
    const all = readAll();
    if (pattern) all[source] = pattern;
    else delete all[source];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* 存不了就算了，下次再猜一次 */
  }
}
