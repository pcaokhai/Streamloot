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
/**
 * Vòng dày 6px trên canvas 32px.
 *
 * 4px bị chìm: trên thanh công cụ icon hiển thị cỡ 16pt, nên mọi thứ co lại một
 * nửa và một vòng 4px thành 2pt — mảnh hơn nét của chính glyph bên trong. Dày
 * hơn thì icon nền phải nhỏ lại, và đó là đánh đổi đúng: lúc đang tải thì tiến
 * trình mới là thứ cần đọc, còn "đây là extension nào" thì vị trí trên thanh
 * công cụ đã trả lời rồi.
 */
const RING_W = 6;
/**
 * Icon nền mờ đi khi đang tải, để vòng là thứ đập vào mắt trước.
 *
 * Không đổi hẳn màu glyph: icon phải còn nhận ra được là Streamloot. Giảm độ
 * đục thì nó lùi về sau mà vẫn giữ hình dạng.
 */
const BASE_ALPHA_WHILE_BUSY = 0.45;
/**
 * Cam-500 cho cung tiến trình.
 *
 * Xanh #2563eb chìm vào chính icon (nền icon cũng xanh) nên vòng khó tách khỏi
 * glyph. Cam nằm đối diện xanh trên vòng màu nên tách bạch ngay, và đo được là
 * 5.74:1 trên thanh công cụ tối. Trên thanh công cụ SÁNG nó chỉ 2.14:1 — chấp
 * nhận được vì đây là đồ hoạ đặc, không phải chữ, và đường ray mờ bên dưới đã
 * vạch sẵn hình tròn nên mắt bám được viền kể cả khi cung nhạt.
 */
const RING_ACTIVE = '#f97316';
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
  await draw(task ? { pct: quantize5(task.progress), paused: task.status === 'paused' } : null);
}

/**
 * Vòng chạy nốt tới 100% rồi ẩn hẳn (spec §5.3).
 *
 * Gọi khi một task vừa xong THẬT — người gọi phải tự xác nhận trạng thái cuối
 * là `completed`, vì task bị huỷ cũng biến mất khỏi danh sách y hệt và không
 * đáng được vẽ đầy vòng.
 *
 * Đặt `lastKey` thành khoá riêng để lần vẽ kế tiếp của applyIconState không bị
 * chốt chặn vẽ thừa nuốt mất.
 */
export async function flashCompleted(holdMs = 900): Promise<void> {
  lastKey = 'flash-completed';
  await draw({ pct: 100, paused: false });
  setTimeout(() => {
    lastKey = null;
    void draw(null);
  }, holdMs);
}

async function draw(ring: { pct: number; paused: boolean } | null): Promise<void> {
  try {
    const canvas = new OffscreenCanvas(SIZE, SIZE);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const bmp = await baseBitmap();

    if (!ring) {
      // Rảnh: icon trần, vòng biến mất hẳn (spec §5.3).
      ctx.drawImage(bmp, 0, 0, SIZE, SIZE);
    } else {
      // inset 9 chứ không phải 8: icon là hình VUÔNG, nên bốn góc cách tâm xa
      // hơn cạnh. Tính ra với vòng dày 6 thì mép trong dải vòng ở bán kính 10,
      // còn góc icon 16px nằm ở 11.3 — tức chọc vào vòng. Ở 14px thì góc ở 9.9,
      // vừa đủ nằm trong.
      const inset = RING_W + 3;
      ctx.globalAlpha = BASE_ALPHA_WHILE_BUSY;
      ctx.drawImage(bmp, inset, inset, SIZE - inset * 2, SIZE - inset * 2);
      ctx.globalAlpha = 1;
      const pct = ring.pct;
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

      ctx.strokeStyle = ring.paused ? RING_GRAY : RING_ACTIVE;
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
