/**
 * Tìm URL riêng của một video trong trang nhiều video (feed).
 *
 * Trên feed, `location.href` chỉ là trang chủ — gửi nó cho backend thì yt-dlp
 * báo "Unsupported URL" hoặc tải nhầm video đầu tiên nó thấy. Video nào cũng
 * có sẵn một đường dẫn riêng ngay cạnh nó trong DOM; lấy đường dẫn đó.
 *
 * Không nhận diện theo tên site hay theo dạng đường dẫn của từng site (thứ
 * CLAUDE.md §3.1 cấm): chỉ so ĐỘ SÂU đường dẫn. Trang riêng của một video bao
 * giờ cũng sâu hơn trang feed chứa nó.
 */

function depth(u: URL): number {
  return u.pathname.split('/').filter(Boolean).length;
}

/**
 * Chọn link sâu nhất, cùng origin, sâu hơn trang hiện tại.
 *
 * Trả `null` khi trang hiện tại ĐÃ là trang riêng của video — lúc đó
 * `location.href` mới là thứ đúng, đổi đi là tải nhầm.
 */
export function deeperPermalink(pageUrl: string, hrefs: readonly string[]): string | null {
  let here: URL;
  try {
    here = new URL(pageUrl);
  } catch {
    return null;
  }

  let best: URL | null = null;
  for (const href of hrefs) {
    let u: URL;
    try {
      u = new URL(href, pageUrl);
    } catch {
      continue;
    }
    if (u.origin !== here.origin) continue;
    if (depth(u) <= depth(here)) continue;
    if (!best || depth(u) > depth(best)) best = u;
  }
  // Bỏ query/hash: chúng thường là tham số theo dõi, làm hai lượt tải cùng một
  // video trông như hai video khác nhau.
  return best ? `${best.origin}${best.pathname}` : null;
}
