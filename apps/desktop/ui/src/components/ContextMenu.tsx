import { useEffect, useRef, useState } from "react";
import { TERMINAL_STATUSES } from "../types";
import type { RowContext } from "../hooks/useContextMenu";

interface Props {
  x: number;
  y: number;
  context: RowContext;
  onClose: () => void;
  onPause: (taskId: string) => void;
  onResume: (taskId: string) => void;
  onStop: (taskId: string) => void;
  onRedownload: (ctx: RowContext) => void;
  onCopyUrl: (url: string) => void;
  onCopyTitle: (title: string) => void;
  onOpenInFinder: (path: string) => void;
  onRemoveHistory: (ctx: RowContext) => void;
}

function MenuItem({ label, disabled, onClick }: { label: string; disabled?: boolean; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      className={`context-menu-item${hovered ? " is-hovered" : ""}`}
      disabled={disabled}
      onClick={onClick}
      // JS-driven, not CSS :hover — see the comment in index.css on
      // .context-menu-item.is-hovered for why.
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {label}
    </button>
  );
}

function Separator() {
  return <div className="context-menu-separator" />;
}

export function ContextMenu({ x, y, context: ctx, onClose, onPause, onResume, onStop, onRedownload, onCopyUrl, onCopyTitle, onOpenInFinder, onRemoveHistory }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ x, y });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)),
    });
  }, [x, y]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  const isLiveTask = !!ctx.taskId;
  const canPause = isLiveTask && ctx.status === "downloading";
  const canResume = isLiveTask && ctx.status === "paused";
  const canStop = isLiveTask && !TERMINAL_STATUSES.has(ctx.status) && ctx.status !== "cancelling";
  const canOpenInFinder = ctx.status === "completed" && !!ctx.outputPath;
  const canCopyTitle = !!ctx.title;
  // Redownload covers both "retry a failed one" and "I deleted the file
  // from disk and want it back" — download_service's is_video_on_disk check
  // already handles the latter correctly, this just re-issues the request.
  const canRedownload = TERMINAL_STATUSES.has(ctx.status) || !isLiveTask;

  const wrap = (fn: () => void) => () => {
    onClose();
    fn();
  };

  return (
    <div ref={ref} className="context-menu" style={{ left: pos.x, top: pos.y }}>
      <MenuItem label="Pause" disabled={!canPause} onClick={wrap(() => onPause(ctx.taskId!))} />
      <MenuItem label="Resume" disabled={!canResume} onClick={wrap(() => onResume(ctx.taskId!))} />
      <MenuItem label="Stop" disabled={!canStop} onClick={wrap(() => onStop(ctx.taskId!))} />
      <Separator />
      <MenuItem label="Download Again" disabled={!canRedownload} onClick={wrap(() => onRedownload(ctx))} />
      <Separator />
      <MenuItem label="Copy URL" onClick={wrap(() => onCopyUrl(ctx.url))} />
      <MenuItem label="Copy Title" disabled={!canCopyTitle} onClick={wrap(() => onCopyTitle(ctx.title ?? ""))} />
      <Separator />
      <MenuItem label="Show in Finder" disabled={!canOpenInFinder} onClick={wrap(() => onOpenInFinder(ctx.outputPath!))} />
      {ctx.historyId !== null && (
        <>
          <Separator />
          <MenuItem label="Remove" onClick={wrap(() => onRemoveHistory(ctx))} />
        </>
      )}
    </div>
  );
}
