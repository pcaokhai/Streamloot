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
  if (typeof f.height === 'number' && f.height > 0) return `${f.height}p`;
  if (f.resolution) return f.resolution;
  return 'Chất lượng không rõ';
}

function rowFor(f: FormatOption): FormatRow {
  const size = humanSize(f.filesize);
  return {
    formatId: f.format_id,
    label: labelFor(f),
    detail: size ? `${f.ext} · ${size}` : f.ext,
    recommended: f.recommended,
    name: f.vcodec === 'none' ? 'Audio' : qualityName(f.height),
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
 * Gộp các dòng nhìn GIỐNG HỆT nhau.
 *
 * yt-dlp trả nhiều biến thể cùng một chiều cao — khác codec (avc1/vp9/av01),
 * khác fps, khác bitrate. Panel chỉ hiện chiều cao và đuôi file, nên chúng hiện
 * ra thành 4–6 dòng trông y như nhau và người dùng không có cơ sở nào để chọn.
 *
 * Gộp theo (chiều cao, đuôi), giữ bản NẶNG NHẤT — dung lượng lớn hơn ở cùng độ
 * phân giải nghĩa là bitrate cao hơn, tức nét hơn. Không biết dung lượng thì giữ
 * bản gặp trước, vì thứ tự yt-dlp trả đã là từ tốt xuống.
 */
function dedupeRows(rows: FormatRow[]): FormatRow[] {
  const best = new Map<string, FormatRow>();
  for (const r of rows) {
    const key = `${r.label}|${r.ext}`;
    const cur = best.get(key);
    if (!cur) {
      best.set(key, r);
      continue;
    }
    const size = (x: FormatRow) => {
      const m = /([\d.]+)\s*(B|KB|MB|GB|TB)/.exec(x.detail);
      if (!m) return -1;
      const unit = { B: 0, KB: 1, MB: 2, GB: 3, TB: 4 }[m[2]] ?? 0;
      return parseFloat(m[1]) * 1024 ** unit;
    };
    if (size(r) > size(cur)) best.set(key, { ...r, recommended: r.recommended || cur.recommended });
    else if (r.recommended) best.set(key, { ...cur, recommended: true });
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
  video.sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  return { video: dedupeRows(video.map(rowFor)), audio: dedupeRows(audio.map(rowFor)) };
}
