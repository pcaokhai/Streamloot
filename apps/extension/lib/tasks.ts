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
 */
export function pickRingTask(tasks: TaskRecord[]): TaskRecord | undefined {
  const live = tasks.filter((t) => !TERMINAL_STATUSES.has(t.status));
  if (!live.length) return undefined;
  return live.reduce((a, b) => (b.created_at > a.created_at ? b : a));
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
 * tab, số download là toàn cục (D2).
 */
export function badgeFor(
  tasks: TaskRecord[],
  tabCaptureCount: number,
): { text: string; color: string } {
  const live = tasks.filter((t) => !TERMINAL_STATUSES.has(t.status));
  if (live.length > 1) return { text: String(live.length), color: BADGE_BLUE };
  if (live.length === 1) return { text: '', color: BADGE_BLUE };
  if (tabCaptureCount > 0) return { text: String(tabCaptureCount), color: BADGE_GRAY };
  return { text: '', color: BADGE_GRAY };
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
