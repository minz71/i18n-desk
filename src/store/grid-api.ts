/**
 * 表格是唯一知道捲動位置與 DOM 的地方。動作（新增 key、切聚焦……）要捲動或對焦時
 * 透過這裡呼叫，表格掛載時把實作註冊進來。沒掛載時全部是 no-op。
 */
export interface GridApi {
  resetScrollTop(): void;
  resetScrollLeft(): void;
  scrollToColumn(id: string): void;
  /** 捲到那一列並把焦點放進第一個語系格 */
  focusKey(key: string): void;
  viewportWidth(): number;
}

const noop: GridApi = {
  resetScrollTop() {},
  resetScrollLeft() {},
  scrollToColumn() {},
  focusKey() {},
  viewportWidth: () => 0,
};

let impl: GridApi = noop;

export const gridApi: GridApi = {
  resetScrollTop: () => impl.resetScrollTop(),
  resetScrollLeft: () => impl.resetScrollLeft(),
  scrollToColumn: (id) => impl.scrollToColumn(id),
  focusKey: (key) => impl.focusKey(key),
  viewportWidth: () => impl.viewportWidth(),
};

export function registerGrid(next: GridApi): () => void {
  impl = next;
  return () => {
    if (impl === next) impl = noop;
  };
}
