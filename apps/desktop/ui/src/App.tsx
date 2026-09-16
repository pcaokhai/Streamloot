import { useEffect, useMemo, useState } from "react";
import { initApi, getHistory, revealInFinder, pathExists, deleteHistoryItem, clearHistory } from "./api";
import { useTasks } from "./hooks/useTasks";
import { useFormatPicker, formatSelectorForHeight } from "./hooks/useFormatPicker";
import { useContextMenu, type RowContext } from "./hooks/useContextMenu";
import { Sidebar, type View } from "./components/Sidebar";
import { Toolbar } from "./components/Toolbar";
import { DownloadsTable } from "./components/DownloadsTable";
import { HistoryTable } from "./components/HistoryTable";
import { EmptyState } from "./components/EmptyState";
import { ContextMenu } from "./components/ContextMenu";
import type { HistoryRow } from "./types";

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for contexts where the async Clipboard API isn't available.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}

export default function App() {
  const [view, setView] = useState<View>("downloads");
  const [urlInput, setUrlInput] = useState("");
  const [filter, setFilter] = useState("");
  const [resolution, setResolution] = useState("");
  const [downloadPending, setDownloadPending] = useState(false);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [bridgeError, setBridgeError] = useState<string | null>(null);

  const { tasks, beginDownload, cancel, pause, resume } = useTasks();
  const formatPicker = useFormatPicker();
  const { menu, open: openMenu, close: closeMenu } = useContextMenu();

  // Kicks off the pywebview bridge handshake early (every api.ts call awaits
  // it lazily anyway) so History/rehydration don't wait on user action, and
  // so a genuine failure surfaces as a visible banner instead of a silently
  // blank app — the render below never blocks on this.
  useEffect(() => {
    initApi().catch((e) => setBridgeError(e instanceof Error ? e.message : String(e)));
  }, []);

  const loadHistory = () => {
    getHistory().then((rows) => setHistory(rows ?? [])).catch(() => {});
  };

  useEffect(() => {
    if (view === "history") loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const taskEntries = useMemo(() => Object.entries(tasks), [tasks]);

  const visibleTasks = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return taskEntries;
    return taskEntries.filter(([, t]) => (t.title || t.url).toLowerCase().includes(f));
  }, [taskEntries, filter]);

  const downloadingCount = taskEntries.filter(([, t]) => t.status === "downloading" || t.status === "pending").length;
  const needsAttentionCount = taskEntries.filter(([, t]) => t.status === "failed" || t.status === "cancelled").length;

  const statusSummary = (() => {
    if (taskEntries.length === 0) return "No active downloads";
    const parts: string[] = [];
    if (downloadingCount) parts.push(`${downloadingCount} downloading`);
    if (needsAttentionCount) parts.push(`${needsAttentionCount} need attention`);
    return parts.join(", ") || `${taskEntries.length} item(s)`;
  })();

  const handleDownload = async () => {
    const url = urlInput.trim();
    if (!url) return;
    setDownloadPending(true);
    try {
      const formatId = resolution ? formatSelectorForHeight(Number(resolution)) : null;
      // Reuse the title from the metadata fetch if it matches this URL —
      // avoids showing the raw URL as the row title while downloading.
      const title = formatPicker.lastFetched?.url === url ? formatPicker.lastFetched.title : null;
      await beginDownload(url, formatId, title);
      setUrlInput("");
      setResolution("");
      formatPicker.reset();
    } catch (e) {
      alert(`Couldn't start download: ${e instanceof Error ? e.message : e}`);
    } finally {
      setDownloadPending(false);
    }
  };

  const handleRedownload = (ctx: RowContext) => {
    beginDownload(ctx.url, ctx.formatId, ctx.title).catch((e) => {
      alert(`Couldn't start download: ${e instanceof Error ? e.message : e}`);
    });
  };

  const handleOpenInFinder = (path: string) => {
    revealInFinder(path).then((ok) => {
      if (!ok) alert("File not found on disk — it may have been moved or deleted.");
    });
  };

  const handleRemoveHistory = async (ctx: RowContext) => {
    if (ctx.historyId === null) return;
    const fileStillOnDisk = !!ctx.outputPath && (await pathExists(ctx.outputPath));
    let deleteFile = false;
    if (fileStillOnDisk) {
      deleteFile = confirm("The downloaded file still exists on disk. Delete it too?\n\nOK = remove from history and delete the file\nCancel = remove from history only");
    } else if (!confirm("Remove this item from history?")) {
      return;
    }
    try {
      await deleteHistoryItem(ctx.historyId, deleteFile);
      loadHistory();
    } catch (e) {
      alert(`Couldn't remove item: ${e instanceof Error ? e.message : e}`);
    }
  };

  const handleClearHistory = async () => {
    if (!confirm("Clear all download history? This does not delete files on disk.")) return;
    try {
      await clearHistory();
      loadHistory();
    } catch (e) {
      alert(`Couldn't clear history: ${e instanceof Error ? e.message : e}`);
    }
  };

  const handlePause = (taskId: string) => {
    pause(taskId).catch((e) => alert(`Couldn't pause: ${e instanceof Error ? e.message : e}`));
  };
  const handleResume = (taskId: string) => {
    resume(taskId).catch((e) => alert(`Couldn't resume: ${e instanceof Error ? e.message : e}`));
  };

  return (
    <div className="window">
      {bridgeError && (
        <div className="bridge-error-banner">
          Couldn't connect to the app's backend: {bridgeError} — try relaunching.
        </div>
      )}
      <Sidebar
        view={view}
        onSwitch={setView}
        downloadingCount={downloadingCount}
        needsAttentionCount={needsAttentionCount}
        historyCount={history.length}
      />

      <main className="content">
        <Toolbar
          url={urlInput}
          onUrlChange={(v) => {
            setUrlInput(v);
            formatPicker.onUrlChange(v);
          }}
          onDownload={handleDownload}
          downloadDisabled={downloadPending}
          formatStatusText={formatPicker.statusText}
          resolutionHeights={formatPicker.heights}
          resolution={resolution}
          onResolutionChange={setResolution}
          filter={filter}
          onFilterChange={setFilter}
          showClearHistory={view === "history"}
          onClearHistory={handleClearHistory}
        />

        <section className="view">
          {view === "downloads" ? (
            <>
              <DownloadsTable tasks={visibleTasks} onContextMenu={openMenu} />
              {taskEntries.length === 0 && <EmptyState />}
            </>
          ) : (
            <HistoryTable rows={history} onContextMenu={openMenu} />
          )}
        </section>

        <footer className="status-bar">
          <span>{statusSummary}</span>
        </footer>
      </main>

      {menu.visible && menu.context && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          context={menu.context}
          onClose={closeMenu}
          onPause={handlePause}
          onResume={handleResume}
          onStop={cancel}
          onRedownload={handleRedownload}
          onCopyUrl={copyToClipboard}
          onCopyTitle={copyToClipboard}
          onOpenInFinder={handleOpenInFinder}
          onRemoveHistory={handleRemoveHistory}
        />
      )}
    </div>
  );
}
