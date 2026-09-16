import { useCallback, useState } from "react";
import type { TaskStatus } from "../types";

export interface RowContext {
  taskId: string | null; // null for History rows — no live task behind them
  historyId: number | null; // set only for History rows — lets Remove target the record
  url: string;
  title: string | null;
  status: TaskStatus;
  outputPath: string | null;
  formatId: string | null;
}

interface MenuState {
  visible: boolean;
  x: number;
  y: number;
  context: RowContext | null;
}

export function useContextMenu() {
  const [menu, setMenu] = useState<MenuState>({ visible: false, x: 0, y: 0, context: null });

  const open = useCallback((x: number, y: number, context: RowContext) => {
    setMenu({ visible: true, x, y, context });
  }, []);

  const close = useCallback(() => setMenu((m) => ({ ...m, visible: false, context: null })), []);

  return { menu, open, close };
}
