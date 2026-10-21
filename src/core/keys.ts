import type { Doc } from "./types";

/** 決定 key 怎麼寫回檔案需要的資訊 */
export type KeyStore = Pick<Doc, "paths" | "flatKeys">;

/* key 寫回檔案時的分層一律走這裡，不要自己 split(".")：
   - 檔案裡本身含 . 的 key（例如 "Loading..."）照載入時記下的分層
   - 平層的專案（"a.b.c": "…"）新 key 也寫成平層
   - 其他照 . 切 —— keyPathError 擋掉了開頭、結尾、連續的 .
   畫面上的分區跟這個無關，見 sectionSegments()。 */
export function keySegments(key: string, store?: KeyStore): string[] {
  return store?.paths[key] ?? (store?.flatKeys ? [key] : key.split("."));
}

const isPart = (c: string) => c !== "." && c.trim() !== "";

/* 畫面上的分區一律照 key 字面上的 . 切，跟檔案實際的結構無關 ——
   平層的 "a.b.c" 也有分區（虛擬分區），寫回去還是平層。
   兩邊都要是一般字元才算分隔：連續的 .（"Loading..."）、前後有空白的 .（"Hello. World"）不算。
   不用 lookbehind 的 regex：舊版 Safari 不支援。 */
export function sectionSegments(key: string): string[] {
  const seg: string[] = [];
  let start = 0;
  for (let i = 1; i < key.length - 1; i += 1) {
    if (key[i] === "." && isPart(key[i - 1]) && isPart(key[i + 1])) {
      seg.push(key.slice(start, i));
      start = i + 1;
    }
  }
  seg.push(key.slice(start));
  return seg;
}

/** 所屬分區的前綴（含結尾的 .），最上層是空字串 */
export function keyParent(key: string): string {
  const seg = sectionSegments(key);
  return seg.length < 2 ? "" : seg.slice(0, -1).join(".") + ".";
}

/** key 是不是在 prefix（含結尾的 .）這一區底下，含更深的子分區 */
export function underPrefix(key: string, prefix: string): boolean {
  return keyParent(key).startsWith(prefix);
}

const startsWithSegs = (long: string[], short: string[]) =>
  long.length > short.length && short.every((s, i) => long[i] === s);

/* 新 key 不能跟現有 key 在結構上打架。
   例如已經有字串 common.copy，再加 common.copy.extra 的話，
   setNested 會把那個字串換成物件 —— 翻譯就這樣無聲無息地掉了。
   except 是改名時要排除的自己。 */
export interface KeyConflict {
  type: "duplicate" | "parent" | "child";
  key: string;
}

export function keyConflict(
  keyOrder: string[],
  key: string,
  except: string | null,
  store?: KeyStore,
): KeyConflict | null {
  const seg = keySegments(key, store);
  for (const k of keyOrder) {
    if (k === except) continue;
    if (k === key) return { type: "duplicate", key: k };
    const other = keySegments(k, store);
    if (startsWithSegs(other, seg)) return { type: "parent", key: k };
    if (startsWithSegs(seg, other)) return { type: "child", key: k };
  }
  return null;
}

export function keyPathError(
  keyOrder: string[],
  key: string,
  except: string | null,
  store?: KeyStore,
): string {
  if (!key) return "請輸入 key";
  if (key.startsWith(".") || key.endsWith(".") || /\.\./.test(key)) {
    return "開頭與結尾不能是 .，也不能有連續的 .";
  }

  const conflict = keyConflict(keyOrder, key, except, store);
  if (!conflict) return "";
  if (conflict.type === "duplicate") return key + " 已經存在了";
  if (conflict.type === "parent") {
    return "已經有 " + conflict.key + "，所以 " + key + " 得是一個群組，不能是字串";
  }
  return conflict.key + " 是一個字串，不能再往下分層";
}

/** 對話框裡打的 key：去頭尾空白、連續空白收成一個 */
export function normalizeKeyInput(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/* 把 key 插進畫面順序裡 after 的下一列。
   序列化時 mergeKeyOrder 會依這個順序，把新 key 排到檔案裡同一個位置。 */
export function insertKeyAfter(keyOrder: string[], key: string, after: string): void {
  const at = after ? keyOrder.indexOf(after) : -1;
  if (at === -1) keyOrder.push(key);
  else keyOrder.splice(at + 1, 0, key);
}

/* 新 key 要接在誰後面。路徑可以在對話框裡隨便改，所以「按了哪一列的 +」
   只是偏好：還在同一層才真的接在那一列下面；改到別組的話，
   接在共用前綴最長的那一組的最後一個 key 後面 —— 這也是它寫進
   巢狀 JSON 後實際會在的位置，畫面才不會跟檔案對不起來。平層的檔也照這個排，分區才連得起來。 */
export function placementAnchor(keyOrder: string[], key: string, preferred: string): string {
  if (preferred && keyParent(preferred) === keyParent(key)) return preferred;
  const seg = sectionSegments(key);
  for (let n = seg.length - 1; n > 0; n -= 1) {
    const prefix = seg.slice(0, n).join(".") + ".";
    for (let i = keyOrder.length - 1; i >= 0; i -= 1) {
      if (underPrefix(keyOrder[i], prefix)) return keyOrder[i];
    }
  }
  return "";
}
