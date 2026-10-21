// 欄位排列順序。純粹是顯示習慣（照原本 Excel 的欄序），
// 不代表任何一個語系是「來源」—— 每一欄都可以編輯。
export const DISPLAY_ORDER = [
  "en",
  "zh-cht",
  "zh-chs",
  "th",
  "vi",
  "id",
  "ja",
  "ko",
  "hi",
  "tr",
  "pt",
  "ru",
  "bn",
  "de",
];

export const LOCALE_LABELS: Record<string, string> = {
  en: "英文 EN",
  "zh-cht": "繁中 ZH-TW",
  "zh-chs": "簡中 ZH-CN",
  th: "泰文 TH",
  vi: "越文 VI",
  id: "印尼文 ID",
  ja: "日文 JA",
  ko: "韓文 KO",
  hi: "印地文 HI",
  tr: "土耳其文 TR",
  pt: "葡萄牙文 PT-BR",
  ru: "俄文 RU",
  bn: "孟加拉文 BN-BD",
  de: "德文 DE",
};

/* 很多專案不用標準代碼（eng、sch、tch、jp…）。名稱、欄序、預設對照語系都照它
   代表的語言算，畫面上仍然帶著原本的代碼 —— 資料夾就叫那個名字，不能藏起來。 */
const ALIASES: Record<string, string> = {
  eng: "en",
  "en-us": "en",
  "en-gb": "en",
  tch: "zh-cht",
  cht: "zh-cht",
  "zh-tw": "zh-cht",
  "zh-hant": "zh-cht",
  sch: "zh-chs",
  chs: "zh-chs",
  "zh-cn": "zh-chs",
  "zh-hans": "zh-chs",
  tha: "th",
  vie: "vi",
  vn: "vi",
  ind: "id",
  jp: "ja",
  jpn: "ja",
  kr: "ko",
  kor: "ko",
  hin: "hi",
  tur: "tr",
  por: "pt",
  "pt-br": "pt",
  rus: "ru",
  ben: "bn",
  "bn-bd": "bn",
  deu: "de",
  ger: "de",
};

/** 這個代碼代表哪個語言（DISPLAY_ORDER 裡的寫法）。認不得就原樣回傳。 */
export function canonicalLocale(code: string): string {
  const k = code.toLowerCase().replace(/_/g, "-");
  return ALIASES[k] || (LOCALE_LABELS[k] ? k : code);
}

/** 認得是哪個語言（在欄序表裡，或是它的別名） */
export function isKnownLocale(code: string): boolean {
  return !!LOCALE_LABELS[canonicalLocale(code)];
}

/** 載入資料夾時用來猜哪一段路徑是語系代碼：認得的別名，或長得像 en、pt-BR、zh_TW 的 */
export function looksLikeLocale(code: string): boolean {
  return (
    canonicalLocale(code) !== code ||
    !!LOCALE_LABELS[code] ||
    /^[a-z]{2,3}([-_][a-z0-9]{2,8})*$/i.test(code)
  );
}

// 偏好是存在瀏覽器裡的，換一個資料夾打開時上次記的語系可能根本不存在。
// 照代表的語言比：tch、zh-TW、zh-Hant 都算繁中
const SOURCE_HINTS = ["zh-cht", "zh-chs", "zh", "en"];

/** 沒有記住對照語系時挑一個：繁中 → 簡中 → 中文 → 英文 → 第一個 */
export function defaultSource(order: string[]): string {
  for (const hint of SOURCE_HINTS) {
    const hit = order.find((c) => canonicalLocale(c) === hint);
    if (hit) return hit;
  }
  return order[0] || "";
}

export function localeLabel(code: string): string {
  if (LOCALE_LABELS[code]) return LOCALE_LABELS[code];
  const canon = LOCALE_LABELS[canonicalLocale(code)];
  // 「英文 EN」→「英文 ENG」：語言名稱照認得的，代碼照原本的
  return canon ? canon.slice(0, canon.indexOf(" ")) + " " + code.toUpperCase() : code;
}

/* DISPLAY_ORDER 是照某個專案的 Excel 欄序寫死的，只有在它認得大多數語系時
   才拿來排。一個 43 個語系、只對到其中 10 個的專案套上去，結果是 th 站在
   第一欄、en-US 埋在字母序中段 —— 比單純照字母排還難找。 */
export function sortLocales(order: string[]): string[] {
  const rank = (code: string) => DISPLAY_ORDER.indexOf(canonicalLocale(code));
  const known = order.filter((code) => rank(code) !== -1).length;
  const useDisplayOrder = known * 2 > order.length;

  return order.slice().sort((a, b) => {
    if (!useDisplayOrder) return a.localeCompare(b);
    const ia = rank(a);
    const ib = rank(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

/** 語系代碼的格式（新增語系時檢查） */
export const LOCALE_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
