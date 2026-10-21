import {
  baseName,
  isCandidateDir,
  isLocaleCandidate,
  localeDirs,
  MAX_DEPTH,
  splitRoot,
} from "@/core/layout";
import type { ChangedFile, LoadedFile } from "@/core/types";

/* 資料夾有兩種讀法：
   - File System Access API（Chrome / Edge）：拿到讀寫權限後直接寫回原檔。
   - webkitdirectory / 拖放資料夾（Safari、Firefox）：只能讀，改完只能下載。 */

/* 開發用：網址加 ?nofsa 假裝不支援 File System Access，在 Chrome 上也能走 Safari 的那條路 */
const forceFallback =
  import.meta.env.DEV &&
  typeof location !== "undefined" &&
  new URLSearchParams(location.search).has("nofsa");

export function supportsDirectoryPicker(): boolean {
  return (
    !forceFallback &&
    typeof window !== "undefined" &&
    typeof window.showDirectoryPicker === "function"
  );
}

/** <input webkitdirectory>：選得到資料夾，但拿不到寫回的權限 */
export function supportsDirectoryInput(): boolean {
  return typeof document !== "undefined" && "webkitdirectory" in document.createElement("input");
}

/** 還沒讀內容的檔案。先列出路徑、判斷完樣板，只讀對得上的那些。 */
export interface FileRef {
  name: string;
  rel: string;
  read: () => Promise<string>;
}

/** 照樣板挑出要讀的檔，把內容讀進來 */
export function readRefs(refs: FileRef[], wanted: string[]): Promise<LoadedFile[]> {
  const keep = new Set(wanted);
  return Promise.all(
    refs
      .filter((r) => keep.has(r.rel))
      .map(async (r) => ({ name: r.name, rel: r.rel, text: await r.read() })),
  );
}

/* 走太多資料夾就停：選到整個硬碟或一個巨大的專案時，與其卡住不如請人選小一點的 */
const MAX_DIRS = 3000;

class TooBigError extends Error {
  constructor() {
    super("這個資料夾太大了，請直接選語系所在的那個資料夾（例如 assets/i18n）");
  }
}

/* 往下走到 MAX_DEPTH 層，跳過 node_modules、點開頭這類不可能放語系的資料夾。
   這裡只列路徑，不讀內容。 */
export async function walkLocaleDir(handle: FileSystemDirectoryHandle): Promise<FileRef[]> {
  const refs: FileRef[] = [];
  let dirs = 0;
  const scan = async (dir: FileSystemDirectoryHandle, prefix: string, depth: number) => {
    if ((dirs += 1) > MAX_DIRS) throw new TooBigError();
    for await (const entry of dir.values()) {
      const rel = prefix + entry.name;
      if (entry.kind === "file") {
        if (isLocaleCandidate(rel)) {
          refs.push({ name: entry.name, rel, read: () => entry.getFile().then((f) => f.text()) });
        }
      } else if (depth + 1 < MAX_DEPTH && isCandidateDir(entry.name)) {
        await scan(entry, rel + "/", depth + 1);
      }
    }
  };
  await scan(handle, "", 0);
  return refs;
}

/* webkitdirectory 會把整棵樹都給回來 —— 選錯成專案根目錄的話是 node_modules
   裡的幾萬個檔。路徑篩掉的不會被讀。 */
export function directoryInputRefs(list: FileList | File[]): FileRef[] {
  const refs: FileRef[] = [];
  for (const f of Array.from(list)) {
    const { rel } = splitRoot(f.webkitRelativePath || f.name);
    if (isLocaleCandidate(rel)) refs.push({ name: f.name, rel, read: () => f.text() });
  }
  return refs;
}

/** 拖進來的單獨檔案：只有檔名 */
export function fileListRefs(list: FileList | File[]): FileRef[] {
  return Array.from(list)
    .filter((f) => /\.json$/i.test(f.name))
    .map((f) => ({ name: f.name, rel: f.name, read: () => f.text() }));
}

const entryFile = (entry: FileSystemFileEntry) =>
  new Promise<File>((resolve, reject) => entry.file(resolve, reject));

/** readEntries 一次最多給 100 筆，要一直叫到回空陣列為止 */
async function readAllEntries(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader();
  const all: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (!batch.length) return all;
    all.push(...batch);
  }
}

/** 拖放進來的資料夾（唯讀）。規則跟 walkLocaleDir 一樣。 */
export async function droppedDirRefs(root: FileSystemDirectoryEntry): Promise<FileRef[]> {
  const refs: FileRef[] = [];
  let dirs = 0;
  const scan = async (dir: FileSystemDirectoryEntry, prefix: string, depth: number) => {
    if ((dirs += 1) > MAX_DIRS) throw new TooBigError();
    for (const entry of await readAllEntries(dir)) {
      const rel = prefix + entry.name;
      if (entry.isFile) {
        if (isLocaleCandidate(rel)) {
          refs.push({
            name: entry.name,
            rel,
            read: () => entryFile(entry as FileSystemFileEntry).then((f) => f.text()),
          });
        }
      } else if (entry.isDirectory && depth + 1 < MAX_DEPTH && isCandidateDir(entry.name)) {
        await scan(entry as FileSystemDirectoryEntry, rel + "/", depth + 1);
      }
    }
  };
  await scan(root, "", 0);
  return refs;
}

/** 拖放的內容。DataTransferItem 在 drop 事件結束後就失效，所以要在事件當下同步取出來。 */
export interface DropPayload {
  files: File[];
  dirs: { entry: FileSystemDirectoryEntry; handle: Promise<FileSystemHandle | null> | null }[];
}

export function captureDrop(dt: DataTransfer): DropPayload {
  const dirs: DropPayload["dirs"] = [];
  for (const item of Array.from(dt.items)) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.();
    if (!entry?.isDirectory) continue;
    // Chrome / Edge 拖進來的資料夾可以直接換成可寫的 handle，跟用選擇器挑的一樣
    const handle =
      supportsDirectoryPicker() && typeof item.getAsFileSystemHandle === "function"
        ? item.getAsFileSystemHandle()
        : null;
    dirs.push({ entry: entry as FileSystemDirectoryEntry, handle });
  }
  return { files: Array.from(dt.files), dirs };
}

/* 拖放拿到的 handle 一開始只有讀取權限；寫入權限要在使用者按按鈕的當下問。
   用選擇器挑的那種已經是 readwrite，query 直接過。 */
export async function ensureWritable(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const opts = { mode: "readwrite" } as const;
  if ((await handle.queryPermission(opts)) === "granted") return true;
  return (await handle.requestPermission(opts)) === "granted";
}

/* 一路往下拿資料夾。這次新增的語系資料夾還不存在 —— 寫入時用 { create: true }。 */
async function dirHandle(root: FileSystemDirectoryHandle, path: string, create: boolean) {
  let dir = root;
  for (const name of path ? path.split("/") : [])
    dir = await dir.getDirectoryHandle(name, { create });
  return dir;
}

const parentOf = (rel: string) => rel.slice(0, Math.max(0, rel.lastIndexOf("/")));

const notFoundOk = (err: unknown) => {
  if (err instanceof DOMException && err.name === "NotFoundError") return;
  throw err;
};

async function removeFile(root: FileSystemDirectoryHandle, rel: string): Promise<void> {
  await dirHandle(root, parentOf(rel), false)
    .then((dir) => dir.removeEntry(baseName(rel)))
    .catch(notFoundOk);
}

/* 刪掉一個語系檔，連同 Cocos Creator 放在旁邊的 .meta。
   變空的語系資料夾也收掉（只收這個語系自己的，見 localeDirs），資料夾的 .meta
   （eng/json.meta、eng.meta）一起 —— 不然上一層永遠不會是空的。
   只做非遞迴的刪除：資料夾裡還有別的東西（README、圖片）就留著，不要連帶刪掉。
   檔案已經不在（別人先刪了、上一次存到一半）當作成功，目的已經達到了。 */
async function removeLocaleFile(
  root: FileSystemDirectoryHandle,
  rel: string,
  pattern: string,
): Promise<void> {
  await removeFile(root, rel);
  await removeFile(root, rel + ".meta");
  for (const dir of localeDirs(pattern, rel)) {
    const ok = await dirHandle(root, parentOf(dir), false)
      .then((parent) => parent.removeEntry(baseName(dir)))
      .then(
        () => true,
        () => false,
      );
    if (!ok) return; // 這一層還有東西，上面那層一定也還有
    await removeFile(root, dir + ".meta");
  }
}

/** pattern 是整個資料夾的樣板（刪語系時用來判斷哪些資料夾是那個語系自己的） */
export async function writeChanges(
  root: FileSystemDirectoryHandle,
  changed: ChangedFile[],
  pattern: string,
): Promise<void> {
  await Promise.all(
    changed
      .filter((f) => !f.deleted)
      .map(async (f) => {
        const dir = await dirHandle(root, parentOf(f.rel), true);
        const fh = await dir.getFileHandle(baseName(f.rel), { create: true });
        const w = await fh.createWritable();
        await w.write(f.text || "");
        await w.close();
      }),
  );
  // 同一個語系的好幾份檔會收同一個資料夾，一個一個來才不會互相搶
  for (const f of changed) if (f.deleted) await removeLocaleFile(root, f.rel, pattern);
}
