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

  const pending = list.some((c) => c.durationSec === undefined);
  const longest = measured.length
    ? measured.reduce((a, b) => (b.durationSec! > a.durationSec! ? b : a))
    : undefined;

  // 3. Chỉ có một cái ngắn ngủn mà những cái khác còn đang đo thì ĐỪNG chọn nó.
  // Đây đúng là chỗ bản trước sai: đo xong mỗi quảng cáo 5 giây, và "cái đo được
  // dài nhất" hoá ra là quảng cáo.
  if (longest && longest.durationSec! < LIKELY_AD_SEC && pending) return undefined;
  if (longest) return longest;

  // 4. Chưa đo xong thì chưa quyết; đo xong mà không ra gì thì đành lấy cái cuối.
  return pending ? undefined : list[list.length - 1];
}
