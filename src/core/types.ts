/** 攤平後的語系內容：`"history.labels.bet" -> "投注"` */
export type Flat = Record<string, string>;

/** key -> 它在 JSON 裡實際的分層。只記本身含 . 的 key（例如 "Loading..."），其他一律照 . 切 */
export type KeyPaths = Record<string, string[]>;

export type Eol = "\n" | "\r\n";

/** 一份檔原本的排版。寫回去照這個，否則縮排或換行一不同，整份檔都會被當成改過 */
export interface TextFormat {
  eol: Eol;
  /** 一層的縮排（"  "、"    "、"\t"） */
  indent: string;
  /** 檔尾有沒有換行 */
  finalNewline: boolean;
}

/** 從任何來源讀進來、還沒分類的檔案。rel 是相對於語系根目錄的路徑。 */
export interface LoadedFile {
  name: string;
  rel: string;
  text: string;
  /** GitLab 模式：倉庫裡的完整路徑 */
  path?: string;
}

export interface LocaleEntry {
  code: string;
  name: string;
  rel: string;
  text: string;
}

/** 同一個語系底下的其中一份檔（命名空間），所有語系的這一份 */
export interface Classified {
  /** 命名空間的名稱（text、errorMessage）。樣板沒有 {ns} 時是空字串 */
  ns: string;
  /** 這一份的樣板，{ns} 已經填掉了：{code}/json/text.json */
  pattern: string;
  locales: LocaleEntry[];
  comments: LoadedFile | null;
  /** 備註檔的位置，還不存在也知道該放哪 */
  commentsRel: string;
}

/** 整個語系資料夾：一個樣板，底下一份或好幾份檔 */
export interface Layout {
  /** 例如 {code}/json/{ns}.json */
  pattern: string;
  sets: Classified[];
}

export interface CommentsMeta {
  file: string;
  rel: string;
  format: TextFormat;
  existed: boolean;
}

/** 標記刪除的語系：存檔前都還能復原，所以整份留著 */
export interface DeletedSnapshot {
  file: string;
  rel: string;
  format: TextFormat;
  data: Flat;
  base: Flat;
  fileKeys: string[];
  hidden: boolean;
  pinned: boolean;
}

/**
 * 編輯中的整份資料。跟畫面無關的部分全在這裡 —— 序列化、變更判斷、存檔
 * 都只看 Doc，所以可以脫離 React 單獨測試。
 */
export interface Doc {
  /** 顯示用的 locale code 順序 */
  order: string[];
  /** code -> 檔名（不含資料夾） */
  files: Record<string, string>;
  /** code -> 相對於語系根目錄的路徑（"en.json"、"en-US/translation.json"、"eng/json/text.json"） */
  rel: Record<string, string>;
  /** 路徑樣板，只剩 {code}（例如 "{code}/json/text.json"）。新增語系時照著擺 */
  pattern: string;
  /** 這是哪一份檔（命名空間）。只有一份時是空字串 */
  ns: string;
  /** code -> 原檔的排版（換行字元、縮排、檔尾換行） */
  format: Record<string, TextFormat>;
  data: Record<string, Flat>;
  /** code -> 載入當下的快照，用來判斷 dirty */
  base: Record<string, Flat>;
  /** code -> 該檔案原本的 key 順序（序列化時照這個排） */
  fileKeys: Record<string, string[]>;
  /** 這次新增、還沒寫進磁碟的語系 */
  newLocales: Record<string, true>;
  /** 標記要刪除、存檔時才真的刪檔的語系 */
  deletedLocales: Record<string, DeletedSnapshot>;
  /** 這次新增、還沒有任何值的 key（否則重建列表時會消失） */
  extraKeys: Record<string, true>;
  /** key -> 備註 */
  comments: Flat;
  commentsBase: Flat;
  commentsMeta: CommentsMeta;
  /** 所有 key 的聯集，畫面的列順序 */
  keyOrder: string[];
  /** 本身含 . 的 key 實際的分層（所有語系與備註的聯集）。寫檔時照這個切 */
  paths: KeyPaths;
  /** 平層的專案（"a.b.c": "…"）：分區是虛擬的，新 key 也寫成平層 */
  flatKeys: boolean;
}

export interface ChangedFile {
  /** 檔名。巢狀版面跟 rel 不一樣（translation.json vs en-US/translation.json） */
  name: string;
  /** 寫回去一律用這個 */
  rel: string;
  /** deleted 時是 null */
  text: string | null;
  /** 備註檔是 null */
  code: string | null;
  deleted?: boolean;
}
