import { useMemo, type ReactNode } from "react";
import { ChevronDown, ChevronRight, CircleHelp, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { buildTree, type TreeNode } from "@/core/filters";
import { cn } from "@/lib/utils";
import { selectGroup, setSidebarCollapsed, toggleCollapsed } from "@/store/actions";
import { useEditor } from "@/store/editor";

/* 分區：以 key 的 "." 前綴建樹。「全部」是樹的根，點它就是不篩選。
   旁邊的紅色數字是該區還有幾個 key 至少缺一個（看得到的）語系。 */

interface NodeProps {
  node: TreeNode;
  depth: number;
}

function TreeRow({ node, depth }: NodeProps) {
  const selected = useEditor((s) => s.group === node.path);
  const collapsed = useEditor((s) => !!s.collapsed[node.path]);
  const missing = useEditor((s) => s.treeMissing[node.path] || 0);
  const hasKids = node.children.size > 0;

  return (
    <>
      <div
        className={cn(
          "group flex h-7 cursor-pointer items-center gap-1 rounded-md pr-2 text-[13px] hover:bg-accent",
          selected && "bg-primary/10 font-medium text-primary hover:bg-primary/15",
        )}
        style={{ paddingLeft: 4 + depth * 12 }}
        onClick={() => selectGroup(node.path)}
      >
        <span
          className="inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground"
          onClick={(e) => {
            if (!hasKids) return;
            e.stopPropagation();
            toggleCollapsed(node.path);
          }}
        >
          {hasKids && (collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />)}
        </span>
        <span className="min-w-0 flex-1 truncate" title={node.path}>
          {node.name}
        </span>
        {missing > 0 && (
          <span
            className="rounded-full bg-destructive/10 px-1.5 text-[10px] font-semibold text-destructive tabular-nums"
            title={missing + " 個 key 至少有一個語系未填"}
          >
            {missing}
          </span>
        )}
        <span className="text-[11px] text-muted-foreground tabular-nums">{node.count}</span>
      </div>
      {hasKids && !collapsed && <TreeChildren node={node} depth={depth + 1} />}
    </>
  );
}

/** 分區是怎麼來的。展開時掛在標題上，收起時掛在直排的「分區」上 */
function SectionHint({
  children,
  side,
  flat,
}: {
  children: ReactNode;
  side: "right" | "bottom";
  flat: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} className="max-w-72 leading-relaxed text-pretty">
        <p>
          分區是照 key 裡的「.」分出來的：<code>history.labels.bet</code> 會放在 history › labels
          底下。 連續的「.」（例如 <code>Loading...</code>）和前後有空白的「.」不算分隔。
        </p>
        <p className="mt-1 opacity-80">
          {flat
            ? '這份檔是平層的（"a.b.c": "…"），分區只是方便篩選的虛擬分區，寫回去還是平層，新 key 也一樣。'
            : "分區只影響畫面，寫回去照檔案原本的結構。"}
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

function TreeChildren({ node, depth }: NodeProps) {
  return (
    <>
      {[...node.children.values()].map((child) => (
        <TreeRow key={child.path} node={child} depth={depth} />
      ))}
    </>
  );
}

export function Sidebar() {
  const collapsed = useEditor((s) => s.sidebarCollapsed);
  const keyOrder = useEditor((s) => s.doc.keyOrder);
  const flatKeys = useEditor((s) => s.doc.flatKeys);
  const docRev = useEditor((s) => s.docRev);
  const loaded = useEditor((s) => s.doc.order.length > 0);
  const allSelected = useEditor((s) => s.group === "");
  // keyOrder 是原地改的，靠 docRev 知道要重建
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tree = useMemo(() => buildTree(keyOrder), [keyOrder, docRev]);

  return (
    <div className="flex shrink-0 border-r bg-card">
      <div className="flex w-9 flex-col items-center gap-2 border-r py-2">
        <button
          type="button"
          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          title={collapsed ? "展開分區" : "收起分區"}
          onClick={() => setSidebarCollapsed(!collapsed)}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
        <SectionHint side="right" flat={flatKeys}>
          <button
            type="button"
            className="cursor-help rounded-sm text-[11px] tracking-widest text-muted-foreground [writing-mode:vertical-rl]"
          >
            分區
          </button>
        </SectionHint>
      </div>
      <aside
        className={cn(
          "overflow-hidden transition-[width] duration-200 ease-out motion-reduce:transition-none",
          collapsed ? "w-0" : "w-60",
        )}
      >
        <div className="flex h-full w-60 flex-col">
          <div className="px-3 pt-3 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground">
            <SectionHint side="bottom" flat={flatKeys}>
              <button
                type="button"
                className="inline-flex cursor-help items-center gap-1 rounded-sm"
              >
                分區
                {flatKeys && (
                  <span className="rounded-sm bg-muted px-1 text-[10px] font-normal tracking-normal">
                    虛擬
                  </span>
                )}
                <CircleHelp size={12} />
              </button>
            </SectionHint>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-2 pb-3">
            <div
              className={cn(
                "flex h-7 cursor-pointer items-center gap-1 rounded-md pr-2 pl-1 text-[13px] font-medium hover:bg-accent",
                allSelected && "bg-primary/10 text-primary hover:bg-primary/15",
              )}
              onClick={() => selectGroup("")}
            >
              <span className="size-4 shrink-0" />
              <span className="flex-1">全部</span>
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {keyOrder.length}
              </span>
            </div>
            <TreeChildren node={tree} depth={0} />
            {!tree.children.size && (
              <div className="px-2 py-2 text-xs text-muted-foreground">
                {loaded ? "沒有用「.」分層的 key" : "尚未載入資料"}
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
