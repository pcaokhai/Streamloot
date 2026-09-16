export type TaskStatus =
  | "pending"
  | "downloading"
  | "processing"
  | "paused"
  | "cancelling"
  | "cancelled"
  | "completed"
  | "failed"
  | "interrupted";

export const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set(["completed", "failed", "cancelled"]);

export interface Task {
  url: string;
  title: string | null;
  status: TaskStatus;
  completed: number; // 0-100
  speed: string; // human string, e.g. "5.81MiB/s" or "--"
  formatId: string | null;
  outputPath: string | null;
}

/** Raw shape returned by GET /api/v1/downloads/{task_id}. */
export interface TaskRecord {
  task_id: string;
  url: string;
  title: string | null;
  status: TaskStatus;
  progress: number;
  output_path: string | null;
  error_msg: string | null;
  avg_speed: string | null;
  created_at: string;
  updated_at: string;
}

/** One SSE progress event from GET /api/v1/downloads/{task_id}/stream. */
export interface ProgressEvent {
  status: TaskStatus;
  description: string;
  completed: number;
  speed: string;
  eta: string;
  title?: string | null;
  output_path?: string | null;
}

export interface HistoryRow {
  id: number;
  title: string;
  url: string;
  m3u8_url: string | null;
  format_id: string | null;
  status: "SUCCESS" | "FAILED";
  output_path: string | null;
  playlist_name: string | null;
  created_at: string;
  source?: string;
}

export interface FormatInfo {
  format_id: string;
  ext: string | null;
  resolution: string | null;
  height: number | null;
  filesize: number | null;
  vcodec: string | null;
  acodec: string | null;
  recommended: boolean;
}

export interface FormatsResponse {
  title: string;
  formats: FormatInfo[];
}

export interface ApiConfig {
  base_url: string;
  api_key: string;
}
