import {
  memo,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { Pencil, Plus, X } from "lucide-react";
import type { Column } from "@/core/columns";
import { NOTE_COL } from "@/core/constants";
import { PLACEHOLDER_HINT } from "@/core/filters";
import { isBlank } from "@/core/flatten";
import { keyParent } from "@/core/keys";
import { outliersFor } from "@/core/placeholders";
import {
  addKey,
  deleteKey,
  editCell,
  editNote,
  renameKey,
  revertCell,
  setCurrentKey,
} from "@/store/actions";
import { getState, useEditor } from "@/store/editor";
import { colStyle } from "./layout-vars";
import { moveFocus } from "./grid-nav";
import css from "./Grid.module.css";

/* 事件處理器全部是模組層的單一函式，從 data-* 讀出是哪一格 ——
   一次畫一千多格，每格各自建 closure 是白白配置。 */

function onFieldChange(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
  const el = e.currentTarget;
  const { key = "", col = "" } = el.dataset;
  if (col === NOTE_COL) editNote(key, el.value);
  else editCell(key, col, el.value);
}

/* Enter 一律是「往下一列」，不會打進換行 —— 現有語系檔裡沒有任何值含換行，
   這是刻意的限制。Shift+Enter 往上，Ctrl+↑/↓ 也可以。Esc 還原這一格。 */
function onFieldKeyDown(e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
  const el = e.currentTarget;
  const { key = "", col = "" } = el.dataset;
  if (e.nativeEvent.isComposing) return; // 中文輸入法選字中的 Enter 不算
  if (e.key === "Enter") {
    e.preventDefault();
    moveFocus(key, col, e.shiftKey ? -1 : 1);
  } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    moveFocus(key, col, e.key === "ArrowDown" ? 1 : -1);
  } else if (e.key === "Escape") {
    revertCell(key, col === NOTE_COL ? null : col);
  }
}

function onFieldFocus(e: FocusEvent<HTMLElement>) {
  setCurrentKey(e.currentTarget.dataset.key || "");
}

function onRowClick(e: MouseEvent<HTMLElement>) {
  const target = e.target as HTMLElement;
  const tool = target.closest<HTMLElement>("[data-tool]");
  const key = e.currentTarget.dataset.key || "";
  if (tool) {
    const kind = tool.dataset.tool;
    if (kind === "rename") void renameKey(key);
    else if (kind === "delete") void deleteKey(key);
    else if (kind === "insert") void addKey(key);
    return;
  }
  setCurrentKey(key);
}

interface FieldProps {
  rowKey: string;
  col: string;
  value: string;
  className: string;
  multiline: boolean;
  lines: number;
  placeholder?: string;
  /** 加在滑鼠提示的內容後面，說明這格為什麼被標起來 */
  warning?: string;
}

/** 單行用 <input>，多行用 <textarea>。兩種都掛同一個 class，樣式不用寫兩遍。 */
function Field({
  rowKey,
  col,
  value,
  className,
  multiline,
  lines,
  placeholder,
  warning,
}: FieldProps) {
  const common = {
    className,
    value,
    title: warning ? value + "\n\n⚠ " + warning : value,
    placeholder,
    spellCheck: false,
    "data-key": rowKey,
    "data-col": col,
    onChange: onFieldChange,
    onKeyDown: onFieldKeyDown,
    onFocus: onFieldFocus,
  };
  return multiline ? (
    <textarea {...common} rows={lines} wrap="soft" />
  ) : (
    <input type="text" {...common} />
  );
}

/** parent 是所屬分區的前綴（含結尾的 .）。"Loading..." 這種 key 不能直接找最後一個 . 切 */
function KeyCell({ rowKey, parent, isNew }: { rowKey: string; parent: string; isNew: boolean }) {
  const group = parent ? parent + "…" : "最上層";
  return (
    <>
      <span className={isNew ? css.keyText + " " + css.isNew : css.keyText} title={rowKey}>
        {parent}
        <b>{rowKey.slice(parent.length)}</b>
      </span>
      <span className={css.keyTools}>
        <button type="button" className={css.keyTool} data-tool="rename" title="改這個 key 的名稱">
          <Pencil size={12} />
        </button>
        <button
          type="button"
          className={css.keyTool + " " + css.danger}
          data-tool="delete"
          title="刪除這個 key（所有語系）"
        >
          <X size={13} />
        </button>
      </span>
      <button
        type="button"
        className={css.keyInsert}
        data-tool="insert"
        title={"在下面新增同一組的 key（" + group + "）"}
      >
        <Plus size={11} strokeWidth={2.5} />
      </button>
    </>
  );
}

interface RowProps {
  rowKey: string;
  layout: Column[];
  lines: number;
}

function cellClass(col: Column): string {
  let cls = css.cell;
  if (col.kind === "key") cls += " " + css.keyCell;
  if (col.pinned) cls += " " + css.pinned;
  if (col.lastPinned) cls += " " + css.lastPinned;
  return cls;
}

export const GridRow = memo(function GridRow({ rowKey, layout, lines }: RowProps) {
  // 只有這一列的內容改了（keyRev）或整張表重算（docRev）才重畫
  useEditor((s) => s.keyRev[rowKey] || 0);
  useEditor((s) => s.docRev);
  const current = useEditor((s) => s.currentKey === rowKey);
  const { doc } = getState();
  const outliers = outliersFor(doc, rowKey);
  const multiline = lines > 1;

  return (
    <div
      className={current ? css.row + " " + css.current : css.row}
      data-key={rowKey}
      onClick={onRowClick}
    >
      {layout.map((col, i) => {
        const style = colStyle(i, col.pinned);
        if (col.kind === "key") {
          return (
            <div key={col.id} className={cellClass(col)} style={style}>
              <KeyCell rowKey={rowKey} parent={keyParent(rowKey)} isNew={!!doc.extraKeys[rowKey]} />
            </div>
          );
        }
        if (col.kind === "note") {
          const value = doc.comments[rowKey] || "";
          const dirty = doc.comments[rowKey] !== doc.commentsBase[rowKey];
          return (
            <div key={col.id} className={cellClass(col)} style={style}>
              <Field
                rowKey={rowKey}
                col={NOTE_COL}
                value={value}
                className={css.field + " " + css.note + (dirty ? " " + css.dirty : "")}
                multiline={multiline}
                lines={lines}
                placeholder="說明…"
              />
            </div>
          );
        }
        const raw = (doc.data[col.id] || {})[rowKey];
        let cls = css.field;
        const bad = !isBlank(raw) && outliers.has(col.id);
        if (isBlank(raw)) cls += " " + css.empty;
        else if (bad) cls += " " + css.bad;
        if (raw !== (doc.base[col.id] || {})[rowKey]) cls += " " + css.dirty;
        return (
          <div key={col.id} className={cellClass(col)} style={style}>
            <Field
              rowKey={rowKey}
              col={col.id}
              value={raw || ""}
              className={cls}
              multiline={multiline}
              lines={lines}
              warning={bad ? PLACEHOLDER_HINT : undefined}
            />
          </div>
        );
      })}
    </div>
  );
});
