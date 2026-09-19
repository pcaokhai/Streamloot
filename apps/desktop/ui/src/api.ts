import type { ApiConfig, FormatsResponse, HistoryRow, TaskRecord } from "./types";

const BRIDGE_TIMEOUT_MS = 10_000;

let configPromise: Promise<ApiConfig> | null = null;
let resolvedConfig: ApiConfig | null = null; // set once ensureConfig() actually settles

// Lazily awaited by every call below, instead of the UI gating its entire
// render tree on this resolving first. pywebview injects window.pywebview
// asynchronously after the page loads and dispatches "pywebviewready" — if
// a caller (or the whole app) checks it synchronously on mount and only
// that one moment, a slow or missed handshake means everything stays blank
// forever with zero visible signal. Waiting per-request means the shell
// renders immediately and the first real API call just blocks briefly
// (bounded by the timeout below) instead of the whole page going dark.
// `window.pywebview` can be truthy as a stub before its API methods finish
// binding — object existence alone isn't proof the bridge is callable.
// `pywebviewready` is pywebview's actual "safe to call now" signal.
function bridgeReady(): boolean {
  return typeof window.pywebview?.api?.get_api_config === "function";
}

function ensureConfig(): Promise<ApiConfig> {
  if (!configPromise) {
    configPromise = new Promise<ApiConfig>((resolve, reject) => {
      if (bridgeReady()) {
        window.pywebview!.api.get_api_config().then(resolve, reject);
        return;
      }
      const timer = setTimeout(() => {
        reject(new Error("Desktop app bridge (window.pywebview) never became ready."));
      }, BRIDGE_TIMEOUT_MS);
      window.addEventListener("pywebviewready", () => {
        clearTimeout(timer);
        if (bridgeReady()) {
          window.pywebview!.api.get_api_config().then(resolve, reject);
        } else {
          reject(new Error("window.pywebview.api.get_api_config still unavailable after pywebviewready."));
        }
      }, { once: true });
    });
    configPromise.then((c) => { resolvedConfig = c; }).catch(() => {});
  }
  return configPromise;
}

/** Fire-and-forget-able: lets callers kick off the bridge handshake early
 *  without blocking their own render on it. */
export function initApi(): Promise<ApiConfig> {
  return ensureConfig();
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T | null> {
  const config = await ensureConfig();
  const res = await fetch(`${config.base_url}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.api_key}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${await res.text()}`);
  }
  return res.status === 204 ? null : ((await res.json()) as T);
}

/** Synchronous — only safe to call after a request() above has resolved at
 *  least once in the current call chain (config is then guaranteed set). */
export function getBaseUrl(): string {
  if (!resolvedConfig) throw new Error("API config not yet resolved — call an async API method first.");
  return resolvedConfig.base_url;
}

export interface StartDownloadResult {
  task_id: string;
  message: string;
  /**
   * Token dùng-một-lần cho GET /downloads/{id}/stream. EventSource không set
   * được header Authorization nên stream xác thực bằng query string thay vì
   * Bearer token (ADR 0005 B13).
   */
  stream_token: string;
}

export function startDownload(url: string, formatId: string | null): Promise<StartDownloadResult | null> {
  // §6.2: mỗi surface tự khai nguồn, nếu không cột Source trống với mọi thứ
  // người dùng bấm từ chính app.
  const body: { url: string; source: string; format_id?: string } = { url, source: "desktop" };
  if (formatId) body.format_id = formatId;
  return request<StartDownloadResult>("/downloads", { method: "POST", body: JSON.stringify(body) });
}

/**
 * Xin token stream mới cho task đang chạy. Token là dùng-một-lần nên sau khi mở
 * lại app, task khôi phục từ storage phải xin token mới mới nối lại stream được.
 */
export function refreshStreamToken(taskId: string): Promise<{ stream_token: string } | null> {
  return request<{ stream_token: string }>(`/downloads/${taskId}/stream-token`, { method: "POST" });
}

export function getTask(taskId: string): Promise<TaskRecord | null> {
  return request<TaskRecord>(`/downloads/${taskId}`);
}

export function cancelTask(taskId: string): Promise<unknown> {
  return request(`/downloads/${taskId}/cancel`, { method: "POST" });
}

export function pauseTask(taskId: string): Promise<unknown> {
  return request(`/downloads/${taskId}/pause`, { method: "POST" });
}

export function resumeTask(taskId: string): Promise<unknown> {
  return request(`/downloads/${taskId}/resume`, { method: "POST" });
}

/**
 * Mọi task chưa kết thúc, bất kể nguồn nào khởi động — cửa sổ app, extension
 * hay CLI. Thay hoàn toàn cho việc tự nhớ danh sách task id trong localStorage:
 * backend đã biết, client chỉ phản chiếu.
 */
export function getActiveTasks(): Promise<{ tasks: TaskRecord[] } | null> {
  return request<{ tasks: TaskRecord[] }>("/downloads/active");
}

export function getHistory(): Promise<HistoryRow[] | null> {
  return request<HistoryRow[]>("/history");
}

export function getFormats(url: string): Promise<FormatsResponse | null> {
  return request<FormatsResponse>(`/formats?url=${encodeURIComponent(url)}`);
}

export function revealInFinder(path: string): Promise<boolean> {
  if (typeof window.pywebview?.api?.reveal_in_finder !== "function") return Promise.resolve(false);
  return window.pywebview.api.reveal_in_finder(path);
}

export function pathExists(path: string): Promise<boolean> {
  if (typeof window.pywebview?.api?.path_exists !== "function") return Promise.resolve(false);
  return window.pywebview.api.path_exists(path);
}

export function deleteHistoryItem(id: number, deleteFile: boolean): Promise<unknown> {
  return request(`/history/${id}?delete_file=${deleteFile}`, { method: "DELETE" });
}

export function clearHistory(): Promise<unknown> {
  return request("/history", { method: "DELETE" });
}

export interface ToolInfo {
  found: boolean;
  source: "bundled" | "downloaded" | "system" | null;
  required: boolean;
}

export interface ToolsResponse {
  tools: Record<string, ToolInfo>;
  installing: Record<string, { done: number; total: number; label: string; error: string | null }>;
}

export async function fetchTools(): Promise<ToolsResponse> {
  const r = await request<ToolsResponse>("/tools");
  // `request` trả null khi phản hồi rỗng. Với endpoint này thì rỗng là bất
  // thường — trả một object rỗng giả sẽ hiện "chưa cài gì cả" và mời người dùng
  // tải lại những thứ họ đã có.
  if (!r) throw new Error("Backend trả về rỗng khi hỏi trạng thái công cụ");
  return r;
}

export async function installTool(
  name: string,
): Promise<{ started: boolean; message?: string }> {
  const r = await request<{ started: boolean; message?: string }>(
    `/tools/${encodeURIComponent(name)}/install`,
    { method: "POST" },
  );
  return r ?? { started: false };
}
