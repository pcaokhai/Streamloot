import { loadSettings } from './settings';
import type { FormatOption, ProgressEvent, StartResult, VideoInfoPayload, TaskRecord, HistoryRow } from './types';
import { TERMINAL_STATUSES } from './types';

/** Backend chỉ bind 127.0.0.1 (ADR 0004) — không bao giờ gọi ra ngoài máy. */
async function baseUrl(): Promise<string> {
  const { port } = await loadSettings();
  return `http://127.0.0.1:${port}/api/v1`;
}

/**
 * Không gửi API key. Backend nhận diện extension qua `X-Streamloot-Extension-Id`.
 *
 * Vì sao là custom header chứ không phải `Origin`: extension khai
 * `host_permissions` cho host này, mà với host đã được cấp quyền thì Chrome cho
 * gọi thẳng, không ràng buộc CORS, và **không gửi `Origin`**. Đã đo thật: backend
 * nhận `Origin: None`.
 *
 * Header này vẫn chặn được trang web độc hại: trình duyệt không cho trang đặt
 * header tuỳ ý trên request cross-origin nếu chưa qua preflight, mà preflight
 * thì bị CORS allowlist chặn.
 */
function jsonHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    // browser.runtime.id là ID thật của bản đang chạy — nếu nó lệch ID mà app
    // tin thì lỗi hiện ra rõ ràng thay vì âm thầm.
    'X-Streamloot-Extension-Id': browser.runtime.id,
  };
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
      headers: jsonHeaders(),
      body: JSON.stringify(body),
    });
  } catch {
    // B6 — phân biệt "app chưa chạy" với "app từ chối": người dùng sửa hai thứ
    // này theo hai cách hoàn toàn khác nhau.
    throw new BackendError('Không kết nối được Streamloot. App đã chạy chưa?');
  }
  if (res.status === 401 || res.status === 403) {
    // Origin không khớp: gần như chắc chắn là extension đang chạy với ID khác ID
    // đã ghim — xảy ra khi build mất `key` trong manifest.
    throw new BackendError('App từ chối extension này. ID có khớp không?', res.status);
  }
  if (!res.ok) {
    throw new BackendError(`Backend trả ${res.status}`, res.status);
  }
  return (await res.json()) as T;
}

async function get<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${await baseUrl()}${path}`, { headers: jsonHeaders() });
  } catch {
    throw new BackendError('Không kết nối được Streamloot. App đã chạy chưa?');
  }
  if (res.status === 401 || res.status === 403) {
    throw new BackendError('App từ chối extension này. ID có khớp không?', res.status);
  }
  if (!res.ok) throw new BackendError(`Backend trả ${res.status}`, res.status);
  return (await res.json()) as T;
}

export type Health = 'ok' | 'unreachable' | 'rejected';

/**
 * Trả về BA trạng thái, không phải boolean.
 *
 * Gộp "không tới được" và "bị từ chối" làm một là nói dối người dùng: app chưa
 * chạy thì mở app, còn bị từ chối thì ID extension không khớp — hai cách sửa
 * hoàn toàn khác nhau.
 */
/**
 * Hạn giờ cho health.
 *
 * 4s là quá ngắn khi backend vừa khởi động hoặc đang bận: nó biến một lần chậm
 * thành "App chưa chạy", mà hai thứ đó người dùng xử lý khác nhau hoàn toàn.
 * Backend ở localhost nên 10s vẫn không ai phải ngồi đợi thật — quá 10s thì
 * đúng là có gì đó sai.
 */
const HEALTH_TIMEOUT_MS = 10_000;

/**
 * Lý do lần health gần nhất thất bại, để popup hiện ra được.
 *
 * Bắt người dùng mở DevTools mới biết vì sao thì cũng gần như không nói gì.
 * `null` khi lần gần nhất thành công.
 */
let lastHealthError: string | null = null;

export function lastHealthReason(): string | null {
  return lastHealthError;
}

export async function health(): Promise<Health> {
  let res: Response;
  try {
    // Có hạn giờ, vì `fetch` không tự bỏ cuộc bao giờ.
    //
    // Backend nằm ở localhost nên bình thường trả lời trong vài mili giây. Nếu
    // cổng có người nghe nhưng không phải Streamloot (hay tiến trình đang kẹt),
    // fetch treo vô hạn và popup đứng ở "Đang kiểm tra…" mãi mãi — người dùng
    // đọc được đúng con số không. Quá hạn thì coi như không gọi được.
    res = await fetch(`${await baseUrl()}/health`, {
      headers: jsonHeaders(),
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
  } catch (err) {
    // Ghi ra LÝ DO. Trước đây mọi thất bại đều thành 'unreachable' và popup hiện
    // "App chưa chạy" — kể cả khi app đang chạy và chỉ là hết giờ, hay khi
    // `loadSettings()` ném lỗi (nó nằm trong try này). Gộp như thế là bắt người
    // dùng đoán, và đã thật sự làm mất thời gian: popup báo app chưa chạy trong
    // lúc app đang tải video.
    const kind = err instanceof DOMException && err.name === 'TimeoutError'
      ? `hết giờ sau ${HEALTH_TIMEOUT_MS}ms`
      : String(err);
    lastHealthError = kind;
    console.warn(`[Streamloot] health thất bại (${kind})`, err);
    return 'unreachable';
  }
  lastHealthError = null;
  if (res.status === 401 || res.status === 403) return 'rejected';
  return res.ok ? 'ok' : 'rejected';
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
 * worker không có `EventSource`. Đổi lại được thứ tốt hơn — với `fetch`, Chrome
 * gửi kèm `Origin`, nên backend nhận diện được extension và ta không cần token
 * dùng-một-lần; nối lại stream bao nhiêu lần cũng được (ADR 0005 §6.3.1).
 */
export async function streamProgress(
  taskId: string,
  onEvent: (e: ProgressEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${await baseUrl()}/downloads/${taskId}/stream`, {
    headers: jsonHeaders(),
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

/**
 * Nhờ backend đo thời lượng một playlist.
 *
 * Không tự `fetch` trong extension: trình duyệt cấm đặt `Referer`, mà CDN video
 * thường từ chối request thiếu nó — đo tại chỗ thì treo tới hết giờ rồi trả về
 * tay không, và panel hiện "đang đo…" vĩnh viễn. Python đặt được header đó.
 *
 * Trả `null` khi không đo được. KHÔNG ném: đây là tín hiệu phụ để xếp hạng,
 * hỏng nó không được phép làm hỏng việc bắt stream.
 */
export async function probeDuration(
  url: string,
  referer?: string,
  userAgent?: string,
): Promise<number | null> {
  try {
    const r = await post<{ duration_sec: number | null }>('/probe/duration', {
      url,
      referer: referer ?? null,
      user_agent: userAgent ?? null,
    });
    return r.duration_sec;
  } catch (err) {
    // Ghi ra lý do thay vì nuốt trọn. "App cũ chưa có endpoint này" (404) và
    // "CDN từ chối manifest" đều ra `null`, nhưng cách sửa hoàn toàn khác nhau:
    // một bên build lại app, một bên đổi tín hiệu xếp hạng. Gộp hai thứ đó làm
    // một là bắt người dùng đoán.
    const status = err instanceof BackendError ? err.status : undefined;
    if (status === 404) {
      console.warn(
        '[Streamloot] App đang chạy chưa có /probe/duration — build lại app (./build_app.sh). ' +
          'Không đo được thời lượng thì panel phải đoán khi một trang có nhiều stream.',
      );
    } else {
      console.warn('[Streamloot] Đo thời lượng hỏng:', status ?? err);
    }
    return null;
  }
}

/** Mọi task chưa kết thúc, bất kể nguồn nào khởi động (D2 — danh sách là toàn cục). */
export function getActiveTasks(): Promise<{ tasks: TaskRecord[] }> {
  return get<{ tasks: TaskRecord[] }>('/downloads/active');
}

/** Lịch sử. Mặc định chỉ lấy phần do extension tải (tab Lịch sử, spec §5.2). */
export function getHistory(source = 'extension'): Promise<HistoryRow[]> {
  return get<HistoryRow[]>(`/history?source=${encodeURIComponent(source)}`);
}

export async function pauseTask(taskId: string): Promise<void> {
  await post(`/downloads/${taskId}/pause`, {});
}

export async function resumeTask(taskId: string): Promise<void> {
  await post(`/downloads/${taskId}/resume`, {});
}

export async function cancelTask(taskId: string): Promise<void> {
  await post(`/downloads/${taskId}/cancel`, {});
}
