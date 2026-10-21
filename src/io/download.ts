import { strToU8, zipSync, type Zippable } from "fflate";

export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function jsonBlob(text: string): Blob {
  return new Blob([text], { type: "application/json;charset=utf-8" });
}

/** 打包成 zip。rel 可以帶資料夾（巢狀版面），zip 裡的路徑就是身分。 */
export function zipBlob(files: { rel: string; text: string }[]): Blob {
  const tree: Zippable = {};
  for (const f of files) tree[f.rel] = strToU8(f.text);
  const bytes = zipSync(tree, { level: 6 });
  return new Blob([bytes.slice().buffer], { type: "application/zip" });
}
