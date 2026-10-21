import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { columnLayout, enforcePinnedBudget, visibleLocales } from "@/core/columns";
import { KEY_COL, NOTE_COL } from "@/core/constants";
import {
  addLocale,
  applyDraft,
  buildDraft,
  upgradeDraft,
  changeSummary,
  createEmptyDoc,
  deleteKey,
  ingest,
  localeChanged,
  markLocaleDeleted,
  rebaseline,
  renameKey,
  restoreLocale,
} from "@/core/doc";
import {
  applyFilters,
  buildTree,
  filterCounts,
  missingByLocale,
  type TreeNode,
} from "@/core/filters";
import { flatten } from "@/core/flatten";
import {
  insertKeyAfter,
  keyConflict,
  keyParent,
  keyPathError,
  placementAnchor,
  sectionSegments,
} from "@/core/keys";
import {
  classifyFiles,
  commentsRel,
  detectPattern,
  duplicateName,
  isLocaleCandidate,
  LayoutError,
  localeDirs,
  matchPattern,
  patternError,
  splitRoot,
  wantedRels,
} from "@/core/layout";
import { defaultSource, localeLabel, sortLocales } from "@/core/locales";
import { changedFiles } from "@/core/output";
import { outliersFor, signature } from "@/core/placeholders";
import { serialize, serializeComments } from "@/core/serialize";
import type { Doc, LoadedFile } from "@/core/types";
import { directoryInputRefs, readRefs } from "@/io/directory";

const FIX = path.join(import.meta.dirname, "fixtures");

/** 把 fixture 整個讀進來（照 walkLocaleDir 的規則篩候選），樣板讓 classifyFiles 自己猜 */
function readFixture(name: string): LoadedFile[] {
  const root = path.join(FIX, name);
  const out: LoadedFile[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix + entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel + "/");
      else if (isLocaleCandidate(rel)) {
        out.push({
          name: entry.name,
          rel,
          text: fs.readFileSync(path.join(dir, entry.name), "utf8"),
        });
      }
    }
  };
  walk(root, "");
  return out;
}

function loadAll(name: string): { docs: Doc[]; pattern: string; files: LoadedFile[] } {
  const files = readFixture(name);
  const layout = classifyFiles(files);
  const docs = layout.sets.map((set) => {
    const doc = createEmptyDoc();
    ingest(doc, set);
    return doc;
  });
  return { docs, pattern: layout.pattern, files };
}

/** 只有一份檔的 fixture */
function load(name: string): { doc: Doc; files: LoadedFile[] } {
  const { docs, files } = loadAll(name);
  expect(docs.length).toBe(1);
  return { doc: docs[0], files };
}

function textOf(files: LoadedFile[], rel: string): string {
  return files.find((f) => f.rel === rel)!.text;
}

describe("序列化逐位元相同", () => {
  it("扁平版面：沒改的檔案序列化後跟原檔一樣（含 CRLF）", () => {
    const { doc, files } = load("flat");
    expect(doc.order).toEqual(["en", "zh-cht", "de"]);
    for (const code of doc.order) {
      expect(serialize(doc, code)).toBe(textOf(files, doc.rel[code]));
    }
    expect(doc.format.de.eol).toBe("\r\n");
    expect(serializeComments(doc)).toBe(textOf(files, "_comments.json"));
    expect(changeSummary(doc)).toEqual([]);
  });

  it("巢狀版面：沒改的檔案序列化後跟原檔一樣", () => {
    const { doc, files } = load("nested");
    expect(doc.pattern).toBe("{code}/translation.json");
    expect(doc.ns).toBe("");
    for (const code of doc.order) {
      expect(serialize(doc, code)).toBe(textOf(files, doc.rel[code]));
    }
    expect(changedFiles(doc)).toEqual([]);
  });

  it("改一句話只改一行", () => {
    const { doc, files } = load("flat");
    doc.data["zh-cht"]["history.title"] = "紀錄";
    const before = textOf(files, "zh-cht.json").split("\n");
    const after = serialize(doc, "zh-cht").split("\n");
    expect(after.length).toBe(before.length);
    expect(after.filter((l, i) => l !== before[i])).toEqual(['    "title": "紀錄",']);
  });

  it("CRLF 檔改完還是 CRLF", () => {
    const { doc } = load("flat");
    doc.data.de["common.ok"] = "Gut";
    const text = serialize(doc, "de");
    expect(text).toContain('"ok": "Gut",\r\n');
    expect(text.replace(/\r\n/g, "")).not.toContain("\n");
  });
});

describe("排版照原檔（縮排、檔尾換行）", () => {
  // 4 格縮排、檔尾沒有換行；errorMessage 是 CRLF、text 是 LF
  const loadIndent4 = () => {
    const { docs, files } = loadAll("indent4");
    const [errors, text] = docs;
    return { errors, text, files };
  };

  it("沒改的檔案序列化後跟原檔一樣", () => {
    const { errors, text, files } = loadIndent4();
    for (const d of [errors, text]) {
      for (const code of d.order) expect(serialize(d, code)).toBe(textOf(files, d.rel[code]));
    }
    expect(errors.format.eng).toEqual({ eol: "\r\n", indent: "    ", finalNewline: false });
    expect(text.format.eng).toEqual({ eol: "\n", indent: "    ", finalNewline: false });
  });

  it("改一句話只改一行", () => {
    const { errors, text, files } = loadIndent4();
    text.data.tch["history.title"] = "紀錄";
    const before = textOf(files, "tch/json/text.json").split("\n");
    const after = serialize(text, "tch").split("\n");
    expect(after.length).toBe(before.length);
    expect(after.filter((l, i) => l !== before[i])).toEqual(['        "title": "紀錄",']);

    errors.data.eng.E001 = "Offline";
    const crlfBefore = textOf(files, "eng/json/errorMessage.json").split("\r\n");
    const crlfAfter = serialize(errors, "eng").split("\r\n");
    expect(crlfAfter.length).toBe(crlfBefore.length);
    expect(crlfAfter.filter((l, i) => l !== crlfBefore[i])).toEqual(['    "E001": "Offline"']);
  });

  it("新語系、新備註檔跟著現有檔案的排版", () => {
    const { text } = loadIndent4();
    addLocale(text, "sch");
    text.data.sch["history.title"] = "历史";
    expect(serialize(text, "sch")).toBe('{\n    "history": {\n        "title": "历史"\n    }\n}');
    text.comments["history.title"] = "標題";
    expect(serializeComments(text)).toBe('{\n    "history": {\n        "title": "標題"\n    }\n}');
  });

  it("刪除語系再復原，排版不變", () => {
    const { errors, files } = loadIndent4();
    markLocaleDeleted(errors, "tch", { hidden: false, pinned: false });
    restoreLocale(errors, "tch");
    expect(serialize(errors, "tch")).toBe(textOf(files, "tch/json/errorMessage.json"));
  });

  it("看不出縮排的空檔跟著其他檔走", () => {
    const doc = createEmptyDoc();
    const layout = classifyFiles([
      { name: "en.json", rel: "en.json", text: '{\n\t"ok": "OK"\n}\n' },
      { name: "de.json", rel: "de.json", text: "{}\n" },
    ]);
    ingest(doc, layout.sets[0]);
    doc.data.de.ok = "Gut";
    expect(serialize(doc, "de")).toBe('{\n\t"ok": "Gut"\n}\n');
  });
});

describe("本身含 . 的 key（技術債）", () => {
  it("沒改的檔案序列化後跟原檔一樣，分層另外記著", () => {
    const { doc, files } = load("dotted");
    for (const code of doc.order) expect(serialize(doc, code)).toBe(textOf(files, doc.rel[code]));
    expect(doc.paths).toEqual({
      "Setting-AmbientSounds...": ["Setting-AmbientSounds..."],
      "Error.Retry": ["Error.Retry"],
      "history.v1.0": ["history", "v1.0"],
    });
  });

  it("改一句只改一行", () => {
    const { doc, files } = load("dotted");
    doc.data.en["Setting-AmbientSounds..."] = "Studio sounds...";
    const before = textOf(files, "en.json").split("\n");
    const after = serialize(doc, "en").split("\n");
    expect(after.length).toBe(before.length);
    expect(after.filter((l, i) => l !== before[i])).toEqual([
      '  "Setting-AmbientSounds...": "Studio sounds...",',
    ]);
  });

  it("在原本沒有它的語系填值、寫備註，一樣寫成含 . 的 key", () => {
    const { doc } = load("dotted");
    doc.data.de["Setting-AmbientSounds..."] = "Umgebung...";
    doc.data.de["history.v1.0"] = "Version 1.0";
    expect(JSON.parse(serialize(doc, "de"))).toEqual({
      "Setting-AmbientSounds...": "Umgebung...",
      "Error.Retry": "Erneut",
      history: { title: "Verlauf", "v1.0": "Version 1.0" },
    });
    doc.comments["Error.Retry"] = "按鈕";
    expect(JSON.parse(serializeComments(doc))).toEqual({ "Error.Retry": "按鈕" });
  });

  it("分區照 key 字面上的 . 切；結構衝突照檔案實際的分層", () => {
    const { doc } = load("dotted");
    expect(doc.flatKeys).toBe(false);
    const names = (n: TreeNode): string[] =>
      [...n.children.values()].flatMap((c) => [c.path, ...names(c)]);
    expect(names(buildTree(doc.keyOrder))).toEqual(["Error", "history", "history.v1"]);
    expect(keyParent("Setting-AmbientSounds...")).toBe("");
    expect(keyParent("history.v1.0")).toBe("history.v1.");
    // JSON 裡是兄弟，不衝突；字串一樣才算重複
    expect(keyConflict(doc.keyOrder, "Setting-AmbientSounds", null, doc)).toBeNull();
    expect(keyConflict(doc.keyOrder, "Error.Retry", null, doc)?.type).toBe("duplicate");
    expect(keyConflict(doc.keyOrder, "history.title.x", null, doc)?.type).toBe("child");
  });

  it("改名之後照 . 分層", () => {
    const { doc } = load("dotted");
    renameKey(doc, "Error.Retry", "errors.retry");
    expect(doc.paths["Error.Retry"]).toBeUndefined();
    expect(JSON.parse(serialize(doc, "de")).errors).toEqual({ retry: "Erneut" });
  });

  it("同一個檔裡兩種寫法攤平後撞在一起，載入時就報錯", () => {
    const layout = classifyFiles([
      { name: "en.json", rel: "en.json", text: '{"a.b": "1", "a": {"b": "2"}}' },
    ]);
    expect(() => ingest(createEmptyDoc(), layout.sets[0])).toThrow(/en\.json.*a\.b/);
  });
});

describe("虛擬分區（平層專案）", () => {
  it("sectionSegments：只有兩邊都是一般字元的 . 才算分隔", () => {
    expect(sectionSegments("a.b.c")).toEqual(["a", "b", "c"]);
    expect(sectionSegments("Loading...")).toEqual(["Loading..."]);
    expect(sectionSegments("Setting-AmbientSounds...")).toEqual(["Setting-AmbientSounds..."]);
    expect(sectionSegments("Hello. World")).toEqual(["Hello. World"]);
    expect(sectionSegments("Wait...retry.now")).toEqual(["Wait...retry", "now"]);
  });

  it("平層的檔：有分區、寫回去逐位元相同", () => {
    const { doc, files } = load("flatdot");
    expect(doc.flatKeys).toBe(true);
    for (const code of doc.order) expect(serialize(doc, code)).toBe(textOf(files, doc.rel[code]));
    expect([...buildTree(doc.keyOrder).children.keys()]).toEqual(["common", "history"]);
  });

  it("新 key 也寫成平層，排在畫面上鄰居的下一行", () => {
    const { doc } = load("flatdot");
    const key = "common.retry";
    doc.extraKeys[key] = true;
    insertKeyAfter(doc.keyOrder, key, placementAnchor(doc.keyOrder, key, "common.ok"));
    doc.data.en[key] = "Retry";
    expect(serialize(doc, "en").split("\n").slice(1, 4)).toEqual([
      '  "common.ok": "OK",',
      '  "common.retry": "Retry",',
      '  "common.cancel": "Cancel",',
    ]);
  });

  it("平層裡沒有結構衝突，只擋重複", () => {
    const { doc } = load("flatdot");
    expect(keyPathError(doc.keyOrder, "common.ok.x", null, doc)).toBe("");
    expect(keyPathError(doc.keyOrder, "common", null, doc)).toBe("");
    expect(keyPathError(doc.keyOrder, "common.ok", null, doc)).toContain("已經存在");
  });

  it("改名、備註都維持平層", () => {
    const { doc } = load("flatdot");
    renameKey(doc, "common.ok", "common.okay");
    expect(JSON.parse(serialize(doc, "de"))).toEqual({
      "common.okay": "OK",
      "history.title": "Verlauf",
    });
    doc.comments["history.title"] = "標題";
    expect(JSON.parse(serializeComments(doc))).toEqual({ "history.title": "標題" });
  });

  it("有巢狀的專案不算平層，新 key 照舊寫成巢狀", () => {
    const { doc } = load("flat");
    expect(doc.flatKeys).toBe(false);
    doc.data.en["a.b"] = "x";
    expect(JSON.parse(serialize(doc, "en")).a).toEqual({ b: "x" });
  });

  it("只有 Loading... 這種 key 的平層檔不算平層專案", () => {
    const doc = createEmptyDoc();
    const text =
      '{\n  "Home-Featured": "Signature Cakes",\n  "Setting-AmbientSounds...": "Ambient sounds..."\n}\n';
    ingest(doc, classifyFiles([{ name: "en.json", rel: "en.json", text }]).sets[0]);
    expect(doc.flatKeys).toBe(false);
    expect(serialize(doc, "en")).toBe(text);
  });
});

describe("空值不會亂長", () => {
  it("原本沒有、現在也還是空的 key 不寫進去", () => {
    const { doc } = load("flat");
    doc.data.de["history.labels.size"] = "";
    expect(localeChanged(doc, "de")).toBe(false);
    expect(serialize(doc, "de")).not.toContain("labels");
  });

  it("原本就在檔案裡的 key 清空了也保留", () => {
    const { doc } = load("flat");
    doc.data.en["common.ok"] = "";
    expect(localeChanged(doc, "en")).toBe(true);
    expect(serialize(doc, "en")).toContain('"ok": "",');
  });
});

describe("新 key 的位置", () => {
  it("新填的 key 寫在畫面上鄰居的後面，不是群組結尾", () => {
    const { doc } = load("flat");
    // de 原本沒有 history.labels；在畫面上插在 common.ok 下面
    doc.keyOrder.splice(doc.keyOrder.indexOf("common.ok") + 1, 0, "common.new");
    doc.extraKeys["common.new"] = true;
    doc.data.de["common.new"] = "Neu";
    const text = serialize(doc, "de");
    expect(text.indexOf('"ok"')).toBeLessThan(text.indexOf('"new"'));
    expect(text.indexOf('"new"')).toBeLessThan(text.indexOf('"cancel"'));
  });

  it("placementAnchor：同一層接在點的那列下面，別組接在那組的最後一個", () => {
    const order = ["a.x", "a.y", "b.x", "b.y", "c"];
    expect(placementAnchor(order, "a.new", "a.x")).toBe("a.x");
    expect(placementAnchor(order, "b.new", "a.x")).toBe("b.y");
    expect(placementAnchor(order, "z.new", "a.x")).toBe("");
    expect(placementAnchor(order, "top", "c")).toBe("c");
  });
});

describe("key 的結構衝突", () => {
  const order = ["common.copy", "common.ok", "history.labels.size"];
  it("三種衝突", () => {
    expect(keyConflict(order, "common.ok", null)?.type).toBe("duplicate");
    expect(keyConflict(order, "history.labels", null)?.type).toBe("parent");
    expect(keyConflict(order, "common.copy.deeper", null)?.type).toBe("child");
    expect(keyConflict(order, "common.new", null)).toBeNull();
    expect(keyConflict(order, "common.ok", "common.ok")).toBeNull();
  });
  it("路徑格式", () => {
    expect(keyPathError(order, "", null)).toBe("請輸入 key");
    expect(keyPathError(order, ".a", null)).toContain("開頭與結尾");
    expect(keyPathError(order, "a..b", null)).toContain("連續");
    expect(keyPathError(order, "common.copy.x", null)).toBe(
      "common.copy 是一個字串，不能再往下分層",
    );
  });
});

describe("佔位符", () => {
  it("signature 不管空白與順序", () => {
    expect(signature("{{ a }} {0} {{b}}")).toBe(signature("{{b}}{0}{{a}}"));
  });
  it("取多數為準；平手整排標起來", () => {
    const { doc } = load("flat");
    expect([...outliersFor(doc, "common.copied")]).toEqual([]);
    doc.data.de["common.copied"] = "kopiert";
    expect([...outliersFor(doc, "common.copied")]).toEqual(["de"]);
    doc.data.en["common.copied"] = "copied";
    // en/de 沒有佔位符，zh-cht 有：2 對 1
    expect([...outliersFor(doc, "common.copied")]).toEqual(["zh-cht"]);
    delete doc.data.de["common.copied"];
    // 1 對 1：平手，兩個都標
    expect([...outliersFor(doc, "common.copied")].sort()).toEqual(["en", "zh-cht"]);
  });
});

describe("版面判斷", () => {
  it("巢狀版面：代碼取資料夾名，對不上樣板的（ja/deep/extra.json）不看", () => {
    const layout = classifyFiles(readFixture("nested"));
    expect(layout.pattern).toBe("{code}/translation.json");
    const [set] = layout.sets;
    expect(set.locales.map((l) => l.code).sort()).toEqual(["en-US", "ja", "zh-TW"]);
    expect(set.comments?.rel).toBe("_comments.json");
  });
  it("一個語系資料夾裡有多個 JSON：一份一個分頁", () => {
    const layout = classifyFiles([
      { name: "translation.json", rel: "en/translation.json", text: "{}" },
      { name: "common.json", rel: "en/common.json", text: "{}" },
      { name: "translation.json", rel: "ja/translation.json", text: "{}" },
    ]);
    expect(layout.pattern).toBe("{code}/{ns}.json");
    expect(layout.sets.map((x) => [x.ns, x.pattern, x.locales.map((l) => l.code)])).toEqual([
      ["common", "{code}/common.json", ["en"]],
      ["translation", "{code}/translation.json", ["en", "ja"]],
    ]);
  });
  it("看不出版面就丟 LayoutError", () => {
    expect(() => classifyFiles([])).toThrow(LayoutError);
  });
  it("拖進來的同名檔案", () => {
    expect(duplicateName([{ name: "a.json" }, { name: "b.json" }, { name: "a.json" }])).toBe(
      "a.json",
    );
    expect(duplicateName([{ name: "a.json" }])).toBe("");
  });
  it("從資料夾讀檔：最多五層、只看 .json、跳過點開頭的與 node_modules 這類", () => {
    expect(isLocaleCandidate("en.json")).toBe(true);
    expect(isLocaleCandidate("en-US/translation.json")).toBe(true);
    expect(isLocaleCandidate("_comments.json")).toBe(true);
    expect(isLocaleCandidate("i18n/eng/json/text.json")).toBe(true);
    expect(isLocaleCandidate("a/b/c/d/e/f.json")).toBe(false);
    expect(isLocaleCandidate("node_modules/x/package.json")).toBe(false);
    expect(isLocaleCandidate("library/imports/a.json")).toBe(false);
    expect(isLocaleCandidate("eng/json/text.json.meta")).toBe(false);
    expect(isLocaleCandidate("README.md")).toBe(false);
    expect(isLocaleCandidate("._en.json")).toBe(false);
    expect(isLocaleCandidate(".git/config.json")).toBe(false);
  });
  it("webkitdirectory 的路徑要拿掉根資料夾", () => {
    expect(splitRoot("locales/en-US/translation.json")).toEqual({
      root: "locales",
      rel: "en-US/translation.json",
    });
    expect(splitRoot("en.json")).toEqual({ root: "", rel: "en.json" });
  });
  it("唯讀資料夾讀得進巢狀版面，選太大也只讀對得上樣板的檔", async () => {
    const reads: string[] = [];
    const fake = (path: string, text = "{}") =>
      ({
        name: path.slice(path.lastIndexOf("/") + 1),
        webkitRelativePath: path,
        text: async () => {
          reads.push(path);
          return text;
        },
      }) as unknown as File;
    const refs = directoryInputRefs([
      fake("locales/en-US/translation.json", '{"a":"A"}'),
      fake("locales/ja/translation.json", '{"a":"エー"}'),
      fake("locales/_comments.json"),
      fake("locales/README.md", "# hi"),
      fake("locales/node_modules/pkg/package.json"),
      fake("locales/tools/config.json"),
    ]);
    const rels = refs.map((r) => r.rel);
    const pattern = detectPattern(rels)!;
    expect(pattern).toBe("{code}/translation.json");
    const files = await readRefs(refs, wantedRels(rels, pattern));
    expect(reads.sort()).toEqual([
      "locales/_comments.json",
      "locales/en-US/translation.json",
      "locales/ja/translation.json",
    ]);
    const [set] = classifyFiles(files, pattern).sets;
    expect(set.locales.map((l) => l.rel).sort()).toEqual([
      "en-US/translation.json",
      "ja/translation.json",
    ]);
    expect(set.comments?.rel).toBe("_comments.json");
  });
  it("認得大多數語系才用寫死的欄序，否則照字母", () => {
    expect(sortLocales(["de", "en", "zh-cht"])).toEqual(["en", "zh-cht", "de"]);
    expect(sortLocales(["th", "en-US", "fr", "es"])).toEqual(["en-US", "es", "fr", "th"]);
  });
});

describe("路徑樣板", () => {
  it("你們的 Cocos 版面：{code}/json/{ns}.json", () => {
    const rels = [
      "eng/json/text.json",
      "eng/json/errorMessage.json",
      "ja/json/text.json",
      "ja/json/errorMessage.json",
      "tch/json/text.json",
      "tch/json/errorMessage.json",
    ];
    expect(detectPattern(rels)).toBe("{code}/json/{ns}.json");
    // 選到上一層的 assets 也認得，旁邊的其他 JSON 不會被當成語系
    const fromAssets = [
      ...rels.map((r) => "i18n/" + r),
      "animations/hero/idle.json",
      "animations/hero/run.json",
      "resources/config/shop.json",
      "resources/config/ui.json",
    ];
    expect(detectPattern(fromAssets)).toBe("i18n/{code}/json/{ns}.json");
    expect(wantedRels(fromAssets, "i18n/{code}/json/{ns}.json")).toHaveLength(6);
  });
  it("扁平、巢狀、按檔名分資料夾", () => {
    expect(detectPattern(["en.json", "zh-cht.json", "_comments.json"])).toBe("{code}.json");
    expect(detectPattern(["en-US/translation.json", "ja/translation.json"])).toBe(
      "{code}/translation.json",
    );
    expect(
      detectPattern(["common/en.json", "common/ja.json", "errors/en.json", "errors/ja.json"]),
    ).toBe("{ns}/{code}.json");
    expect(detectPattern(["en/app.json", "en/ui.json", "ja/app.json", "ja/ui.json"])).toBe(
      "{code}/{ns}.json",
    );
  });
  it("旁邊多一個零星的檔，不會把一份檔拆成兩個分頁", () => {
    // 拆了的話備註檔會從 _comments.json 變成 _comments.translation.json，原本的備註全不見
    const rels = [
      "en-US/translation.json",
      "ja/translation.json",
      "zh-TW/translation.json",
      "en-US/backup.json",
    ];
    expect(detectPattern(rels)).toBe("{code}/translation.json");
    // 但少一份檔的語系不影響：errorMessage 只有 2/3 個語系有，還是算數
    expect(detectPattern(readFixture("multi").map((f) => f.rel))).toBe("{code}/json/{ns}.json");
  });
  it("拆路徑、備註檔位置、刪語系時收哪些資料夾", () => {
    expect(matchPattern("{code}/json/{ns}.json", "eng/json/text.json")).toEqual({
      code: "eng",
      ns: "text",
    });
    expect(matchPattern("{code}/json/{ns}.json", "eng/text.json")).toBeNull();
    expect(matchPattern("{code}.json", "_comments.json")).toBeNull();
    expect(commentsRel("{code}/json/{ns}.json", "text")).toBe("_comments.text.json");
    expect(commentsRel("i18n/{code}/{ns}.json", "")).toBe("i18n/_comments.json");
    expect(localeDirs("{code}/json/{ns}.json", "eng/json/text.json")).toEqual(["eng/json", "eng"]);
    expect(localeDirs("i18n/{code}/text.json", "i18n/eng/text.json")).toEqual(["i18n/eng"]);
    // text/ 是所有語系共用的，不能收
    expect(localeDirs("{ns}/{code}.json", "text/eng.json")).toEqual([]);
  });
  it("手動輸入的樣板要檢查", () => {
    expect(patternError("{code}/json/{ns}.json")).toBe("");
    expect(patternError("json/{ns}.json")).toContain("{code}");
    expect(patternError("{code}/text")).toContain(".json");
    expect(patternError("/{code}.json")).toContain("空的段");
    expect(patternError("../{code}.json")).toContain("..");
  });
  it("多份檔：每份各自讀、各自序列化逐位元相同，缺檔的語系只是那一份沒有", () => {
    const { docs, pattern, files } = loadAll("multi");
    expect(pattern).toBe("{code}/json/{ns}.json");
    expect(docs.map((d) => d.ns)).toEqual(["errorMessage", "text"]);
    const [errors, text] = docs;
    expect(text.order).toEqual(["eng", "tch", "sch"]);
    expect(errors.order).toEqual(["eng", "tch"]);
    for (const d of docs) {
      for (const code of d.order) expect(serialize(d, code)).toBe(textOf(files, d.rel[code]));
    }
    expect(text.commentsMeta.rel).toBe("_comments.text.json");
    expect(text.comments["home.title"]).toBe("蛋糕店標題");
    expect(errors.commentsMeta).toMatchObject({
      rel: "_comments.errorMessage.json",
      existed: false,
    });
    // 新增語系照各自的樣板擺
    expect(addLocale(errors, "sch")).toBe("sch/json/errorMessage.json");
  });
});

describe("語系代碼別名", () => {
  it("eng / sch / tch 認得是哪個語言，畫面上仍然帶原本的代碼", () => {
    expect(localeLabel("eng")).toBe("英文 ENG");
    expect(localeLabel("tch")).toBe("繁中 TCH");
    expect(localeLabel("en")).toBe("英文 EN");
    expect(localeLabel("xx")).toBe("xx");
    expect(sortLocales(["vi", "tch", "eng", "sch", "ja", "ko", "th"])).toEqual([
      "eng",
      "tch",
      "sch",
      "th",
      "vi",
      "ja",
      "ko",
    ]);
    expect(defaultSource(["eng", "sch", "tch"])).toBe("tch");
    expect(defaultSource(["fr", "de"])).toBe("fr");
  });
});

describe("結構操作", () => {
  it("改名：內容、備註一起搬，位置不變", () => {
    const { doc } = load("flat");
    const at = doc.keyOrder.indexOf("common.copied");
    renameKey(doc, "common.copied", "common.copiedText");
    expect(doc.keyOrder[at]).toBe("common.copiedText");
    expect(doc.data.en["common.copiedText"]).toBe("{{label}} copied");
    expect(doc.comments["common.copiedText"]).toBe("{{label}} 會被代換");
    expect(doc.data.en["common.copied"]).toBeUndefined();
  });

  it("刪 key", () => {
    const { doc } = load("flat");
    deleteKey(doc, "common.ok");
    expect(doc.keyOrder).not.toContain("common.ok");
    expect(serialize(doc, "en")).not.toContain('"ok"');
  });

  it("新增語系照現有版面擺，存檔後就不算新的", () => {
    const { doc } = load("nested");
    expect(addLocale(doc, "fr")).toBe("fr/translation.json");
    expect(changeSummary(doc).map((c) => c.rel)).toEqual(["fr/translation.json"]);
    doc.data.fr["d"] = "Dé";
    const changed = changedFiles(doc);
    rebaseline(doc, changed);
    expect(doc.newLocales.fr).toBeUndefined();
    expect(changeSummary(doc)).toEqual([]);
  });

  it("標記刪除 → 只有存檔才刪，復原後 key 順序回到原位", () => {
    const { doc } = load("flat");
    const keysBefore = doc.keyOrder.slice();
    markLocaleDeleted(doc, "en", { hidden: false, pinned: true });
    expect(doc.order).not.toContain("en");
    // unicode 只有 en 有，跟著消失
    expect(doc.keyOrder).not.toContain("unicode");
    expect(changedFiles(doc)).toEqual([
      { name: "en.json", rel: "en.json", text: null, code: "en", deleted: true },
    ]);
    const snap = restoreLocale(doc, "en");
    expect(snap?.pinned).toBe(true);
    expect(doc.keyOrder).toEqual(keysBefore);
    expect(changeSummary(doc)).toEqual([]);
  });

  it("備註改了才算變更", () => {
    const { doc } = load("flat");
    doc.comments["common.ok"] = "  ";
    expect(changeSummary(doc)).toEqual([]);
    doc.comments["common.ok"] = "按鈕";
    expect(changeSummary(doc)).toEqual([{ code: null, rel: "_comments.json" }]);
  });
});

describe("草稿", () => {
  it("只存改過的語系，還原回去內容一樣", () => {
    const { doc } = load("flat");
    doc.data.de["common.ok"] = "Gut";
    doc.extraKeys["x.y"] = true;
    const draft = buildDraft([doc], "資料夾 flat");
    expect(Object.keys(draft.parts)).toEqual([""]);
    expect(Object.keys(draft.parts[""].data)).toEqual(["de"]);

    const fresh = load("flat").doc;
    applyDraft(fresh, draft.parts[""]);
    expect(fresh.data.de["common.ok"]).toBe("Gut");
    expect(fresh.keyOrder).toContain("x.y");
  });
  it("多份檔：只放有改的那幾份", () => {
    const { docs } = loadAll("multi");
    const text = docs.find((d) => d.ns === "text")!;
    text.data.sch["ok"] = "确定";
    const draft = buildDraft(docs, "資料夾 multi");
    expect(Object.keys(draft.parts)).toEqual(["text"]);
    expect(Object.keys(draft.parts.text.data)).toEqual(["sch"]);
  });
  it("認不得的草稿是 null", () => {
    expect(upgradeDraft({ ts: 1 })).toBeNull();
    expect(upgradeDraft(null)).toBeNull();
  });
});

describe("篩選", () => {
  it("只算看得到的欄位", () => {
    const { doc } = load("flat");
    const all = { doc, visible: doc.order, group: "", query: "" };
    expect(applyFilters(all, "missing")).toContain("history.labels.size");
    const onlyEn = { ...all, visible: ["en"] };
    expect(applyFilters(onlyEn, "missing")).toEqual([]);
    expect(filterCounts({ ...all, group: "common" }).all).toBe(3);
    expect(applyFilters({ ...all, query: "訂單" }, "all")).toEqual(["history.title"]);
    expect(missingByLocale(doc).de).toBe(4);
  });
});

describe("欄位", () => {
  const { doc } = load("flat");
  it("KEY 永遠在最左邊，釘選的排前面", () => {
    const view = { hidden: {}, pinned: { de: true as const }, widths: {}, focus: "", source: "" };
    const cols = columnLayout(visibleLocales(doc, view), view);
    expect(cols.map((c) => c.id)).toEqual([KEY_COL, "de", NOTE_COL, "en", "zh-cht"]);
    expect(cols[1]).toMatchObject({ pinned: true, lastPinned: true, left: 260 });
  });
  it("聚焦模式：對照 + 目標", () => {
    const view = {
      hidden: { en: true as const },
      pinned: {},
      widths: {},
      focus: "de",
      source: "en",
    };
    expect(visibleLocales(doc, view)).toEqual(["en", "de"]);
  });
  it("凍結區太寬時從右邊退掉釘選", () => {
    const view = {
      hidden: {},
      pinned: { [NOTE_COL]: true as const, en: true as const },
      widths: {},
    };
    const fixed = enforcePinnedBudget(doc.order, view, 800);
    // 260 + 200 + 180 = 640 > 560 → 退掉 en
    expect(fixed?.dropped).toBe(1);
    expect(fixed?.pinned).toEqual({ [NOTE_COL]: true });
  });
});

describe("flatten", () => {
  it("數字與布林轉成字串，null 略過", () => {
    expect(flatten({ a: 1, b: { c: true, d: null } })).toEqual({ a: "1", "b.c": "true" });
  });
});
