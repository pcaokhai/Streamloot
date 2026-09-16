import { useCallback, useRef } from "react";

const MIN_WIDTH = 60;

/**
 * Drag-to-resize columns on a CSS Grid "table" (see index.css for why this
 * isn't an HTML <table> — table-layout:fixed proved unreliable for
 * enforcing explicit widths in this app's actual runtime). Resizing just
 * rewrites one grid track in the container's grid-template-columns —
 * unambiguous, single source of truth, no per-row DOM to keep in sync.
 */
export function useColumnResize() {
  const gridRef = useRef<HTMLDivElement | null>(null);

  const onHandleMouseDown = useCallback((colIndex: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    const grid = gridRef.current;
    if (!grid) return;

    const startX = e.clientX;
    // getComputedStyle resolves grid-template-columns to absolute px
    // regardless of how each track was originally specified.
    const startTracks = getComputedStyle(grid).gridTemplateColumns.split(" ").map((v) => parseFloat(v));
    const startWidth = startTracks[colIndex];
    if (!Number.isFinite(startWidth)) return;

    const handle = e.target as HTMLElement;
    handle.classList.add("resizing");

    const onMove = (ev: MouseEvent) => {
      const newWidth = Math.max(MIN_WIDTH, startWidth + (ev.clientX - startX));
      const next = [...startTracks];
      next[colIndex] = newWidth;
      grid.style.gridTemplateColumns = next.map((w) => `${w}px`).join(" ");
    };
    const onUp = () => {
      handle.classList.remove("resizing");
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  return { gridRef, onHandleMouseDown };
}
