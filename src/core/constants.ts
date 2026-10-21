// 列高一律相同 —— 虛擬捲動靠「每列固定高度」算位置，
// 一列一個高度就得改成量測式的偏移索引，一萬列會很痛。
// 所以「換行」做成整表統一 1/2/3 行，不是逐列自動長高。
export const ROW_H_1 = 34; // 一行的列高
export const LINE_H = 17; // 多行時每多一行加的高度（要與 CSS 的 line-height 一致）
export const HEAD_H = 34; // 表頭高度
export const MIN_COL = 80; // 拉欄寬的下限
export const MAX_COL = 720; // 上限
export const OVERSCAN = 6;
export const COMMENT_FILE = "_comments.json";

export const NOTE_COL = "__note";
export const KEY_COL = "__key";

// 欄寬預設值。使用者拉過的欄寬記在 widths，colWidth() 是唯一的查詢入口 ——
// 凍結欄的 left 位移是從實際欄寬累加出來的，兩邊要吃同一份數字才不會脫節。
export const W = { key: 260, note: 200, cell: 180, add: 46 } as const;

export function rowHeight(lines: number): number {
  return ROW_H_1 + (lines - 1) * LINE_H;
}
