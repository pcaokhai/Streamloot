import { loadSettings } from './settings';
import type { FormatOption, ProgressEvent, StartResult, VideoInfoPayload } from './types';
import { TERMINAL_STATUSES } from './types';

/** Backend chỉ bind 127.0.0.1 (ADR 0004) — không bao giờ gọi ra ngoài máy. */
async function baseUrl(): Promise<string> {
  const { port } = await loadSettings();
  return `http://127.0.0.1:${port}/api/v1`;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { apiKey } = await loadSettings();
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
}

export class BackendError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${await baseUrl()}${path}`, {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify(body),
    });
  } catch {
    // B6 — phân biệt "app chưa chạy" với "app từ chối": người dùng sửa hai thứ
    // này theo hai cách hoàn toàn khác nhau.
    throw new BackendError('Không kết nối được Streamloot. App đã chạy chưa?');
  }
  if (res.status === 401 || res.status === 403) {
    throw new BackendError('API key sai. Mở Options để nhập lại.', res.status);
  }
  if (!res.ok) {
    throw new BackendError(`Backend trả ${res.status}`, res.status);
  }
  return (await res.json()) as T;
}

export async function ping(): Promise<boolean> {
  try {
    const res = await fetch(`${await baseUrl()}/history`, { headers: await authHeaders() });
    return res.ok;
  } catch {
    return false;
  }
}

export function listFormats(info: VideoInfoPayload): Promise<{ title: string; formats: FormatOption[] }> {
  // /formats/prepared, KHÔNG phải /formats: cái sau tự extract từ URL, tức mở
  // Chromium lần nữa — đúng ~30s mà cả kiến trúc này sinh ra để tránh.
  return post('/formats/prepared', info);
}

export async function startDownload(
  info: VideoInfoPayload,
  formatId: string | null,
): Promise<StartResult> {
  const { concurrency } = await loadSettings();
  return post<StartResult>('/downloads/prepared', {
    video_info: info,
    concurrency,
    ...(formatId ? { format_id: formatId } : {}),
  });
}

/**
 * B9 — đường lùi: gửi URL trần để app tự extract bằng plugin headless.
 * Dùng khi extension không bắt được manifest (site cần tương tác mới lộ stream,
 * ADR 0005 §2.3). Chậm hơn nhiều nhưng còn hơn là bó tay.
 */
export function startDownloadByUrl(url: string, formatId: string | null): Promise<StartResult> {
  return post<StartResult>('/downloads', { url, ...(formatId ? { format_id: formatId } : {}) });
}

/**
 * Đọc tiến trình.
 *
 * Dùng `fetch` + `ReadableStream` chứ KHÔNG dùng `EventSource`: MV3 service
 * worker không có `EventSource`. Đổi lại được một thứ tốt hơn — `fetch` set
 * được header `Authorization`, nên không cần token dùng-một-lần và nối lại
 * stream bao nhiêu lần cũng được (ADR 0005 §6.3.1).
 */
export async function streamProgress(
  taskId: string,
  onEvent: (e: ProgressEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${await baseUrl()}/downloads/${taskId}/stream`, {
    headers: await authHeaders(),
    signal,
  });
  if (!res.ok || !res.body) throw new BackendError(`Stream trả ${res.status}`, res.status);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });

    // Khung SSE phân tách bằng dòng trống. Phải gom buffer chứ không xử lý từng
    // chunk: một sự kiện có thể bị cắt ngang giữa hai lần đọc.
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';

    for (const frame of frames) {
      const line = frame.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      try {
        const data = JSON.parse(line.slice(5).trim()) as ProgressEvent;
        onEvent(data);
        if (TERMINAL_STATUSES.has(data.status)) return;
      } catch {
        // Khung hỏng thì bỏ qua, đừng giết cả stream vì một sự kiện lỗi.
      }
    }
  }
}
