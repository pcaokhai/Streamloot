import { useColumnResize } from "../hooks/useColumnResize";
import type { HistoryRow } from "../types";
import type { RowContext } from "../hooks/useContextMenu";

interface Props {
  rows: HistoryRow[];
  onContextMenu: (x: number, y: number, ctx: RowContext) => void;
}

const COLUMNS = "280px 260px 110px 150px"; // Name, URL, Status, Completed

export function HistoryTable({ rows, onContextMenu }: Props) {
  const { gridRef, onHandleMouseDown } = useColumnResize();

  return (
    <div className="table-scroll">
      <div className="grid-table" ref={gridRef} style={{ gridTemplateColumns: COLUMNS }}>
        <div className="grid-row grid-header">
          <div className="grid-cell">Name<span className="col-resize-handle" onMouseDown={onHandleMouseDown(0)} /></div>
          <div className="grid-cell">URL<span className="col-resize-handle" onMouseDown={onHandleMouseDown(1)} /></div>
          <div className="grid-cell">Status<span className="col-resize-handle" onMouseDown={onHandleMouseDown(2)} /></div>
          <div className="grid-cell">Completed</div>
        </div>

        {rows.map((r) => {
          const isSuccess = r.status === "SUCCESS";
          const status = isSuccess ? "completed" : "failed";
          return (
            <div
              className="grid-row"
              key={r.id}
              onContextMenu={(e) => {
                e.preventDefault();
                onContextMenu(e.clientX, e.clientY, {
                  taskId: null, // history rows have no live task behind them
                  historyId: r.id,
                  url: r.url, title: r.title, status,
                  outputPath: r.output_path, formatId: null,
                });
              }}
            >
              <div className="grid-cell"><span className="row-title" title={r.title}>{r.title}</span></div>
              <div className="grid-cell"><span className="row-url" title={r.url}>{r.url}</span></div>
              <div className="grid-cell">
                <span className={`status ${isSuccess ? "status-completed" : "status-failed"}`}>
                  <span className="status-dot" />{isSuccess ? "Completed" : "Failed"}
                </span>
              </div>
              <div className="grid-cell col-completed">{r.created_at}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
