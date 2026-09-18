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

/**
 * Toạ độ nút: NGAY TRÊN mép video, thẳng hàng góc phải — như thanh nút của
 * Cốc Cốc nằm trên góc trái video, mirror sang phải. Nằm ngoài khung để không
 * che hình và không đè lên nút điều khiển của chính player.
 *
 * Video sát mép trên khung nhìn thì không còn chỗ phía trên: kẹp xuống `pad`,
 * chấp nhận đè lên mép video một chút còn hơn là nút bay ra ngoài màn hình.
 */
export function buttonPos(rect: Rect, size: number, pad: number): { top: number; left: number } {
  return {
    top: Math.max(rect.top - size - pad, pad),
    left: rect.left + rect.width - size - pad,
  };
}

/** Bề rộng panel, px — phải khớp `.sl-panel { width }` trong style.css. */
export const PANEL_W = 320;
/** Khe giữa nút và panel, px. */
export const PANEL_GAP = 6;
/** Phần panel tối thiểu phải lộ ra trong khung nhìn, px. */
const PANEL_MIN_VISIBLE = 200;

/**
 * Toạ độ panel: thả NGAY DƯỚI nút, mép phải thẳng hàng với nút — cách IDM và
 * Cốc Cốc làm, để panel mở ra đúng chỗ người dùng vừa bấm chứ không nhảy lên
 * góc cửa sổ (spec §5.1: "chiếm chỗ càng ít càng tốt").
 *
 * Kẹp vào khung nhìn: nút neo ở mép phải video, nên panel rộng 320px dễ tràn
 * trái khi video hẹp; nút ở gần đáy thì panel tràn xuống dưới.
 *
 * ponytail: không lật panel lên trên nút khi thiếu chỗ — chỉ kẹp để còn lộ ít
 * nhất PANEL_MIN_VISIBLE px, phần còn lại panel tự cuộn (max-height 70vh).
 * Lật lên cần biết chiều cao thật của panel, mà cái đó phụ thuộc nội dung.
 */
export function panelPos(
  btn: { top: number; left: number },
  btnSize: number,
  pad: number,
  view: { width: number; height: number },
): { top: number; left: number } {
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  return {
    top: clamp(btn.top + btnSize + PANEL_GAP, pad, view.height - pad - PANEL_MIN_VISIBLE),
    left: clamp(btn.left + btnSize - PANEL_W, pad, view.width - pad - PANEL_W),
  };
}
