import { useState } from "react";
import { Columns3, Pin, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { COMMENT_FILE, KEY_COL, NOTE_COL } from "@/core/constants";
import { commentsChanged, dirtyCellCount } from "@/core/doc";
import { localeLabel } from "@/core/locales";
import { cn } from "@/lib/utils";
import {
  resetWidths,
  restoreLocale,
  setColumnHidden,
  setColumnPinned,
  setColumnPreset,
} from "@/store/actions";
import { getState, useEditor } from "@/store/editor";

interface Def {
  id: string;
  label: string;
  note: string;
  fixed?: boolean;
}

function columnDefs(): Def[] {
  const { doc } = getState();
  return [
    { id: KEY_COL, label: "KEY", note: "key 是這一列的身分，固定顯示也固定釘選", fixed: true },
    { id: NOTE_COL, label: "備註", note: COMMENT_FILE },
    ...doc.order.map((code) => ({
      id: code,
      label: localeLabel(code),
      note: doc.rel[code] || code,
    })),
  ];
}

/* 按鈕上的摘要：從語系列切聚焦時選單是關的，所以摘要不能只在選單開著時算 */
function Summary() {
  const focus = useEditor((s) => s.focus);
  const hidden = useEditor((s) => s.hidden);
  const pinned = useEditor((s) => s.pinned);
  useEditor((s) => s.docRev);
  const defs = columnDefs().filter((d) => !d.fixed);
  const hiddenCount = defs.filter((d) => hidden[d.id]).length;
  const pinnedCount = defs.filter((d) => pinned[d.id] && !hidden[d.id]).length;
  const bits: string[] = [];
  if (focus) bits.push("聚焦 " + localeLabel(focus));
  else if (hiddenCount) bits.push("隱藏 " + hiddenCount);
  if (pinnedCount) bits.push("釘選 " + pinnedCount);
  return bits.length ? <span className="text-muted-foreground">（{bits.join(" · ")}）</span> : null;
}

function PanelBody() {
  const [query, setQuery] = useState("");
  const hidden = useEditor((s) => s.hidden);
  const pinned = useEditor((s) => s.pinned);
  const focused = useEditor((s) => !!s.focus);
  const gitlab = useEditor((s) => !!s.gitlab);
  useEditor((s) => s.docRev);
  useEditor((s) => s.editRev);
  const { doc } = getState();
  const q = query.trim().toLowerCase();
  const matches = (label: string, id: string) => !q || (label + " " + id).toLowerCase().includes(q);

  const defs = columnDefs().filter((d) => matches(d.label, d.id));
  const deleted = Object.keys(doc.deletedLocales).filter((c) => matches(localeLabel(c), c));

  return (
    <>
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <span className="text-xs font-semibold">要顯示哪些欄位</span>
        {/* 聚焦模式下按了會把 hidden 整組洗掉，但畫面由聚焦決定所以毫無反應，
            等到關掉聚焦才發現原本藏好的那組不見了。所以要跟著一起灰掉。 */}
        <div className="flex gap-1">
          {(["all", "one"] as const).map((preset) => (
            <Button
              key={preset}
              size="xs"
              variant="ghost"
              disabled={focused}
              title={focused ? "聚焦模式下不能改顯示欄位，請先關掉聚焦" : ""}
              onClick={() => setColumnPreset(preset)}
            >
              {preset === "all" ? "全選" : "只留一個"}
            </Button>
          ))}
        </div>
      </div>
      <div className="border-b px-3 py-2">
        <Input
          type="search"
          value={query}
          placeholder="篩選語系…"
          autoComplete="off"
          className="h-8"
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="max-h-[50vh] overflow-auto py-1">
        {defs.map((def) => {
          const isHidden = !def.fixed && !!hidden[def.id];
          // 聚焦模式自己決定看得見哪些語系，這時候勾選框按下去不會有反應，
          // 與其讓人按半天，不如整排灰掉並說清楚為什麼
          const lockedByFocus = focused && def.id !== NOTE_COL;
          const dirty =
            def.id === NOTE_COL
              ? commentsChanged(doc)
                ? "已改"
                : ""
              : def.fixed
                ? ""
                : (() => {
                    const n = dirtyCellCount(doc, def.id);
                    return n ? "已改 " + n : "";
                  })();
          const isPinned = def.fixed || !!pinned[def.id];
          const pinDisabled = !!def.fixed || isHidden || lockedByFocus;
          return (
            <div key={def.id} className="flex items-center gap-2 px-3 py-1 hover:bg-accent/60">
              <label
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-2"
                title={def.note}
              >
                <Checkbox
                  checked={!isHidden}
                  disabled={!!def.fixed || lockedByFocus}
                  onCheckedChange={(v) => setColumnHidden(def.id, v !== true)}
                />
                <span className="truncate text-[13px]">{def.label}</span>
                {/* 被隱藏但有未存變更時要看得出來，不然會以為改的東西不見了 */}
                {dirty && <span className="text-[11px] font-medium text-dirty">{dirty}</span>}
              </label>
              <button
                type="button"
                disabled={pinDisabled}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] disabled:cursor-not-allowed disabled:opacity-40",
                  isPinned
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent",
                )}
                title={
                  def.fixed
                    ? "KEY 永遠釘在最左邊"
                    : isHidden
                      ? "先顯示這一欄才能釘選"
                      : pinned[def.id]
                        ? "取消釘選"
                        : "釘到左邊：左右捲動時不會消失"
                }
                onClick={() => setColumnPinned(def.id, !pinned[def.id])}
              >
                <Pin size={11} /> 釘
              </button>
            </div>
          );
        })}

        {/* 標記刪除的語系已經不在表格裡了，這裡是唯一能把它拿回來的地方 */}
        {deleted.map((code) => (
          <div
            key={code}
            className="flex items-center gap-2 px-3 py-1 text-muted-foreground"
            title={doc.deletedLocales[code].rel + " 會在" + (gitlab ? "提交" : "儲存") + "時刪除"}
          >
            <span className="min-w-0 flex-1 truncate text-[13px] line-through">
              {localeLabel(code)}
            </span>
            <span className="text-[11px] text-destructive">待刪除</span>
            <Button size="xs" variant="outline" onClick={() => restoreLocale(code)}>
              <Undo2 /> 復原
            </Button>
          </div>
        ))}

        {!defs.length && !deleted.length && (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground">沒有符合的欄位</div>
        )}
      </div>
      <div className="space-y-1 border-t px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
        {focused && (
          <p className="text-primary">
            聚焦模式開著，語系欄位由語系列決定。要手動勾選請先關掉聚焦。
          </p>
        )}
        <p>隱藏欄位只影響畫面。改過但被隱藏的內容照樣會儲存 / 下載。</p>
        <p>
          欄寬直接拖表頭的右邊界就可以改（雙擊還原單一欄）。
          <button type="button" className="ml-1 text-primary hover:underline" onClick={resetWidths}>
            全部還原
          </button>
        </p>
      </div>
    </>
  );
}

export function ColumnPanel() {
  const loaded = useEditor((s) => s.doc.order.length > 0);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" disabled={!loaded}>
          <Columns3 /> 顯示欄位
          <Summary />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <PanelBody />
      </PopoverContent>
    </Popover>
  );
}
