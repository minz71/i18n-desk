import { isBlank, setNested } from "./flatten";
import { formatJson } from "./format";
import { keySegments, type KeyStore } from "./keys";
import type { Doc, Flat, TextFormat } from "./types";

/* 序列化的核心規則：**保留每個檔案自己原本的 key 順序**，
   只把新填的 key 接在後面。沒有「來源語系」，沒有統一排序，
   所以改一句話就只有一行 diff，也不需要先做什麼正規化。 */

/* 把「這個檔原本沒有的 key」排到它在畫面上的鄰居後面。
   不這樣做的話新 key 只會被丟到所屬群組的最後一個，
   跟使用者按下「在這一列下面新增」看到的位置不一致。

   乾淨載入時 flat 不會有 fileOrder 以外的 key，這段完全不會執行 ——
   逐位元相同的性質因此不受影響。 */
export function mergeKeyOrder(flat: Flat, fileOrder: string[], displayOrder: string[]): string[] {
  const known = new Set(fileOrder);
  const extras = Object.keys(flat).filter((k) => !known.has(k));
  if (!extras.length) return fileOrder;

  const merged = fileOrder.slice();
  for (const key of extras) {
    const displayIndex = displayOrder.indexOf(key);
    let at = -1;
    // 往前找第一個這個檔案也有的 key，插在它後面
    for (let i = displayIndex - 1; i >= 0; i -= 1) {
      const candidate = merged.indexOf(displayOrder[i]);
      if (candidate !== -1) {
        at = candidate;
        break;
      }
    }
    if (at === -1) merged.unshift(key);
    else merged.splice(at + 1, 0, key);
  }
  return merged;
}

export function toJsonText(
  flat: Flat,
  fileOrder: string[],
  format: TextFormat,
  displayOrder: string[],
  store: KeyStore,
): string {
  const out: Record<string, unknown> = {};
  const emitted = new Set<string>();
  for (const k of mergeKeyOrder(flat, fileOrder, displayOrder)) {
    if (Object.prototype.hasOwnProperty.call(flat, k)) {
      setNested(out, keySegments(k, store), flat[k]);
      emitted.add(k);
    }
  }
  // 保險：萬一還有漏的，寧可放最後也不要弄丟
  for (const k of Object.keys(flat)) {
    if (!emitted.has(k)) setNested(out, keySegments(k, store), flat[k]);
  }

  // 縮排、換行字元、檔尾換行都照原檔，否則整份檔都會被當成改過
  return formatJson(out, format);
}

/* 實際會被寫進檔案的內容。
   原本就在檔案裡的 key 一律保留（就算被清空，也不要默默刪掉別人的行）；
   但這個檔原本沒有、現在也還是空的 key 不寫進去 ——
   否則點一下又清掉，就會平白多出一個空欄位。 */
export function effectiveFlat(doc: Doc, code: string): Flat {
  const flat = doc.data[code] || {};
  const originally = new Set(doc.fileKeys[code] || []);
  const out: Flat = {};
  for (const k of Object.keys(flat)) {
    if (originally.has(k) || !isBlank(flat[k])) out[k] = flat[k];
  }
  return out;
}

export function serialize(doc: Doc, code: string): string {
  return toJsonText(
    effectiveFlat(doc, code),
    doc.fileKeys[code] || [],
    doc.format[code],
    doc.keyOrder,
    doc,
  );
}

export function nonBlank(flat: Flat): Flat {
  const out: Flat = {};
  for (const k of Object.keys(flat)) if (!isBlank(flat[k])) out[k] = flat[k];
  return out;
}

export function serializeComments(doc: Doc): string {
  // 備註沒有「原檔順序」可循，就照畫面的列順序，一樣是穩定的
  // 平層專案的備註檔也寫成平層
  return toJsonText(
    nonBlank(doc.comments),
    doc.keyOrder,
    doc.commentsMeta.format,
    doc.keyOrder,
    doc,
  );
}
