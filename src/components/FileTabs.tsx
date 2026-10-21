import { FileJson } from "lucide-react";
import { cn } from "@/lib/utils";
import { selectDoc } from "@/store/actions";
import { useEditor } from "@/store/editor";

/* 同一個語系底下有好幾份檔（text.json、errorMessage.json）時，一份一個分頁。
   每份檔的 key 各自獨立，一次只編一份；改過的分頁上會標還有幾個檔沒存。
   只有一份檔時整排不出現。 */
export function FileTabs() {
  const docs = useEditor((s) => s.docs);
  const active = useEditor((s) => s.doc);
  const tabChanges = useEditor((s) => s.tabChanges);
  if (docs.length < 2) return null;

  return (
    /* shrink-0：overflow-x-auto 讓它變成捲動容器，最小高度就不再撐住內容，會被下面的表格擠成 0。
       overflow-y-hidden：分頁的 -mb-px 會往下凸 1px，不藏起來會多一條直向捲軸。 */
    <div
      role="tablist"
      className="flex shrink-0 items-end gap-1 overflow-x-auto overflow-y-hidden border-b bg-muted/40 px-3 pt-1.5"
    >
      {docs.map((d, i) => {
        const on = d === active;
        return (
          <button
            key={d.ns}
            type="button"
            role="tab"
            aria-selected={on}
            title={d.pattern.replace("{code}", "<語系>")}
            className={cn(
              "-mb-px inline-flex h-8 shrink-0 items-center gap-1.5 rounded-t-md border px-3 text-xs transition-colors",
              on
                ? "border-border border-b-card bg-card font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
            onClick={() => selectDoc(i)}
          >
            <FileJson size={13} />
            {d.ns}
            {tabChanges[i] > 0 && (
              <span className="rounded-full bg-primary/15 px-1.5 text-[10px] tabular-nums text-primary">
                {tabChanges[i]}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
