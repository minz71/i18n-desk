import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { HEAD_H, OVERSCAN, rowHeight } from "@/core/constants";
import { columnX } from "@/store/actions";
import { enforceBudget, selectLayout, useEditor } from "@/store/editor";
import { registerGrid } from "@/store/grid-api";
import { focusKey, setScrollTop, setViewport } from "./grid-nav";
import { GridHead } from "./GridHead";
import { GridRow } from "./GridRow";
import { layoutVars } from "./layout-vars";
import css from "./Grid.module.css";

/* 表格：虛擬捲動 + 凍結左側欄。
   列高一律相同 —— 虛擬捲動靠「每列固定高度」算位置，所以「換行」是整表統一 1/2/3 行。 */
export function Grid() {
  const rows = useEditor((s) => s.rows);
  const layout = useEditor(selectLayout);
  const lines = useEditor((s) => s.lines);
  const loaded = useEditor((s) => s.doc.order.length > 0);

  const viewportRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const h = rowHeight(lines);

  // 這個專案沒有開 React Compiler，這條警告只跟它有關
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => viewportRef.current,
    estimateSize: () => h,
    overscan: OVERSCAN,
    scrollMargin: HEAD_H,
    getItemKey: (i) => rows[i],
  });

  useEffect(() => {
    virtualizer.measure();
  }, [h, virtualizer]);

  useEffect(() => {
    const el = viewportRef.current;
    setViewport(el);
    const off = registerGrid({
      resetScrollTop: () => {
        if (viewportRef.current) setScrollTop(viewportRef.current, 0);
      },
      resetScrollLeft: () => {
        if (viewportRef.current) viewportRef.current.scrollLeft = 0;
      },
      scrollToColumn: (id) => {
        const x = columnX(id);
        if (x !== null && viewportRef.current) viewportRef.current.scrollLeft = x;
      },
      focusKey,
      viewportWidth: () => viewportRef.current?.clientWidth || 0,
    });
    return () => {
      off();
      setViewport(null);
    };
  }, []);

  // 偏好是記在瀏覽器裡的：視窗變窄時凍結區可能超過預算
  useEffect(() => {
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => enforceBudget());
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  const style = useMemo(
    () =>
      ({
        ...layoutVars(layout),
        "--row-h": h + "px",
        "--lines": String(lines),
      }) as CSSProperties,
    [layout, h, lines],
  );

  const items = virtualizer.getVirtualItems();
  const top = items.length ? items[0].start - HEAD_H : 0;

  return (
    <div ref={viewportRef} className={css.viewport}>
      <div
        ref={innerRef}
        className={lines > 1 ? css.inner + " " + css.tall : css.inner}
        style={style}
      >
        {loaded && <GridHead layout={layout} innerRef={innerRef} />}
        <div className={css.body} style={{ height: rows.length * h }}>
          <div className={css.rows} style={{ top }}>
            {items.map((item) => (
              <GridRow key={item.key} rowKey={rows[item.index]} layout={layout} lines={lines} />
            ))}
          </div>
        </div>
      </div>
      {!rows.length && <EmptyState loaded={loaded} />}
    </div>
  );
}

function EmptyState({ loaded }: { loaded: boolean }) {
  if (loaded) return <div className={css.emptyState}>此條件下沒有資料</div>;
  return (
    <div className={css.emptyState} style={{ insetBlockStart: 0 }}>
      <div>
        請按「選擇語系資料夾…」挑一個放著 <code>*.json</code> 的資料夾，
        <br />
        或把語系檔直接拖進這個頁面。
        <br />
        <br />
        <span className="text-xs">檔案只在你的瀏覽器裡處理，不會上傳到任何地方。</span>
      </div>
    </div>
  );
}
