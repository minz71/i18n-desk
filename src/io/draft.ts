import { createStore, del, get, set } from "idb-keyval";
import { upgradeDraft, type Draft } from "@/core/doc";

/* 編到一半的內容存在 IndexedDB，關掉分頁再打開會問要不要還原。
   DB / store / key 名不要改：改了就讀不到使用者已經存著的草稿。 */
const store = createStore("i18n-desk", "state");
const KEY = "draft";

export function writeDraft(draft: Draft): void {
  set(KEY, draft, store).catch(() => {});
}

export function clearDraft(): void {
  del(KEY, store).catch(() => {});
}

export async function readDraft(): Promise<Draft | null> {
  try {
    return upgradeDraft(await get(KEY, store));
  } catch {
    return null;
  }
}
