import type { CSSProperties } from "react";
import { totalWidth, type Column } from "@/core/columns";

/* 欄寬與凍結位移寫成表格根節點上的 CSS 變數，每一格用 var() 去讀。
   拉欄寬時直接改變數（不經過 React），一萬列也不用重畫任何一格。 */

export function layoutVars(layout: Column[]): Record<string, string> {
  const vars: Record<string, string> = { "--grid-w": totalWidth(layout) + "px" };
  layout.forEach((c, i) => {
    vars["--cw-" + i] = c.width + "px";
    if (c.pinned) vars["--cl-" + i] = c.left + "px";
  });
  return vars;
}

export function applyLayoutVars(el: HTMLElement, layout: Column[]): void {
  const vars = layoutVars(layout);
  for (const name of Object.keys(vars)) el.style.setProperty(name, vars[name]);
}

const styleCache = new Map<string, CSSProperties>();

/** 每一格的 style。物件共用，不要每格每次都配置一個新的。 */
export function colStyle(i: number, pinned: boolean): CSSProperties {
  const id = i + (pinned ? "p" : "");
  let style = styleCache.get(id);
  if (!style) {
    style = pinned
      ? { width: "var(--cw-" + i + ")", left: "var(--cl-" + i + ")" }
      : { width: "var(--cw-" + i + ")" };
    styleCache.set(id, style);
  }
  return style;
}
