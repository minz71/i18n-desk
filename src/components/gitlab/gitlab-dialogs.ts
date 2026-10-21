import { create } from "zustand";

interface GitLabDialogs {
  /** 每開一次精靈加一，讓精靈從第一步重來 */
  loadSeq: number;
  loadOpen: boolean;
  commitOpen: boolean;
}

export const useGitLabDialogState = create<GitLabDialogs>(() => ({
  loadSeq: 0,
  loadOpen: false,
  commitOpen: false,
}));

export function openGitLabLoad(): void {
  useGitLabDialogState.setState((s) => ({ loadOpen: true, loadSeq: s.loadSeq + 1 }));
}

export function closeGitLabLoad(): void {
  useGitLabDialogState.setState({ loadOpen: false });
}

export function openGitLabCommit(): void {
  useGitLabDialogState.setState({ commitOpen: true });
}

export function closeGitLabCommit(): void {
  useGitLabDialogState.setState({ commitOpen: false });
}
