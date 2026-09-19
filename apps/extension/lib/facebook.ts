/**
 * Bóc video Facebook ra khỏi HTML trang.
 *
 * Facebook KHÔNG phục vụ manifest qua URL riêng — mọi thứ nằm trong payload
 * JSON nhúng sẵn trong trang. Bộ bắt theo URL của extension vì thế không thấy
 * gì, và đó là lý do Facebook chưa tải được.
 *
 * Đo trên trang thật (19/09): một trang permalink chứa 7–12 video trong khi chỉ
 * có 3 thẻ `<video>` — payload mang sẵn cả video trong comment và video chưa
 * cuộn tới. Nên bóc từ HTML cho ra NHIỀU hơn là dò DOM.
 *
 * Mỗi video mang ba đường tải, xếp theo thứ tự nên dùng:
 *  1. `progressive` — MP4 đã gộp sẵn tiếng. Một URL, tải thẳng, không phải ghép.
 *  2. `manifestXml` — DASH, chất lượng cao hơn nhưng tách hình/tiếng nên phải ghép.
 *  3. `permalinkUrl` / `id` — để backend nhờ yt-dlp lo.
 *
 * Thuần: nhận chuỗi HTML, trả dữ liệu. Không chạm DOM, không chạm mạng.
 */

export interface FbProgressive {
  /** 'HD' | 'SD' theo cách Facebook đặt tên. */
  quality: string;
  url: string;
}

export interface FbVideo {
  id: string;
  progressive: FbProgressive[];
  manifestXml: string | null;
  permalinkUrl: string | null;
  lengthSec: number | null;
  isLive: boolean;
}

/**
 * Bao xa thì còn coi là "cùng một video".
 *
 * `permalink_url` và `length_in_second` nằm ở object CHA, không nằm cùng object
 * với `dash_manifests`. Đo thật: object video ~16KB và các trường cha nằm trong
 * khoảng 4KB trước đó. Đây là suy đoán theo khoảng cách, không phải quan hệ
 * chắc chắn — nên khi không thấy thì trả `null` chứ không lấy bừa của video
 * khác. Thà thiếu một đường dự phòng còn hơn gán nhầm permalink.
 */
const PARENT_WINDOW = 6000;

/** Tìm object JSON bao quanh vị trí `at`. `null` nếu không dựng lại được. */
function enclosingObject(text: string, at: number): string | null {
  let depth = 0;
  let start = -1;
  for (let i = at; i >= 0; i -= 1) {
    const c = text[i];
    if (c === '}') depth += 1;
    else if (c === '{') {
      if (depth === 0) {
        start = i;
        break;
      }
      depth -= 1;
    }
  }
  if (start < 0) return null;

  let d = 0;
  let inStr = false;
  let esc = false;
  for (let j = start; j < text.length; j += 1) {
    const c = text[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') d += 1;
    else if (c === '}') {
      d -= 1;
      if (d === 0) return text.slice(start, j + 1);
    }
  }
  return null;
}

/** Giá trị chuỗi của một khoá JSON trong đoạn văn bản, hoặc `null`. */
function nearestString(text: string, key: string): string | null {
  const m = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, 'g');
  let last: string | null = null;
  let hit: RegExpExecArray | null;
  // Lấy cái GẦN NHẤT phía trước, nên duyệt hết rồi giữ cái cuối.
  while ((hit = m.exec(text)) !== null) last = hit[1];
  if (last === null) return null;
  try {
    return JSON.parse(`"${last}"`) as string;
  } catch {
    return null;
  }
}

function nearestNumber(text: string, key: string): number | null {
  const m = new RegExp(`"${key}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, 'g');
  let last: string | null = null;
  let hit: RegExpExecArray | null;
  while ((hit = m.exec(text)) !== null) last = hit[1];
  if (last === null) return null;
  const n = parseFloat(last);
  return Number.isFinite(n) ? n : null;
}

interface RawDelivery {
  id?: string;
  progressive_urls?: { progressive_url?: string | null; metadata?: { quality?: string } }[];
  dash_manifests?: { manifest_xml?: string | null }[];
}

/**
 * Mọi video tìm được trong HTML, theo thứ tự xuất hiện.
 *
 * Bỏ qua video trực tiếp: tải một luồng đang phát là tải mãi không dừng, và
 * người dùng phải biết trước chứ không phải phát hiện khi ổ đĩa đầy.
 */
export function extractVideos(html: string): FbVideo[] {
  const out: FbVideo[] = [];
  const seen = new Set<string>();
  const anchor = /"dash_manifests"\s*:/g;
  let m: RegExpExecArray | null;

  while ((m = anchor.exec(html)) !== null) {
    const blob = enclosingObject(html, m.index);
    if (!blob) continue;
    let o: RawDelivery;
    try {
      o = JSON.parse(blob) as RawDelivery;
    } catch {
      continue; // một video hỏng không được làm hỏng cả trang
    }

    const id = typeof o.id === 'string' ? o.id : '';
    if (!id || seen.has(id)) continue;

    const progressive: FbProgressive[] = [];
    for (const p of o.progressive_urls ?? []) {
      const url = p?.progressive_url;
      if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
        progressive.push({ quality: p?.metadata?.quality ?? '', url });
      }
    }

    let manifestXml: string | null = null;
    for (const d of o.dash_manifests ?? []) {
      const xml = d?.manifest_xml;
      if (typeof xml === 'string' && xml.includes('<MPD')) {
        manifestXml = xml;
        break;
      }
    }

    if (!progressive.length && !manifestXml) continue; // không có đường nào

    const before = html.slice(Math.max(0, m.index - PARENT_WINDOW), m.index);
    if (nearestString(before, 'is_live_streaming') === 'true' ||
        /"is_live_streaming"\s*:\s*true/.test(before)) {
      continue;
    }

    seen.add(id);
    out.push({
      id,
      progressive,
      manifestXml,
      permalinkUrl: nearestString(before, 'permalink_url'),
      lengthSec: nearestNumber(before, 'length_in_second'),
      isLive: false,
    });
  }
  return out;
}

/**
 * URL xem video, dựng từ id khi không tìm được `permalink_url`.
 *
 * Dùng cho đường dự phòng: yt-dlp nhận được dạng này. Không đoán đường dẫn
 * nhóm hay trang — chỉ dạng chuẩn theo id.
 */
export function watchUrl(id: string): string | null {
  return /^\d+$/.test(id) ? `https://www.facebook.com/watch/?v=${id}` : null;
}
