import { detectPattern, matchPattern, wantedRels } from "@/core/layout";
import type { LoadedFile } from "@/core/types";
import { glMessage, treeRels, wantedTreeEntries } from "./host";
import type { GlAction, GlBranch, GlCfg, GlProject, GlTreeEntry, GlUser } from "./types";

/* 這是唯一會把內容送出去的路徑，而且只送到使用者自己填的那台 GitLab。
   資料夾 / 下載那兩條路完全沒有被動到。 */

const PAGE = 100;

interface ApiOpts {
  method?: string;
  body?: unknown;
}

function site(cfg: GlCfg): string {
  return cfg.host.replace(/\/+$/, "") + "/api/v4";
}

async function request(cfg: GlCfg, path: string, opts: ApiOpts = {}): Promise<Response> {
  const headers: Record<string, string> = { "PRIVATE-TOKEN": cfg.token };
  if (opts.body) headers["Content-Type"] = "application/json";
  try {
    return await fetch(site(cfg) + path, {
      method: opts.method || "GET",
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    // fetch 只有網路層失敗才 reject（CORS 被擋也算在這裡）。
    // HTTP 的錯誤碼算「成功拿到回應」，在下面處理。
    throw new Error("連不上 " + cfg.host + "。位址打錯、網路不通，或這台 GitLab 不接受跨來源請求");
  }
}

/* 所有請求的唯一入口：統一帶 token、統一翻錯誤。
   api() 打站台層的端點（/user、/projects），projectApi() 打某個專案底下的端點。 */
async function readText(cfg: GlCfg, path: string, opts?: ApiOpts): Promise<string> {
  const res = await request(cfg, path, opts);
  const text = await res.text();
  if (!res.ok) throw new Error(glMessage(res.status, text));
  return text;
}

export async function api<T>(cfg: GlCfg, path: string, opts?: ApiOpts): Promise<T> {
  const text = await readText(cfg, path, opts);
  return (text ? JSON.parse(text) : null) as T;
}

function projectPath(cfg: GlCfg, path: string): string {
  return "/projects/" + encodeURIComponent(cfg.project || "") + path;
}

export function projectApi<T>(cfg: GlCfg, path: string, opts?: ApiOpts): Promise<T> {
  return api<T>(cfg, projectPath(cfg, path), opts);
}

export function getUser(cfg: GlCfg): Promise<GlUser> {
  return api<GlUser>(cfg, "/user");
}

export function getBranch(cfg: GlCfg, name: string): Promise<GlBranch> {
  return projectApi<GlBranch>(cfg, "/repository/branches/" + encodeURIComponent(name));
}

/* 沒打字就列自己是成員的專案（最近動過的在前面）；打了字就連
   看得到但不是成員的一起搜 —— 不然「用網址被分享過來」的專案會找不到。 */
export async function listProjects(cfg: GlCfg, query: string): Promise<GlProject[]> {
  const list = await api<GlProject[]>(
    cfg,
    "/projects?simple=true&order_by=last_activity_at&per_page=30" +
      (query ? "&search=" + encodeURIComponent(query) : "&membership=true"),
  );
  return list || [];
}

export async function listBranches(cfg: GlCfg, query: string): Promise<GlBranch[]> {
  const list = await projectApi<GlBranch[]>(
    cfg,
    "/repository/branches?per_page=50" + (query ? "&search=" + encodeURIComponent(query) : ""),
  );
  return list || [];
}

export async function listTree(
  cfg: GlCfg,
  ref: string,
  path: string,
  perPage = 100,
): Promise<GlTreeEntry[]> {
  const list = await projectApi<GlTreeEntry[]>(
    cfg,
    "/repository/tree?ref=" +
      encodeURIComponent(ref) +
      "&path=" +
      encodeURIComponent(path) +
      "&per_page=" +
      perPage,
  );
  return list || [];
}

/* 樹狀列表預設一頁 20 筆，語系檔很容易比這個多，所以要翻到底。
   recursive=true 是因為巢狀版面的語系檔在子資料夾裡 ——
   不遞迴的話只會看到 43 個 type: "tree"，一個語系檔都拿不到。 */
async function treeRecursive(cfg: GlCfg, ref: string, dir: string): Promise<GlTreeEntry[]> {
  const out: GlTreeEntry[] = [];
  for (let page = 1; ; page += 1) {
    const list = await projectApi<GlTreeEntry[]>(
      cfg,
      "/repository/tree?ref=" +
        encodeURIComponent(ref) +
        "&path=" +
        encodeURIComponent(dir) +
        "&recursive=true&per_page=" +
        PAGE +
        "&page=" +
        page,
    );
    if (!list || !list.length) break;
    out.push(...list);
    if (list.length < PAGE) break;
  }
  return out;
}

export interface GlLoadResult {
  /** 載入當下的 commit id —— 之後要 commit 之前再問一次，不一樣就代表有人推過 */
  head: string;
  files: LoadedFile[];
  /** 實際用的路徑樣板 */
  pattern: string;
  /** 語系資料夾底下所有檔案的完整路徑（commit 時決定 create / update、要不要順手刪 .meta） */
  known: string[];
}

/**
 * 讀倉庫裡的語系資料夾。不碰編輯器狀態 —— 讀到一半壞掉的話，手上那份還在。
 * pick 決定用哪個樣板（拿到所有候選路徑，回 null 代表使用者不載入了，這時回 null）。
 */
export async function loadLocales(
  cfg: GlCfg,
  ref: string,
  dir: string,
  pick: (rels: string[]) => Promise<string | null>,
): Promise<GlLoadResult | null> {
  const branch = await getBranch(cfg, ref);
  const head = branch?.commit?.id;
  if (!head) throw new Error("讀不到 " + ref + " 的 commit id");

  const prefix = dir ? dir + "/" : "";
  const tree = await treeRecursive(cfg, ref, dir);
  const candidates = wantedTreeEntries(tree, dir);
  if (!candidates.length) {
    throw new Error("這個路徑下沒有 JSON 檔：" + (dir || "（倉庫根目錄）"));
  }
  const rel = (path: string) => (prefix ? path.slice(prefix.length) : path);
  const pattern = await pick(candidates.map((e) => rel(e.path)));
  if (!pattern) return null;
  const keep = new Set(
    wantedRels(
      candidates.map((e) => rel(e.path)),
      pattern,
    ),
  );
  const wanted = candidates.filter((e) => keep.has(rel(e.path)));
  if (!wanted.length) throw new Error("樣板 " + pattern + " 對不到任何檔案");

  const files = await Promise.all(
    wanted.map(async (e) => {
      const text = await readText(
        cfg,
        projectPath(
          cfg,
          "/repository/files/" + encodeURIComponent(e.path) + "/raw?ref=" + encodeURIComponent(ref),
        ),
      );
      return { name: e.name, rel: rel(e.path), path: e.path, text };
    }),
  );

  // 先確認每個檔都解得開，再讓呼叫端動現有資料
  for (const f of files) {
    try {
      JSON.parse(f.text);
    } catch (err) {
      throw new Error(f.path + " 不是合法的 JSON：" + (err as Error).message, { cause: err });
    }
  }
  return { head, files, pattern, known: treeRels(tree, dir).map((x) => x.entry.path) };
}

export function createCommit(
  cfg: GlCfg,
  body: { branch: string; start_branch?: string; commit_message: string; actions: GlAction[] },
): Promise<{ id: string }> {
  return projectApi(cfg, "/repository/commits", { method: "POST", body });
}

export async function createMergeRequest(
  cfg: GlCfg,
  source: string,
  target: string,
  title: string,
): Promise<string> {
  const mr = await projectApi<{ web_url?: string }>(cfg, "/merge_requests", {
    method: "POST",
    body: { source_branch: source, target_branch: target, title, remove_source_branch: true },
  });
  return mr?.web_url || "";
}

export interface DetectResult {
  ok: boolean;
  text: string;
}

/* 這一層像不像語系資料夾：往下抓一頁檔案清單，照載入時的規則猜一次樣板。
   只看一頁，資料夾很大時可能猜得不準 —— 這只是提示，真正的判斷在載入時。 */
export async function detectLayout(cfg: GlCfg, ref: string, path: string): Promise<DetectResult> {
  const list = await projectApi<GlTreeEntry[]>(
    cfg,
    "/repository/tree?ref=" +
      encodeURIComponent(ref) +
      "&path=" +
      encodeURIComponent(path) +
      "&recursive=true&per_page=" +
      PAGE,
  );
  const rels = wantedTreeEntries(list || [], path).map((e) =>
    path ? e.path.slice(path.length + 1) : e.path,
  );
  if (!rels.length) return { ok: false, text: "這一層底下沒有 JSON，點下面的資料夾繼續找。" };
  const pattern = detectPattern(rels);
  if (!pattern) return { ok: false, text: "這一層看起來不是語系資料夾，點下面的資料夾繼續找。" };
  const codes = new Set<string>();
  const nss = new Set<string>();
  for (const rel of wantedRels(rels, pattern)) {
    const m = matchPattern(pattern, rel);
    if (m) {
      codes.add(m.code);
      nss.add(m.ns);
    }
  }
  return {
    ok: true,
    text:
      "看起來是 " +
      pattern +
      "：" +
      codes.size +
      " 個語系" +
      (nss.size > 1 ? " × " + nss.size + " 份檔" : "") +
      "，可以直接載入這一層。",
  };
}

/* token 頁在 /-/user_settings/personal_access_tokens。
   （舊版是 /-/profile/...，新版不會從舊路徑轉過來，直接 404，所以這裡固定用新路徑。
   真的碰到舊站台的話，對話框裡有手動點選的路徑。）
   name / scopes 帶在網址上，版本支援就順便預填，不支援也只是被忽略。 */
export function tokenPageUrl(host: string): string {
  return host + "/-/user_settings/personal_access_tokens?name=i18n-desk&scopes=api";
}
