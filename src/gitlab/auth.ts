import type { GlSavedCfg } from "./types";

/* 授權走 Personal Access Token（需要 api scope）。token 預設只進
   sessionStorage（分頁關掉就沒了），勾「記住」才會寫進 localStorage。
   OAuth 2.0 PKCE 才是靜態站台該有的形狀 —— 不存長效憑證、token 有期限 ——
   但要先在 GitLab 上註冊一個 application，所以這版先走 PAT。
   這支檔案就是之後要換掉的那個接縫，其他地方都不碰憑證從哪來。 */

const CFG_KEY = "i18n-desk-gitlab"; // 位址 / 專案 / 分支 / 路徑，不含 token
const TOKEN_KEY = "i18n-desk-gitlab-token";

export function loadCfg(): GlSavedCfg {
  try {
    const raw = localStorage.getItem(CFG_KEY);
    const cfg = raw ? JSON.parse(raw) : null;
    return cfg && typeof cfg === "object" ? cfg : {};
  } catch {
    return {};
  }
}

/* 只存連線設定。token 永遠不進這裡，也不進草稿。 */
export function saveCfg(cfg: GlSavedCfg): void {
  try {
    localStorage.setItem(
      CFG_KEY,
      JSON.stringify({
        host: cfg.host,
        project: cfg.project,
        ref: cfg.ref,
        dir: cfg.dir,
        remember: !!cfg.remember,
      }),
    );
  } catch {
    /* 隱私模式存不了就算了，下次重打一次 */
  }
}

export function getToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function setToken(token: string, remember: boolean): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
    if (remember) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* 存不了也還是能用，只是下次要再貼一次 */
  }
}

export function forgetToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* 沒得清就算了 */
  }
}
