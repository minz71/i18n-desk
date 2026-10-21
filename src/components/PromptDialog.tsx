import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
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
import { closeDialog, useDialog, type DialogOpts } from "@/store/dialog";

/* 新增 / 改名 / 刪除共用的對話框。重點是行內驗證：
   key 路徑打錯會直接在對話框裡說哪裡錯，可以當場改，不用被關掉再重開一次。 */
function Body({ opts }: { opts: DialogOpts }) {
  const isPrompt = !!opts.label;
  const [value, setValue] = useState(opts.value || "");
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isPrompt) return;
    // 游標放到最後：預填的是群組路徑，接著打 key 名稱就好
    requestAnimationFrame(() => {
      const el = input.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }, [isPrompt]);

  const submit = () => {
    if (!isPrompt) {
      closeDialog(true);
      return;
    }
    const msg = opts.validate?.(value) || "";
    if (msg) {
      // 留在對話框裡讓人改，不要關掉再丟 toast
      setError(msg);
      input.current?.focus();
      return;
    }
    closeDialog(value);
  };

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <DialogHeader>
        <DialogTitle className="break-all">{opts.title}</DialogTitle>
        {opts.body ? (
          <DialogDescription className="whitespace-pre-line">{opts.body}</DialogDescription>
        ) : (
          <DialogDescription className="sr-only">{opts.title}</DialogDescription>
        )}
      </DialogHeader>

      {isPrompt && (
        <div className="grid gap-2">
          <Label htmlFor="dlg-input">{opts.label}</Label>
          <Input
            id="dlg-input"
            ref={input}
            value={value}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            aria-invalid={!!error}
            onChange={(e) => {
              setValue(e.target.value);
              setError("");
            }}
          />
          {opts.hint && (
            <p className="text-xs whitespace-pre-line text-muted-foreground">{opts.hint}</p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      )}

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={() => closeDialog(isPrompt ? null : false)}
        >
          取消
        </Button>
        <Button
          type="submit"
          variant={opts.danger ? "destructive" : "default"}
          autoFocus={!isPrompt}
        >
          {opts.confirmText || "確定"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function PromptDialog() {
  const opts = useDialog((s) => s.opts);
  const seq = useDialog((s) => s.seq);
  return (
    <Dialog
      open={!!opts}
      onOpenChange={(open) => {
        // Esc / 點外面：當成取消，把 promise 收乾淨
        if (!open) closeDialog(opts?.label ? null : false);
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        {opts && <Body key={seq} opts={opts} />}
      </DialogContent>
    </Dialog>
  );
}
