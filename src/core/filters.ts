import { isBlank } from "./flatten";
import { sectionSegments, underPrefix } from "./keys";
import { outliersFor } from "./placeholders";
import type { Doc } from "./types";

export type FilterName = "all" | "missing" | "placeholder" | "commented" | "modified";

/** 標紅那一格的滑鼠提示。篩選按鈕的說明比較長，這句是給已經看到紅字的人的。 */
export const PLACEHOLDER_HINT =
  "變數跟其他語言不一致：{{name}}、{0} 這類記號可能被刪掉、打錯或翻譯掉了";

export const FILTERS: { name: FilterName; label: string; hint?: string }[] = [
  { name: "all", label: "全部" },
  { name: "missing", label: "未翻譯" },
  {
    name: "placeholder",
    label: "變數不一致",
    // 給不寫程式的人看：講出變數長什麼樣、出錯會怎樣、怎麼判斷的
    hint:
      "譯文裡的 {{name}}、{0} 會在畫面上換成名字、數字等實際的值，翻譯時要原封不動留著。\n" +
      "這裡列出跟其他語言對不上的 key（變數被刪掉、打錯或翻譯掉了），上線後畫面會出現錯誤的文字。\n" +
      "以大多數語言的寫法為準；分不出多數時，整排都會標起來。",
  },
  { name: "commented", label: "有備註" },
  { name: "modified", label: "已修改" },
];

export type FilterCounts = Record<FilterName, number>;

/**
 * 篩選需要的上下文。visible 是顯示中的語系 ——
 * 篩選與統計只算看得到的欄位（只留德文時，「未翻譯」就是德文沒填的數量）。
 */
export interface FilterCtx {
  doc: Doc;
  visible: string[];
  group: string;
  /** 已經轉小寫、去頭尾空白 */
  query: string;
}

export function isMissing(ctx: FilterCtx, key: string): boolean {
  return ctx.visible.some((code) => isBlank((ctx.doc.data[code] || {})[key]));
}

export function hasComment(doc: Doc, key: string): boolean {
  return !isBlank(doc.comments[key]);
}

export function isModified(doc: Doc, key: string): boolean {
  if (doc.comments[key] !== doc.commentsBase[key]) return true;
  return doc.order.some((code) => (doc.data[code] || {})[key] !== (doc.base[code] || {})[key]);
}

/* 多數決本身用全部語系（資料越多越準），
   但只有看得到的欄位才算「這一列有問題」 */
export function hasPlaceholderIssue(ctx: FilterCtx, key: string): boolean {
  const set = outliersFor(ctx.doc, key);
  // 絕大多數的 key 根本沒有異常，先擋掉就不用每列都掃過所有語系
  if (!set.size) return false;
  return ctx.visible.some((code) => set.has(code));
}

export function matchesQuery(ctx: FilterCtx, key: string): boolean {
  const q = ctx.query;
  if (!q) return true;
  if (key.toLowerCase().includes(q)) return true;
  if (
    String(ctx.doc.comments[key] || "")
      .toLowerCase()
      .includes(q)
  )
    return true;
  return ctx.visible.some((code) =>
    String((ctx.doc.data[code] || {})[key] || "")
      .toLowerCase()
      .includes(q),
  );
}

export function inGroup(group: string, key: string): boolean {
  return !group || underPrefix(key, group + ".");
}

const PREDICATES: Record<FilterName, ((ctx: FilterCtx, key: string) => boolean) | null> = {
  all: null,
  missing: isMissing,
  placeholder: hasPlaceholderIssue,
  commented: (ctx, key) => hasComment(ctx.doc, key),
  modified: (ctx, key) => isModified(ctx.doc, key),
};

export function applyFilters(ctx: FilterCtx, filter: FilterName): string[] {
  const pred = PREDICATES[filter];
  return ctx.doc.keyOrder.filter((key) => {
    if (!inGroup(ctx.group, key) || !matchesQuery(ctx, key)) return false;
    return pred ? pred(ctx, key) : true;
  });
}

export function filterCounts(ctx: FilterCtx): FilterCounts {
  const counts: FilterCounts = { all: 0, missing: 0, placeholder: 0, commented: 0, modified: 0 };
  for (const key of ctx.doc.keyOrder) {
    if (!inGroup(ctx.group, key) || !matchesQuery(ctx, key)) continue;
    counts.all += 1;
    if (isMissing(ctx, key)) counts.missing += 1;
    if (hasPlaceholderIssue(ctx, key)) counts.placeholder += 1;
    if (hasComment(ctx.doc, key)) counts.commented += 1;
    if (isModified(ctx.doc, key)) counts.modified += 1;
  }
  return counts;
}

/* 每個語系還缺幾個 key。43 × 一千多個 key 掃一次是五萬次比較，
   一次算完全部比每顆 chip 各掃一遍便宜太多，所以整批算好。 */
export function missingByLocale(doc: Doc): Record<string, number> {
  const out: Record<string, number> = {};
  for (const code of doc.order) {
    const data = doc.data[code] || {};
    let n = 0;
    for (const key of doc.keyOrder) if (isBlank(data[key])) n += 1;
    out[code] = n;
  }
  return out;
}

/** 分區樹上的數字：該區還有幾個 key 至少缺一個（看得到的）語系 */
export function missingByPrefix(ctx: FilterCtx): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const key of ctx.doc.keyOrder) {
    if (!isMissing(ctx, key)) continue;
    const seg = sectionSegments(key);
    let prefix = "";
    for (let i = 0; i < seg.length - 1; i += 1) {
      prefix = prefix ? prefix + "." + seg[i] : seg[i];
      counts[prefix] = (counts[prefix] || 0) + 1;
    }
  }
  return counts;
}

// ------------------------------------------------------------------
// 分區樹（以 key 字面上的 "." 分組，跟檔案是不是巢狀無關：平層的檔就是虛擬分區）
// ------------------------------------------------------------------

export interface TreeNode {
  name: string;
  path: string;
  children: Map<string, TreeNode>;
  count: number;
}

export function buildTree(keyOrder: string[]): TreeNode {
  const root: TreeNode = { name: "", path: "", children: new Map(), count: 0 };
  for (const key of keyOrder) {
    const seg = sectionSegments(key);
    let node = root;
    for (let i = 0; i < seg.length - 1; i += 1) {
      const name = seg[i];
      let child = node.children.get(name);
      if (!child) {
        child = {
          name,
          path: node.path ? node.path + "." + name : name,
          children: new Map(),
          count: 0,
        };
        node.children.set(name, child);
      }
      node = child;
      node.count += 1;
    }
  }
  return root;
}
