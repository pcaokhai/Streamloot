/**
 * Cache local để popup mở ra hiện ngay, không đợi mạng (D1, spec §4.1).
 *
 * Cache **không bao giờ là nguồn sự thật** — backend mới là. Nó chỉ lấp khoảng
 * trống giữa lúc popup mở và lúc dữ liệu thật về, và giữ cho popup còn thứ để
 * hiện khi app tắt. Mọi lời gọi ở đây đều nuốt lỗi và trả về giá trị rỗng: cache
 * hỏng thì mất tiện lợi, không được phép làm hỏng popup.
 *
 * Chọn nơi lưu theo spec: task vào `session` (chết theo phiên trình duyệt, vì
 * task cũ của phiên trước chẳng còn ý nghĩa), lịch sử vào `local` (sống qua cả
 * lần khởi động lại).
 */
import { trimHistory } from './tasks';
import type { HistoryRow, TaskRecord } from './types';

const TASKS_KEY = 'cache:tasks';
const HISTORY_KEY = 'cache:history';

export async function cacheTasks(tasks: TaskRecord[]): Promise<void> {
  try {
    await browser.storage.session.set({ [TASKS_KEY]: tasks });
  } catch {
    // Hết dung lượng hay storage bị chặn: bỏ qua, lần sau ghi lại.
  }
}

export async function readCachedTasks(): Promise<TaskRecord[]> {
  try {
    const got = await browser.storage.session.get(TASKS_KEY);
    const rows = (got as Record<string, unknown>)[TASKS_KEY];
    return Array.isArray(rows) ? (rows as TaskRecord[]) : [];
  } catch {
    return [];
  }
}

export async function cacheHistory(rows: HistoryRow[]): Promise<void> {
  try {
    await browser.storage.local.set({ [HISTORY_KEY]: trimHistory(rows) });
  } catch {
    // Không ghi được thì thôi — popup vẫn gọi backend như thường.
  }
}

export async function readCachedHistory(): Promise<HistoryRow[]> {
  try {
    const got = await browser.storage.local.get(HISTORY_KEY);
    const rows = (got as Record<string, unknown>)[HISTORY_KEY];
    return Array.isArray(rows) ? (rows as HistoryRow[]) : [];
  } catch {
    return [];
  }
}
