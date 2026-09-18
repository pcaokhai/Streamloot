/**
 * Chọn video nào để neo nút, và nút nằm ở đâu.
 *
 * Thuần và không chạm DOM: nhận hình chữ nhật đã đo sẵn, trả chỉ số và toạ độ.
 * Phần gọi `getBoundingClientRect` và gắn observer nằm ở content script — ở đó
 * không test được, nên phần quyết định phải ra đây (ADR 0006).
 *
 * KHÔNG vi phạm B7: B7 cấm đọc `<video>.src` để lấy URL tải, còn đọc vị trí và
 * trạng thái đang-phát là việc khác hẳn.
 */

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface VideoLike {
  rect: Rect;
  playing: boolean;
}

/** Cạnh nút, px. */
export const BTN_SIZE = 28;
/** Khoảng thụt vào từ mép video, px. */
export const BTN_PAD = 8;
/**
 * Video nhỏ hơn mức này bị bỏ qua.
 *
 * Trang thật đầy `<video>` tí hon dùng làm ảnh động, sprite hay nền — neo nút
 * vào chúng thì nút vừa vô dụng vừa che mất nội dung.
 */
export const MIN_VIDEO_PX = 120;

const area = (r: Rect) => r.width * r.height;

function inViewport(r: Rect, view: { width: number; height: number }): boolean {
  return r.top < view.height && r.top + r.height > 0 && r.left < view.width && r.left + r.width > 0;
}

/**
 * Chỉ số video để neo nút, `-1` nếu không có ứng viên.
 *
 * Thứ tự ưu tiên theo spec §5.1.1: **đang phát** trước, rồi **lớn nhất**. Ưu
 * tiên đang-phát chứ không phải lớn-nhất vì trang tin thường có một video quảng
 * cáo to đùng nằm im cạnh video người dùng bấm play.
 *
 * Lọc theo khung nhìn CHỈ KHI còn ứng viên: video cuộn khuất vẫn hơn là không
 * có nút nào.
 */
export function pickAnchor(videos: VideoLike[], viewport: { width: number; height: number }): number {
  const idx = videos
    .map((v, i) => i)
    .filter((i) => {
      const r = videos[i].rect;
      return r.width >= MIN_VIDEO_PX && r.height >= MIN_VIDEO_PX;
    });
  if (!idx.length) return -1;

  const visible = idx.filter((i) => inViewport(videos[i].rect, viewport));
  const pool = visible.length ? visible : idx;

  const playing = pool.filter((i) => videos[i].playing);
  const from = playing.length ? playing : pool;

  return from.reduce((best, i) => (area(videos[i].rect) > area(videos[best].rect) ? i : best), from[0]);
}

/** Toạ độ nút: góc trên PHẢI của video, thụt vào trong để không tràn ra ngoài. */
export function buttonPos(rect: Rect, size: number, pad: number): { top: number; left: number } {
  return {
    top: rect.top + pad,
    left: rect.left + rect.width - size - pad,
  };
}
