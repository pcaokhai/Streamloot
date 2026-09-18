/**
 * Đọc master playlist HLS ngay trong extension.
 *
 * Vì sao không để backend làm: backend phải spawn yt-dlp (0.38s chỉ để khởi
 * động, chưa kể nó tự tải master rồi tải thêm một biến thể để dò) — tức vài
 * giây trước khi panel hiện được gì. Đọc thẳng master là MỘT request và vài
 * dòng regex. Đây là cách IDM và các extension tải video làm.
 *
 * Thuần và không chạm mạng: nhận chuỗi, trả dữ liệu. Phần `fetch` (cần
 * declarativeNetRequest để đặt Referer) nằm ở background — ở đó không test
 * được, nên phần quyết định phải ra đây (ADR 0006).
 */

export interface Variant {
  url: string;
  width: number | null;
  height: number | null;
  bandwidth: number | null;
  audioOnly: boolean;
}

/** Codec chỉ có tiếng. Dùng để nhận ra luồng audio khi thiếu RESOLUTION. */
const AUDIO_CODECS = new Set(['mp4a', 'ac-3', 'ec-3', 'opus', 'vorbis', 'flac']);
/** Đuôi của segment phụ đề — playlist toàn thứ này KHÔNG phải video. */
const SUBTITLE_EXT = /^(vtt|webvtt|srt|ttml)$/i;

function attrs(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  const body = line.includes(':') ? line.slice(line.indexOf(':') + 1) : '';
  // Giá trị có thể nằm trong nháy kép và chứa dấu phẩy (CODECS="a,b"), nên
  // không tách thô bằng split(',').
  for (const m of body.matchAll(/([A-Z0-9-]+)=("([^"]*)"|[^,]*)/g)) {
    out[m[1]] = m[2].startsWith('"') ? m[3] : m[2];
  }
  return out;
}

function absolute(url: string, base: string): string {
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

/** Có phải master playlist không (master liệt kê biến thể, không có segment). */
export function isMaster(text: string): boolean {
  return /^#EXT-X-STREAM-INF:/m.test(text);
}

/**
 * Playlist mà MỌI segment đều là phụ đề.
 *
 * Trang thật phục vụ phụ đề bằng chính định dạng HLS, nên nếu chỉ nhìn đuôi
 * `.m3u8` thì ta sẽ mời người dùng tải một tệp .vtt và gọi nó là video.
 */
export function isSubtitlePlaylist(text: string): boolean {
  const segs = segmentUris(text);
  if (!segs.length) return false;
  return segs.every((u) => SUBTITLE_EXT.test(u.split(/[?#]/)[0].split('.').pop() ?? ''));
}

/**
 * Luồng trực tiếp: không có #EXT-X-ENDLIST.
 *
 * Quan trọng vì tải một luồng live là tải mãi không dừng — người dùng phải
 * biết trước, chứ không phải phát hiện khi ổ đĩa đầy.
 */
export function isLive(text: string): boolean {
  return !isMaster(text) && segmentUris(text).length > 0 && !/^#EXT-X-ENDLIST/m.test(text);
}

function segmentUris(text: string): string[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const out: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].startsWith('#EXTINF')) continue;
    const next = lines.slice(i + 1).find((l) => l && !l.startsWith('#'));
    if (next) out.push(next);
  }
  return out;
}

/** Tổng thời lượng (giây) của media playlist; `null` khi không đo được. */
export function totalDuration(text: string): number | null {
  const nums = [...text.matchAll(/#EXTINF:\s*([\d.]+)/gi)].map((m) => parseFloat(m[1]));
  if (!nums.length || nums.some((n) => !Number.isFinite(n))) return null;
  const sum = nums.reduce((a, b) => a + b, 0);
  return sum > 0 ? sum : null;
}

/** Các biến thể trong master playlist. Rỗng khi không phải master. */
export function parseMaster(text: string, baseUrl: string): Variant[] {
  if (!isMaster(text)) return [];
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const out: Variant[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;
    const target = lines.slice(i + 1).find((l) => l && !l.startsWith('#'));
    if (!target) continue;
    const a = attrs(lines[i]);
    let width: number | null = null;
    let height: number | null = null;
    const res = /^(\d+)x(\d+)$/i.exec(a.RESOLUTION ?? '');
    if (res) {
      width = parseInt(res[1], 10);
      height = parseInt(res[2], 10);
    }
    const codecs = (a.CODECS ?? '').split(',').map((c) => c.trim().split('.')[0]).filter(Boolean);
    const bw = parseInt(a.BANDWIDTH ?? '', 10);
    out.push({
      url: absolute(target, baseUrl),
      width,
      height,
      bandwidth: Number.isFinite(bw) ? bw : null,
      // Chỉ kết luận "audio" khi KHÔNG có RESOLUTION và mọi codec đều là tiếng.
      // Thiếu cả hai tín hiệu thì coi là video: đoán nhầm thành audio sẽ giấu
      // mất một lựa chọn hình, còn đoán nhầm thành video chỉ là nhãn hơi sai.
      audioOnly: height === null && codecs.length > 0 && codecs.every((c) => AUDIO_CODECS.has(c)),
    });
  }
  return out;
}

/** Tên cấp chất lượng suy từ bandwidth khi master thiếu RESOLUTION. */
function heightFromBandwidth(bw: number | null): number | null {
  if (!bw) return null;
  if (bw >= 6_000_000) return 1080;
  if (bw >= 3_000_000) return 720;
  if (bw >= 1_200_000) return 480;
  return 360;
}

/**
 * Đổi biến thể sang đúng hình dạng `FormatOption` mà backend trả, để panel
 * không phải biết danh sách đến từ đâu.
 *
 * Trường `url` là điểm khác duy nhất: bấm dòng nào thì gửi URL biến thể đó làm
 * `m3u8_url`, không dùng `format_id` — `hls-<bandwidth>` của yt-dlp không ổn
 * định giữa các lần chạy.
 */
export function variantsToFormats(variants: Variant[]): import('./types').FormatOption[] {
  const videos = variants.filter((v) => !v.audioOnly);
  const best = Math.max(0, ...videos.map((v) => v.height ?? heightFromBandwidth(v.bandwidth) ?? 0));
  return variants.map((v) => {
    const h = v.audioOnly ? null : v.height ?? heightFromBandwidth(v.bandwidth);
    return {
      format_id: v.bandwidth ? `hls-${v.bandwidth}` : 'hls',
      ext: v.audioOnly ? 'm4a' : 'mp4',
      resolution: v.width && v.height ? `${v.width}x${v.height}` : v.audioOnly ? 'audio only' : '',
      height: h,
      filesize: null,
      vcodec: v.audioOnly ? 'none' : 'avc1',
      acodec: 'mp4a',
      recommended: !v.audioOnly && h !== null && h === best && best > 0,
      url: v.url,
    };
  });
}

/**
 * Một dòng duy nhất cho media playlist (không có biến thể để chọn).
 *
 * Vẫn hơn là lùi về backend: backend chỉ trả đúng một lựa chọn cho cùng luồng
 * này, mà lại bắt người dùng đợi yt-dlp — và nếu app chưa chạy thì không có gì
 * để hiện cả. Thời lượng đọc ngay từ playlist nên nhãn vẫn nói được điều có ích.
 */
export function singleFormat(url: string, durationSec: number | null): import('./types').FormatOption {
  return {
    format_id: '',
    ext: 'mp4',
    resolution: durationSec ? `${Math.round(durationSec / 60)} phút` : '',
    height: null,
    filesize: null,
    vcodec: 'avc1',
    acodec: 'mp4a',
    recommended: true,
    url,
  };
}
