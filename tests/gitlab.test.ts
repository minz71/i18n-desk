import { describe, expect, it } from "vitest";
import {
  applyActions,
  branchNameError,
  defaultBranchName,
  glActions,
  glMessage,
  normalizeHost,
  wantedTreeEntries,
} from "@/gitlab/host";
import type { GitLabSession, GlTreeEntry } from "@/gitlab/types";

describe("normalizeHost", () => {
  it("各種貼法都收成 origin", () => {
    expect(normalizeHost("git.example.com/")).toBe("https://git.example.com");
    expect(normalizeHost("https://git.example.com/group/repo/-/tree/main")).toBe(
      "https://git.example.com",
    );
    expect(normalizeHost("git@git.example.com:group/repo.git")).toBe("https://git.example.com");
    expect(normalizeHost("http://10.0.0.1:8080/x")).toBe("http://10.0.0.1:8080");
    expect(normalizeHost("ftp://x")).toBe("");
    expect(normalizeHost("  ")).toBe("");
  });
});

describe("glMessage", () => {
  it("把 HTTP 碼翻成能行動的句子", () => {
    expect(glMessage(401, "")).toContain("token 無效");
    expect(glMessage(403, '{"message":"nope"}')).toContain("：nope");
    expect(glMessage(500, "<html>")).toBe("GitLab 回 HTTP 500");
  });
});

describe("wantedTreeEntries", () => {
  const e = (path: string, type: GlTreeEntry["type"] = "blob"): GlTreeEntry => ({
    id: path,
    path,
    type,
    name: path.slice(path.lastIndexOf("/") + 1),
  });
  it("語系資料夾底下的 JSON 都是候選（要讀哪些等樣板判斷完才決定）", () => {
    const got = wantedTreeEntries(
      [
        e("src/locales/en.json"),
        e("src/locales/_comments.json"),
        e("src/locales/_other.json"),
        e("src/locales/zh/translation.json"),
        e("src/locales/zh/deep/x.json"),
        e("src/locales/zh", "tree"),
        e("src/other.json"),
      ],
      "src/locales",
    ).map((x) => x.path);
    expect(got).toEqual([
      "src/locales/en.json",
      "src/locales/_comments.json",
      "src/locales/_other.json",
      "src/locales/zh/translation.json",
      "src/locales/zh/deep/x.json",
    ]);
  });
});

describe("glActions", () => {
  const session = (): GitLabSession => ({
    host: "https://g",
    project: "g/r",
    dir: "loc",
    ref: "main",
    branch: "main",
    head: "abc",
    known: { "loc/en.json": true, "loc/de.json": true, "loc/de.json.meta": true },
    mrUrl: "",
  });

  it("已有的 update、新的 create、刪的 delete；commit 後更新路徑紀錄", () => {
    const g = session();
    const changed = [
      { name: "en.json", rel: "en.json", text: "{}\n", code: "en" },
      { name: "fr.json", rel: "fr.json", text: "{}\n", code: "fr" },
      { name: "de.json", rel: "de.json", text: null, code: "de", deleted: true },
      { name: "_comments.json", rel: "_comments.json", text: "{}\n", code: null },
    ];
    const actions = glActions(g, changed);
    expect(actions.map((a) => a.action + " " + a.file_path)).toEqual([
      "update loc/en.json",
      "create loc/fr.json",
      "delete loc/de.json",
      // Cocos Creator 的 .meta 跟著刪
      "delete loc/de.json.meta",
      "create loc/_comments.json",
    ]);
    applyActions(g, actions);
    expect(g.known["loc/de.json"]).toBeUndefined();
    expect(g.known["loc/de.json.meta"]).toBeUndefined();
    expect(g.known["loc/fr.json"]).toBe(true);
    expect(g.known["loc/_comments.json"]).toBe(true);
  });
});

describe("glActions：Cocos 的資料夾 .meta", () => {
  it("語系資料夾空了才連資料夾的 .meta 一起刪", () => {
    const known = [
      "a/i18n/tch/json/text.json",
      "a/i18n/tch/json/text.json.meta",
      "a/i18n/tch/json/err.json",
      "a/i18n/tch/json/err.json.meta",
      "a/i18n/tch/json.meta",
      "a/i18n/tch.meta",
      "a/i18n/eng/json/text.json",
      "a/i18n/eng/json/text.json.meta",
      "a/i18n/eng/json/notes.txt",
      "a/i18n/eng/json.meta",
      "a/i18n/eng.meta",
    ];
    const g: GitLabSession = {
      host: "https://g",
      project: "g/r",
      dir: "a",
      ref: "main",
      branch: "main",
      head: "x",
      known: Object.fromEntries(known.map((p) => [p, true as const])),
      mrUrl: "",
    };
    const del = (rel: string, code: string) => ({
      name: rel,
      rel,
      text: null,
      code,
      deleted: true,
    });
    const actions = glActions(
      g,
      [
        del("i18n/tch/json/text.json", "tch"),
        del("i18n/tch/json/err.json", "tch"),
        del("i18n/eng/json/text.json", "eng"),
      ],
      "i18n/{code}/json/{ns}.json",
    );
    const paths = actions.map((a) => a.file_path);
    expect(paths).toContain("a/i18n/tch/json.meta");
    expect(paths).toContain("a/i18n/tch.meta");
    // eng/json 裡還有 notes.txt：資料夾不會消失，它的 .meta 要留著
    expect(paths).not.toContain("a/i18n/eng/json.meta");
    expect(paths).not.toContain("a/i18n/eng.meta");
    expect(paths).toContain("a/i18n/eng/json/text.json.meta");
  });
});

describe("分支", () => {
  it("預設分支名與檢查", () => {
    expect(defaultBranchName(new Date(2026, 0, 5))).toBe("i18n/2026-01-05");
    expect(branchNameError("i18n/2026-01-05")).toBe("");
    expect(branchNameError("a b")).not.toBe("");
    expect(branchNameError("a..b")).not.toBe("");
    expect(branchNameError("-x")).not.toBe("");
    expect(branchNameError("")).toBe("請填分支名稱");
  });
});
