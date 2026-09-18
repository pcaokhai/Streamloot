/**
 * Đọc danh sách chất lượng của YouTube ngay từ HTML trang.
 *
 * YouTube nhúng sẵn `ytInitialPlayerResponse` vào trang — trong đó có đủ itag,
 * nhãn chất lượng, dung lượng. Đọc nó là tức thì, không request nào cả.
 *
 * CỐ Ý KHÔNG giải chữ ký (`signatureCipher`/`nsig`). Giải được thì mới tải
 * thẳng trong trình duyệt, mà việc đó cần trích hàm giải mã từ player JS của
 * YouTube và hỏng mỗi lần họ xoay player — hàng nghìn dòng phải chạy theo suốt
 * đời. Ta không cần: yt-dlp ở backend đã làm đúng việc đó. Ở đây chỉ lấy đủ để
 * VẼ danh sách cho người dùng chọn, còn tải thì vẫn giao cho backend.
 *
 * Thuần: nhận chuỗi HTML, trả dữ liệu. Không chạm DOM, không chạm mạng.
 */
import type { FormatOption } from './types';

interface RawFormat {
  itag?: number;
  mimeType?: string;
  qualityLabel?: string;
  height?: number;
  contentLength?: string;
  bitrate?: number;
  audioQuality?: string;
}

/** Cắt đúng khối JSON của `ytInitialPlayerResponse` ra khỏi HTML. */
export function extractPlayerResponse(html: string): unknown | null {
  const at = html.indexOf('ytInitialPlayerResponse');
  if (at < 0) return null;
  const open = html.indexOf('{', at);
  if (open < 0) return null;
  // Đếm ngoặc thay vì dùng regex: JSON này chứa cả chuỗi có ngoặc lồng nhau,
  // regex tham lam sẽ nuốt sang tận cuối trang.
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = open; i < html.length; i += 1) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(open, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function extOf(mime: string | undefined): string {
  const m = /^(audio|video)\/([a-z0-9]+)/i.exec(mime ?? '');
  if (!m) return 'mp4';
  return m[2].toLowerCase() === 'webm' ? 'webm' : m[2].toLowerCase();
}

function isAudio(mime: string | undefined): boolean {
  return (mime ?? '').startsWith('audio/');
}

/**
 * Mã format gửi cho yt-dlp.
 *
 * Luồng hình của YouTube là hình KHÔNG TIẾNG (DASH tách hai luồng). Gửi trần
 * itag thì yt-dlp tải đúng luồng đó và người dùng nhận một video câm. Phải ghép
 * `+bestaudio`, kèm `/<itag>` làm đường lùi cho trường hợp không ghép được.
 * Luồng progressive (đã có sẵn tiếng) và luồng chỉ-tiếng thì dùng itag trần.
 */
export function ytFormatId(itag: number, videoOnly: boolean): string {
  return videoOnly ? `${itag}+bestaudio/${itag}` : String(itag);
}

/**
 * Danh sách chất lượng từ `ytInitialPlayerResponse`.
 *
 * Trả `[]` khi không có gì đọc được — người gọi lùi về hỏi backend.
 */
export function formatsFromPlayerResponse(pr: unknown): FormatOption[] {
  const sd = (pr as { streamingData?: { formats?: RawFormat[]; adaptiveFormats?: RawFormat[] } })
    ?.streamingData;
  if (!sd) return [];

  // `formats` là luồng progressive (có sẵn cả tiếng lẫn hình), `adaptiveFormats`
  // là luồng tách. Gộp cả hai rồi để phần dưới tự phân loại.
  const progressive = new Set((sd.formats ?? []).map((f) => f.itag));
  const all = [...(sd.formats ?? []), ...(sd.adaptiveFormats ?? [])];

  const out: FormatOption[] = [];
  const seen = new Set<number>();
  for (const f of all) {
    if (typeof f.itag !== 'number' || seen.has(f.itag)) continue;
    seen.add(f.itag);
    const audio = isAudio(f.mimeType);
    const videoOnly = !audio && !progressive.has(f.itag);
    const size = parseInt(f.contentLength ?? '', 10);
    const h = typeof f.height === 'number' ? f.height : parseInt(f.qualityLabel ?? '', 10);
    out.push({
      format_id: ytFormatId(f.itag, videoOnly),
      ext: audio ? (extOf(f.mimeType) === 'webm' ? 'webm' : 'm4a') : extOf(f.mimeType),
      resolution: audio ? 'audio only' : f.qualityLabel ?? '',
      height: audio ? null : Number.isFinite(h) ? h : null,
      filesize: Number.isFinite(size) ? size : null,
      vcodec: audio ? 'none' : 'avc1',
      acodec: 'mp4a',
      recommended: false,
      url: null,
    });
  }

  // Đánh dấu luồng hình cao nhất. Làm sau khi gom đủ vì phải biết trần là bao nhiêu.
  const best = Math.max(0, ...out.filter((f) => f.vcodec !== 'none').map((f) => f.height ?? 0));
  for (const f of out) {
    if (f.vcodec !== 'none' && f.height === best && best > 0) {
      f.recommended = true;
      break; // chỉ một dòng được khuyên, không phải mọi dòng cùng chiều cao
    }
  }
  return out;
}
