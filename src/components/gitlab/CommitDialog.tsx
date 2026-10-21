import { useState } from "react";
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
import { branchNameError, defaultBranchName, defaultCommitMessage, glShort } from "@/gitlab/host";
import type { GitLabSession } from "@/gitlab/types";
import { commitToGitLab, pendingFiles } from "@/store/actions";
import { useEditor } from "@/store/editor";
import { closeGitLabCommit, useGitLabDialogState } from "./gitlab-dialogs";

function Body({ g }: { g: GitLabSession }) {
  const [changed] = useState(pendingFiles);
  // 還在來源分支上 → 預設開一條新的工作分支，不要直推。
  // 已經開過工作分支了 → 預設繼續推同一條。
  const [branch, setBranch] = useState(g.branch === g.ref ? defaultBranchName() : g.branch);
  const [message, setMessage] = useState(() => defaultCommitMessage(changed));
  const [mr, setMr] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  /* MR 只有在「這次要開一條新分支」時才有意義：推回目前這條分支的話沒有東西可以 merge。 */
  const target = branch.trim();
  const canMr = !!target && target !== g.branch && target !== g.ref && !g.mrUrl;

  const submit = async () => {
    const msg = message.trim();
    const bad = branchNameError(target);
    if (bad) return setError(bad);
    if (!msg) return setError("請填 commit 訊息");
    setBusy(true);
    setError("");
    try {
      await commitToGitLab({ branch: target, message: msg, mr: mr && canMr });
      closeGitLabCommit();
    } catch (err) {
      setError((err instanceof Error && err.message) || "commit 失敗");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>提交到 GitLab</DialogTitle>
        <DialogDescription className="whitespace-pre-line">
          {changed.length} 個檔會在同一個 commit 裡進去：
          {changed.map((f) => f.rel + (f.deleted ? "（刪除）" : "")).join("、")}
          {"\n"}目前跟著 {g.branch}（{glShort(g.head)}）。
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-1.5">
        <Label htmlFor="gl-commit-branch">要 commit 到哪個分支</Label>
        <Input
          id="gl-commit-branch"
          value={branch}
          autoComplete="off"
          spellCheck={false}
          autoFocus
          className="font-mono"
          onChange={(e) => {
            setBranch(e.target.value);
            setError("");
          }}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="gl-commit-message">Commit 訊息</Label>
        <Input
          id="gl-commit-message"
          value={message}
          autoComplete="off"
          onChange={(e) => {
            setMessage(e.target.value);
            setError("");
          }}
        />
      </div>
      {canMr && (
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox checked={mr} onCheckedChange={(v) => setMr(v === true)} />
          順便開一個 Merge Request 回 {g.ref}
        </label>
      )}

      <p className="text-xs text-muted-foreground">
        所有檔案在同一個 commit
        裡進去，不會出現「存到一半」的狀態。送出之前會再確認一次遠端沒有被別人推過。
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={closeGitLabCommit}>
          取消
        </Button>
        <Button
          type="submit"
          disabled={busy}
          className="bg-gitlab text-gitlab-foreground hover:bg-gitlab/90"
        >
          {busy ? "處理中…" : "建立 commit"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function CommitDialog() {
  const open = useGitLabDialogState((s) => s.commitOpen);
  const g = useEditor((s) => s.gitlab);
  return (
    <Dialog open={open && !!g} onOpenChange={(v) => !v && closeGitLabCommit()}>
      <DialogContent showCloseButton={false} className="sm:max-w-xl">
        {open && g && <Body g={g} />}
      </DialogContent>
    </Dialog>
  );
}
