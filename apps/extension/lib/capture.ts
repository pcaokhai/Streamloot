/**
 * Quyết định: request nào đáng bắt làm ứng viên tải.
 *
 * Trước đây chỉ bắt `.m3u8`/`.mpd`. Đo 20/09 trên một site phát video: nó dùng
 * **MP4 progressive**, nên extension mù hoàn toàn — và mọi site phát MP4 trực
 * tiếp cũng vậy. Đây là lỗ hổng chung, không riêng site nào.
 *
 * Nhưng mở ra cho MP4 thì quảng cáo cũng lọt: cùng phép đo thấy 4 file MP4
 * quảng cáo, 1.7–2.4 MB, từ CDN quảng cáo. Nên phải có ngưỡng.
 */

/** Manifest: bắt theo đuôi URL. */
const MANIFEST_URL = /\.(m3u8|mpd)(\?|$)/i;
/** Manifest: bắt theo kiểu nội dung, cho URL không lộ đuôi. */
const MANIFEST_TYPE = /(mpegurl|dash\+xml)/i;
/** File hoàn chỉnh tải thẳng được. */
const PROGRESSIVE_URL = /\.(mp4|m4v|webm|mov)(\?|$)/i;
const PROGRESSIVE_TYPE = /^video\/(mp4|webm|quicktime|x-m4v)/i;

/**
 * MẢNH của luồng HLS/DASH — KHÔNG phải file tải được.
 *
 * Chúng cũng mang `video/mp4`, và bắt nhầm một mảnh là đưa người dùng vài giây
 * video rồi bảo đó là cả phim.
 */
const SEGMENT_URL = /\.(ts|m4s)(\?|$)/i;

/**
 * Ngưỡng dưới cho MP4 progressive, byte.
 *
 * Đo thật: quảng cáo trên trang đó nằm trong khoảng 1.7–2.4 MB. Đặt 5 MB để
 * loại chúng mà vẫn nhận được clip ngắn thật.
 *
 * Đánh đổi có ý thức: video thật ngắn hơn 5 MB sẽ bị bỏ. Chấp nhận, vì hiện
 * thừa quảng cáo trong danh sách tải còn tệ hơn — người dùng bấm vào rồi mới
 * biết, sau khi đã tải xong.
 */
export const MIN_PROGRESSIVE_BYTES = 5 * 1024 * 1024;

export type MediaKind = 'manifest' | 'progressive' | null;

/** Loại media của một request, hoặc `null` nếu không phải media tải được. */
export function mediaKind(url: string, contentType?: string | null): MediaKind {
  if (SEGMENT_URL.test(url)) return null;
  if (MANIFEST_URL.test(url)) return 'manifest';
  if (contentType && MANIFEST_TYPE.test(contentType)) return 'manifest';
  if (PROGRESSIVE_URL.test(url)) return 'progressive';
  if (contentType && PROGRESSIVE_TYPE.test(contentType)) return 'progressive';
  return null;
}

/**
 * Có bắt request này không.
 *
 * Manifest thì bắt ngay — nó chỉ là một file text nhỏ, và chính nó mới nói cho
 * ta biết video dài bao nhiêu. Progressive thì phải đủ lớn (xem ngưỡng).
 * Không biết kích thước thì BẮT: máy chủ có thể không khai `Content-Length`
 * khi dùng chunked, mà bỏ qua video thật vì thiếu một header là tệ hơn.
 */
export function worthCapturing(o: { kind: MediaKind; contentLength?: number | null }): boolean {
  if (o.kind === 'manifest') return true;
  if (o.kind !== 'progressive') return false;
  const n = o.contentLength;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return true;
  return n >= MIN_PROGRESSIVE_BYTES;
}

/** Đọc `Content-Length` từ danh sách header của webRequest. `null` khi không có. */
export function contentLengthOf(
  headers?: { name: string; value?: string }[] | null,
): number | null {
  const h = headers?.find((x) => x.name.toLowerCase() === 'content-length');
  const n = h?.value ? parseInt(h.value, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Đọc `Content-Type`. `null` khi không có. */
export function contentTypeOf(
  headers?: { name: string; value?: string }[] | null,
): string | null {
  return headers?.find((x) => x.name.toLowerCase() === 'content-type')?.value ?? null;
}
