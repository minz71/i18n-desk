import { COMMENT_FILE } from "./constants";
import { isKnownLocale, looksLikeLocale } from "./locales";
import type { Classified, Doc, Layout, LoadedFile, LocaleEntry } from "./types";

/* 語系檔擺在哪裡用「路徑樣板」描述，載入時自己判斷：
     {code}.json                  扁平：語系代碼 = 檔名
     {code}/translation.json      每個語系一個資料夾（i18next 預設）
     {code}/json/{ns}.json        每個語系底下好幾份檔（text.json、errorMessage.json）
     {ns}/{code}.json             反過來，按檔名分資料夾
   {code} 是語系，{ns} 是同一個語系底下的哪一份檔（命名空間，畫面上一份一個分頁）。
   讀、寫回、新增語系、刪語系都照同一個樣板，不會各自猜。 */

export const CODE = "{code}";
export const NS = "{ns}";

/** 最多看到第幾層（含檔名）。i18n/eng/json/text.json 從專案的 assets 選下去剛好五層 */
export const MAX_DEPTH = 5;

/* 不往裡面找的資料夾：套件、建置產物、Cocos Creator 的快取。
   選錯成專案根目錄時，這些裡面是幾萬個跟語系無關的 JSON。 */
const SKIP_DIRS = new Set([
  "node_modules",
  "library",
  "temp",
  "build",
  "dist",
  "local",
  "profiles",
]);

export function isLocaleFile(name: string): boolean {
  // 底線開頭的是附屬檔（_comments.json），不是語系
  return /\.json$/i.test(name) && name.charAt(0) !== "_";
}

export class LayoutError extends Error {}

/** 讀資料夾時要不要往這個子資料夾裡走。點開頭的不看 —— .git、.creator 都不是語系 */
export function isCandidateDir(name: string): boolean {
  return !!name && name.charAt(0) !== "." && !SKIP_DIRS.has(name);
}

/* 從資料夾讀檔時哪些路徑值得考慮：不超過 MAX_DEPTH、只看 .json。
   macOS 在外接碟上留的 ._en.json 也是點開頭，一起擋掉。
   真正要讀哪些，等樣板判斷完才決定（見 wantedRels）。 */
export function isLocaleCandidate(rel: string): boolean {
  const seg = rel.split("/");
  if (seg.length > MAX_DEPTH) return false;
  const name = seg[seg.length - 1];
  if (!name || name.charAt(0) === "." || !/\.json$/i.test(name)) return false;
  return seg.slice(0, -1).every(isCandidateDir);
}

// ------------------------------------------------------------------
// 樣板
// ------------------------------------------------------------------

/** 手動輸入樣板時的檢查。空字串代表沒問題。 */
export function patternError(p: string): string {
  if (!p) return "請輸入樣板";
  if (p.split(CODE).length !== 2) return "樣板裡要有一個 {code}（語系代碼的位置）";
  if (p.split(NS).length > 2) return "{ns} 最多只能有一個";
  if (!/\.json$/i.test(p)) return "樣板要以 .json 結尾";
  const seg = p.split("/");
  if (seg.some((s) => !s || s === "." || s === ".."))
    return "路徑不能有空的段、. 或 ..，開頭也不要加 /";
  if (seg.length > MAX_DEPTH) return "最多只能 " + MAX_DEPTH + " 層";
  return "";
}

export function fillPattern(p: string, code: string, ns = ""): string {
  return p.replace(CODE, code).replace(NS, ns);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const compiled = new Map<string, RegExp>();

function patternRe(p: string): RegExp {
  let re = compiled.get(p);
  if (!re) {
    const body = escapeRe(p)
      .replace(escapeRe(CODE), "(?<code>[^/]+)")
      .replace(escapeRe(NS), "(?<ns>[^/]+)");
    re = new RegExp("^" + body + "$");
    compiled.set(p, re);
  }
  return re;
}

/** 底線、點開頭的不當語系代碼或檔名 —— 那是附屬檔或隱藏檔 */
const validPart = (v: string) => !!v && v.charAt(0) !== "_" && v.charAt(0) !== ".";

/** 這個路徑照樣板拆出來是哪個語系、哪一份檔。對不上就是 null。 */
export function matchPattern(p: string, rel: string): { code: string; ns: string } | null {
  const m = patternRe(p).exec(rel);
  if (!m?.groups) return null;
  const code = m.groups.code;
  const ns = m.groups.ns || "";
  if (!validPart(code) || (p.includes(NS) && !validPart(ns))) return null;
  return { code, ns };
}

/* 備註檔放在第一個會變的那一段之前（語系們共同的上層），
   多份檔時一份一個：_comments.text.json、_comments.errorMessage.json。 */
export function commentsRel(p: string, ns: string): string {
  const seg = p.split("/");
  const fixed = seg.slice(
    0,
    seg.findIndex((s) => s.includes(CODE) || s.includes(NS)),
  );
  return [...fixed, ns ? "_comments." + ns + ".json" : COMMENT_FILE].join("/");
}

/* 刪語系時順手收掉的資料夾，由深到淺。只收 {code} 那一段以下的 ——
   {ns}/{code}.json 的 text/ 是所有語系共用的，不能動；
   {code}/json/{ns}.json 的 eng/json、eng 才是這個語系自己的。 */
export function localeDirs(p: string, rel: string): string[] {
  const at = p.split("/").findIndex((s) => s.includes(CODE));
  const seg = rel.split("/");
  const dirs: string[] = [];
  for (let i = seg.length - 2; i >= at; i -= 1) dirs.push(seg.slice(0, i + 1).join("/"));
  return dirs;
}

/* 從路徑猜樣板。每個路徑的每一段都試著當 {code}（再搭配另一段當 {ns}），
   看哪個樣板對到的檔案最像「一排語系」：
     1. 認得的語系代碼最多（en、ja、eng、tch…）
     2. 長得像語系代碼的最多（xx、xxx、xx-YY）
     3. 對到的「語系的檔」最多 —— {code}/json/{ns}.json 對到 14 個，贏過 {code}/json/text.json 的 7 個
     4. 越單純越好：不用 {ns} 的優先，再來是對到的檔案多的、層數少的
   {ns} 那一段至少要有兩種值、而且各自出現在一半以上的語系裡 —— 不然它只是固定的檔名，
   旁邊多一個 en-US/backup.json 就會把 {code}/translation.json 拆成兩個分頁，
   連備註檔的位置都跟著變。 */
export function detectPattern(rels: string[]): string | null {
  interface Tally {
    files: number;
    localeFiles: number;
    codes: Set<string>;
    /** ns -> 有這份檔的語系 */
    nss: Map<string, Set<string>>;
    hasNs: boolean;
    depth: number;
  }
  const tally = new Map<string, Tally>();

  for (const rel of rels) {
    if (!isLocaleCandidate(rel)) continue;
    const seg = rel.split("/");
    const last = seg.length - 1;
    if (!isLocaleFile(seg[last])) continue;
    const ext = seg[last].slice(seg[last].length - 5); // 保留原本的大小寫
    const valueAt = (i: number) => (i === last ? seg[last].slice(0, -5) : seg[i]);
    const holeAt = (parts: string[], i: number, hole: string) => {
      parts[i] = i === last ? hole + ext : hole;
    };

    for (let i = 0; i <= last; i += 1) {
      const code = valueAt(i);
      if (!validPart(code)) continue;
      for (let j = -1; j <= last; j += 1) {
        if (j === i) continue;
        const ns = j === -1 ? "" : valueAt(j);
        if (j !== -1 && !validPart(ns)) continue;
        const parts = seg.slice();
        holeAt(parts, i, CODE);
        if (j !== -1) holeAt(parts, j, NS);
        const key = parts.join("/");
        let t = tally.get(key);
        if (!t) {
          t = {
            files: 0,
            localeFiles: 0,
            codes: new Set(),
            nss: new Map(),
            hasNs: j !== -1,
            depth: seg.length,
          };
          tally.set(key, t);
        }
        t.files += 1;
        if (looksLikeLocale(code)) t.localeFiles += 1;
        t.codes.add(code);
        if (ns) {
          const have = t.nss.get(ns) || new Set<string>();
          have.add(code);
          t.nss.set(ns, have);
        }
      }
    }
  }

  const score = (t: Tally) => {
    const codes = [...t.codes];
    return [
      codes.filter(isKnownLocale).length,
      codes.filter(looksLikeLocale).length,
      t.localeFiles,
      // 旁邊多一個 tools/config.json 不該讓 {code}/{ns}.json 贏過 {code}/translation.json
      t.hasNs ? 0 : 1,
      t.files,
      -t.depth,
    ];
  };
  let best: string | null = null;
  let bestScore: number[] = [];
  for (const [key, t] of [...tally].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (t.hasNs) {
      const common = [...t.nss.values()].filter((have) => have.size * 2 >= t.codes.size).length;
      if (common < 2) continue;
    }
    const sc = score(t);
    const i = sc.findIndex((v, k) => v !== bestScore[k]);
    if (best === null || (i !== -1 && sc[i] > bestScore[i])) {
      best = key;
      bestScore = sc;
    }
  }
  return best;
}

/** 照樣板要讀哪些檔：對得上的語系檔，加上各份檔的備註檔 */
export function wantedRels(rels: string[], p: string): string[] {
  const nss = new Set<string>();
  const out: string[] = [];
  for (const rel of rels) {
    const m = matchPattern(p, rel);
    if (m && isLocaleFile(baseName(rel))) {
      out.push(rel);
      nss.add(m.ns);
    }
  }
  const comments = new Set([...nss].map((ns) => commentsRel(p, ns)));
  return out.concat(rels.filter((rel) => comments.has(rel)));
}

/* 照樣板把檔案分成一份一份。沒給樣板就自己猜。
   對不上樣板的檔案不讀 —— 猜錯的代價是把 foo/bar.json 當成一個叫 foo 的語系，然後寫回去。 */
export function classifyFiles(loaded: LoadedFile[], pattern?: string): Layout {
  const p = pattern || detectPattern(loaded.map((f) => f.rel));
  if (!p) throw new LayoutError("看不出哪一段路徑是語系代碼");

  const groups = new Map<string, LocaleEntry[]>();
  for (const f of loaded) {
    const m = matchPattern(p, f.rel);
    if (!m || !isLocaleFile(f.name)) continue;
    const list = groups.get(m.ns) || [];
    list.push({ code: m.code, name: f.name, rel: f.rel, text: f.text });
    groups.set(m.ns, list);
  }

  const sets: Classified[] = [...groups.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((ns) => {
      const rel = commentsRel(p, ns);
      return {
        ns,
        pattern: p.replace(NS, ns),
        locales: groups.get(ns)!,
        comments: loaded.find((f) => f.rel === rel) || null,
        commentsRel: rel,
      };
    });
  return { pattern: p, sets };
}

/** 某個語系落在哪個相對路徑。已載入的用 rel，新增的照樣板推。 */
export function relFor(doc: Doc, code: string): string {
  return doc.rel[code] || fillPattern(doc.pattern, code);
}

/** 新增語系對話框裡的提示：會建立哪種路徑 */
export function newLocalePattern(doc: Doc): string {
  return fillPattern(doc.pattern, "<代碼>");
}

/** webkitdirectory 給的路徑帶著根資料夾名稱（locales/en.json），拿掉才是 rel */
export function splitRoot(path: string): { root: string; rel: string } {
  const i = path.indexOf("/");
  return i < 0 ? { root: "", rel: path } : { root: path.slice(0, i), rel: path.slice(i + 1) };
}

export function baseName(rel: string): string {
  return rel.slice(rel.lastIndexOf("/") + 1);
}

/** 拖進來的檔案只有檔名。回傳第一個重複的檔名（沒有就是空字串）。 */
export function duplicateName(files: { name: string }[]): string {
  const seen = new Set<string>();
  let dup = "";
  for (const f of files) {
    if (seen.has(f.name)) dup = f.name;
    seen.add(f.name);
  }
  return dup;
}
