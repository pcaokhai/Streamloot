/**
 * Mọi quyết định của icon và vòng poll — tách khỏi phần chạm trình duyệt.
 *
 * Để ở đây vì chạy thử được bằng node (`tests/run.sh`). Service worker không
 * có DOM và `OffscreenCanvas` không có trong node, nên nếu trộn quyết định vào
 * phần vẽ thì không test được gì cả — mà đây đúng là loại logic dễ sai âm thầm.
 */
import type { TaskRecord } from './types';
import { TERMINAL_STATUSES } from './types';

/**
 * Cam-700 cho nền badge, KHÔNG phải cam-500 của vòng.
 *
 * Badge có chữ trắng đè lên nên cần tương phản cao hơn nhiều so với một vòng
 * đồ hoạ trơn. Đo thật: cam-500 với chữ trắng chỉ 2.80:1 (đọc không nổi),
 * cam-600 được 3.56:1, cam-700 đạt 5.18:1 — ngang mức xanh cũ (5.17:1). Hai
 * sắc cam khác nhau là có chủ đích, không phải lệch nhầm.
 */
export const BADGE_ORANGE = '#c2410c';
/** Giữ lại vì lib/icon.ts đối chiếu màu xám của vòng với nó trong chú thích;
 *  badge không còn dùng màu xám từ khi nó chỉ nói về download. */
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
export function badgeFor(tasks: TaskRecord[]): { text: string; color: string } {
  const live = tasks.filter((t) => !TERMINAL_STATUSES.has(t.status));
  // Badge CHỈ nói về download đang chạy, không nói về stream bắt được.
  //
  // Spec §5.3 vốn cho badge hiện số stream bắt được khi không tải gì, nhưng số
  // đó chạy suốt trên mọi trang có video và làm badge gần như lúc nào cũng
  // sáng — nhìn vào không biết có đang tải hay không, tức mất đúng thông tin
  // badge sinh ra để mang. Số stream đã có trong popup, nơi có chỗ giải thích
  // nó là gì.
  // Luôn toàn cục: số download không thuộc về tab nào cả.
  return { text: live.length ? String(live.length) : '', color: BADGE_ORANGE };
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
 * F2 — có nên nhớ (cache) một lần dò định dạng thất bại hay không.
 *
 * `status` có giá trị nghĩa là backend đã trả lời (kể cả lỗi) — kết quả bền
 * theo URL, đáng nhớ. `status` là `undefined` nghĩa là request chưa chạm tới
 * backend (app chưa chạy, mất kết nối) — nhớ sai này thì trang bị khoá "không
 * tải được" vĩnh viễn cho tới khi service worker khởi động lại, kể cả sau khi
 * người dùng đã mở app lên.
 */
export function shouldCacheFormatFailure(status: number | undefined): boolean {
  return status !== undefined;
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

/** Số dòng lịch sử giữ trong cache local (spec §4.1). */
export const HISTORY_CACHE_MAX = 20;

/**
 * Cắt lịch sử xuống số dòng được phép cache.
 *
 * Giữ phần ĐẦU vì backend trả mới nhất trước — cắt nhầm đuôi thì cache toàn
 * dòng cũ nhất, tức mở popup ra thấy đúng thứ không ai cần.
 */
export function trimHistory<T>(rows: T[], max: number = HISTORY_CACHE_MAX): T[] {
  return rows.slice(0, max);
}
