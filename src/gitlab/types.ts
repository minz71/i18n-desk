/** 打 API 需要的最少資訊。精靈途中還沒選專案時 project 是空的。 */
export interface GlCfg {
  host: string;
  token: string;
  project?: string;
}

/** 記在 localStorage 的連線設定。token 永遠不在這裡。 */
export interface GlSavedCfg {
  host?: string;
  project?: string;
  ref?: string;
  dir?: string;
  remember?: boolean;
}

/** GitLab 模式的連線狀態（不含 token，token 在 auth.ts）。 */
export interface GitLabSession {
  host: string;
  project: string;
  dir: string;
  /** 載入時的來源分支，開 MR 時當目標 */
  ref: string;
  /** 目前跟著的分支，第一次 commit 之後換成工作分支 */
  branch: string;
  /** 上面那條分支現在的 commit id —— 衝突偵測的基準 */
  head: string;
  /** 倉庫裡已經有的路徑（決定 commit 時是 create 還是 update）。載入時是語系資料夾底下的所有檔案 */
  known: Record<string, true>;
  mrUrl: string;
}

export interface GlTreeEntry {
  id: string;
  name: string;
  type: "blob" | "tree" | "commit";
  path: string;
}

export interface GlProject {
  id: number;
  path_with_namespace: string;
  default_branch?: string;
}

export interface GlBranch {
  name: string;
  commit?: { id: string };
}

export interface GlUser {
  name?: string;
  username?: string;
}

export type GlAction =
  | { action: "delete"; file_path: string }
  | { action: "create" | "update"; file_path: string; content: string; encoding: "text" };
