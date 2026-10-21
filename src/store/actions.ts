import {
  colWidth,
  columnLayout,
  columnScrollLeft,
  pinnedLimit,
  pinnedWidth,
  visibleLocales,
} from "@/core/columns";
import { MAX_COL, MIN_COL, NOTE_COL } from "@/core/constants";
import * as D from "@/core/doc";
import { inGroup, type FilterName } from "@/core/filters";
import { isBlank } from "@/core/flatten";
import {
  insertKeyAfter,
  keyParent,
  keyPathError,
  normalizeKeyInput,
  placementAnchor,
} from "@/core/keys";
import {
  classifyFiles,
  detectPattern,
  duplicateName,
  newLocalePattern,
  patternError,
  relFor,
  splitRoot,
  wantedRels,
} from "@/core/layout";
import { LOCALE_CODE_RE, localeLabel } from "@/core/locales";
import { allFiles, changedFiles, savedSummary } from "@/core/output";
import type { ChangedFile, Doc, Layout } from "@/core/types";
import { clearDraft, readDraft, writeDraft } from "@/io/draft";
import {
  directoryInputRefs,
  droppedDirRefs,
  ensureWritable,
  fileListRefs,
  readRefs,
  walkLocaleDir,
  writeChanges,
  type DropPayload,
  type FileRef,
} from "@/io/directory";
import { jsonBlob, saveBlob, zipBlob } from "@/io/download";
import { rememberPattern, savedPattern } from "@/io/patterns";
import * as gl from "@/gitlab/api";
import { getToken } from "@/gitlab/auth";
import { applyActions, glActions, glShort } from "@/gitlab/host";
import type { GitLabSession } from "@/gitlab/types";
import { confirmDialog, promptDialog } from "./dialog";
import {
  canDeleteLocales,
  getState,
  normalizeFocus,
  recountSoon,
  recountTabs,
  refresh,
  selectLayout,
  selectVisible,
  setState,
  totalChanges,
  touchKey,
  updateStatus,
  type EditorState,
  type Mode,
} from "./editor";
import { gridApi } from "./grid-api";
import { notify } from "./notify";

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err || ""));

// ------------------------------------------------------------------
// 載入
// ------------------------------------------------------------------

/** 草稿是從哪一份資料改出來的。還原時拿來跟現在的來源比對。 */
export function sourceLabel(s: Pick<EditorState, "gitlab" | "dirName"> = getState()): string {
  if (s.gitlab) return "GitLab · " + s.gitlab.project + "@" + s.gitlab.ref;
  // 同一個資料夾不管是可寫還是唯讀開的，都是同一份來源
  if (s.dirName) return "資料夾 " + s.dirName;
  return "載入的 JSON 檔";
}

interface LoadOpts {
  mode: Exclude<Mode, "none">;
  /** 空字串的話照檔案數自己寫 */
  label: string;
  dirHandle?: FileSystemDirectoryHandle | null;
  dirName?: string;
  gitlab?: GitLabSession | null;
}

/** 記住樣板用的來源名稱。GitLab 不看分支 —— 換分支版面不會變 */
function patternSource(opts: LoadOpts): string {
  if (opts.gitlab)
    return "gitlab:" + opts.gitlab.host + "/" + opts.gitlab.project + ":" + opts.gitlab.dir;
  return opts.dirName ? "dir:" + opts.dirName : "files";
}

/** 換樣板重新載入：記著上一次是怎麼載入的，照同樣的路再走一次 */
let reloadWith: ((pattern: string) => Promise<void>) | null = null;

/** 決定樣板：指定的 → 上次手動改過的 → 自己猜 → 猜不出來就問人。null 是使用者不載入了。 */
async function choosePattern(
  rels: string[],
  source: string,
  forced?: string,
): Promise<string | null> {
  if (forced) return forced;
  const saved = savedPattern(source);
  if (saved && wantedRels(rels, saved).length) return saved;
  return detectPattern(rels) || askPattern(rels, "");
}

function askPattern(rels: string[], current: string): Promise<string | null> {
  const sample = rels.slice(0, 6).join("\n");
  return promptDialog({
    title: current ? "改語系檔的路徑樣板" : "看不出語系檔放在哪裡",
    label: "路徑樣板",
    value: current,
    hint:
      "{code} 是語系代碼，{ns} 是同一個語系底下的哪一份檔（會一份一個分頁）。\n" +
      "例如 {code}.json、{code}/translation.json、{code}/json/{ns}.json。\n" +
      "讀到的路徑長這樣：\n" +
      sample +
      (rels.length > 6 ? "\n…" : ""),
    confirmText: current ? "重新載入" : "載入",
    validate: (v) => {
      const p = v.trim();
      return patternError(p) || (wantedRels(rels, p).length ? "" : "這個樣板對不到任何檔案");
    },
  }).then((raw) => (raw === null ? null : raw.trim()));
}

/** 所有來源最後都走這裡：換掉整份資料、整理偏好、重畫、問要不要還原草稿 */
function applyLoad(layout: Layout, opts: LoadOpts): void {
  // 先全部讀完再動現有資料：哪一個檔壞掉的話手上這份還在
  const docs = layout.sets.map((set) => {
    const d = D.createEmptyDoc();
    D.ingest(d, set);
    return d;
  });
  const s = getState();
  // 同一個資料夾重新載入（例如改樣板）時回到剛剛那一份
  const doc = docs.find((d) => d.ns === s.doc.ns) || docs[0];

  // 偏好可能是別的資料夾留下來的，清掉指向不存在語系的紀錄
  const hidden: Record<string, true> = {};
  for (const id of Object.keys(s.hidden)) {
    if (id === NOTE_COL || docs.some((d) => d.data[id])) hidden[id] = true;
  }
  const files = docs.reduce((n, d) => n + d.order.length, 0);

  setState({
    doc,
    docs,
    tabChanges: docs.map(() => 0),
    pattern: layout.pattern,
    mode: opts.mode,
    dirHandle: opts.dirHandle || null,
    dirName: opts.dirName || "",
    gitlab: opts.gitlab || null,
    loadLabel: opts.label || "已載入 " + files + " 個檔",
    hidden,
    group: "",
    collapsed: {},
    currentKey: "",
    keyRev: {},
  });
  setState(normalizeFocus(getState()));

  const after = getState();
  if (doc.order.length && !selectVisible(after).length) setState({ hidden: {}, focus: "" });

  refresh(true);
  void restoreDraft();
}

/* 本機的三條路（選擇器、webkitdirectory、拖放）和拖進來的檔案都到這裡：
   先列路徑、決定樣板，只讀對得上的檔。 */
async function loadRefs(
  refs: FileRef[],
  opts: LoadOpts,
  forced?: string,
  reload?: (pattern: string) => Promise<void>,
): Promise<void> {
  try {
    if (!refs.length) {
      notify("這個資料夾裡沒有 JSON 檔");
      return;
    }
    const rels = refs.map((r) => r.rel);
    const pattern = await choosePattern(rels, patternSource(opts), forced);
    if (!pattern) return;
    const layout = classifyFiles(await readRefs(refs, wantedRels(rels, pattern)), pattern);
    if (!layout.sets.length) {
      notify("樣板 " + pattern + " 對不到任何語系檔");
      return;
    }
    applyLoad(layout, opts);
    // 可寫的資料夾存過檔之後，列出來的檔案已經不是這一份了 —— 那種要重新走一次
    reloadWith = reload || ((p) => loadRefs(refs, opts, p));
  } catch (err) {
    notify(errMsg(err) || "無法開啟資料夾");
  }
}

export async function pickDirectory(): Promise<void> {
  let handle: FileSystemDirectoryHandle;
  try {
    handle = await window.showDirectoryPicker({ mode: "readwrite" });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    notify(errMsg(err) || "無法開啟資料夾");
    return;
  }
  await openDirectory(handle);
}

/** 可寫的資料夾：選擇器挑的，或 Chrome / Edge 拖進來的 */
async function openDirectory(handle: FileSystemDirectoryHandle, forced?: string): Promise<void> {
  let refs: FileRef[];
  try {
    refs = await walkLocaleDir(handle);
  } catch (err) {
    notify(errMsg(err) || "無法開啟資料夾");
    return;
  }
  await loadRefs(
    refs,
    { mode: "folder", label: handle.name, dirHandle: handle, dirName: handle.name },
    forced,
    (p) => openDirectory(handle, p),
  );
}

/* 唯讀的資料夾：能力跟載入 JSON 檔一樣只能下載，
   但知道每個檔的相對路徑，巢狀版面也讀得進來。 */
function readOnlyFolder(name: string): LoadOpts {
  return { mode: "files", label: name + "（唯讀）", dirName: name };
}

/** <input webkitdirectory> 選回來的資料夾（不支援 showDirectoryPicker 的瀏覽器） */
export async function loadDirectoryInput(list: FileList | File[]): Promise<void> {
  const files = Array.from(list);
  // 空資料夾什麼都不會給，連名稱都拿不到
  if (!files.length) {
    notify("這個資料夾裡沒有 JSON 檔");
    return;
  }
  await loadRefs(
    directoryInputRefs(files),
    readOnlyFolder(splitRoot(files[0].webkitRelativePath).root),
  );
}

/** 拖放：一個資料夾，或一堆 JSON 檔 */
export async function loadDrop(drop: DropPayload): Promise<void> {
  if (!drop.dirs.length) {
    await loadFiles(drop.files);
    return;
  }
  if (drop.dirs.length > 1 || drop.files.length > drop.dirs.length) {
    notify("一次只能拖一個語系資料夾，或只拖 JSON 檔");
    return;
  }
  const { entry, handle } = drop.dirs[0];
  const h = handle ? await handle.catch(() => null) : null;
  if (h?.kind === "directory") {
    await openDirectory(h as FileSystemDirectoryHandle);
    return;
  }
  let refs: FileRef[];
  try {
    refs = await droppedDirRefs(entry);
  } catch (err) {
    notify(errMsg(err) || "無法開啟資料夾");
    return;
  }
  await loadRefs(refs, readOnlyFolder(entry.name));
}

export async function loadFiles(list: FileList | File[]): Promise<void> {
  const refs = fileListRefs(list);
  if (!refs.length) {
    notify("沒有找到 .json 檔案");
    return;
  }
  // 拖進來的檔案只有檔名，沒有它原本在哪個資料夾。巢狀版面每個檔
  // 都叫 translation.json，光看檔名分不出語系 —— 與其讓最後一個
  // 蓋掉前面 42 個，不如講清楚並指去另外兩條路。
  const dup = duplicateName(refs);
  if (dup) {
    notify(
      "有多個檔案都叫 " +
        dup +
        "，看不出各自是哪個語系。" +
        "每個語系一個資料夾的版面請改用「選擇語系資料夾…」或「從 GitLab 載入…」",
    );
    return;
  }
  // 檔案模式刪不了檔，之前在資料夾 / GitLab 模式標記的刪除也送不出去了 ——
  // 換成新的 doc 時自然就清掉了
  await loadRefs(refs, { mode: "files", label: "" });
}

export interface GlLoadCfg {
  host: string;
  token: string;
  project: string;
  ref: string;
  dir: string;
}

/**
 * 讀倉庫裡的語系資料夾。失敗時丟例外，手上的資料不動。
 * keep：改樣板重新載入時用 —— 讀的是目前跟著的工作分支，開 MR 的目標跟 MR 連結照舊。
 */
export async function loadFromGitLab(
  cfg: GlLoadCfg,
  forced?: string,
  keep?: { ref: string; mrUrl: string },
): Promise<void> {
  const session: GitLabSession = {
    host: cfg.host,
    project: cfg.project,
    dir: cfg.dir,
    ref: keep?.ref || cfg.ref,
    branch: cfg.ref,
    head: "",
    known: {},
    mrUrl: keep?.mrUrl || "",
  };
  const opts: LoadOpts = {
    mode: "gitlab",
    label: "GitLab · " + cfg.project + "@" + cfg.ref + (cfg.dir ? " · " + cfg.dir : ""),
    gitlab: session,
  };
  const res = await gl.loadLocales(cfg, cfg.ref, cfg.dir, (rels) =>
    choosePattern(rels, patternSource(opts), forced),
  );
  if (!res) return;
  const layout = classifyFiles(res.files, res.pattern);
  if (!layout.sets.length) throw new Error("樣板 " + res.pattern + " 對不到任何語系檔");

  session.head = res.head;
  // 倉庫裡已經有的路徑：決定 commit 時是 create 還是 update
  for (const path of res.known) session.known[path] = true;
  applyLoad(layout, opts);
  // token 不放進閉包，重新載入時再拿一次（沒勾記住的話可能已經不在了）
  reloadWith = (p) => {
    const token = getToken();
    if (!token) throw new Error("token 不見了，請重新按「從 GitLab 載入…」填一次");
    // commit 過之後跟的是工作分支，從那裡讀才看得到剛送出去的東西
    const g = getState().gitlab || session;
    return loadFromGitLab({ ...cfg, token, ref: g.branch }, p, { ref: g.ref, mrUrl: g.mrUrl });
  };
}

/** 頂端的樣板按鈕：改樣板，照同一個來源重新載入 */
export async function editPattern(): Promise<void> {
  const s = getState();
  if (!reloadWith || !s.pattern) return;
  const source = patternSource({ mode: "files", label: "", gitlab: s.gitlab, dirName: s.dirName });
  const raw = await promptDialog({
    title: "語系檔的路徑樣板",
    label: "路徑樣板",
    value: s.pattern,
    hint:
      "{code} 是語系代碼，{ns} 是同一個語系底下的哪一份檔（會一份一個分頁）。\n" +
      "例如 {code}.json、{code}/translation.json、{code}/json/{ns}.json。\n" +
      "清空再按確定，會改回自動判斷。",
    confirmText: "重新載入",
    validate: (v) => (v.trim() ? patternError(v.trim()) : ""),
  });
  if (raw === null) return;
  const next = raw.trim();
  if (next === s.pattern) return;
  if (totalChanges(getState())) {
    const ok = await confirmDialog({
      title: "還有沒存的變更",
      body: "換樣板會重新載入，還沒存 / 下載的修改會不見。要繼續嗎？",
      confirmText: "捨棄並重新載入",
      danger: true,
    });
    if (!ok) return;
  }
  rememberPattern(source, next);
  try {
    // 清空 = 改回自動判斷：沒指定樣板、也沒記住的，載入時會重新猜一次
    await reloadWith(next);
  } catch (err) {
    notify(errMsg(err) || "重新載入失敗");
  }
}

// ------------------------------------------------------------------
// 分頁（同一個語系底下的好幾份檔）
// ------------------------------------------------------------------

/* 切到另一份檔：key 完全不一樣，分區、收合、目前那一列都要重來；
   哪些語系藏起來、釘選、聚焦、欄寬是跟著語系的，留著。 */
export function selectDoc(index: number): void {
  const s = getState();
  const doc = s.docs[index];
  if (!doc || doc === s.doc) return;
  setState({ doc, group: "", collapsed: {}, currentKey: "", keyRev: {} });
  setState(normalizeFocus(getState()));
  if (doc.order.length && !selectVisible(getState()).length) setState({ hidden: {}, focus: "" });
  refresh(true);
}

// ------------------------------------------------------------------
// 草稿
// ------------------------------------------------------------------

let draftTimer: ReturnType<typeof setTimeout> | undefined;

export function saveDraft(): void {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    const s = getState();
    if (!totalChanges(s)) {
      clearDraft();
      return;
    }
    writeDraft(D.buildDraft(s.docs, sourceLabel(s)));
  }, 600);
}

async function restoreDraft(): Promise<void> {
  const draft = await readDraft();
  if (!draft) return;
  const s = getState();
  const hits: { doc: Doc; part: D.DraftPart }[] = [];
  for (const doc of s.docs) {
    const part = draft.parts[doc.ns];
    if (part && D.draftLocales(doc, part).length) hits.push({ doc, part });
  }
  if (!hits.length) return;
  const files = hits.reduce((n, x) => n + D.draftLocales(x.doc, x.part).length, 0);

  const when = new Date(draft.ts).toLocaleString();
  // 草稿是全域一份，來源卻有三種。還原到別的倉庫 / 別的資料夾上
  // 是會直接送出去的東西，所以把當初是從哪裡改的講清楚。
  const from =
    draft.source && draft.source !== sourceLabel(s)
      ? "\n\n當初是在「" + draft.source + "」改的，跟現在這份來源不一樣。"
      : "";
  const ok = await confirmDialog({
    title: "找到未匯出的草稿",
    body:
      when +
      " 的草稿，" +
      files +
      (s.docs.length > 1 ? " 個語系檔" : " 個語系") +
      "有修改。要還原嗎？" +
      from,
    confirmText: "還原",
  });
  if (!ok) {
    clearDraft();
    return;
  }
  // 問的這段時間可能已經換了一份資料
  if (getState().docs !== s.docs) return;
  for (const x of hits) D.applyDraft(x.doc, x.part);
  refresh(false);
  recountTabs();
  notify("已還原草稿");
}

// ------------------------------------------------------------------
// 編輯
// ------------------------------------------------------------------

function afterEdit(key: string, code: string | null): void {
  touchKey(key);
  updateStatus(code);
  saveDraft();
  recountSoon();
}

export function editCell(key: string, code: string, value: string): void {
  const { doc } = getState();
  if (!doc.data[code]) return;
  doc.data[code][key] = value;
  afterEdit(key, code);
}

export function editNote(key: string, value: string): void {
  getState().doc.comments[key] = value;
  afterEdit(key, null);
}

/** Esc：把這一格還原成載入時的內容（刪除 key 不適用） */
export function revertCell(key: string, code: string | null): void {
  const { doc } = getState();
  if (code === null) doc.comments[key] = doc.commentsBase[key] || "";
  else if (doc.data[code]) doc.data[code][key] = (doc.base[code] || {})[key] || "";
  afterEdit(key, code);
}

export function setCurrentKey(key: string): void {
  if (getState().currentKey !== key) setState({ currentKey: key });
}

// ------------------------------------------------------------------
// key 的新增 / 改名 / 刪除
// ------------------------------------------------------------------

/** 平層專案的 . 只用來分區，不要讓人以為存出去會變成巢狀 */
function keyInputLabel(doc: Doc): string {
  return doc.flatKeys ? "完整 key（. 用來分區，寫回去還是平層）" : "完整路徑（用 . 分層）";
}

export async function addKey(after?: string): Promise<void> {
  const s = getState();
  if (!s.doc.order.length) return;
  const anchor = after || s.currentKey || "";
  const prefill = anchor ? keyParent(anchor) : s.group ? s.group + "." : "";

  const raw = await promptDialog({
    title: "新增 key",
    label: keyInputLabel(s.doc),
    value: prefill,
    hint:
      (anchor
        ? "路徑留在" +
          (prefill ? " " + prefill + "… 底下" : "最上層") +
          "，就插在 " +
          anchor +
          " 的下一列；改成別組的路徑，會排到那一組的最後面。\n"
        : "") +
      "例如 history.labels.newLabel。\n填了內容才會寫進語系檔 —— 沒有任何值的 key 不屬於任何檔案。",
    confirmText: "新增",
    validate: (v) => {
      const { doc } = getState();
      return keyPathError(doc.keyOrder, normalizeKeyInput(v), null, doc);
    },
  });
  if (raw === null) return;
  const key = normalizeKeyInput(raw);
  const { doc, group } = getState();

  doc.extraKeys[key] = true;
  insertKeyAfter(doc.keyOrder, key, placementAnchor(doc.keyOrder, key, anchor));

  // 清掉可能把新 key 濾掉的條件，不然按了看不到東西
  setState({
    filter: "all",
    query: "",
    group: inGroup(group, key) ? group : "",
    currentKey: key,
  });
  refresh(false);
  gridApi.focusKey(key);
  saveDraft();
  notify("已新增 " + key + "，填入內容後才會寫進檔案");
}

export async function renameKey(key: string): Promise<void> {
  const raw = await promptDialog({
    title: "改 key 名稱",
    label: keyInputLabel(getState().doc),
    value: key,
    hint:
      "所有語系的內容與備註都會跟著搬過去。" +
      (getState().doc.paths[key] && !getState().doc.flatKeys
        ? "\n這個 key 本身含「.」（舊資料留下的）。新名字會照 . 分層寫成巢狀，程式裡用到它的地方要一起改。"
        : ""),
    confirmText: "改名",
    validate: (v) => {
      const next = normalizeKeyInput(v);
      const { doc } = getState();
      return next === key ? "" : keyPathError(doc.keyOrder, next, key, doc);
    },
  });
  if (raw === null) return;
  const next = normalizeKeyInput(raw);
  if (next === key) return;

  const s = getState();
  D.renameKey(s.doc, key, next);
  // 收合狀態是以群組前綴當 key 記的，跟著改才不會殘留
  const collapsed: Record<string, true> = {};
  for (const path of Object.keys(s.collapsed)) {
    if (path === key || path.startsWith(key + ".")) collapsed[next + path.slice(key.length)] = true;
    else collapsed[path] = true;
  }
  setState({ collapsed, currentKey: next });
  refresh(false);
  gridApi.focusKey(next);
  saveDraft();
  notify("已改名為 " + next);
}

export async function deleteKey(key: string): Promise<void> {
  const { doc } = getState();
  const filled = doc.order.filter((code) => !isBlank((doc.data[code] || {})[key]));
  const body =
    (filled.length
      ? filled.length + " 個語系有內容，會一起刪掉：\n" + filled.join("、")
      : "這個 key 目前沒有任何語系填了內容。") + "\n\n這個動作不能用 Esc 還原。";

  const ok = await confirmDialog({ title: "刪除 " + key, body, confirmText: "刪除", danger: true });
  if (!ok) return;

  D.deleteKey(getState().doc, key);
  if (getState().currentKey === key) setState({ currentKey: "" });
  refresh(false);
  saveDraft();
  notify("已刪除 " + key);
}

// ------------------------------------------------------------------
// 語系的新增 / 移除 / 刪除 / 復原
// ------------------------------------------------------------------

/** 語系的組成變了：只存在那個語系裡的 key 要跟著消失（或回來） */
function localesChanged(): void {
  setState(normalizeFocus(getState()));
  // 被移掉的可能正是聚焦中或當對照的那一個；剩下的語系剛好全被藏起來的話
  // 畫面只剩 KEY，看起來像壞了
  const s = getState();
  if (!visibleLocales(s.doc, s).length) {
    const hidden = { ...s.hidden };
    for (const c of s.doc.order) delete hidden[c];
    setState({ hidden });
  }
  refresh(false);
  recountTabs();
}

/* 語系是整個資料夾的事，不是某一份檔的：同一個語系底下有好幾份檔時，
   新增、刪除、復原都是每一份一起動。 */

/** 多份檔時列出全部路徑，太多就只講幾個 */
function listRels(rels: string[]): string {
  return rels.length > 3
    ? rels.slice(0, 3).join("、") + " 等 " + rels.length + " 個檔"
    : rels.join("、");
}

export async function addLocale(): Promise<void> {
  const { docs } = getState();
  const raw = await promptDialog({
    title: "新增語系",
    label: "語系代碼",
    value: "",
    hint:
      "會建立 " +
      docs.map(newLocalePattern).join("、") +
      "，例如 es、fr、pt-BR。\n" +
      "按下確定只是先開一個欄位，儲存之後檔案才會真的出現。",
    confirmText: "新增",
    validate: (v) => {
      const code = v.trim();
      const s = getState();
      if (!code) return "請輸入代碼";
      if (!LOCALE_CODE_RE.test(code)) {
        return "代碼只能用英數、- 與 _，而且不能以 _ 開頭（那是附屬檔的命名）";
      }
      if (s.doc.data[code]) return code + " 已經存在了";
      // 同一個路徑又刪又建：GitLab 會拒絕整個 commit，資料夾模式則是拿空檔蓋掉原檔
      if (s.docs.some((d) => d.deletedLocales[code])) {
        return code + " 已標記刪除。要留著它請到「顯示欄位」按復原，要重建請先存檔讓刪除生效";
      }
      return "";
    },
  });
  if (raw === null) return;
  const code = raw.trim();
  // 別的分頁已經有這個語系的話只補缺的那幾份
  const added = getState()
    .docs.filter((d) => !d.data[code])
    .map((d) => D.addLocale(d, code));
  refresh(false);
  recountTabs();
  // 新語系依欄序可能排在後面，不捲過去使用者會找不到
  requestAnimationFrame(() => gridApi.scrollToColumn(code));
  notify("已新增 " + listRels(added) + "，儲存後才會真的建立檔案");
}

/** 表頭的 × 兩種意思：還沒存過的語系是直接拿掉，已經存在的是標記刪檔。 */
export function removeLocale(code: string): void {
  if (getState().doc.newLocales[code]) void discardNewLocale(code);
  else void deleteLocale(code);
}

function dropViewFlags(code: string): void {
  const s = getState();
  const hidden = { ...s.hidden };
  const pinned = { ...s.pinned };
  delete hidden[code];
  delete pinned[code];
  setState({ hidden, pinned });
}

async function discardNewLocale(code: string): Promise<void> {
  const fresh = getState().docs.filter((d) => d.newLocales[code]);
  const ok = await confirmDialog({
    title: "移除 " + listRels(fresh.map((d) => relFor(d, code))),
    body: "這個語系還沒儲存過，移除後已填的內容會不見。",
    confirmText: "移除",
    danger: true,
  });
  if (!ok) return;
  for (const d of fresh) D.dropLocale(d, code);
  dropViewFlags(code);
  localesChanged();
  notify("已移除 " + code);
}

/* 已存在的語系：先從表格拿掉、記進 deletedLocales，
   跟新增語系一樣等到「儲存到資料夾 / 提交到 GitLab」才真的動到檔案。
   GitLab 模式因此能把刪檔跟其他變更放進同一個 commit，
   也一樣會先過「遠端有沒有被推過」那道檢查。 */
async function deleteLocale(code: string): Promise<void> {
  const s = getState();
  const { doc } = s;
  if (!doc.data[code] || doc.newLocales[code] || !canDeleteLocales(s)) return;
  if (doc.order.length <= 1) {
    notify("至少要留一個語系");
    return;
  }

  // 每一份檔裡的這個語系：已經存在的標記刪除，這次才補上的直接拿掉
  const existing = s.docs.filter((d) => d.data[code] && !d.newLocales[code]);
  const fresh = s.docs.filter((d) => d.newLocales[code]);
  const rels = existing.map((d) => relFor(d, code));
  const keys = existing.reduce((n, d) => n + Object.keys(d.base[code] || {}).length, 0);
  const dirty = [...existing, ...fresh].reduce((n, d) => n + D.dirtyCellCount(d, code), 0);
  const many = rels.length > 1;
  const when = s.gitlab
    ? "下一次「提交到 GitLab」時，會在同一個 commit 裡刪掉" + (many ? "這些檔" : "這個檔") + "。"
    : "按下「儲存到資料夾」時才會真的刪掉" + (many ? "這些檔" : "這個檔") + "。";

  const ok = await confirmDialog({
    title: "刪除 " + localeLabel(code) + "（" + (many ? rels.length + " 個檔" : rels[0]) + "）",
    body:
      (many ? "會刪掉 " + rels.join("、") + "，共有 " : "這個語系檔目前有 ") +
      keys +
      " 個 key" +
      (dirty ? "，另外還有 " + dirty + " 格沒存的修改會一起丟掉" : "") +
      "。\n" +
      when +
      "\n在那之前可以從「顯示欄位」選單復原。",
    confirmText: "刪除語系",
    danger: true,
  });
  if (!ok) return;

  const now = getState();
  const view = { hidden: !!now.hidden[code], pinned: !!now.pinned[code] };
  for (const d of existing) D.markLocaleDeleted(d, code, view);
  for (const d of fresh) D.dropLocale(d, code);
  dropViewFlags(code);
  localesChanged();
  notify("已標記刪除 " + listRels(rels) + "，" + (now.gitlab ? "提交" : "儲存") + "後才會真的刪檔");
}

export function restoreLocale(code: string): void {
  const s = getState();
  const snaps = s.docs.map((d) => D.restoreLocale(d, code)).filter((x) => x !== null);
  if (!snaps.length) return;
  const snap = snaps[0];
  setState({
    hidden: snap.hidden ? { ...s.hidden, [code]: true } : s.hidden,
    pinned: snap.pinned ? { ...s.pinned, [code]: true } : s.pinned,
  });
  localesChanged();
  requestAnimationFrame(() => gridApi.scrollToColumn(code));
  notify("已復原 " + listRels(snaps.map((x) => x.rel)));
}

// ------------------------------------------------------------------
// 篩選 / 分區 / 搜尋
// ------------------------------------------------------------------

export function setFilter(filter: FilterName): void {
  setState({ filter });
  refresh(true);
}

export function setQuery(query: string): void {
  setState({ query: query.trim().toLowerCase() });
  refresh(true);
}

/** 點目前選中的那一區就是取消 */
export function selectGroup(path: string): void {
  setState((s) => ({ group: path === s.group ? "" : path }));
  refresh(true);
}

export function toggleCollapsed(path: string): void {
  setState((s) => {
    const collapsed = { ...s.collapsed };
    if (collapsed[path]) delete collapsed[path];
    else collapsed[path] = true;
    return { collapsed };
  });
}

// ------------------------------------------------------------------
// 顯示欄位 / 凍結 / 欄寬 / 列高
// ------------------------------------------------------------------

export function setLines(lines: number): void {
  const next = Math.max(1, Math.min(3, lines | 0));
  if (next !== getState().lines) setState({ lines: next });
}

export function setSidebarCollapsed(collapsed: boolean): void {
  setState({ sidebarCollapsed: collapsed });
}

export function setColumnHidden(id: string, hide: boolean): void {
  const s = getState();
  const hidden = { ...s.hidden };
  const pinned = { ...s.pinned };
  if (hide) {
    hidden[id] = true;
    delete pinned[id]; // 藏起來的欄位釘著也沒意義
  } else {
    delete hidden[id];
  }
  // 全部語系都藏起來的話畫面只剩 KEY，看起來像壞了
  if (!visibleLocales(s.doc, { ...s, hidden }).length) {
    notify("至少要留一個語系");
    return;
  }
  setState({ hidden, pinned });
  refresh(false);
}

export function setColumnPinned(id: string, pin: boolean): void {
  const s = getState();
  const pinned = { ...s.pinned };
  if (!pin) {
    delete pinned[id];
  } else {
    // 凍結區太寬的話右邊就沒空間可以捲了
    const limit = pinnedLimit(gridApi.viewportWidth());
    if (limit && pinnedWidth(selectLayout(s)) + colWidth(s.widths, id) > limit) {
      notify("凍結的欄位太寬了，右邊會沒有空間捲動");
      return;
    }
    pinned[id] = true;
  }
  setState({ pinned });
}

/** 「全選」或「只留一個」：留下第一個語系，其餘與備註都收起來 */
export function setColumnPreset(preset: "all" | "one"): void {
  const s = getState();
  if (s.focus) return;
  const hidden: Record<string, true> = {};
  if (preset === "one") {
    hidden[NOTE_COL] = true;
    for (const c of s.doc.order.slice(1)) hidden[c] = true;
  }
  setState({ hidden });
  refresh(false);
}

/** 拖曳時的上限：凍結欄拉太寬等於繞過釘選時的檢查，右邊會沒空間捲 */
export function resizeLimit(id: string): number {
  const s = getState();
  let mine = false;
  let otherPinned = 0;
  for (const c of selectLayout(s)) {
    if (c.id === id) mine = c.pinned;
    else if (c.pinned) otherPinned += c.width;
  }
  if (!mine) return MAX_COL;
  const limit = pinnedLimit(gridApi.viewportWidth());
  return Math.max(MIN_COL, Math.min(MAX_COL, Math.floor(limit - otherPinned)));
}

export function setColumnWidth(id: string, width: number): void {
  setState((s) => ({ widths: { ...s.widths, [id]: width } }));
}

export function resetColumnWidth(id: string): void {
  const s = getState();
  if (!s.widths[id]) return;
  const widths = { ...s.widths };
  delete widths[id];
  setState({ widths });
}

export function resetWidths(): void {
  if (!Object.keys(getState().widths).length) {
    notify("欄寬本來就是預設值");
    return;
  }
  setState({ widths: {} });
  notify("欄寬已還原成預設值");
}

/** 沒開聚焦時語系列的 chip 當快速定位用；藏起來的欄位先叫出來再捲過去 */
export function revealColumn(code: string): void {
  if (getState().hidden[code]) setColumnHidden(code, false);
  requestAnimationFrame(() => gridApi.scrollToColumn(code));
}

export function columnX(id: string): number | null {
  const s = getState();
  return columnScrollLeft(columnLayout(selectVisible(s), s), id);
}

// ------------------------------------------------------------------
// 聚焦模式
// ------------------------------------------------------------------

/* 切換聚焦是「哪些欄位看得見」整個換掉：重算整張表，橫向捲動歸零 ——
   不歸零的話會停在剛剛那個 3000px，畫面一片空白。 */
export function setFocus(code: string): void {
  const s = getState();
  const patch: Partial<EditorState> = { focus: code || "" };
  if (s.focus) patch.lastFocus = s.focus;
  if (code && code === s.source) {
    // 對照跟目標同一個等於只看一欄，沒有對照的意義，換一個當對照
    patch.source = s.doc.order.find((c) => c !== code) || "";
  }
  setState(patch);
  gridApi.resetScrollLeft();
  refresh(false);
}

export function toggleFocus(): void {
  const s = getState();
  if (s.focus) {
    setFocus("");
    return;
  }
  // 開聚焦時挑一個目標：優先接續上次那個，否則第一個非對照語系
  const want =
    s.lastFocus && s.doc.data[s.lastFocus] && s.lastFocus !== s.source
      ? s.lastFocus
      : s.doc.order.find((c) => c !== s.source);
  if (want) setFocus(want);
}

export function setSourceLocale(code: string): void {
  const s = getState();
  if (!s.doc.data[code] || code === s.source) return;
  const patch: Partial<EditorState> = { source: code };
  // 被選去當對照的那個原本是目標，目標往後挪一個
  if (s.focus === code) patch.focus = s.doc.order.find((c) => c !== code) || "";
  setState(patch);
  gridApi.resetScrollLeft();
  refresh(false);
}

/* Alt + ←/→ 換下一個目標語系。43 個語系用滑鼠一顆一顆點很慢，
   照著清單順序掃過去才跟得上「一個語系翻完換下一個」的節奏。 */
export function stepFocus(delta: number): void {
  const { focus, source, doc } = getState();
  if (!focus || doc.order.length < 2) return;
  const i = doc.order.indexOf(focus);
  if (i === -1) return;
  const n = doc.order.length;
  for (let step = 1; step <= n; step += 1) {
    const next = doc.order[(((i + delta * step) % n) + n) % n];
    if (next !== source) {
      setFocus(next);
      return;
    }
  }
}

// ------------------------------------------------------------------
// 輸出
// ------------------------------------------------------------------

/** 所有分頁要寫出去的檔案，跟各自屬於哪一份 —— 寫成功之後要各自推基準線 */
function pendingByDoc(): { doc: Doc; files: ChangedFile[] }[] {
  return getState()
    .docs.map((doc) => ({ doc, files: changedFiles(doc) }))
    .filter((x) => x.files.length);
}

/** 所有分頁要寫出去的檔案（提交對話框、除錯用） */
export function pendingFiles(): ChangedFile[] {
  return pendingByDoc().flatMap((x) => x.files);
}

function rebaselineAll(pending: { doc: Doc; files: ChangedFile[] }[]): void {
  for (const x of pending) D.rebaseline(x.doc, x.files);
}

export function downloadChanged(): void {
  const all = pendingFiles();
  if (!all.length) return;

  // 下載表達不了「這個檔不要了」，要刪的只能請人自己去刪
  const gone = all.filter((f) => f.deleted);
  const changed = all.filter((f) => !f.deleted);
  let goneNote = gone.length
    ? "要刪除的 " + gone.map((f) => f.rel).join("、") + " 請自己從資料夾刪掉"
    : "";
  if (!changed.length) {
    notify("沒有要下載的內容。" + goneNote);
    return;
  }
  goneNote = goneNote ? "；" + goneNote : "";
  // 唯讀資料夾：zip 裡的路徑跟原本的資料夾一致，講清楚放回哪裡就能蓋過去
  const { dirName, dirHandle } = getState();
  const putBack = (what: string) =>
    dirName && !dirHandle ? "，" + what + "「" + dirName + "」覆蓋原檔即可" : "";

  // 多個檔一定要打包：連續觸發多次下載會被瀏覽器當成
  // 「下載多個檔案」跳權限提示，使用者拒絕過就只會拿到第一個。
  // 巢狀版面就算只有一個檔也要打包：檔名都叫 translation.json，
  // 單獨下載一個看不出是哪個語系 —— 那個版面裡路徑才是身分。
  const nested = changed.some((f) => f.rel.includes("/"));
  if (changed.length === 1 && !nested) {
    saveBlob(jsonBlob(changed[0].text || ""), changed[0].name);
    notify("已下載 " + changed[0].name + putBack("放回") + goneNote);
    return;
  }
  saveBlob(
    zipBlob(changed.map((f) => ({ rel: f.rel, text: f.text || "" }))),
    "locales-changed.zip",
  );
  notify(
    "已打包 " + changed.length + " 個變更檔：locales-changed.zip" + putBack("解壓縮到") + goneNote,
  );
}

export function downloadAll(): void {
  const { docs } = getState();
  if (!docs.some((d) => d.order.length)) return;
  const files = docs.flatMap(allFiles);
  saveBlob(zipBlob(files), "locales.zip");
  notify("已匯出 " + files.length + " 個檔");
}

export async function saveToDirectory(): Promise<void> {
  const { dirHandle, pattern } = getState();
  if (!dirHandle) return;
  const pending = pendingByDoc();
  const changed = pending.flatMap((x) => x.files);
  if (!changed.length) return;
  try {
    if (!(await ensureWritable(dirHandle))) {
      notify("沒有拿到寫入權限，檔案沒有動。也可以改用「下載變更」");
      return;
    }
    await writeChanges(dirHandle, changed, pattern);
  } catch (err) {
    notify("寫入失敗：" + errMsg(err));
    return;
  }
  rebaselineAll(pending);
  clearDraft();
  refresh(false);
  recountTabs();
  notify(savedSummary(changed, "寫回"));
}

// ------------------------------------------------------------------
// GitLab commit
// ------------------------------------------------------------------

export interface CommitOpts {
  branch: string;
  message: string;
  mr: boolean;
}

/** 送一個 commit 回 GitLab。失敗時丟例外（對話框會留著讓人改）。 */
export async function commitToGitLab(opts: CommitOpts): Promise<void> {
  const { gitlab: g, pattern } = getState();
  if (!g) throw new Error("目前不是 GitLab 模式");

  const token = getToken();
  if (!token) {
    throw new Error(
      "token 不見了（沒勾記住的話，關掉分頁就會清掉）。請重新按「從 GitLab 載入…」填一次",
    );
  }
  const cfg = { host: g.host, project: g.project, token };
  const pending = pendingByDoc();
  const changed = pending.flatMap((x) => x.files);
  if (!changed.length) throw new Error("沒有變更");

  const target = opts.branch;
  const branching = target !== g.branch; // 開一條新的，還是推回目前這條
  const actions = glActions(g, changed, pattern);

  // 載入當下的 commit id 就是衝突基準：送出前再問一次，
  // 不一樣就代表有人在這中間推過東西
  const branch = await gl.getBranch(cfg, g.branch);
  const now = branch?.commit?.id;
  if (now !== g.head) {
    throw new Error(
      "GitLab 上的 " +
        g.branch +
        " 在這中間被推過了（" +
        glShort(g.head) +
        " → " +
        glShort(now) +
        "）。請重新載入再改一次，不然會蓋掉別人的東西。",
    );
  }

  const commit = await gl.createCommit(cfg, {
    branch: target,
    // 只有要開新分支時才送 start_branch；分支已經在了還送會被拒絕
    start_branch: branching ? g.branch : undefined,
    commit_message: opts.message,
    actions,
  });

  const mrTarget = g.ref;
  rebaselineAll(pending);
  applyActions(g, actions);
  // 從現在起跟的是工作分支，衝突基準也換成剛剛那個 commit ——
  // 不換的話下一次送出會被自己的 commit 擋下來。
  const session: GitLabSession = { ...g, branch: target, head: commit?.id || g.head };
  setState({ gitlab: session });
  clearDraft();
  refresh(false);
  recountTabs();

  let mrUrl = "";
  if (opts.mr && branching && target !== mrTarget) {
    try {
      mrUrl = await gl.createMergeRequest(cfg, target, mrTarget, opts.message);
    } catch (err) {
      // commit 已經進去了。MR 開不起來不該讓人以為整件事失敗。
      notify("commit 成功，但開 MR 失敗：" + errMsg(err));
    }
  }
  if (mrUrl) setState({ gitlab: { ...getState().gitlab!, mrUrl } });
  notify(
    "已 commit " +
      changed.length +
      " 個檔到 " +
      target +
      "（" +
      glShort(session.head) +
      "）" +
      (mrUrl ? "，MR 也開好了" : ""),
  );
}

export function hasUnsavedChanges(): boolean {
  return totalChanges(getState()) > 0;
}
