/**
 * Vẽ vòng tiến trình quanh icon extension.
 *
 * Service worker MV3 không có DOM nhưng CÓ `OffscreenCanvas`, nên vẽ được icon
 * rồi đẩy thẳng qua `action.setIcon({imageData})` — không cần offscreen
 * document, không cần thư viện (spec §5.3).
 *
 * File này cố ý không chứa quyết định nào: chọn task nào, vẽ bao nhiêu phần
 * trăm, badge ra sao đều lấy từ `lib/tasks.ts` (có test). Ở đây chỉ có nét vẽ.
 */
import { badgeFor, iconKey, pickRingTask, quantize5 } from './tasks';
import type { TaskRecord } from './types';

const SIZE = 32;
const RING_W = 4;
const RING_BLUE = '#2563eb';
// Khác BADGE_GRAY (#71717a) một cách cố ý, không phải lệch nhầm: vòng xám này
// khớp màu xám tạm-dừng/chờ trong popup, còn BADGE_GRAY là màu rảnh của badge
// — hai ngữ cảnh khác nhau, đừng gộp làm một hằng số.
const RING_GRAY = '#a1a1aa';

/** Khoá lần vẽ gần nhất. Trùng khoá thì bỏ qua — đây là chốt chặn vẽ thừa. */
let lastKey: string | null = null;

async function baseBitmap(): Promise<ImageBitmap> {
  const res = await fetch(browser.runtime.getURL('/icon/128.png'));
  return createImageBitmap(await res.blob());
}

export async function applyIconState(
  tasks: TaskRecord[],
  tabCaptureCount: number,
  tabId?: number,
): Promise<void> {
  const task = pickRingTask(tasks);
  const key = iconKey(task);

  const badge = badgeFor(tasks, tabCaptureCount);
  const scoped = badge.perTab && tabId !== undefined;
  await browser.action
    .setBadgeText({ text: badge.text, ...(scoped ? { tabId } : {}) })
    .catch(() => {});
  await browser.action
    .setBadgeBackgroundColor({ color: badge.color, ...(scoped ? { tabId } : {}) })
    .catch(() => {});
  // Global không tự đè per-tab: nếu badge trước đó thuộc tab này (captures) và
  // giờ chuyển sang toàn cục (download bắt đầu), badge tab-scoped cũ vẫn còn
  // treo trên đúng tab đó vì Chrome coi hai scope là hai giá trị độc lập. Xoá
  // tường minh bản ghi theo-tab mỗi khi badge hiện tại là toàn cục.
  if (!scoped && tabId !== undefined) {
    await browser.action.setBadgeText({ text: '', tabId }).catch(() => {});
  }

  if (key === lastKey) return; // không đổi thì không vẽ
  lastKey = key;

  try {
    const canvas = new OffscreenCanvas(SIZE, SIZE);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const bmp = await baseBitmap();

    if (!task) {
      // Rảnh: icon trần, vòng biến mất hẳn (spec §5.3).
      ctx.drawImage(bmp, 0, 0, SIZE, SIZE);
    } else {
      const inset = RING_W + 1;
      ctx.drawImage(bmp, inset, inset, SIZE - inset * 2, SIZE - inset * 2);
      const pct = quantize5(task.progress);
      ctx.lineWidth = RING_W;
      ctx.strokeStyle = task.status === 'paused' ? RING_GRAY : RING_BLUE;
      ctx.lineCap = 'round';
      ctx.beginPath();
      // Bắt đầu từ 12 giờ (-90°) cho giống mọi vòng tiến trình khác.
      ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - RING_W / 2,
              -Math.PI / 2, -Math.PI / 2 + (pct / 100) * 2 * Math.PI);
      ctx.stroke();
    }

    await browser.action.setIcon({ imageData: ctx.getImageData(0, 0, SIZE, SIZE) });
  } catch (err) {
    // Vẽ icon hỏng thì icon xấu, không phải tải hỏng. Ghi lại rồi đi tiếp.
    console.warn('[Streamloot] vẽ icon hỏng:', err);
    lastKey = null; // cho thử lại lần sau
  }
}
