import { useRef, useState } from "react";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FILTERS } from "@/core/filters";
import { cn } from "@/lib/utils";
import { addKey, setFilter, setLines, setQuery } from "@/store/actions";
import { useEditor } from "@/store/editor";
import { ColumnPanel } from "./ColumnPanel";

/** 搜尋 key、任一（看得到的）語系內容、備註。打字時稍微等一下再篩，一萬列每個字都重算太浪費。 */
function SearchBox() {
  const query = useEditor((s) => s.query);
  const [text, setText] = useState(query);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // 新增 key 會清掉搜尋條件，輸入框要跟著清
  const [seen, setSeen] = useState(query);
  if (query !== seen) {
    setSeen(query);
    if (query !== text.trim().toLowerCase()) setText(query);
  }

  return (
    <div className="relative w-64 max-w-full">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={text}
        placeholder="搜尋 key、任一語系內容、備註…"
        autoComplete="off"
        className="h-8 pl-8"
        onChange={(e) => {
          const value = e.target.value;
          setText(value);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setQuery(value), 160);
        }}
      />
    </div>
  );
}

function Filters() {
  const active = useEditor((s) => s.filter);
  const counts = useEditor((s) => s.counts);
  return (
    <div className="flex flex-wrap gap-1">
      {FILTERS.map((f) => (
        <button
          key={f.name}
          type="button"
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs transition-colors",
            active === f.name
              ? "border-primary bg-primary text-primary-foreground"
              : "bg-card text-foreground hover:bg-accent",
          )}
          title={f.hint}
          onClick={() => setFilter(f.name)}
        >
          {f.label}
          {counts[f.name] > 0 && <span className="tabular-nums opacity-75">{counts[f.name]}</span>}
        </button>
      ))}
    </div>
  );
}

function RowLines() {
  const lines = useEditor((s) => s.lines);
  return (
    <label
      className="flex items-center gap-1.5 text-xs text-muted-foreground"
      title="每一列顯示幾行。太長顯示不完的內容可以靠這個換行"
    >
      列高
      <Select value={String(lines)} onValueChange={(v) => setLines(Number(v))}>
        <SelectTrigger size="sm" className="h-8 w-[76px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {[1, 2, 3].map((n) => (
            <SelectItem key={n} value={String(n)}>
              {n} 行
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function Status() {
  const rows = useEditor((s) => s.rows.length);
  const total = useEditor((s) => s.doc.keyOrder.length);
  const cells = useEditor((s) => s.dirtyCells);
  useEditor((s) => s.docRev);
  return (
    <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
      {rows} / {total} 列{cells ? " · 已改 " + cells + " 格" : ""}
    </span>
  );
}

export function Toolbar() {
  const loaded = useEditor((s) => s.doc.order.length > 0);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-card px-3 py-2">
      <SearchBox />
      <Filters />
      <div className="flex-1" />
      <RowLines />
      <ColumnPanel />
      <Button size="sm" variant="outline" disabled={!loaded} onClick={() => void addKey()}>
        <Plus /> 新增 key
      </Button>
      <Status />
    </div>
  );
}
