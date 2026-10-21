import { useEffect, useRef, useState, type ReactNode } from "react";
import { ExternalLink, Folder, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import * as gl from "@/gitlab/api";
import { forgetToken, getToken, loadCfg, saveCfg, setToken } from "@/gitlab/auth";
import { glShort, normalizeHost } from "@/gitlab/host";
import type { GlBranch, GlProject, GlSavedCfg, GlTreeEntry } from "@/gitlab/types";
import { cn } from "@/lib/utils";
import { hasUnsavedChanges, loadFromGitLab } from "@/store/actions";
import { confirmDialog } from "@/store/dialog";
import { notify } from "@/store/notify";
import { closeGitLabLoad, openGitLabLoad, useGitLabDialogState } from "./gitlab-dialogs";

/* 載入精靈：連線 → 專案 → 分支 → 語系資料夾。
   不要求使用者先知道專案路徑、分支名、語系資料夾在哪 —— 對沒用過 git 的人來說
   那是三個都答不出來的問題。所以一步一步問，
   能用選的就不要用打的：專案、分支、資料夾都從 API 撈回來讓人點。
   驗證或請求失敗時留在對話框裡讓人改，不是關掉再丟 toast。 */

type Step = 1 | 2 | 3 | 4;
const STEPS = ["連線", "專案", "分支", "語系資料夾"];
const errMsg = (err: unknown, fallback: string) =>
  (err instanceof Error && err.message) || fallback;

interface Folder {
  path: string;
  dirs: GlTreeEntry[];
  detect: gl.DetectResult | null;
}

function Steps({ step }: { step: Step }) {
  return (
    <ol className="flex gap-1.5">
      {STEPS.map((label, i) => {
        const n = i + 1;
        return (
          <li
            key={label}
            className={cn(
              "flex-1 rounded-md border px-2 py-1 text-center text-xs",
              n === step && "border-gitlab bg-gitlab font-semibold text-gitlab-foreground",
              n < step && "border-gitlab/40 text-gitlab",
              n > step && "text-muted-foreground",
            )}
          >
            {n}. {label}
          </li>
        );
      })}
    </ol>
  );
}

function PickList({ children, empty }: { children: ReactNode[]; empty: string }) {
  return (
    <div className="max-h-72 min-h-24 overflow-auto rounded-md border">
      {children.length ? (
        children
      ) : (
        <div className="p-4 text-center text-sm text-muted-foreground">{empty}</div>
      )}
    </div>
  );
}

function PickItem(props: { label: ReactNode; meta?: string; tag?: string; onPick: () => void }) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-accent"
      onClick={props.onPick}
    >
      <span className="min-w-0 flex-1 truncate">{props.label}</span>
      {props.tag && (
        <span className="rounded bg-gitlab/15 px-1.5 text-[11px] font-medium text-gitlab">
          {props.tag}
        </span>
      )}
      {props.meta && <span className="font-mono text-xs text-muted-foreground">{props.meta}</span>}
    </button>
  );
}

function Wizard() {
  const [last] = useState<GlSavedCfg>(loadCfg);
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [host, setHost] = useState(normalizeHost(last.host));
  const [token, setTokenText] = useState(getToken());
  const [remember, setRemember] = useState(!!last.remember);
  const [who, setWho] = useState("");

  const [projectQuery, setProjectQuery] = useState("");
  const [projects, setProjects] = useState<GlProject[]>([]);
  const [project, setProject] = useState("");
  const [defaultBranch, setDefaultBranch] = useState("");

  const [branchQuery, setBranchQuery] = useState("");
  const [branches, setBranches] = useState<GlBranch[]>([]);
  const [ref, setRef] = useState("");

  const [folder, setFolder] = useState<Folder | null>(null);

  const hostInput = useRef<HTMLInputElement>(null);
  const tokenInput = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    requestAnimationFrame(() => (host ? tokenInput : hostInput).current?.focus());
    return () => clearTimeout(searchTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cfg = (p = project) => ({ host, token, project: p });

  /** 讀位址欄並把整理後的結果寫回去，讓使用者看到實際會連的是哪裡 */
  const readHost = () => {
    const h = normalizeHost(host);
    if (h) setHost(h);
    return h;
  };

  const run = async (fn: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(errMsg(err, fallback));
    } finally {
      setBusy(false);
    }
  };

  // ---- 1. 連線 ----

  const connect = () => {
    const h = readHost();
    const t = token.trim();
    if (!h) return setError("位址看不懂，填 GitLab 的網域就好，例如 https://gitlab.example.com");
    if (!t) return setError("請貼上 access token（上面那顆橘色按鈕可以去申請）");
    void run(async () => {
      // /user 是最便宜的驗證：token 有效的話順便知道是誰
      const c = { host: h, token: t };
      const user = await gl.getUser(c);
      setWho(user?.name || user?.username || "?");
      setToken(t, remember);
      setHost(h);
      setTokenText(t);
      setProjects(await gl.listProjects(c, ""));
      setStep(2);
    }, "連線失敗");
  };

  // ---- 2. 專案 ----

  const pickProject = (p: GlProject) => {
    void run(async () => {
      const name = p.path_with_namespace;
      const def = p.default_branch || "";
      const list = await gl.listBranches(cfg(name), "");
      setProject(name);
      setDefaultBranch(def);
      setBranches(list);
      setBranchQuery("");
      setStep(3);
    }, "讀不到分支");
  };

  // ---- 3. 分支 ----

  const openFolder = async (path: string, branch = ref) => {
    const entries = await gl.listTree(cfg(), branch, path);
    setFolder({ path, dirs: entries.filter((e) => e.type === "tree"), detect: null });
    // 只是提示，失敗了也不擋人往下點
    const detect = await gl
      .detectLayout(cfg(), branch, path)
      .catch(() => ({ ok: false, text: "檢查不了這一層，可以直接載入看看。" }));
    setFolder((f) => (f && f.path === path ? { ...f, detect } : f));
  };

  const pickBranch = (name: string) => {
    void run(async () => {
      setRef(name);
      // 上次用過的路徑就從那裡開始找，不用再點一次同樣的路
      await openFolder(last.dir || "", name);
      setStep(4);
    }, "讀不到資料夾");
  };

  // ---- 4. 載入 ----

  const load = async (c: {
    host: string;
    token: string;
    project: string;
    ref: string;
    dir: string;
    remember: boolean;
  }) => {
    // 載入會整個換掉手上的資料，沒送出去的修改就沒了
    if (hasUnsavedChanges()) {
      closeGitLabLoad();
      const ok = await confirmDialog({
        title: "還有沒送出去的變更",
        body: "從 GitLab 載入會換掉目前手上的資料，還沒 commit / 下載的修改會不見。要繼續嗎？",
        confirmText: "捨棄並載入",
        danger: true,
      });
      if (!ok) {
        openGitLabLoad();
        return;
      }
      try {
        await loadFromGitLab(c);
        setToken(c.token, c.remember);
        saveCfg(c);
      } catch (err) {
        // 對話框已經關掉了，錯誤改用 toast 報
        notify("載入失敗：" + errMsg(err, ""));
      }
      return;
    }
    await run(async () => {
      await loadFromGitLab(c);
      setToken(c.token, c.remember);
      saveCfg(c);
      closeGitLabLoad();
    }, "載入失敗");
  };

  /* 上次那組設定直接用。省掉的是三次點選，不是任何一次確認 ——
     載入前一樣會擋沒送出去的變更。 */
  const repeatLast = () => {
    const h = readHost();
    const t = token.trim();
    if (!h) return setError("位址看不懂，填 GitLab 的網域就好，例如 https://gitlab.example.com");
    if (!t) return setError("請先貼上 access token");
    void load({
      host: h,
      token: t,
      remember,
      project: last.project || "",
      ref: last.ref || "",
      dir: last.dir || "",
    });
  };

  const submit = () => {
    if (step === 1) return connect();
    if (step === 2) return setError("請點一個專案");
    if (step === 3) return setError("請點一個分支");
    void load({ host, token, remember, project, ref, dir: folder?.path || "" });
  };

  // 專案 / 分支的過濾都打回 API（清單可能比一頁長），所以要節流
  const search = (q: string, fn: (q: string) => Promise<void>) => {
    setError("");
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      fn(q.trim()).catch((err) => setError(errMsg(err, "查詢失敗")));
    }, 250);
  };

  const canRepeat = !!(last.host && last.project && last.ref);
  const okLabel = busy ? "處理中…" : step === 4 ? "載入這一層" : "下一步";

  const sortedBranches = [...branches].sort(
    (a, b) => (a.name === defaultBranch ? 0 : 1) - (b.name === defaultBranch ? 0 : 1),
  );
  const crumbs = folder?.path ? folder.path.split("/") : [];

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>從 GitLab 載入語系</DialogTitle>
        <DialogDescription className="sr-only">
          四個步驟：連線、專案、分支、語系資料夾
        </DialogDescription>
      </DialogHeader>
      <Steps step={step} />

      {step === 1 && (
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="gl-host">GitLab 位址</Label>
            <Input
              id="gl-host"
              ref={hostInput}
              value={host}
              placeholder="https://git.example.com"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => {
                setHost(e.target.value);
                setError("");
              }}
              // 離開欄位就先整理一次，不用等按下一步才發現被改掉
              onBlur={readHost}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="gl-token">Access Token</Label>
            <Input
              id="gl-token"
              ref={tokenInput}
              type="password"
              value={token}
              placeholder="glpat-…"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => {
                setTokenText(e.target.value);
                setError("");
              }}
            />
          </div>

          <div className="grid gap-2 rounded-md border border-gitlab/30 bg-gitlab/5 p-3">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="w-fit border-gitlab/50 text-gitlab hover:bg-gitlab/10 hover:text-gitlab"
              onClick={() => {
                const h = readHost();
                if (!h) return setError("請先填 GitLab 位址，才知道要去哪裡申請");
                window.open(gl.tokenPageUrl(h), "_blank", "noopener");
              }}
            >
              在 GitLab 申請一個 token <ExternalLink />
            </Button>
            <p className="text-xs leading-relaxed text-muted-foreground">
              沒有 token 也沒關係，這顆按鈕會把申請頁開好，在那一頁做五件事：
              <br />
              1. 按 <b>Add new token</b>（有些版本直接就是一張表單）→ 2. 名稱隨意、到期日隨便挑一個
              → 3.{" "}
              <b>
                權限只勾 <code>api</code>
              </b>{" "}
              → 4. 按 <b>Create personal access token</b> → 5. 把畫面上那串 <code>glpat-…</code>{" "}
              複製回來貼在上面。
              <br />
              那串字只會出現一次，關掉就看不到了，弄丟就再申請一個。頁面開不起來的話：GitLab
              右上角頭像 → <b>Edit profile</b> 或 <b>User settings</b> → <b>Access tokens</b>。
            </p>
          </div>

          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <Checkbox
              className="mt-0.5"
              checked={remember}
              onCheckedChange={(v) => setRemember(v === true)}
            />
            <span>在這台電腦記住 token。不勾的話只留到這個分頁關掉為止。</span>
          </label>

          {/* 上次用過的整組設定：常見情況是每天開同一個專案，不該每次都走四步 */}
          {canRepeat && (
            <Button
              type="button"
              variant="secondary"
              className="justify-start"
              disabled={busy}
              onClick={repeatLast}
            >
              <RotateCw /> 直接載入上次的：
              <span className="truncate font-mono text-xs">
                {last.project}@{last.ref}
                {last.dir ? " · " + last.dir : ""}
              </span>
            </Button>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="grid gap-3">
          <p className="text-sm text-muted-foreground">
            已連上 {host}，你是 <b className="text-foreground">{who}</b>
          </p>
          <div className="grid gap-1.5">
            <Label htmlFor="gl-project">找專案</Label>
            <Input
              id="gl-project"
              value={projectQuery}
              placeholder="打幾個字過濾…"
              autoComplete="off"
              spellCheck={false}
              autoFocus
              onChange={(e) => {
                setProjectQuery(e.target.value);
                search(e.target.value, async (q) => setProjects(await gl.listProjects(cfg(), q)));
              }}
            />
          </div>
          <PickList
            empty={
              projectQuery.trim()
                ? "找不到符合的專案"
                : "這個帳號還不是任何專案的成員。知道名字的話，用上面的搜尋框找。"
            }
          >
            {projects.map((p) => (
              <PickItem
                key={p.id}
                label={p.path_with_namespace}
                meta={p.default_branch || ""}
                onPick={() => pickProject(p)}
              />
            ))}
          </PickList>
        </div>
      )}

      {step === 3 && (
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="gl-branch">找分支</Label>
            <Input
              id="gl-branch"
              value={branchQuery}
              placeholder="打幾個字過濾…"
              autoComplete="off"
              spellCheck={false}
              autoFocus
              onChange={(e) => {
                setBranchQuery(e.target.value);
                search(e.target.value, async (q) => setBranches(await gl.listBranches(cfg(), q)));
              }}
            />
          </div>
          <PickList empty={branchQuery.trim() ? "找不到符合的分支" : "這個專案沒有分支"}>
            {sortedBranches.map((b) => (
              <PickItem
                key={b.name}
                label={b.name}
                meta={b.commit?.id ? glShort(b.commit.id) : ""}
                tag={b.name === defaultBranch ? "預設" : ""}
                onPick={() => pickBranch(b.name)}
              />
            ))}
          </PickList>
        </div>
      )}

      {step === 4 && folder && (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-1 text-sm">
            {["倉庫根目錄", ...crumbs].map((name, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span className="text-muted-foreground">/</span>}
                <button
                  type="button"
                  className="rounded px-1 hover:bg-accent hover:underline"
                  onClick={() =>
                    void run(() => openFolder(crumbs.slice(0, i).join("/")), "讀不到資料夾")
                  }
                >
                  {name}
                </button>
              </span>
            ))}
          </div>
          <PickList empty="這一層沒有子資料夾">
            {folder.dirs.map((d) => (
              <PickItem
                key={d.path}
                label={
                  <span className="inline-flex items-center gap-1.5">
                    <Folder size={14} className="text-muted-foreground" /> {d.name}
                  </span>
                }
                onPick={() => void run(() => openFolder(d.path), "讀不到資料夾")}
              />
            ))}
          </PickList>
          <p className={cn("text-sm", folder.detect?.ok ? "text-folder" : "text-muted-foreground")}>
            {folder.detect ? folder.detect.text : "檢查這一層…"}
          </p>
        </div>
      )}

      {error && <p className="text-sm whitespace-pre-line text-destructive">{error}</p>}

      <DialogFooter className="items-center sm:justify-between">
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground hover:underline"
          onClick={() => {
            forgetToken();
            setTokenText("");
            setRemember(false);
            notify("已清掉這台電腦上記住的 token");
          }}
        >
          清除記住的 token
        </button>
        <div className="flex gap-2">
          {step > 1 && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setError("");
                setStep((s) => (s - 1) as Step);
              }}
            >
              上一步
            </Button>
          )}
          <Button type="button" variant="outline" onClick={closeGitLabLoad}>
            取消
          </Button>
          <Button
            type="submit"
            disabled={busy}
            className="bg-gitlab text-gitlab-foreground hover:bg-gitlab/90"
          >
            {okLabel}
          </Button>
        </div>
      </DialogFooter>
    </form>
  );
}

export function GitLabWizard() {
  const open = useGitLabDialogState((s) => s.loadOpen);
  const seq = useGitLabDialogState((s) => s.loadSeq);
  return (
    <Dialog open={open} onOpenChange={(v) => !v && closeGitLabLoad()}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-xl"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {open && <Wizard key={seq} />}
      </DialogContent>
    </Dialog>
  );
}
