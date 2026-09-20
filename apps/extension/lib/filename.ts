/**
 * Dựng tên file an toàn cho lượt tải thẳng trong trình duyệt.
 *
 * `chrome.downloads.download` TỪ CHỐI cả lượt tải nếu `filename` chứa ký tự
 * cấm, đường dẫn tuyệt đối, hay `..` — hỏng lặng lẽ và người dùng chỉ thấy
 * "không tải được". Nên phần dựng tên là quyết định, phải test được.
 */

/** Ký tự không được có trong tên file trên Windows/macOS, cộng ký tự điều khiển. */
const UNSAFE = /[\\/:*?"<>|\u0000-\u001f]/g;

/**
 * Thư mục gốc cho mọi lượt tải của extension, nằm trong thư mục tải của trình
 * duyệt.
 *
 * `chrome.downloads` lấy `~/Downloads` làm gốc, nên `folder` trần sẽ đẻ thẳng
 * `~/Downloads/instagram`, `~/Downloads/facebook`… lẫn vào thư mục cá nhân của
 * người dùng. Đặt gốc ở ĐÂY chứ không ở chỗ gọi: chỗ gọi quên một lần là lại
 * rải thư mục ra `~/Downloads`.
 */
export const DOWNLOAD_ROOT = 'downloader';

/** Tên dài quá thì một số hệ tệp từ chối; chừa chỗ cho đuôi và hậu tố. */
const MAX_BASE = 120;

export function sanitize(name: string): string {
  return name
    .replace(UNSAFE, '_')
    .replace(/\s+/g, ' ')
    // Dấu chấm ở cuối bị Windows cắt bỏ, tạo ra tên trùng nhau một cách bất ngờ.
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, MAX_BASE);
}

/**
 * Tên file cho một video tải thẳng.
 *
 * `title` rỗng hoặc toàn ký tự cấm thì lùi về `id` — KHÔNG trả tên rỗng, vì
 * `downloads.download` sẽ từ chối và ta mất cả lượt tải.
 */
export function downloadName(o: {
  title?: string | null;
  id: string;
  quality?: string | null;
  ext?: string | null;
  folder?: string | null;
}): string {
  const base = sanitize(o.title ?? '') || sanitize(o.id) || 'video';
  const q = sanitize(o.quality ?? '');
  const ext = (o.ext ?? 'mp4').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'mp4';
  const name = q ? `${base} (${q}).${ext}` : `${base}.${ext}`;
  // Thư mục theo site, cùng quy ước với bên app; sanitize trước vì `sanitize`
  // biến `/` thành `_`, nên mọi dấu `/` còn lại đều là dấu ngăn thư mục do
  // chính ta đặt — không có đường nào để tên file tự tạo thư mục con.
  const dir = [DOWNLOAD_ROOT, sanitize(o.folder ?? '')].filter(Boolean).join('/');
  return `${dir}/${name}`;
}
