import { create } from "zustand";
import {
  columnLayout,
  enforcePinnedBudget,
  visibleLocales,
  type Column,
  type ColumnView,
} from "@/core/columns";
import { COMMENT_FILE, NOTE_COL } from "@/core/constants";
import {
  changeSummary,
  commentsChanged,
  createEmptyDoc,
  dirtyCellCount,
  localeChanged,
  type ChangeSummary,
} from "@/core/doc";
import {
  applyFilters,
  filterCounts,
  missingByLocale,
  missingByPrefix,
  type FilterCounts,
  type FilterCtx,
  type FilterName,
} from "@/core/filters";
import { relFor } from "@/core/layout";
import { defaultSource } from "@/core/locales";
import type { Doc } from "@/core/types";
import type { GitLabSession } from "@/gitlab/types";
import { gridApi } from "./grid-api";
import { notify } from "./notify";

/** 三種取得資料的方式，差別只有一個：能不能直接寫回原檔 */
export type Mode = "none" | "folder" | "files" | "gitlab";

export interface EditorState extends ColumnView {
  /**
   * 編輯中的資料。內部是可變的 —— 一萬列 × 43 語系，每打一個字就整份複製太浪費。
   * 改完一定要 bump 版本號：單格用 keyRev[key]（只重畫那一列），
   * 結構變動用 refresh()（docRev，整張表重算）。
   */
  doc: Doc;
  /**
   * 同一個語系底下有好幾份檔（text.json、errorMessage.json）時一份一個 Doc，
   * 畫面一次只編一份 —— doc 就是目前那份分頁。只有一份檔時就是 [doc]。
   */
  docs: Doc[];
  /** 各分頁有幾個檔要寫出去，跟 docs 對齊。目前那份由 updateStatus 跟著更新 */
  tabChanges: number[];
  /** 整個資料夾的路徑樣板，例如 {code}/json/{ns}.json */
  pattern: string;
  mode: Mode;
  dirHandle: FileSystemDirectoryHandle | null;
  /** 從資料夾載入時的資料夾名稱。唯讀的（Safari 等）只有名稱、沒有 dirHandle */
  dirName: string;
  /** GitLab 模式的連線狀態（不含 token） */
  gitlab: GitLabSession | null;
  loadLabel: string;

  // ---- 偏好（記在瀏覽器裡） ----
  /** 每一列顯示幾行（1 = 單行 input，2/3 = textarea） */
  lines: number;
  /** 上次聚焦在哪個語系，再開的時候接回去 */
  lastFocus: string;
  sidebarCollapsed: boolean;

  // ---- 暫時的畫面狀態 ----
  group: string;
  filter: FilterName;
  /** 已經轉小寫、去頭尾空白 */
  query: string;
  collapsed: Record<string, true>;
  /** 最後點過的那一列，新增 key 會插在它下面 */
  currentKey: string;

  // ---- refresh() 算出來的快照 ----
  rows: string[];
  counts: FilterCounts;
  localeMissing: Record<string, number>;
  treeMissing: Record<string, number>;
  changes: ChangeSummary[];
  dirtyCells: number;

  // ---- 版本號 ----
  docRev: number;
  editRev: number;
  keyRev: Record<string, number>;
}

const ZERO_COUNTS: FilterCounts = { all: 0, missing: 0, placeholder: 0, commented: 0, modified: 0 };

const emptyDoc = createEmptyDoc();

export const useEditor = create<EditorState>(() => ({
  doc: emptyDoc,
  docs: [emptyDoc],
  tabChanges: [0],
  pattern: "",
  mode: "none",
  dirHandle: null,
  dirName: "",
  gitlab: null,
  loadLabel: "",

  hidden: {},
  pinned: { [NOTE_COL]: true },
  widths: {},
  lines: 1,
  focus: "",
  lastFocus: "",
  source: "",
  sidebarCollapsed: false,

  group: "",
  filter: "all",
  query: "",
  collapsed: {},
  currentKey: "",

  rows: [],
  counts: ZERO_COUNTS,
  localeMissing: {},
  treeMissing: {},
  changes: [],
  dirtyCells: 0,

  docRev: 0,
  editRev: 0,
  keyRev: {},
}));

export const getState = useEditor.getState;
export const setState = useEditor.setState;

// ------------------------------------------------------------------
// 衍生資料（記憶化）
// ------------------------------------------------------------------

/* 顯示中的語系會在每個 key 的篩選判斷裡被用到，一萬列時是好幾萬次；
   每次都 filter 一個新陣列光是配置就很貴，所以照輸入記住結果。 */
let visibleMemo: { deps: unknown[]; value: string[] } | null = null;

export function selectVisible(s: EditorState): string[] {
  const deps = [s.docRev, s.doc, s.hidden, s.focus, s.source];
  if (!visibleMemo || deps.some((d, i) => d !== visibleMemo!.deps[i])) {
    visibleMemo = { deps, value: visibleLocales(s.doc, s) };
  }
  return visibleMemo.value;
}

let layoutMemo: { deps: unknown[]; value: Column[] } | null = null;

export function selectLayout(s: EditorState): Column[] {
  const visible = selectVisible(s);
  const deps = [visible, s.hidden, s.pinned, s.widths];
  if (!layoutMemo || deps.some((d, i) => d !== layoutMemo!.deps[i])) {
    layoutMemo = { deps, value: columnLayout(visible, s) };
  }
  return layoutMemo.value;
}

export function filterCtx(s: EditorState): FilterCtx {
  return { doc: s.doc, visible: selectVisible(s), group: s.group, query: s.query };
}

/** 所有分頁加起來有幾個檔要寫出去 */
export function totalChanges(s: EditorState): number {
  return s.tabChanges.reduce((a, b) => a + b, 0);
}

/** 重算每個分頁的變更數。打字只會動到目前那份，所以只有切分頁、增刪語系、存檔時才需要 */
export function recountTabs(): void {
  const s = getState();
  setState({
    tabChanges: s.docs.map((d) => (d === s.doc ? s.changes.length : changeSummary(d).length)),
  });
}

export function canDeleteLocales(s: EditorState): boolean {
  return s.mode === "folder" || s.mode === "gitlab";
}

// ------------------------------------------------------------------
// 重算
// ------------------------------------------------------------------

/* 偏好可能是別的資料夾留下來的：聚焦 / 對照指到不存在的語系就清掉，
   沒有對照語系的話照常見的來源語言挑一個。 */
export function normalizeFocus(s: EditorState): Partial<EditorState> {
  const { doc } = s;
  let { focus, lastFocus, source } = s;
  if (focus && !doc.data[focus]) focus = "";
  if (lastFocus && !doc.data[lastFocus]) lastFocus = "";
  if (source && !doc.data[source]) source = "";
  if (!source) source = defaultSource(doc.order);
  return { focus, lastFocus, source };
}

/* 變更狀態的快取。打一個字只會動到一個語系（或備註），沒道理每次都把
   43 個語系 × 一萬個 key 全部掃一遍 —— 那樣一個字要 100ms。 */
const status = {
  doc: null as Doc | null,
  changed: new Map<string, boolean>(),
  dirty: new Map<string, number>(),
  commentsChanged: false,
  commentsDirty: 0,
};

function scanComments(doc: Doc): void {
  status.commentsChanged = commentsChanged(doc);
  let n = 0;
  for (const k of Object.keys(doc.comments)) if (doc.comments[k] !== doc.commentsBase[k]) n += 1;
  status.commentsDirty = n;
}

function scanLocale(doc: Doc, code: string): void {
  status.changed.set(code, localeChanged(doc, code));
  status.dirty.set(code, dirtyCellCount(doc, code));
}

/**
 * 按鈕上的變更數、狀態列的「已改 N 格」。
 * code 給語系代碼只重算那個語系，給 null 只重算備註，不給就全部重算。
 */
export function updateStatus(code?: string | null): void {
  const { doc } = getState();
  if (code === undefined || status.doc !== doc) {
    status.doc = doc;
    status.changed.clear();
    status.dirty.clear();
    for (const c of doc.order) scanLocale(doc, c);
    scanComments(doc);
  } else if (code === null) {
    scanComments(doc);
  } else {
    scanLocale(doc, code);
  }

  // 順序跟 changeSummary() 一樣：語系 → 標記刪除 → 備註
  const changes: ChangeSummary[] = [];
  let cells = status.commentsDirty;
  for (const c of doc.order) {
    if (status.changed.get(c)) changes.push({ code: c, rel: relFor(doc, c) });
    cells += status.dirty.get(c) || 0;
  }
  for (const c of Object.keys(doc.deletedLocales)) {
    changes.push({ code: c, rel: doc.deletedLocales[c].rel, deleted: true });
  }
  if (status.commentsChanged)
    changes.push({ code: null, rel: doc.commentsMeta.rel || COMMENT_FILE });
  const s = getState();
  const at = s.docs.indexOf(doc);
  if (at !== -1 && s.tabChanges[at] !== changes.length) {
    const tabChanges = s.tabChanges.slice();
    tabChanges[at] = changes.length;
    setState({ changes, dirtyCells: cells, tabChanges });
  } else {
    setState({ changes, dirtyCells: cells });
  }
}

/* 篩選器的數字與各語系「還缺幾個」要掃全部 key，太貴，打字時另外 debounce */
let countsTimer: ReturnType<typeof setTimeout> | undefined;

export function recountSoon(): void {
  clearTimeout(countsTimer);
  countsTimer = setTimeout(() => {
    const s = getState();
    const ctx = filterCtx(s);
    setState({
      counts: filterCounts(ctx),
      localeMissing: missingByLocale(s.doc),
      treeMissing: missingByPrefix(ctx),
    });
  }, 350);
}

/**
 * 整張表重算。結構變了（載入、增刪 key / 語系、換篩選、改顯示欄位）都走這裡。
 * resetScroll：換篩選 / 搜尋 / 分區時回到頂端；存檔與還原草稿保留位置。
 */
export function refresh(resetScroll = false): void {
  clearTimeout(countsTimer);
  setState((s) => ({ docRev: s.docRev + 1 }));

  if (resetScroll) enforceBudget();

  const s = getState();
  const ctx = filterCtx(s);
  setState({
    rows: applyFilters(ctx, s.filter),
    counts: filterCounts(ctx),
    localeMissing: missingByLocale(s.doc),
    treeMissing: missingByPrefix(ctx),
  });
  updateStatus();
  if (resetScroll) gridApi.resetScrollTop();
}

/** 凍結區超過畫面七成時退掉釘選（見 enforcePinnedBudget） */
export function enforceBudget(): boolean {
  const s = getState();
  if (!s.doc.order.length) return false;
  const width = gridApi.viewportWidth();
  if (!width) return false;
  const fixed = enforcePinnedBudget(selectVisible(s), s, width);
  if (!fixed) return false;
  setState({ pinned: fixed.pinned, widths: fixed.widths });
  if (fixed.dropped) notify("畫面太窄，已取消 " + fixed.dropped + " 個凍結欄");
  return true;
}

/** 單格改了：只重畫那一列 */
export function touchKey(key: string): void {
  const s = getState();
  s.keyRev[key] = (s.keyRev[key] || 0) + 1;
  setState({ editRev: s.editRev + 1 });
}
