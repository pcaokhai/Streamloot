export type View = "downloads" | "history";

interface Props {
  view: View;
  onSwitch: (view: View) => void;
  downloadingCount: number;
  needsAttentionCount: number;
  historyCount: number;
}

export function Sidebar({ view, onSwitch, downloadingCount, needsAttentionCount, historyCount }: Props) {
  const badgeText = downloadingCount || needsAttentionCount ? `●${downloadingCount} ●${needsAttentionCount}` : "";

  return (
    <nav className="sidebar">
      <div className="sidebar-section">
        <div className="sidebar-label">Library</div>
        <button
          type="button"
          className={`sidebar-item${view === "downloads" ? " active" : ""}`}
          onClick={() => onSwitch("downloads")}
        >
          <span>Downloads</span>
          <span className="badge-group">{badgeText}</span>
        </button>
        <button
          type="button"
          className={`sidebar-item${view === "history" ? " active" : ""}`}
          onClick={() => onSwitch("history")}
        >
          <span>History</span>
          <span className="badge">{historyCount > 0 ? historyCount : ""}</span>
        </button>
      </div>
    </nav>
  );
}
