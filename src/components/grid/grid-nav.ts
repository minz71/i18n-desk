import { HEAD_H, NOTE_COL, rowHeight } from "@/core/constants";
import { getState, selectLayout } from "@/store/editor";

/* 鍵盤移列與對焦。虛擬捲動下目標列可能還不在 DOM 裡：
   先把捲動位置調好，等表格畫出那一列再對焦。 */

let viewportEl: HTMLElement | null = null;

export function setViewport(el: HTMLElement | null): void {
  viewportEl = el;
}

/* 程式自己改捲動位置之後，同步補一個 scroll 事件。虛擬捲動是聽 scroll 事件更新範圍的，
   原生事件要等下一次繪製才會送 —— 分頁在背景或剛換掉一整份資料時，
   畫面會停在舊的範圍（例如第一列不見），對焦也會等不到目標列。 */
export function setScrollTop(el: HTMLElement, top: number): void {
  el.scrollTop = top;
  el.dispatchEvent(new Event("scroll"));
}

function cssEscape(v: string): string {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(v) : v.replace(/["\\]/g, "\\$&");
}

/** 等到元素出現再對焦。捲動後表格要過一兩個 frame 才會畫出新的列。 */
function focusWhenReady(selector: string, select: boolean, tries = 12): void {
  const attempt = (left: number) => {
    const el = viewportEl?.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
    if (el) {
      el.focus({ preventScroll: true });
      if (select) el.select();
      return;
    }
    if (left > 0) requestAnimationFrame(() => attempt(left - 1));
  };
  attempt(tries);
}

function fieldSelector(key: string, col: string): string {
  return '[data-key="' + cssEscape(key) + '"][data-col="' + cssEscape(col) + '"]';
}

/** 讓第 index 列完整出現在表頭下方。toCenter：跳得遠的時候擺到中間 */
function scrollRowIntoView(index: number, toCenter: boolean): void {
  const viewport = viewportEl;
  if (!viewport) return;
  const h = rowHeight(getState().lines);
  const top = index * h;
  const bottomEdge = top + h + HEAD_H;
  if (toCenter) {
    if (top < viewport.scrollTop || bottomEdge > viewport.scrollTop + viewport.clientHeight) {
      setScrollTop(viewport, Math.max(0, top - viewport.clientHeight / 2));
    }
    return;
  }
  if (top < viewport.scrollTop) setScrollTop(viewport, top);
  else if (bottomEdge > viewport.scrollTop + viewport.clientHeight) {
    setScrollTop(viewport, bottomEdge - viewport.clientHeight);
  }
}

export function moveFocus(key: string, col: string, delta: number): void {
  const { rows } = getState();
  const index = rows.indexOf(key);
  const next = index + delta;
  if (index === -1 || next < 0 || next >= rows.length) return;
  scrollRowIntoView(next, false);
  focusWhenReady(fieldSelector(rows[next], col), true);
}

/** 新增 / 改名之後：捲到那一列，焦點放進第一個語系格 */
export function focusKey(key: string): void {
  const s = getState();
  const index = s.rows.indexOf(key);
  if (index === -1) return;
  scrollRowIntoView(index, true);
  const first = selectLayout(s).find((c) => c.kind === "loc")?.id || NOTE_COL;
  focusWhenReady(fieldSelector(key, first), false);
}
