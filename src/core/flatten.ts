import type { Flat, KeyPaths } from "./types";

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

/* 巢狀 JSON 攤平成 "a.b.c"。檔案裡本身就含 . 的 key（技術債，例如 "Loading..."）
   光看攤平後的字串分不出是不是巢狀，所以把它實際的分層另外記進 paths，
   寫回去時照著分層，才不會被拆成 {"Loading": {"": {"": ...}}}。 */
export function flatten(obj: unknown, paths?: KeyPaths, seg: string[] = [], out: Flat = {}): Flat {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return out;
  const rec = obj as Record<string, Json>;
  for (const k of Object.keys(rec)) {
    const v = rec[k];
    const next = [...seg, k];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      flatten(v, paths, next, out);
      continue;
    }
    if (v == null) continue;
    const path = next.join(".");
    // 只有含 . 的 key 才會撞：{"a.b": 1, "a": {"b": 2}} 兩個都攤成 a.b，存檔時一定會掉一個
    if (Object.prototype.hasOwnProperty.call(out, path)) {
      throw new Error(
        "「" + path + "」出現兩次（一個是本身含 . 的 key，一個是巢狀），請先手動改掉其中一個",
      );
    }
    if (paths && next.some((s) => s.includes("."))) paths[path] = next;
    out[path] = typeof v === "string" ? v : String(v);
  }
  return out;
}

export function setNested(target: Record<string, unknown>, seg: string[], value: string): void {
  let cur = target;
  for (let i = 0; i < seg.length - 1; i += 1) {
    const next = cur[seg[i]];
    if (!next || typeof next !== "object") cur[seg[i]] = {};
    cur = cur[seg[i]] as Record<string, unknown>;
  }
  cur[seg[seg.length - 1]] = value;
}

export function isBlank(value: string | undefined | null): boolean {
  return !String(value || "").trim();
}
