import { useCallback, useEffect, useState } from "react";
import { fetchTools, installTool, type ToolsResponse } from "../api";

/** Nhịp hỏi lại khi đang tải. Đủ dày để thanh tiến trình mượt, đủ thưa để không phí. */
const POLL_MS = 700;

const LABEL: Record<string, string> = {
  "yt-dlp": "yt-dlp",
  ffmpeg: "FFmpeg",
  chromium: "Trình duyệt ẩn (Chromium)",
};

const WHY: Record<string, string> = {
  "yt-dlp": "Bắt buộc — lo phần lấy và tải luồng video.",
  ffmpeg: "Bắt buộc — ghép hình với tiếng. Thiếu nó thì video tải về có thể mất tiếng.",
  chromium:
    "Tuỳ chọn — chỉ cần khi dán URL của vài site đòi vượt Cloudflare vào app. " +
    "Tải video qua extension thì không cần cái này.",
};

const SOURCE: Record<string, string> = {
  bundled: "đóng gói kèm",
  downloaded: "đã tải về",
  system: "dùng bản của máy",
};

export function ToolsPanel() {
  const [data, setData] = useState<ToolsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchTools()
      .then((d) => {
        setData(d);
        setErr(null);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Chỉ hỏi lại khi THẬT SỰ đang tải — hỏi liên tục lúc rảnh là phí, mà
  // trạng thái công cụ thì chỉ đổi khi người dùng bấm cài.
  const busy = data ? Object.keys(data.installing).length > 0 : false;
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [busy, load]);

  const onInstall = (name: string) => {
    installTool(name)
      .then(load)
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  };

  if (err) return <div className="empty">Không đọc được trạng thái công cụ: {err}</div>;
  if (!data) return <div className="empty">Đang kiểm tra…</div>;

  return (
    <div className="tools-panel">
      <h2>Công cụ</h2>
      <p className="tools-intro">
        App tải các công cụ này về khi cần, thay vì đóng gói sẵn — bộ cài nhờ đó nhẹ đi rất nhiều.
      </p>
      {Object.entries(data.tools).map(([name, info]) => {
        const job = data.installing[name];
        const pct = job && job.total > 0 ? Math.round((job.done / job.total) * 100) : null;
        return (
          <div className="tool-row" key={name}>
            <div className="tool-main">
              <span className="tool-name">{LABEL[name] ?? name}</span>
              <span className={`tool-state${info.found ? " ok" : info.required ? " missing" : ""}`}>
                {info.found
                  ? `Đã có (${SOURCE[info.source ?? ""] ?? info.source})`
                  : info.required
                  ? "Thiếu — cần cài"
                  : "Chưa cài"}
              </span>
              <span className="tool-why">{WHY[name] ?? ""}</span>
              {job?.error ? <span className="tool-err">Cài thất bại: {job.error}</span> : null}
            </div>
            <div className="tool-action">
              {job && !job.error ? (
                <span className="tool-progress">
                  {pct === null ? "Đang tải…" : `Đang tải ${pct}%`}
                </span>
              ) : (
                <button type="button" onClick={() => onInstall(name)}>
                  {info.found ? "Cài lại" : "Cài"}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
