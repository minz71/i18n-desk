import { serialize, serializeComments } from "@/core/serialize";
import * as actions from "@/store/actions";
import * as dialog from "@/store/dialog";
import { getState } from "@/store/editor";

/** 開發用，只有 dev server 會掛（見 main.tsx）：在 console 檢查狀態或驗證序列化。GitLab 的 token 不在 state 裡。 */
export function installDebugHook(): void {
  (window as unknown as Record<string, unknown>).i18nDeskDebug = {
    get state() {
      return getState();
    },
    serialize: (code: string) => serialize(getState().doc, code),
    serializeComments: () => serializeComments(getState().doc),
    changedFiles: actions.pendingFiles,
    // 讓瀏覽器裡的測試可以直接驅動動作、回答對話框
    actions,
    dialog,
  };
}
