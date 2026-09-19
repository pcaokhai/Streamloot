/**
 * Quyết định cho việc quan sát response của trang.
 *
 * Vì sao cần: Facebook nạp comment SAU khi trang tải, qua GraphQL. Dữ liệu đó
 * không bao giờ vào DOM, nên quét `innerHTML` không thấy video trong comment —
 * người dùng phải bấm mở từng cái. Đọc bản sao response lúc nó về thì thấy sớm.
 *
 * Ta chỉ QUAN SÁT thứ trang đã tự yêu cầu. Không tự gọi API của site.
 *
 * Phần thuần nằm ở đây; phần bọc `fetch` phải chạy ở world MAIN nên không test
 * được (ADR 0006).
 */

/** Dấu hiệu response CÓ THỂ chứa video. Rẻ, chạy trên chuỗi chưa phân tích. */
const MARKERS = ['dash_manifests', 'progressive_url', 'playable_url'];

/**
 * Có đáng đọc body của response này không.
 *
 * Đọc body là tốn: `clone().text()` trên mọi response sẽ nhân đôi lưu lượng bộ
 * nhớ của cả trang. Lọc trước bằng hai thứ rẻ — kiểu nội dung và kích thước.
 */
export function worthReading(o: {
  contentType?: string | null;
  contentLength?: number | null;
}): boolean {
  const ct = (o.contentType ?? '').toLowerCase();
  if (!ct.includes('json') && !ct.includes('javascript') && ct !== '') return false;
  const len = o.contentLength;
  // Response khổng lồ gần như chắc chắn là media chứ không phải metadata.
  if (typeof len === 'number' && len > MAX_BODY_BYTES) return false;
  return true;
}

/** Trần kích thước body chịu đọc, byte. */
export const MAX_BODY_BYTES = 4 * 1024 * 1024;

/** Body này có dấu hiệu chứa video không. Gọi TRƯỚC khi phân tích tốn kém. */
export function looksRelevant(body: string): boolean {
  return MARKERS.some((m) => body.includes(m));
}

export interface HasId {
  id: string;
}

/**
 * Gộp video mới vào danh sách đã có, theo `id`.
 *
 * Giữ bản CŨ khi trùng: bản đầu tiên thấy được thường là bản đầy đủ nhất (nó
 * kèm cả progressive lẫn DASH), còn các lần sau hay là bản rút gọn. Ghi đè bằng
 * bản rút gọn là tự làm mất đường tải đã có.
 *
 * Có trần: một phiên cuộn feed dài có thể sinh hàng trăm video, mà panel không
 * hiện nổi ngần ấy và service worker thì bị thu hồi bất cứ lúc nào.
 */
export function mergeVideos<T extends HasId>(existing: T[], incoming: T[], max = MAX_VIDEOS): T[] {
  const seen = new Set(existing.map((v) => v.id));
  const out = existing.slice();
  for (const v of incoming) {
    if (!v.id || seen.has(v.id)) continue;
    seen.add(v.id);
    out.push(v);
  }
  // Quá trần thì bỏ cái CŨ nhất: người dùng quan tâm phần vừa cuộn tới.
  return out.length > max ? out.slice(out.length - max) : out;
}

/** Số video giữ lại nhiều nhất cho một tab. */
export const MAX_VIDEOS = 60;
