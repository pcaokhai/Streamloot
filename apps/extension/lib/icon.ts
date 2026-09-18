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
/** Đường ray mờ chạy hết vòng — cho biết "đang tải" kể cả khi mới 0%. */
const RING_TRACK = 'rgba(148, 163, 184, 0.45)';

/** Khoá lần vẽ gần nhất. Trùng khoá thì bỏ qua — đây là chốt chặn vẽ thừa. */
let lastKey: string | null = null;

async function baseBitmap(): Promise<ImageBitmap> {
  const res = await fetch(browser.runtime.getURL('/icon/128.png'));
  return createImageBitmap(await res.blob());
}

export async function applyIconState(tasks: TaskRecord[], tabId?: number): Promise<void> {
  const task = pickRingTask(tasks);
  const key = iconKey(task);

  // Badge luôn TOÀN CỤC: nó đếm download, mà download không thuộc tab nào.
  const badge = badgeFor(tasks);
  await browser.action.setBadgeText({ text: badge.text }).catch(() => {});
  await browser.action.setBadgeBackgroundColor({ color: badge.color }).catch(() => {});

  // Gỡ override theo-tab nếu còn sót (bản cũ từng ghi badge theo tab).
  //
  // `text: null`, KHÔNG phải '': '' là ĐẶT một badge rỗng cho tab, và badge
  // theo-tab luôn thắng badge toàn cục — số toàn cục sẽ bị che mất. Chỉ `null`
  // mới xoá override để giá trị toàn cục lộ ra.
  if (tabId !== undefined) {
    // Kiểu `BadgeTextDetails.text` của @wxt-dev/browser chỉ khai
    // `string | undefined`, thiếu `null`, dù JSDoc ngay trong file .d.ts của
    // chính gói đó ghi null là cách xoá override, và Chrome thật nhận null.
    // Ép kiểu có chủ đích — gỡ khi gói sửa type.
    await browser.action.setBadgeText({ text: null as unknown as string, tabId }).catch(() => {});
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
      const r = SIZE / 2 - RING_W / 2;
      const TOP = -Math.PI / 2; // 12 giờ, như mọi vòng tiến trình khác

      // ĐƯỜNG RAY trước, rồi mới tới cung tiến trình.
      //
      // Không có ray thì lúc mới bắt đầu nhìn y hệt như chưa chạy: quantize5
      // làm tròn xuống bội số 5, nên 2% thành 0% và cung dài đúng 0 độ. Ngay cả
      // 5% cũng chỉ là một chấm trên icon 16px. Ray cho biết "đang tải" ngay từ
      // giây đầu, còn cung cho biết tới đâu.
      ctx.lineWidth = RING_W;
      ctx.lineCap = 'butt';
      ctx.strokeStyle = RING_TRACK;
      ctx.beginPath();
      ctx.arc(SIZE / 2, SIZE / 2, r, 0, 2 * Math.PI);
      ctx.stroke();

      ctx.strokeStyle = task.status === 'paused' ? RING_GRAY : RING_BLUE;
      ctx.lineCap = 'round';
      ctx.beginPath();
      // Cung tối thiểu ~4% để 0% vẫn thấy được là đã bắt đầu, thay vì trống trơn.
      const frac = Math.max(0.04, pct / 100);
      ctx.arc(SIZE / 2, SIZE / 2, r, TOP, TOP + frac * 2 * Math.PI);
      ctx.stroke();
    }

    await browser.action.setIcon({ imageData: ctx.getImageData(0, 0, SIZE, SIZE) });
  } catch (err) {
    // Vẽ icon hỏng thì icon xấu, không phải tải hỏng. Ghi lại rồi đi tiếp.
    console.warn('[Streamloot] vẽ icon hỏng:', err);
    lastKey = null; // cho thử lại lần sau
  }
}
