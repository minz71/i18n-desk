import { MAX_COL, MIN_COL } from "@/core/constants";
import { useEditor, type EditorState } from "@/store/editor";

/* 版面偏好：顯示 / 凍結 / 欄寬 / 列高 / 聚焦 / 分區收合，記在瀏覽器裡，下次打開維持原樣。
   key 名不要改，改了使用者的偏好就全部歸零；每個欄位個別檢查，形狀認不得的就用預設值。 */
const PREF_KEY = "i18n-desk-layout";

type Prefs = Pick<
  EditorState,
  "hidden" | "pinned" | "widths" | "lines" | "focus" | "lastFocus" | "source" | "sidebarCollapsed"
>;

const FIELDS: (keyof Prefs)[] = [
  "hidden",
  "pinned",
  "widths",
  "lines",
  "focus",
  "lastFocus",
  "source",
  "sidebarCollapsed",
];

function flags(raw: unknown): Record<string, true> {
  const out: Record<string, true> = {};
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw)) if (v) out[k] = true;
  }
  return out;
}

export function loadPrefs(): Partial<Prefs> {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (!raw) return {};
    const pref = JSON.parse(raw);
    if (!pref || typeof pref !== "object") return {};
    const out: Partial<Prefs> = {};
    if (pref.hidden && typeof pref.hidden === "object") out.hidden = flags(pref.hidden);
    if (pref.pinned && typeof pref.pinned === "object") out.pinned = flags(pref.pinned);
    if (typeof pref.focus === "string") out.focus = pref.focus;
    if (typeof pref.lastFocus === "string") out.lastFocus = pref.lastFocus;
    if (typeof pref.source === "string") out.source = pref.source;
    if (pref.widths && typeof pref.widths === "object") {
      // localStorage 的內容不一定是這個程式寫的（手動改過、壞掉），超出範圍的欄寬直接丟掉
      const widths: Record<string, number> = {};
      for (const [id, v] of Object.entries(pref.widths)) {
        const w = Number(v);
        if (w >= MIN_COL && w <= MAX_COL) widths[id] = Math.round(w);
      }
      out.widths = widths;
    }
    if (pref.lines >= 1 && pref.lines <= 3) out.lines = pref.lines | 0;
    out.sidebarCollapsed = !!pref.sidebarCollapsed;
    return out;
  } catch {
    /* 隱私模式或封鎖網站資料時會丟例外，用預設值就好 */
    return {};
  }
}

function savePrefs(s: EditorState): void {
  try {
    const out: Record<string, unknown> = { version: 2 };
    for (const f of FIELDS) out[f] = s[f];
    localStorage.setItem(PREF_KEY, JSON.stringify(out));
  } catch {
    /* 存不了就算了，不影響編輯 */
  }
}

/** 任何一個偏好欄位換了就寫回去。回傳取消訂閱的函式。 */
export function persistPrefs(): () => void {
  return useEditor.subscribe((s, prev) => {
    if (FIELDS.some((f) => s[f] !== prev[f])) savePrefs(s);
  });
}
