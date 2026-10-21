import { COMMENT_FILE } from "./constants";
import { flatten, isBlank } from "./flatten";
import { commonFormat, DEFAULT_FORMAT, detectFormat, detectIndent, mostCommon } from "./format";
import { keySegments, sectionSegments } from "./keys";
import { baseName, relFor } from "./layout";
import { sortLocales } from "./locales";
import type { ChangedFile, Classified, Doc } from "./types";

export function createEmptyDoc(): Doc {
  return {
    order: [],
    files: {},
    rel: {},
    pattern: "{code}.json",
    ns: "",
    format: {},
    data: {},
    base: {},
    fileKeys: {},
    newLocales: {},
    deletedLocales: {},
    extraKeys: {},
    comments: {},
    commentsBase: {},
    commentsMeta: {
      file: COMMENT_FILE,
      rel: COMMENT_FILE,
      format: { ...DEFAULT_FORMAT },
      existed: false,
    },
    keyOrder: [],
    paths: {},
    flatKeys: false,
  };
}

/** 檔案壞掉時要知道是哪一個 */
function parseFile(doc: Doc, rel: string, text: string) {
  try {
    return flatten(JSON.parse(text), doc.paths);
  } catch (err) {
    throw new Error(rel + "：" + (err instanceof Error ? err.message : String(err)), {
      cause: err,
    });
  }
}

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * 把分類好的檔案讀進 doc。code 是 classifyFiles() 判斷出來的，
 * 不是從檔名推的 —— 巢狀版面每個檔都叫 translation.json。
 * 讀完會排好語系順序、建好 keyOrder。
 */
export function ingest(doc: Doc, sorted: Classified): void {
  doc.pattern = sorted.pattern;
  doc.ns = sorted.ns;

  // `{}` 這種看不出縮排的檔跟著其他檔走，不然一填值就變成另一種縮排
  const texts = sorted.locales.map((e) => e.text);
  if (sorted.comments) texts.push(sorted.comments.text);
  const indents = texts.map(detectIndent).filter((s): s is string => s !== null);
  const fallbackIndent = mostCommon(indents) ?? DEFAULT_FORMAT.indent;

  for (const entry of sorted.locales) {
    const flat = parseFile(doc, entry.rel, entry.text);
    doc.files[entry.code] = entry.name;
    doc.rel[entry.code] = entry.rel;
    doc.format[entry.code] = detectFormat(entry.text, fallbackIndent);
    doc.data[entry.code] = flat;
    doc.base[entry.code] = { ...flat };
    doc.fileKeys[entry.code] = Object.keys(flat);
    if (!doc.order.includes(entry.code)) doc.order.push(entry.code);
  }

  /* 平層專案：沒有任何巢狀，而且真的有 key 用 . 分組（"a.b.c"）。
     只是含 "Loading..." 這種 key 的平層檔不算 —— 那種 . 不是分組，新 key 照舊寫成巢狀。
     備註檔不列入判斷：它是這個工具自己寫的，可能已經是巢狀，不代表專案的語系檔怎麼寫。 */
  const keys = doc.order.flatMap((c) => Object.keys(doc.data[c]));
  doc.flatKeys =
    keys.every((k) => keySegments(k, { paths: doc.paths, flatKeys: false }).length === 1) &&
    keys.some((k) => sectionSegments(k).length > 1);

  // 還不存在的備註檔：第一次寫出去時排版跟語系檔一樣
  doc.commentsMeta = {
    file: baseName(sorted.commentsRel),
    rel: sorted.commentsRel,
    format: commonFormat(doc.order.map((c) => doc.format[c])),
    existed: false,
  };
  if (sorted.comments) {
    const flat = parseFile(doc, sorted.comments.rel, sorted.comments.text);
    doc.comments = flat;
    doc.commentsBase = { ...flat };
    doc.commentsMeta = {
      file: sorted.comments.name,
      rel: sorted.comments.rel,
      format: detectFormat(sorted.comments.text, fallbackIndent),
      existed: true,
    };
  }

  doc.order = sortLocales(doc.order);
  rebuildKeyOrder(doc);
}

export function rebuildKeyOrder(doc: Doc): void {
  const seen = new Set<string>();
  const order: string[] = [];
  const take = (k: string) => {
    if (!seen.has(k)) {
      seen.add(k);
      order.push(k);
    }
  };
  for (const code of doc.order) Object.keys(doc.data[code] || {}).forEach(take);
  // 只存在於備註檔的 key 也要看得到，否則備註會變孤兒
  Object.keys(doc.comments).forEach(take);
  // 這次新增但還沒填任何值的 key，不列進來就會在下次重建時消失
  Object.keys(doc.extraKeys).forEach(take);
  doc.keyOrder = order;
}

/* 語系的組成變了時用這個，不能直接 rebuildKeyOrder()：這次新增的 key 是插在
   使用者點的那一列下面，重建會把它們全擠到最後 —— 而且 mergeKeyOrder() 是照
   keyOrder 決定新 key 寫進檔案的位置，連存出去的 JSON 都會跟著變。所以只做增減：
   已經沒有任何來源的 key 拿掉，復原回來的 key 插回它在原檔裡前一個 key 的後面。 */
export function syncKeyOrder(doc: Doc): void {
  const live = new Set<string>();
  for (const code of doc.order) Object.keys(doc.data[code] || {}).forEach((k) => live.add(k));
  Object.keys(doc.comments).forEach((k) => live.add(k));
  Object.keys(doc.extraKeys).forEach((k) => live.add(k));

  const order = doc.keyOrder.filter((k) => live.has(k));
  const seen = new Set(order);
  for (const code of doc.order) {
    let prev = "";
    for (const k of Object.keys(doc.data[code] || {})) {
      if (!seen.has(k)) {
        const at = prev ? order.indexOf(prev) : -1;
        if (at === -1) order.push(k);
        else order.splice(at + 1, 0, k);
        seen.add(k);
      }
      prev = k;
    }
  }
  doc.keyOrder = order;
}

// ------------------------------------------------------------------
// 變更追蹤
// ------------------------------------------------------------------

/* 拿「實際會寫出去的內容」跟載入時的快照比，
   而不是比 data —— 否則點過但留白的格子會讓檔案被誤判成有變更。
   等同於 effectiveFlat() 跟 base 逐一比對，但不配置新物件 —— 每打一個字都會跑一次。 */
export function localeChanged(doc: Doc, code: string): boolean {
  // 新語系的 base 也是空的，不特別處理的話永遠不會被寫出來
  if (doc.newLocales[code]) return true;
  const flat = doc.data[code] || {};
  const base = doc.base[code] || {};
  const originally = new Set(doc.fileKeys[code] || []);
  let n = 0;
  for (const k of Object.keys(flat)) {
    if (!originally.has(k) && isBlank(flat[k])) continue;
    n += 1;
    if (flat[k] !== base[k]) return true;
  }
  return n !== Object.keys(base).length;
}

export function commentsChanged(doc: Doc): boolean {
  const a = doc.comments;
  const b = doc.commentsBase;
  const ka = Object.keys(a).filter((k) => !isBlank(a[k]));
  const kb = Object.keys(b).filter((k) => !isBlank(b[k]));
  if (ka.length !== kb.length) return true;
  // 跟「兩邊各自 JSON.stringify 再比」等價：key 順序也算
  for (let i = 0; i < ka.length; i += 1) {
    if (ka[i] !== kb[i] || a[ka[i]] !== b[kb[i]]) return true;
  }
  return false;
}

export interface ChangeSummary {
  code: string | null;
  rel: string;
  deleted?: boolean;
}

/** 會被寫出去的檔案清單，不含內容。打字時用這個算按鈕上的數字，不用每次都序列化。 */
export function changeSummary(doc: Doc): ChangeSummary[] {
  const list: ChangeSummary[] = doc.order
    .filter((code) => localeChanged(doc, code))
    .map((code) => ({ code, rel: relFor(doc, code) }));
  for (const code of Object.keys(doc.deletedLocales)) {
    list.push({ code, rel: doc.deletedLocales[code].rel, deleted: true });
  }
  if (commentsChanged(doc)) list.push({ code: null, rel: doc.commentsMeta.rel || COMMENT_FILE });
  return list;
}

export function dirtyCellCount(doc: Doc, code: string): number {
  const a = doc.data[code] || {};
  const b = doc.base[code] || {};
  let n = 0;
  for (const k of Object.keys(a)) if (a[k] !== b[k]) n += 1;
  return n;
}

// ------------------------------------------------------------------
// 結構操作（key / 語系的增刪改）
// ------------------------------------------------------------------

export function renameKey(doc: Doc, key: string, next: string): void {
  for (const code of doc.order) {
    const flat = doc.data[code];
    if (!has(flat, key)) continue;
    flat[next] = flat[key];
    delete flat[key];
  }
  if (has(doc.comments, key)) {
    doc.comments[next] = doc.comments[key];
    delete doc.comments[key];
  }
  if (doc.extraKeys[key]) {
    delete doc.extraKeys[key];
    doc.extraKeys[next] = true;
  }
  // 新名稱是使用者打的，照專案的寫法（平層或照 . 分層）；含 . 的舊 key 改過名就不再是例外
  delete doc.paths[key];
  // 原地換掉，不要跑到列表最後面
  const at = doc.keyOrder.indexOf(key);
  if (at === -1) doc.keyOrder.push(next);
  else doc.keyOrder[at] = next;
}

export function deleteKey(doc: Doc, key: string): void {
  for (const code of doc.order) delete doc.data[code][key];
  delete doc.comments[key];
  delete doc.extraKeys[key];
  delete doc.paths[key];
  doc.keyOrder = doc.keyOrder.filter((k) => k !== key);
}

/** 新語系照現有版面擺，排版（縮排、換行字元、檔尾換行）跟著現有檔案的多數走。回傳它的相對路徑。 */
export function addLocale(doc: Doc, code: string): string {
  const format = commonFormat(doc.order.map((c) => doc.format[c]));
  const rel = relFor(doc, code);
  doc.files[code] = baseName(rel);
  doc.rel[code] = rel;
  doc.format[code] = format;
  doc.data[code] = {};
  doc.base[code] = {};
  doc.fileKeys[code] = [];
  doc.newLocales[code] = true;
  doc.order = sortLocales([...doc.order, code]);
  return rel;
}

/** 把一個語系從編輯狀態裡整個拿掉。刪檔、放棄新語系都走這裡。 */
export function dropLocale(doc: Doc, code: string): void {
  delete doc.files[code];
  delete doc.rel[code];
  delete doc.format[code];
  delete doc.data[code];
  delete doc.base[code];
  delete doc.fileKeys[code];
  delete doc.newLocales[code];
  doc.order = doc.order.filter((c) => c !== code);
  syncKeyOrder(doc);
}

/** 標記刪除：先從表格拿掉、留一份快照，等存檔 / 提交時才真的刪檔 */
export function markLocaleDeleted(
  doc: Doc,
  code: string,
  view: { hidden: boolean; pinned: boolean },
): void {
  doc.deletedLocales[code] = {
    file: doc.files[code],
    rel: relFor(doc, code),
    format: doc.format[code],
    data: doc.data[code],
    base: doc.base[code],
    fileKeys: doc.fileKeys[code],
    hidden: view.hidden,
    pinned: view.pinned,
  };
  dropLocale(doc, code);
}

/** 復原標記刪除的語系。回傳快照（呼叫端要把隱藏 / 釘選還回去），已存在就回 null。 */
export function restoreLocale(doc: Doc, code: string) {
  const snap = doc.deletedLocales[code];
  if (!snap || doc.data[code]) return null;
  delete doc.deletedLocales[code];
  doc.files[code] = snap.file;
  doc.rel[code] = snap.rel;
  doc.format[code] = snap.format;
  doc.data[code] = snap.data;
  doc.base[code] = snap.base;
  doc.fileKeys[code] = snap.fileKeys;
  doc.order = sortLocales([...doc.order, code]);
  syncKeyOrder(doc);
  return snap;
}

/* 寫出去成功之後把基準線推到「剛寫出去的內容」。資料夾存檔與 GitLab commit 共用。
   直接解析剛寫出去的內容當新基準：新填的 key 經過 setNested 之後會落在它所屬的
   物件裡，順序跟 flat 的順序不一定一樣，所以用寫出去的結果回推最準。 */
export function rebaseline(doc: Doc, changed: ChangedFile[]): void {
  for (const f of changed) {
    if (f.deleted) {
      if (f.code) delete doc.deletedLocales[f.code]; // 檔案已經不在了
    } else if (f.code) {
      // 只往 paths 加不重建：沒寫出去的語系貢獻的分層也還要留著
      const written = flatten(JSON.parse(f.text || "{}"), doc.paths);
      doc.base[f.code] = written;
      doc.fileKeys[f.code] = Object.keys(written);
      delete doc.newLocales[f.code]; // 檔案已經落地了
    } else {
      doc.commentsBase = { ...doc.comments };
      doc.commentsMeta.existed = true;
    }
  }
  // 已經落地的新 key 不用再另外記著
  for (const k of Object.keys(doc.extraKeys)) {
    const landed = doc.order.some((code) => has(doc.base[code] || {}, k));
    if (landed || doc.commentsBase[k]) delete doc.extraKeys[k];
  }
}

// ------------------------------------------------------------------
// 草稿
// ------------------------------------------------------------------

/** 一份檔的草稿：只放有改過的語系 */
export interface DraftPart {
  data: Record<string, Record<string, string>>;
  comments?: Record<string, string>;
  extraKeys?: Record<string, unknown>;
  newLocales?: Record<string, unknown>;
}

export interface Draft {
  version: 3;
  ts: number;
  /** 草稿是從哪一份資料改出來的。還原時拿來跟現在的來源比對。 */
  source: string;
  /** ns -> 那一份檔的草稿。只有一份檔時 ns 是空字串 */
  parts: Record<string, DraftPart>;
}

/** 從 IndexedDB 讀回來的東西不一定是草稿：至少要有 parts，認不得就是 null。 */
export function upgradeDraft(raw: unknown): Draft | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const ts = typeof d.ts === "number" ? d.ts : 0;
  const source = typeof d.source === "string" ? d.source : "";
  if (d.parts && typeof d.parts === "object") {
    return { version: 3, ts, source, parts: d.parts as Draft["parts"] };
  }
  return null;
}

function buildPart(doc: Doc): DraftPart {
  const data: DraftPart["data"] = {};
  for (const code of doc.order) if (localeChanged(doc, code)) data[code] = { ...doc.data[code] };
  return {
    data,
    comments: { ...doc.comments },
    extraKeys: { ...doc.extraKeys },
    newLocales: { ...doc.newLocales },
  };
}

/** 草稿只放有改過的檔。token 與 GitLab 連線狀態永遠不在裡面。 */
export function buildDraft(docs: Doc[], source: string): Draft {
  const parts: Draft["parts"] = {};
  for (const doc of docs) {
    if (changeSummary(doc).length || Object.keys(doc.extraKeys).length)
      parts[doc.ns] = buildPart(doc);
  }
  return { version: 3, ts: Date.now(), source, parts };
}

/** 草稿裡目前確實存在的語系 */
export function draftLocales(doc: Doc, part: DraftPart): string[] {
  return Object.keys(part.data || {}).filter((c) => doc.data[c]);
}

export function applyDraft(doc: Doc, part: DraftPart): void {
  for (const code of draftLocales(doc, part)) doc.data[code] = { ...part.data[code] };
  if (part.comments) doc.comments = { ...part.comments };
  if (part.extraKeys) {
    doc.extraKeys = {};
    for (const k of Object.keys(part.extraKeys)) doc.extraKeys[k] = true;
  }
  // 只還原目前確實存在的語系，避免留下沒有欄位的幽靈紀錄
  if (part.newLocales) {
    for (const c of Object.keys(part.newLocales)) if (doc.data[c]) doc.newLocales[c] = true;
  }
  rebuildKeyOrder(doc);
}
