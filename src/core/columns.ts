import { KEY_COL, MIN_COL, NOTE_COL, W } from "./constants";
import type { Doc } from "./types";

/** 純顯示的設定。不影響存檔 —— 被隱藏的語系照樣會存。 */
export interface ColumnView {
  hidden: Record<string, true>;
  pinned: Record<string, true>;
  widths: Record<string, number>;
  /** 聚焦中的目標語系（空字串 = 沒開聚焦模式） */
  focus: string;
  /** 聚焦模式下擺在左邊當對照的來源語系 */
  source: string;
}

export type ColumnKind = "key" | "note" | "loc";

export interface Column {
  id: string;
  kind: ColumnKind;
  width: number;
  pinned: boolean;
  lastPinned: boolean;
  /** 凍結欄的 left 位移；沒凍結的是 0 */
  left: number;
}

/** 某一欄現在多寬。使用者拉過的優先，否則用預設值。這是欄寬唯一的查詢入口。 */
export function colWidth(widths: Record<string, number>, id: string): number {
  if (widths[id]) return widths[id];
  if (id === KEY_COL) return W.key;
  if (id === NOTE_COL) return W.note;
  return W.cell;
}

/* 43 個語系攤平是 7000 多 px，橫向捲動找不到自己在改哪一欄。
   聚焦模式一次只擺「來源 + 一個目標」，畫面收成四欄，捲動就消失了。 */
export function focusLocales(doc: Doc, view: ColumnView): string[] {
  const out: string[] = [];
  if (view.source && doc.data[view.source] && view.source !== view.focus) out.push(view.source);
  if (doc.data[view.focus]) out.push(view.focus);
  return out.length ? out : doc.order.slice(0, 1);
}

/* 目前顯示中的語系。只給畫面、篩選與統計用 —— 存檔一律走 doc.order。
   聚焦模式蓋過 hidden，但不寫進去 —— 關掉聚焦時使用者原本手動勾的那組要能原封不動回來。 */
export function visibleLocales(doc: Doc, view: ColumnView): string[] {
  return view.focus ? focusLocales(doc, view) : doc.order.filter((code) => !view.hidden[code]);
}

/* 欄位排列與凍結位置的唯一來源。順序是：KEY → 使用者釘選的欄（照原本欄序）→ 其餘欄。
   KEY 永遠在最左邊也永遠凍結 —— 它是這一列的身分，捲掉之後就不知道自己在改哪個字串了。 */
export function columnLayout(
  visible: string[],
  view: Pick<ColumnView, "hidden" | "pinned" | "widths">,
): Column[] {
  const rest: { id: string; kind: ColumnKind }[] = [];
  if (!view.hidden[NOTE_COL]) rest.push({ id: NOTE_COL, kind: "note" });
  for (const code of visible) rest.push({ id: code, kind: "loc" });

  const ordered = [
    { id: KEY_COL, kind: "key" as const },
    ...rest.filter((c) => view.pinned[c.id]),
    ...rest.filter((c) => !view.pinned[c.id]),
  ];

  let left = 0;
  const cols: Column[] = ordered.map((c) => {
    const width = colWidth(view.widths, c.id);
    const pinned = c.kind === "key" || !!view.pinned[c.id];
    const col: Column = { ...c, width, pinned, lastPinned: false, left: pinned ? left : 0 };
    if (pinned) left += width;
    return col;
  });
  for (let i = cols.length - 1; i >= 0; i -= 1) {
    if (cols[i].pinned) {
      cols[i].lastPinned = true;
      break;
    }
  }
  return cols;
}

export function pinnedWidth(cols: Column[]): number {
  return cols.reduce((n, c) => (c.pinned ? n + c.width : n), 0);
}

export function totalWidth(cols: Column[]): number {
  return cols.reduce((n, c) => n + c.width, 0) + W.add;
}

/** 凍結區的寬度上限。超過的話右邊就沒有空間可以捲了 —— 釘選與拉寬都要守這條線。 */
export function pinnedLimit(viewportWidth: number): number {
  return viewportWidth * 0.7;
}

/** 某一欄的 x 位置（凍結區算在裡面）。凍結的欄回 null —— 它本來就看得到。 */
export function columnScrollLeft(cols: Column[], id: string): number | null {
  let x = 0;
  for (const c of cols) {
    if (c.id === id) return c.pinned ? null : Math.max(0, x - pinnedWidth(cols));
    x += c.width;
  }
  return null;
}

/* 偏好是記在瀏覽器裡的：在大螢幕釘了一堆寬欄位，換到筆電打開就會爆掉。
   所以載入與改變視窗大小時要再檢查一次，超過預算就從右邊開始退掉釘選。
   KEY 退不掉（它是這一列的身分），只能把寬度夾回去。
   回傳 null 代表沒超過；否則是修正後的 pinned / widths 與退掉了幾個。 */
export function enforcePinnedBudget(
  visible: string[],
  view: Pick<ColumnView, "hidden" | "pinned" | "widths">,
  viewportWidth: number,
): { pinned: Record<string, true>; widths: Record<string, number>; dropped: number } | null {
  const limit = pinnedLimit(viewportWidth);
  const fits = (pinned: Record<string, true>, widths: Record<string, number>) =>
    pinnedWidth(columnLayout(visible, { hidden: view.hidden, pinned, widths })) <= limit;
  if (limit <= 0 || fits(view.pinned, view.widths)) return null;

  const pinned = { ...view.pinned };
  const widths = { ...view.widths };
  let dropped = 0;
  for (;;) {
    const ids = columnLayout(visible, { hidden: view.hidden, pinned, widths })
      .filter((c) => c.pinned && c.id !== KEY_COL)
      .map((c) => c.id);
    if (!ids.length || fits(pinned, widths)) break;
    delete pinned[ids[ids.length - 1]];
    dropped += 1;
  }
  // 只剩 KEY 還是超過的話，夾 KEY 的寬度
  if (!fits(pinned, widths)) widths[KEY_COL] = Math.max(MIN_COL, Math.floor(limit));
  return { pinned, widths, dropped };
}
