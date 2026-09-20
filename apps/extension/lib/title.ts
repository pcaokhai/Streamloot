/**
 * Làm sạch tiêu đề trang để dùng làm tên file.
 *
 * `document.title` gần như luôn kèm đuôi tên site — "Tên phim | TÊN SITE",
 * "Tên phim - Watch free streaming". Lấy nguyên thì mọi file tải về đều mang
 * tên site, và người dùng phải tự sửa từng cái.
 */

/** Ký tự ngăn cách tiêu đề với tên site mà các site hay dùng. */
const SEP = /\s+[|·–—]\s+|\s+-\s+/;

/**
 * Nhãn thương hiệu suy từ hostname: `www.vi-du.co.uk` -> `vi-du`.
 *
 * Bỏ `www`, bỏ phần đuôi miền. Dùng để nhận ra đoạn nào trong tiêu đề là tên
 * site — so theo hostname chứ KHÔNG theo danh sách site viết cứng, vì danh
 * sách đó vừa không bao giờ đủ vừa là thứ CLAUDE.md §3.1 cấm.
 */
export function brandOf(hostname: string): string {
  const parts = hostname.toLowerCase().replace(/^www\./, '').split('.');
  return parts[0] ?? '';
}

function isSiteTail(part: string, brand: string): boolean {
  if (!brand) return false;
  const p = part.toLowerCase().replace(/[^a-z0-9]/g, '');
  const b = brand.replace(/[^a-z0-9]/g, '');
  if (!p || !b) return false;
  return p.includes(b) || b.includes(p);
}

/**
 * Tên file gợi ý từ tiêu đề trang.
 *
 * Chỉ cắt các đoạn Ở CUỐI mà trông giống tên site. Không cắt bừa đoạn cuối:
 * rất nhiều tiêu đề thật có dấu gạch ngang ("Tập 3 - Phần cuối"), cắt đi là
 * mất thông tin người dùng cần.
 *
 * Cắt hết mà rỗng thì trả lại nguyên bản — thà tên xấu còn hơn tên rỗng.
 */
export function cleanTitle(raw: string, hostname = ''): string {
  const brand = brandOf(hostname);
  const parts = raw.split(SEP).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return raw.trim();

  const kept = [...parts];
  while (kept.length > 1 && isSiteTail(kept[kept.length - 1], brand)) kept.pop();

  const out = kept.join(' - ').trim();
  return out || raw.trim();
}
