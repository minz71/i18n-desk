import { COMMENT_FILE } from "./constants";
import { changeSummary } from "./doc";
import { baseName, relFor } from "./layout";
import { serialize, serializeComments } from "./serialize";
import type { ChangedFile, Doc } from "./types";

/** 這次要寫出去的檔案（含內容）。name 是檔名，rel 是相對於語系根目錄的路徑，寫回去一律用 rel。 */
export function changedFiles(doc: Doc): ChangedFile[] {
  return changeSummary(doc).map((c) => {
    // 標記刪除的語系：沒有內容，寫出去的那一端看到 deleted 就刪檔
    if (c.deleted)
      return { name: baseName(c.rel), rel: c.rel, text: null, code: c.code, deleted: true };
    if (c.code === null) {
      return { name: doc.commentsMeta.file, rel: c.rel, text: serializeComments(doc), code: null };
    }
    return {
      name: doc.files[c.code] || baseName(c.rel),
      rel: c.rel,
      text: serialize(doc, c.code),
      code: c.code,
    };
  });
}

/** 「下載全部」：所有語系檔，不管有沒有改 */
export function allFiles(doc: Doc): { rel: string; text: string }[] {
  const files = doc.order.map((code) => ({
    rel: relFor(doc, code),
    text: serialize(doc, code),
  }));
  if (Object.keys(doc.comments).length) {
    files.push({ rel: doc.commentsMeta.rel || COMMENT_FILE, text: serializeComments(doc) });
  }
  return files;
}

export function savedSummary(changed: ChangedFile[], verb: string): string {
  const removed = changed.filter((f) => f.deleted).length;
  const written = changed.length - removed;
  const bits: string[] = [];
  if (written) bits.push(verb + " " + written + " 個檔案");
  if (removed) bits.push("刪除 " + removed + " 個語系檔");
  return "已" + bits.join("、");
}
