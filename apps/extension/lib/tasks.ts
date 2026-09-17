/**
 * Mọi quyết định của icon và vòng poll — tách khỏi phần chạm trình duyệt.
 *
 * Để ở đây vì chạy thử được bằng node (`tests/run.sh`). Service worker không
 * có DOM và `OffscreenCanvas` không có trong node, nên nếu trộn quyết định vào
 * phần vẽ thì không test được gì cả — mà đây đúng là loại logic dễ sai âm thầm.
 */
import type { TaskRecord } from './types';
import { TERMINAL_STATUSES } from './types';

export const BADGE_BLUE = '#2563eb';
export const BADGE_GRAY = '#71717a';

/** Bước làm tròn phần trăm. 5 => tối đa 20 lần vẽ mỗi download (spec §5.3). */
const STEP = 5;

/**
 * Task mà vòng tiến trình bám: cái KHỞI ĐỘNG GẦN NHẤT.
 *
 * Cố ý KHÔNG lấy trung bình mọi task: thêm một download mới sẽ kéo tổng phần
 * trăm tụt xuống, vòng chạy ngược, trông như hỏng. Con số của một task thì luôn
 * tăng (spec §5.3).
 *
 * `created_at` chỉ tới độ phân giải giây, hai task cùng giây là chuyện thường.
 * Truy vấn SQL không có khoá phụ nên thứ tự trả về là không xác định. Phá hoà
 * bằng `task_id` để cùng dữ liệu luôn cho cùng kết quả, không phụ thứ tự mảy.
 */
export function pickRingTask(tasks: TaskRecord[]): TaskRecord | undefined {
  const live = tasks.filter((t) => !TERMINAL_STATUSES.has(t.status));
  if (!live.length) return undefined;
  // live.length đã được kiểm ở trên nên reduce có ít nhất một phần tử
  return live.reduce((a, b) => {
    if (b.created_at !== a.created_at) return b.created_at > a.created_at ? b : a;
    return b.task_id > a.task_id ? b : a;
  });
}

/** Làm tròn xuống bội số 5, kẹp trong [0, 100]. */
export function quantize5(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  const clamped = Math.min(100, Math.max(0, pct));
  return Math.floor(clamped / STEP) * STEP;
}

/**
 * Khoá quyết định "có cần vẽ lại icon không".
 *
 * Chỉ vẽ khi khoá đổi. Poll 1s cho video 10 phút là 600 lần poll nhưng tối đa
 * 20 lần vẽ (spec §5.3).
 */
export function iconKey(t: TaskRecord | undefined): string {
  if (!t) return 'idle';
  return `${t.status}:${quantize5(t.progress)}`;
}

/**
 * Badge BỔ SUNG cho vòng chứ không lặp lại nó (spec §5.3).
 *
 * Đúng một download thì badge để trống — vòng đã nói rồi. Số stream là theo
 * tab (`perTab: true`), số download là toàn cục theo D2 (`perTab: false`) —
 * đây là quyết định, không phải chi tiết vẽ, nên nằm ở đây để test được thay
 * vì suy luận từ việc có truyền `tabId` hay không ở lib/icon.ts.
 */
export function badgeFor(
  tasks: TaskRecord[],
  tabCaptureCount: number,
): { text: string; color: string; perTab: boolean } {
  const live = tasks.filter((t) => !TERMINAL_STATUSES.has(t.status));
  if (live.length > 1) return { text: String(live.length), color: BADGE_BLUE, perTab: false };
  if (live.length === 1) return { text: '', color: BADGE_BLUE, perTab: false };
  if (tabCaptureCount > 0) return { text: String(tabCaptureCount), color: BADGE_GRAY, perTab: true };
  // Rỗng: perTab false để badge toàn cục cũ (nếu có) được xoá đi.
  return { text: '', color: BADGE_GRAY, perTab: false };
}

/**
 * Nhịp poll kế tiếp, `null` nghĩa là DỪNG hẳn (spec §4.2).
 *
 * Không có task thì không poll, kể cả khi popup đang mở: gọi API extension theo
 * chu kỳ chính là cách giữ service worker sống, và đó là thứ D4 loại bỏ.
 */
export function nextPollMs(o: { viewersOpen: boolean; hasActive: boolean }): number | null {
  if (!o.hasActive) return null;
  return o.viewersOpen ? 1000 : 60000;
}

/**
 * Thời gian tương đối cho một dòng lịch sử (spec §5.2), kiểu "2 phút trước".
 *
 * `created_at` từ SQLite không có múi giờ trong chuỗi — coi là UTC (backend
 * ghi bằng `datetime('now')`, luôn UTC) rồi so với giờ hiện tại của máy.
 * Chuỗi hỏng hoặc rỗng thì trả về rỗng thay vì ném lỗi: một timestamp lạ
 * không được phép làm sập cả dòng lịch sử.
 */
export function relativeTime(createdAt: string | null | undefined, now: number = Date.now()): string {
  if (!createdAt) return '';
  const iso = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(createdAt)
    ? createdAt.replace(' ', 'T') + (createdAt.endsWith('Z') ? '' : 'Z')
    : createdAt;
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  const diffSec = Math.max(0, Math.round((now - ts) / 1000));
  if (diffSec < 60) return 'vừa xong';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour} giờ trước`;
  const diffDay = Math.round(diffHour / 24);
  if (diffDay === 1) return 'hôm qua';
  return `${diffDay} ngày trước`;
}
