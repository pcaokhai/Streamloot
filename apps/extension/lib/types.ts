/**
 * Hợp đồng dữ liệu với backend Python.
 *
 * `VideoInfoPayload` phải khớp `VideoInfoPayload` ở apps/api/main.py, vốn phản
 * chiếu `core/models.py`. Đây là chỗ dễ lệch nhất giữa hai ngôn ngữ (ADR 0006
 * §4.1) — thêm field bên Python mà quên bên này thì lỗi chỉ lộ lúc chạy.
 *
 * KHÔNG có `cookies`: phép đo B14 (ADR 0005 §7.3) cho thấy mọi host phục vụ byte
 * media đều không nhận cookie, nên extension khỏi phải xin quyền `cookies`.
 */
export interface VideoInfoPayload {
  title: string;
  m3u8_url: string;
  page_url: string;
  referer?: string;
  origin?: string;
  user_agent?: string;
  playlist_name?: string;
  video_id?: string;
  disable_fixup?: boolean;
  embed_metadata?: boolean;
  clean_disguised_ts?: boolean;
  extra_ytdlp_args?: string[];
}

export interface FormatOption {
  format_id: string;
  ext: string;
  resolution: string;
  height: number | null;
  /** Byte, hoặc `null` khi yt-dlp không biết trước (HLS thường không biết). */
  filesize: number | null;
  /** `'none'` nghĩa là luồng này KHÔNG có hình — đó là cách tách âm thanh. */
  vcodec: string | null;
  /** `'none'` nghĩa là luồng này không có tiếng. */
  acodec: string | null;
  recommended: boolean;
}

export interface StartResult {
  task_id: string;
  message: string;
  stream_token: string;
}

/** Một sự kiện tiến trình từ luồng SSE. */
export interface ProgressEvent {
  status: string;
  description?: string;
  completed?: number;
  speed?: string;
  eta?: string;
  title?: string;
  output_path?: string;
}

/** Manifest bắt được cho một tab. */
export interface Capture {
  page: string;
  host: string;
  url: string;
  title: string;
  referer?: string;
  origin?: string;
  userAgent?: string;
  at: number;
  /**
   * Tổng thời lượng playlist, tính bằng giây — `undefined` khi chưa đo xong,
   * `null` khi đo không ra.
   *
   * Đây là thứ phân biệt phim với quảng cáo. Một trang phát phim nạp cùng lúc
   * vài manifest từ nhiều host; cái nạp SAU CÙNG thường là quảng cáo, nên chọn
   * theo thứ tự thời gian là chọn nhầm. Quảng cáo dài chừng 15-30 giây, phim
   * dài hàng chục phút — so thời lượng là cách tách chúng đáng tin nhất mà
   * không cần biết tên miền nào của ai.
   */
  durationSec?: number | null;
}

export const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

/**
 * Một task trong bảng `download_tasks` — nguồn sự thật cho "đang tải gì".
 *
 * Trùng cột với backend; `tests/test_api_contract.py` giữ hai bên không lệch.
 * `progress` là phần trăm 0-100.
 */
export interface TaskRecord {
  task_id: string;
  url: string;
  title: string | null;
  status: string;
  progress: number;
  output_path: string | null;
  error_msg: string | null;
  created_at: string;
  updated_at: string | null;
  avg_speed: string | null;
  source: string;
}

/** Một dòng trong bảng `download_history` — file đã tải xong. */
export interface HistoryRow {
  id: number;
  title: string;
  url: string;
  m3u8_url: string | null;
  format_id: string | null;
  status: string;
  output_path: string | null;
  playlist_name: string | null;
  created_at: string;
  source: string;
}
