import { isBlank } from "./flatten";
import type { Doc } from "./types";

// i18next 的 {{name}}，以及 formatIndexedTemplate 那類的 {0}
const PLACEHOLDER_RE = /\{\{\s*[^}]+?\s*\}\}|\{\d+\}/g;

export function signature(text: string | undefined): string {
  return (String(text || "").match(PLACEHOLDER_RE) || [])
    .map((t) => t.replace(/\s+/g, ""))
    .sort()
    .join("|");
}

const NONE: ReadonlySet<string> = new Set();

/* 同一個 key、所有非空的值互相比對，取多數的佔位符組合為準。
   沒有明確多數（例如 2 對 2）時，整排都標起來讓人自己判斷。
   多數決本身用全部語系（資料越多越準），標不標紅才看顯示中的欄位。 */
export function outliersFor(doc: Doc, key: string): ReadonlySet<string> {
  const tally = new Map<string, number>();
  const sigs = new Map<string, string>();

  for (const code of doc.order) {
    const value = (doc.data[code] || {})[key];
    if (isBlank(value)) continue;
    const sig = signature(value);
    sigs.set(code, sig);
    tally.set(sig, (tally.get(sig) || 0) + 1);
  }

  if (sigs.size <= 1 || tally.size <= 1) return NONE;

  let best: string | null = null;
  let bestCount = 0;
  let tie = false;
  for (const [sig, n] of tally) {
    if (n > bestCount) {
      best = sig;
      bestCount = n;
      tie = false;
    } else if (n === bestCount) {
      tie = true;
    }
  }

  const set = new Set<string>();
  for (const [code, sig] of sigs) {
    if (tie || sig !== best) set.add(code);
  }
  return set;
}
