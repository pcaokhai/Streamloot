interface Props {
  url: string;
  onUrlChange: (value: string) => void;
  onDownload: () => void;
  downloadDisabled: boolean;
  formatStatusText: string | null;
  resolutionHeights: number[];
  resolution: string; // "" for Best, else the height as a string
  onResolutionChange: (value: string) => void;
  filter: string;
  onFilterChange: (value: string) => void;
  showClearHistory: boolean;
  onClearHistory: () => void;
}

export function Toolbar({
  url, onUrlChange, onDownload, downloadDisabled, formatStatusText,
  resolutionHeights, resolution, onResolutionChange, filter, onFilterChange,
  showClearHistory, onClearHistory,
}: Props) {
  const onKeyDownTriggersDownload = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") onDownload();
  };

  return (
    <header className="toolbar">
      <input
        className="url-input"
        type="text"
        placeholder="Paste a video or file URL"
        value={url}
        onChange={(e) => onUrlChange(e.target.value)}
        onKeyDown={onKeyDownTriggersDownload}
      />
      {formatStatusText && <span className="format-status">{formatStatusText}</span>}
      {resolutionHeights.length > 0 && (
        <select
          className="resolution-select"
          value={resolution}
          onChange={(e) => onResolutionChange(e.target.value)}
          // Picking a resolution and hitting Enter should download directly
          // — no need to click back into the URL field first.
          onKeyDown={onKeyDownTriggersDownload}
        >
          {/* Kèm độ phân giải cao nhất vào nhãn: một chữ "Best" trần không phân
              biệt được với trạng thái fallback khi không load được format, nên
              người dùng không biết danh sách đã về hay chưa. */}
          <option value="">Best ({resolutionHeights[0]}p)</option>
          {resolutionHeights.map((h) => (
            <option key={h} value={h}>{h}p</option>
          ))}
        </select>
      )}
      <button type="button" className="btn-primary" onClick={onDownload} disabled={downloadDisabled}>
        Download
      </button>
      <div className="toolbar-divider" />
      {showClearHistory && (
        <button type="button" className="btn-secondary" onClick={onClearHistory}>
          Clear History
        </button>
      )}
      <input
        className="filter-input"
        type="text"
        placeholder="Filter"
        value={filter}
        onChange={(e) => onFilterChange(e.target.value)}
      />
    </header>
  );
}
