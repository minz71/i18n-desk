import { useEffect, useRef } from "react";
import { Crosshair } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { localeLabel } from "@/core/locales";
import { cn } from "@/lib/utils";
import { revealColumn, setFocus, setSourceLocale, stepFocus, toggleFocus } from "@/store/actions";
import { useEditor } from "@/store/editor";

/* 語系列：沒開聚焦時當快速定位用；開了聚焦就是「對照 + 一個目標」的切換器。
   每顆 chip 上的數字是那個語系還缺幾個 key。 */
export function LocaleBar() {
  const order = useEditor((s) => s.doc.order);
  const focus = useEditor((s) => s.focus);
  const source = useEditor((s) => s.source);
  const hidden = useEditor((s) => s.hidden);
  const missing = useEditor((s) => s.localeMissing);
  useEditor((s) => s.docRev);
  const chips = useRef<HTMLDivElement>(null);
  const on = !!focus;

  // Alt + ←/→ 換目標語系。放在 window 上，焦點在輸入格裡也能用
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey || !focus) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      stepFocus(e.key === "ArrowRight" ? 1 : -1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus]);

  useEffect(() => {
    if (!focus) return;
    chips.current
      ?.querySelector<HTMLElement>('[data-locale="' + CSS.escape(focus) + '"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [focus]);

  if (!order.length) return null;

  return (
    <div className="flex items-center gap-2 border-b bg-card px-3 py-1.5">
      <button
        type="button"
        aria-pressed={on}
        className={cn(
          "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium",
          on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
        )}
        title={
          on
            ? "關掉聚焦，回到剛剛那組顯示欄位（Alt + ←/→ 換目標語系）"
            : "一次只看「對照語系 + 一個目標語系」，不用左右捲"
        }
        onClick={toggleFocus}
      >
        <Crosshair size={13} /> 聚焦
      </button>

      {on && (
        <label
          className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
          title="擺在目標語系左邊當對照，通常是翻譯的來源語言"
        >
          對照
          <Select value={source} onValueChange={setSourceLocale}>
            <SelectTrigger size="sm" className="h-7 min-w-[120px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {order.map((code) => (
                <SelectItem key={code} value={code}>
                  {localeLabel(code)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      )}
      {/* 快捷鍵要看得到才有人會用，藏在 title 裡等於沒做 */}
      {on && order.length > 1 && (
        <span className="shrink-0 text-[11px] text-muted-foreground">
          <kbd className="rounded border bg-muted px-1">Alt</kbd> ←/→ 換語系
        </span>
      )}

      <div
        ref={chips}
        className="flex min-w-0 flex-1 gap-1 overflow-x-auto py-0.5 [scrollbar-width:thin]"
      >
        {order.map((code) => {
          const isTarget = on && code === focus;
          const isSrc = on && code === source && !isTarget;
          const off = !on && !!hidden[code];
          const n = missing[code] || 0;
          return (
            <button
              key={code}
              type="button"
              data-locale={code}
              className={cn(
                "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs whitespace-nowrap",
                isTarget && "border-primary bg-primary text-primary-foreground",
                isSrc && "border-primary/50 bg-primary/10 text-primary",
                off && "border-dashed text-muted-foreground opacity-60",
                !isTarget && !isSrc && "hover:bg-accent",
              )}
              title={
                on
                  ? isTarget
                    ? "再按一次就關掉聚焦"
                    : code === source
                      ? "目前的對照語系。按下去改成編輯它"
                      : "聚焦到 " + code
                  : off
                    ? "這一欄現在是隱藏的，按下去顯示並捲過去"
                    : "捲到 " + code + " 這一欄"
              }
              onClick={() => {
                // 分區樹也是這個習慣：點目前選中的那個就是取消
                if (on) setFocus(code === focus ? "" : code);
                else revealColumn(code);
              }}
            >
              {localeLabel(code)}
              {n > 0 && (
                <span className={cn("tabular-nums", isTarget ? "opacity-80" : "text-destructive")}>
                  {n}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
