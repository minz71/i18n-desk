import { create } from "zustand";

/**
 * 通用對話框。沒有 label 時是確認對話框，resolve(true/false)；
 * 有 label 時是輸入框，resolve(字串) 或取消時 resolve(null)。
 * validate 回傳錯誤字串就擋下來並顯示在對話框裡 —— key 路徑打錯可以當場改，
 * 不用被關掉再重開一次。
 */
export interface DialogOpts {
  title: string;
  body?: string;
  label?: string;
  value?: string;
  hint?: string;
  confirmText?: string;
  danger?: boolean;
  validate?: (value: string) => string;
}

interface DialogState {
  opts: DialogOpts | null;
  /** 每開一次加一，讓對話框內容整個重來 */
  seq: number;
  resolve: ((value: string | boolean | null) => void) | null;
}

export const useDialog = create<DialogState>(() => ({ opts: null, seq: 0, resolve: null }));

function open(opts: DialogOpts): Promise<string | boolean | null> {
  // 前一個還開著就當成取消，不要讓它的 promise 懸著
  closeDialog(null);
  return new Promise((resolve) => useDialog.setState((s) => ({ opts, resolve, seq: s.seq + 1 })));
}

export function closeDialog(value: string | boolean | null): void {
  const { resolve, opts } = useDialog.getState();
  if (!resolve) return;
  useDialog.setState({ opts: null, resolve: null });
  resolve(opts?.label ? value : !!value);
}

export function confirmDialog(
  opts: Omit<DialogOpts, "label" | "value" | "validate">,
): Promise<boolean> {
  return open(opts) as Promise<boolean>;
}

export function promptDialog(opts: DialogOpts & { label: string }): Promise<string | null> {
  return open(opts) as Promise<string | null>;
}
