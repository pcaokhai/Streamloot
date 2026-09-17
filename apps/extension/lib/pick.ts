/**
 * Chọn stream nào để tải trong số các manifest bắt được.
 *
 * Tách khỏi panel để chạy thử được: đây là chỗ đã chọn nhầm quảng cáo hai lần,
 * và đọc code không đủ để biết nó đúng — phải cho nó ăn dữ liệu thật.
 */
import type { Capture } from './types';

/** Dưới ngưỡng này gần như chắc chắn là quảng cáo chứ không phải phim. */
export const LIKELY_AD_SEC = 120;

export interface PickContext {
  /** Hostname của trang đang mở. */
  pageHost: string;
  /** Thời lượng thẻ <video> của trang, nếu đọc được. */
  pageDurationSec?: number | null;
  /** URL người dùng tự chọn. */
  chosenUrl?: string | null;
}

const hostOf = (u?: string): string | null => {
  if (!u) return null;
  try {
    return new URL(u).hostname;
  } catch {
    return null;
  }
};

export function pickCapture(all: Capture[], ctx: PickContext): Capture | undefined {
  if (!all.length) return undefined;

  if (ctx.chosenUrl) {
    const manual = all.find((c) => c.url === ctx.chosenUrl);
    if (manual) return manual; // người dùng đã chọn thì tôn trọng
  }

  // 1. Lọc theo Referer — tín hiệu có NGAY, không phải chờ đo.
  // Manifest của phim do chính trang này yêu cầu nên Referer là trang đang mở;
  // quảng cáo nạp từ iframe của mạng quảng cáo nên Referer là tên miền khác.
  // Chỉ thu hẹp khi còn chừa lại ứng viên: trang không đặt Referer thì đi tiếp
  // bằng thời lượng như cũ.
  const ours = all.filter(
    (c) => hostOf(c.referer) === ctx.pageHost || hostOf(c.origin) === ctx.pageHost,
  );
  const list = ours.length ? ours : all;

  const measured = list.filter((c) => typeof c.durationSec === 'number' && c.durationSec > 0);

  // 2. Khớp thời lượng với thẻ <video> của trang — chắc ăn nhất khi có.
  const pd = ctx.pageDurationSec;
  if (pd && pd > 0) {
    const close = measured.filter((c) => Math.abs(c.durationSec! - pd) <= pd * 0.1);
    if (close.length) return close.reduce((a, b) => (b.durationSec! > a.durationSec! ? b : a));
  }

  const unmeasured = list.filter((c) => c.durationSec === undefined);
  const longest = measured.length
    ? measured.reduce((a, b) => (b.durationSec! > a.durationSec! ? b : a))
    : undefined;

  // 3. Đo được cái nào đủ dài thì lấy cái dài nhất.
  if (longest && longest.durationSec! >= LIKELY_AD_SEC) return longest;

  // 4. Thứ đo được chỉ toàn ngắn ngủn (gần như chắc là quảng cáo): thà lấy một
  // ứng viên CHƯA đo còn hơn lấy thứ đã biết là quảng cáo.
  if (unmeasured.length) return unmeasured[unmeasured.length - 1];

  // 5. Không bao giờ trả về "chưa chọn" khi danh sách còn ứng viên.
  //
  // Bản trước đợi đo xong mới quyết, và khi phép đo không bao giờ về thì panel
  // treo ở "Đang xác định stream…" vĩnh viễn — đổi một lỗi chọn sai lấy một lỗi
  // treo, tệ hơn. Lọc Referer ở bước 1 đã loại quảng cáo rồi, nên đoán ở đây là
  // đoán trong nhóm đã sạch; người dùng vẫn đổi tay được.
  return longest ?? list[list.length - 1];
}
