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
}

export const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);
