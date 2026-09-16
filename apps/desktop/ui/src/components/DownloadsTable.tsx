import { useColumnResize } from "../hooks/useColumnResize";
import type { Task, TaskStatus } from "../types";
import type { RowContext } from "../hooks/useContextMenu";

interface Props {
  tasks: [string, Task][];
  onContextMenu: (x: number, y: number, ctx: RowContext) => void;
}

function statusClass(status: TaskStatus): string {
  if (status === "completed") return "status-completed";
  if (status === "failed") return "status-failed";
  if (status === "cancelled" || status === "cancelling" || status === "paused") return "status-paused";
  if (status === "interrupted") return "status-interrupted";
  return "status-downloading";
}

const STATUS_LABELS: Partial<Record<TaskStatus, string>> = {
  pending: "Pending", downloading: "Downloading", cancelling: "Cancelling",
  cancelled: "Cancelled", completed: "Completed", failed: "Failed", paused: "Paused",
};

function statusLabel(status: TaskStatus): string {
  return STATUS_LABELS[status] ?? status;
}

const COLUMNS = "260px 240px 140px 80px 110px"; // Name, URL, Progress, Speed, Status

export function DownloadsTable({ tasks, onContextMenu }: Props) {
  const { gridRef, onHandleMouseDown } = useColumnResize();

  return (
    <div className="table-scroll">
      <div className="grid-table" ref={gridRef} style={{ gridTemplateColumns: COLUMNS }}>
        <div className="grid-row grid-header">
          <div className="grid-cell">Name<span className="col-resize-handle" onMouseDown={onHandleMouseDown(0)} /></div>
          <div className="grid-cell">URL<span className="col-resize-handle" onMouseDown={onHandleMouseDown(1)} /></div>
          <div className="grid-cell">Progress<span className="col-resize-handle" onMouseDown={onHandleMouseDown(2)} /></div>
          <div className="grid-cell">Speed<span className="col-resize-handle" onMouseDown={onHandleMouseDown(3)} /></div>
          <div className="grid-cell">Status</div>
        </div>

        {tasks.map(([taskId, t]) => {
          const pct = Math.max(0, Math.min(100, t.completed || 0));
          // "completed" carries the real average speed (downloaders/ytdlp.py
          // computes bytes/elapsed); failed/cancelled have no meaningful speed.
          const speedHidden = t.status === "failed" || t.status === "cancelled";

          return (
            <div
              className="grid-row"
              key={taskId}
              onContextMenu={(e) => {
                e.preventDefault();
                onContextMenu(e.clientX, e.clientY, {
                  taskId, historyId: null, url: t.url, title: t.title, status: t.status,
                  outputPath: t.outputPath, formatId: t.formatId,
                });
              }}
            >
              <div className="grid-cell"><span className="row-title" title={t.title || t.url}>{t.title || t.url}</span></div>
              <div className="grid-cell"><span className="row-url" title={t.url}>{t.url}</span></div>
              <div className="grid-cell">
                <div className="progress-cell">
                  <div className="progress-track"><div className="progress-fill" style={{ width: `${pct}%` }} /></div>
                  <span className="progress-pct">{Math.round(pct)}%</span>
                </div>
              </div>
              <div className="grid-cell col-speed">{speedHidden ? "--" : (t.speed || "--")}</div>
              <div className="grid-cell">
                <span className={`status ${statusClass(t.status)}`}>
                  <span className="status-dot" />{statusLabel(t.status)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
