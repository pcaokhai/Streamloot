/**
 * Biến danh sách format thô của yt-dlp thành các dòng bấm được.
 *
 * Tách khỏi panel vì đây là quyết định (nhóm nào, sắp thế nào, nhãn ra sao) chứ
 * không phải nét vẽ — và quyết định thì chạy thử được bằng node, còn DOM thì
 * không (ADR 0006).
 */
import type { FormatOption } from './types';

export interface FormatRow {
  formatId: string;
  /** Dòng chính: "720p" */
  label: string;
  /** Dòng phụ: "mp4 · 12.3 MB" */
  detail: string;
  recommended: boolean;
  /** Tên cấp chất lượng kiểu Cốc Cốc: "HD", "Standard"… — cột 1 của panel. */
  name: string;
  /** Đuôi file: "mp4" — cột 3 của panel. */
  ext: string;
  /** URL biến thể HLS nếu có (đường manifest nhanh); null thì tải theo formatId. */
  url: string | null;
  /**
   * Tải THẲNG bằng trình duyệt, không qua backend (ADR 0007 D2).
   *
   * Chỉ đặt khi URL là một file hoàn chỉnh đã có sẵn tiếng. Có trường này thì
   * panel bỏ qua backend hoàn toàn — chạy được cả khi app chưa mở.
   */
  directUrl?: string;
  /** Tên file khi tải thẳng. Bắt buộc đi kèm `directUrl`. */
  fileName?: string;
  /**
   * URL xem của CHÍNH video này, cho đường lùi nhờ yt-dlp.
   *
   * Khác `location.href`: trang feed có nhiều video, mỗi cái một permalink
   * riêng. Gửi URL trang thì backend tải nhầm video đầu tiên nó thấy.
   */
  pageUrl?: string;
  /**
   * Nguyên văn MPD, cho mức chất lượng chỉ có trong manifest DASH.
   *
   * Đường này PHẢI qua backend: DASH tách hình khỏi tiếng nên cần ghép, mà ghép
   * trong trình duyệt thì phải nhúng ffmpeg-wasm — cái giá ADR 0007 D3 đã từ chối.
   */
  manifestXml?: string;
}

/**
 * Mức chất lượng của một format: CẠNH NGẮN, không phải chiều cao.
 *
 * Video dọc (reel, short) là 1080x1920. Lấy chiều cao thì nó thành "2K" trong
 * khi người dùng và mọi công cụ khác gọi nó là 1080p. Cạnh ngắn đúng cho cả
 * video ngang lẫn dọc.
 */
export function qualityHeight(f: { height?: number | null; width?: number | null }): number | null {
  const h = typeof f.height === 'number' && f.height > 0 ? f.height : null;
  const w = typeof f.width === 'number' && f.width > 0 ? f.width : null;
  if (h && w) return Math.min(h, w);
  return h;
}

/** Tên cho format không khai độ phân giải — không bịa mức, cũng không bỏ trống. */
const UNKNOWN_NAME = 'Tiêu chuẩn';

/**
 * Tên cấp chất lượng theo chiều cao, cùng thang với IDM/Cốc Cốc để người dùng
 * quen tay không phải học lại. Không rõ chiều cao thì trả rỗng — panel sẽ chỉ
 * hiện độ phân giải, không bịa tên.
 */
export function qualityName(height: number | null | undefined): string {
  if (typeof height !== 'number' || height <= 0) return '';
  if (height >= 2160) return '4K';
  if (height >= 1440) return '2K';
  if (height >= 1080) return 'Full HD';
  if (height >= 720) return 'HD';
  if (height >= 480) return 'Standard';
  if (height >= 360) return 'Medium';
  return 'Low';
}

/**
 * Dung lượng cho người đọc. Rỗng khi không biết.
 *
 * HLS thường không biết trước dung lượng, nên "không biết" là ca THƯỜNG chứ
 * không phải ngoại lệ — trả rỗng để panel bỏ hẳn phần đó thay vì hiện "0 B".
 */
export function humanSize(bytes: number | null): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return i === 0 ? `${Math.round(v)} ${units[i]}` : `${v.toFixed(1)} ${units[i]}`;
}

function labelFor(f: FormatOption): string {
  const h = qualityHeight(f);
  if (h) return `${h}p`;
  return f.resolution ?? '';
}

function rowFor(f: FormatOption): FormatRow {
  const size = humanSize(f.filesize);
  return {
    formatId: f.format_id,
    label: labelFor(f),
    detail: size ? `${f.ext} · ${size}` : f.ext,
    recommended: f.recommended,
    name: f.vcodec === 'none' ? 'Audio' : qualityName(qualityHeight(f)) || UNKNOWN_NAME,
    ext: f.ext,
    url: f.url ?? null,
  };
}

/**
 * Tách VIDEO và ÂM THANH bằng `vcodec`, KHÔNG bằng `height`.
 *
 * yt-dlp đặt `vcodec: 'none'` cho luồng chỉ có tiếng — đó là tín hiệu tường
 * minh. Đoán theo `height` sẽ xếp nhầm mọi luồng hình mà yt-dlp không biết chiều
 * cao (HLS hay thiếu) vào nhóm âm thanh.
 *
 * Video sắp từ cao xuống thấp vì người dùng gần như luôn tìm chất lượng cao
 * nhất trước.
 */
/**
 * Gộp các dòng cùng một mức chất lượng.
 *
 * yt-dlp trả nhiều biến thể cùng chiều cao — khác container (mp4/webm), khác
 * codec (avc1/vp9/av01), khác fps, khác bitrate. Hiện hết ra thì thành 6–8 dòng
 * mà người dùng không có cơ sở nào để chọn giữa chúng.
 *
 * Gộp theo CHIỀU CAO, không theo (chiều cao, đuôi). Bản đầu gộp theo cả đuôi vì
 * tôi cho rằng "người dùng phân biệt được mp4 với webm" — thử tay cho thấy sai:
 * hai dòng "Full HD 1080p" cạnh nhau vẫn bị đọc là trùng lặp. Với người tải
 * video thì mức chất lượng mới là thứ cần chọn, còn container là chi tiết kỹ
 * thuật.
 *
 * Ưu tiên: mp4 trước (mở được ở mọi nơi), rồi tới bản nặng hơn — cùng độ phân
 * giải thì nặng hơn nghĩa là bitrate cao hơn, tức nét hơn.
 */
function sizeOf(r: FormatRow): number {
  const m = /([\d.]+)\s*(B|KB|MB|GB|TB)/.exec(r.detail);
  if (!m) return -1;
  const unit = { B: 0, KB: 1, MB: 2, GB: 3, TB: 4 }[m[2]] ?? 0;
  return parseFloat(m[1]) * 1024 ** unit;
}

/** Bản nào đáng giữ hơn giữa hai dòng cùng mức chất lượng. */
function better(a: FormatRow, b: FormatRow): FormatRow {
  const mp4 = (r: FormatRow) => (r.ext === 'mp4' ? 1 : 0);
  if (mp4(a) !== mp4(b)) return mp4(a) > mp4(b) ? a : b;
  return sizeOf(a) >= sizeOf(b) ? a : b;
}

function dedupeRows(rows: FormatRow[]): FormatRow[] {
  const best = new Map<string, FormatRow>();
  for (const r of rows) {
    const cur = best.get(r.label);
    if (!cur) {
      best.set(r.label, r);
      continue;
    }
    const win = better(r, cur);
    // Dấu khuyên chọn không được mất khi bản mang nó bị loại.
    best.set(r.label, { ...win, recommended: win.recommended || r.recommended || cur.recommended });
  }
  return [...best.values()];
}

export function groupFormats(formats: FormatOption[]): { video: FormatRow[]; audio: FormatRow[] } {
  const video: FormatOption[] = [];
  const audio: FormatOption[] = [];
  for (const f of formats) {
    if (f.vcodec === 'none') audio.push(f);
    else video.push(f);
  }
  video.sort((a, b) => (qualityHeight(b) ?? 0) - (qualityHeight(a) ?? 0));
  return { video: dedupeRows(video.map(rowFor)), audio: dedupeRows(audio.map(rowFor)) };
}
