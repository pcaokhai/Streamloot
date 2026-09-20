/**
 * Gom ảnh của một bài nhiều ảnh (carousel) thành danh sách tải được.
 *
 * yt-dlp không giúp được ở đây: extractor Instagram bỏ qua hẳn node không phải
 * video (`if not is_video: continue`). Nhưng ảnh lại dễ hơn video nhiều — JPEG
 * hoàn chỉnh, không chia mảnh, không phải ghép tiếng — nên trình duyệt tải
 * thẳng được, không cần app chạy.
 *
 * Thuần, không chạm DOM: phần lướt carousel và đọc `<img>` nằm ở content
 * script (không test được), phần quyết định nằm ở đây (ADR 0006).
 */

/** Ảnh nhỏ hơn mức này là avatar, icon, emoji — không phải nội dung bài. */
export const MIN_PHOTO_PX = 200;

export interface PhotoEl {
  src: string;
  /** `srcset` nếu có: nơi duy nhất biết được bản to nhất máy chủ có. */
  srcset?: string | null;
  width: number;
  height: number;
}

/**
 * Bản to nhất trong `srcset`, lùi về `src` khi không có.
 *
 * Trang thường đặt `src` là bản vừa màn hình chứ không phải bản gốc. Tải theo
 * `src` là người dùng nhận ảnh bé hơn ảnh họ đang nhìn trên màn Retina.
 */
export function bestSrc(el: { src: string; srcset?: string | null }): string {
  let best = el.src;
  let bestW = -1;
  for (const part of (el.srcset ?? '').split(',')) {
    const [url, size] = part.trim().split(/\s+/);
    if (!url) continue;
    const w = size?.endsWith('w') ? parseInt(size, 10) : NaN;
    // Mục không khai bề rộng (`2x`) không so được, nhưng vẫn hơn không có gì.
    const score = Number.isFinite(w) ? w : 0;
    if (score > bestW) {
      bestW = score;
      best = url;
    }
  }
  return best;
}

/**
 * Khoá nhận dạng một tấm ảnh, bỏ qua kích cỡ và tham số.
 *
 * Cùng một tấm được phục vụ ở nhiều cỡ với query khác nhau; lấy đường dẫn làm
 * khoá thì lướt qua lướt lại carousel cũng không sinh ảnh trùng.
 */
export function photoKey(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url.split('?')[0];
  }
}

/**
 * Lọc và gộp ảnh thu được sau nhiều lượt lướt.
 *
 * Giữ THỨ TỰ gặp: đó là thứ tự slide, và người dùng đánh số file theo nó.
 */
export function collectPhotos(els: readonly PhotoEl[], minPx = MIN_PHOTO_PX): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const el of els) {
    if (el.width < minPx || el.height < minPx) continue;
    const url = bestSrc(el);
    if (!url || url.startsWith('data:')) continue;
    const key = photoKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}

/** Đuôi ảnh suy từ đường dẫn. Lạ thì trả `jpg` — thà đúng gần hết còn hơn bịa. */
const PHOTO_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'gif']);

export function photoExt(url: string): string {
  const last = photoKey(url).split('/').filter(Boolean).pop() ?? '';
  const ext = last.slice(last.lastIndexOf('.') + 1).toLowerCase();
  return PHOTO_EXT.has(ext) ? ext : 'jpg';
}

/**
 * Số thứ tự đệm 0 theo tổng số ảnh, để trình quản lý file sắp đúng thứ tự.
 *
 * Không đệm thì 10 đứng trước 2 — với bài 12 ảnh là thứ tự sai hoàn toàn.
 */
export function photoIndex(i: number, total: number): string {
  return String(i + 1).padStart(String(Math.max(total, 1)).length, '0');
}
