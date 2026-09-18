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
export function groupFormats(formats: FormatOption[]): { video: FormatRow[]; audio: FormatRow[] } {
  const video: FormatOption[] = [];
  const audio: FormatOption[] = [];
  for (const f of formats) {
    if (f.vcodec === 'none') audio.push(f);
    else video.push(f);
  }
  video.sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  return { video: video.map(rowFor), audio: audio.map(rowFor) };
}
