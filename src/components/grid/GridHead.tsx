import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { Plus, X } from "lucide-react";
import { columnLayout, colWidth, type Column } from "@/core/columns";
import { COMMENT_FILE, MIN_COL } from "@/core/constants";
import { localeLabel } from "@/core/locales";
import {
  addLocale,
  removeLocale,
  resetColumnWidth,
  resizeLimit,
  setColumnWidth,
} from "@/store/actions";
import { canDeleteLocales, getState, selectVisible, useEditor } from "@/store/editor";
import { cn } from "@/lib/utils";
import { applyLayoutVars, colStyle } from "./layout-vars";
import css from "./Grid.module.css";

interface Drag {
  id: string;
  pointerId: number;
  startX: number;
  startW: number;
  max: number;
  width: number;
  raf: number;
}

/* 拉欄寬。拖曳中只改 CSS 變數（不經過 React），一萬列也不會卡；放手才寫進 store。 */
function useColumnResize(innerRef: React.RefObject<HTMLDivElement | null>) {
  const drag = useRef<Drag | null>(null);

  const paint = () => {
    const d = drag.current;
    if (!d) return;
    d.raf = 0;
    const s = getState();
    const widths = { ...s.widths, [d.id]: d.width };
    if (innerRef.current)
      applyLayoutVars(innerRef.current, columnLayout(selectVisible(s), { ...s, widths }));
  };

  const end = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (d.raf) cancelAnimationFrame(d.raf);
    document.body.classList.remove("is-resizing");
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    window.removeEventListener("blur", end);
    if (d.width !== d.startW) setColumnWidth(d.id, d.width);
  };

  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const w = Math.max(MIN_COL, Math.min(d.max, Math.round(d.startW + (e.clientX - d.startX))));
    if (w === d.width) return;
    d.width = w;
    if (!d.raf) d.raf = requestAnimationFrame(paint);
  };

  const start = (e: ReactPointerEvent<HTMLElement>, id: string) => {
    if (e.button !== 0) return;
    e.preventDefault(); // 不要順便選到表頭的文字
    e.stopPropagation();
    const startW = colWidth(getState().widths, id);
    drag.current = {
      id,
      pointerId: e.pointerId,
      startX: e.clientX,
      startW,
      max: resizeLimit(id),
      width: startW,
      raf: 0,
    };
    document.body.classList.add("is-resizing");
    // 掛在 window 上：滑出表頭放手也要收得乾淨，不然 is-resizing 會卡住
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("blur", end);
  };

  return start;
}

interface Props {
  layout: Column[];
  innerRef: React.RefObject<HTMLDivElement | null>;
}

export function GridHead({ layout, innerRef }: Props) {
  const startResize = useColumnResize(innerRef);
  const newLocales = useEditor((s) => s.doc.newLocales);
  const canDelete = useEditor(canDeleteLocales);
  useEditor((s) => s.docRev);

  return (
    <div className={css.head}>
      {layout.map((col, i) => {
        let label: React.ReactNode;
        let title = "";
        if (col.kind === "key") label = "KEY";
        else if (col.kind === "note") {
          label = "備註";
          title = "給譯者看的說明，存到 " + COMMENT_FILE + "，程式不會讀它";
        } else {
          const isNew = !!newLocales[col.id];
          title = getState().doc.rel[col.id] + (isNew ? "（尚未儲存）" : "");
          label = (
            <>
              <span className={css.headLabel}>{localeLabel(col.id)}</span>
              {isNew && <span className={css.newBadge}>新</span>}
              {(isNew || canDelete) && (
                <button
                  type="button"
                  className={cn(
                    "inline-flex size-5 shrink-0 items-center justify-center rounded border border-transparent text-muted-foreground hover:border-destructive hover:text-destructive",
                    css.headDelete,
                    isNew && css.always,
                  )}
                  title={
                    isNew ? "移除這個還沒儲存的語系" : "刪除這個語系（儲存 / 提交時才會真的刪檔）"
                  }
                  onClick={() => removeLocale(col.id)}
                >
                  <X size={12} />
                </button>
              )}
            </>
          );
        }
        return (
          <div
            key={col.id}
            className={cn(css.headCell, col.pinned && css.pinned, col.lastPinned && css.lastPinned)}
            style={colStyle(i, col.pinned)}
            title={title}
          >
            {typeof label === "string" ? <span className={css.headLabel}>{label}</span> : label}
            <span
              className={css.resize}
              title="拖曳調整欄寬（雙擊還原）"
              onPointerDown={(e) => startResize(e, col.id)}
              onDoubleClick={() => resetColumnWidth(col.id)}
            />
          </div>
        );
      })}
      <div className={css.addCol}>
        <button
          type="button"
          className="inline-flex size-6 items-center justify-center rounded-md border border-dashed border-border-strong text-muted-foreground hover:border-primary hover:bg-primary hover:text-primary-foreground"
          title="新增語系"
          onClick={() => void addLocale()}
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}
