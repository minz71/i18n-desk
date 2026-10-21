import type { TextFormat } from "./types";

/* 寫回去的排版一律照原檔：縮排幾格、換行是 LF 還是 CRLF、檔尾有沒有換行。
   任何一項跟原檔不同，MR 上看起來就是整份檔每一行都被改過。 */

/** 沒有原檔可以參考（全新的資料夾）時才用 */
export const DEFAULT_FORMAT: TextFormat = { eol: "\n", indent: "  ", finalNewline: true };

/** 第一個有縮排的行就是第一層，它的縮排就是一層的寬度。`{}` 或壓成一行的檔看不出來，回 null。 */
export function detectIndent(text: string): string | null {
  const m = /^([ \t]+)\S/m.exec(text);
  return m ? m[1] : null;
}

export function detectFormat(text: string, fallbackIndent = DEFAULT_FORMAT.indent): TextFormat {
  return {
    eol: /\r\n/.test(text) ? "\r\n" : "\n",
    indent: detectIndent(text) ?? fallbackIndent,
    finalNewline: /\n$/.test(text),
  };
}

/** 出現最多次的那個，平手取先出現的 */
export function mostCommon<T>(items: T[], key: (item: T) => string = String): T | undefined {
  const counts = new Map<string, number>();
  let best: T | undefined;
  let bestCount = 0;
  for (const item of items) {
    const k = key(item);
    const n = (counts.get(k) || 0) + 1;
    counts.set(k, n);
    if (n > bestCount) {
      best = item;
      bestCount = n;
    }
  }
  return best;
}

/** 新檔（新語系、還不存在的備註檔）跟著現有檔案的多數走 */
export function commonFormat(formats: TextFormat[]): TextFormat {
  const pick = mostCommon(formats, (f) => [f.eol, f.indent, f.finalNewline].join("|"));
  return { ...(pick || DEFAULT_FORMAT) };
}

export function formatJson(value: unknown, format: TextFormat): string {
  let text = JSON.stringify(value, null, format.indent);
  if (format.finalNewline) text += "\n";
  return format.eol === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
}
