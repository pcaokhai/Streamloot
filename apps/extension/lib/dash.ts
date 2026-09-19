/**
 * Đọc manifest DASH (MPD).
 *
 * Vì sao tự viết thay vì dùng thư viện: service worker MV3 **không có
 * `DOMParser`**, nên mọi thư viện XML đều phải kéo theo một bộ phân tích DOM
 * riêng — bản tham khảo gói hẳn một cái vào bundle. Ta chỉ cần vài thuộc tính
 * của `<Representation>`, nên đọc bằng regex là đủ và giữ được module THUẦN
 * (chạy được dưới node, test được — ADR 0006).
 *
 * Giới hạn có chủ đích: chỉ đọc `BaseURL` dạng URL đầy đủ. MPD dùng
 * `SegmentTemplate` phải ghép mảnh mới ra file, việc đó thuộc về tầng tải chứ
 * không phải tầng đọc — thấy dạng đó thì trả rỗng để người gọi đi đường khác,
 * chứ không trả một danh sách nửa vời.
 */

export interface DashRep {
  id: string;
  mimeType: string;
  codecs: string;
  /** URL tải thẳng luồng này. */
  url: string;
  width: number | null;
  height: number | null;
  bandwidth: number | null;
  audioOnly: boolean;
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag);
  return m ? m[1] : null;
}

function num(tag: string, name: string): number | null {
  const v = attr(tag, name);
  if (v === null) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

/** Gỡ thực thể XML trong URL — `&amp;` rất hay gặp trong MPD. */
function unescapeXml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * Các luồng tải được trong một MPD.
 *
 * Rỗng khi không phải MPD, hoặc khi không luồng nào có `BaseURL` dùng thẳng được.
 */
export function parseMpd(xml: string): DashRep[] {
  if (!/<MPD[\s>]/i.test(xml)) return [];

  const out: DashRep[] = [];
  // Duyệt theo AdaptationSet để thừa hưởng mimeType/contentType khi
  // Representation không tự khai — MPD thật hay đặt ở tầng cha.
  const setRe = /<AdaptationSet\b([^>]*)>([\s\S]*?)<\/AdaptationSet>/gi;
  const blocks: { head: string; body: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = setRe.exec(xml)) !== null) blocks.push({ head: m[1], body: m[2] });
  // MPD không có AdaptationSet nào (hiếm nhưng hợp lệ): vẫn quét cả tài liệu.
  if (!blocks.length) blocks.push({ head: '', body: xml });

  for (const b of blocks) {
    const setMime = attr(b.head, 'mimeType') ?? '';
    const setType = attr(b.head, 'contentType') ?? '';
    const repRe = /<Representation\b([^>]*)>([\s\S]*?)<\/Representation>/gi;
    let r: RegExpExecArray | null;
    while ((r = repRe.exec(b.body)) !== null) {
      const head = r[1];
      const body = r[2];
      const base = /<BaseURL[^>]*>([\s\S]*?)<\/BaseURL>/i.exec(body);
      if (!base) continue; // SegmentTemplate: xem ghi chú đầu file
      const url = unescapeXml(base[1].trim());
      if (!/^https?:\/\//i.test(url)) continue;

      const mime = attr(head, 'mimeType') ?? setMime;
      const codecs = attr(head, 'codecs') ?? '';
      const height = num(head, 'height');
      const isAudio =
        mime.startsWith('audio/') ||
        setType.toLowerCase() === 'audio' ||
        (height === null && /^(mp4a|opus|ac-3|ec-3|vorbis|flac)/i.test(codecs));

      out.push({
        id: attr(head, 'id') ?? '',
        mimeType: mime,
        codecs,
        url,
        width: num(head, 'width'),
        height,
        bandwidth: num(head, 'bandwidth'),
        audioOnly: isAudio,
      });
    }
  }
  return out;
}

/** Luồng hình có chiều cao lớn nhất. `null` khi không có luồng hình nào. */
export function bestVideo(reps: DashRep[]): DashRep | null {
  const vids = reps.filter((r) => !r.audioOnly);
  if (!vids.length) return null;
  return vids.reduce((a, b) => ((b.height ?? 0) > (a.height ?? 0) ? b : a));
}

/** Luồng tiếng có bitrate cao nhất. `null` khi không có. */
export function bestAudio(reps: DashRep[]): DashRep | null {
  const auds = reps.filter((r) => r.audioOnly);
  if (!auds.length) return null;
  return auds.reduce((a, b) => ((b.bandwidth ?? 0) > (a.bandwidth ?? 0) ? b : a));
}

/**
 * Thời lượng khai trong MPD, tính bằng giây. `null` khi không có.
 *
 * Dùng để GẮN một thẻ `<video>` trên trang với đúng manifest của nó: trang feed
 * có nhiều video, mà `<video>` không mang id nào để đối chiếu. Thời lượng thì
 * cả hai phía đều biết.
 *
 * Đây là tín hiệu tốt hơn `length_in_second` moi từ object cha: đo thật, MỌI
 * manifest đều khai `mediaPresentationDuration`, còn trường kia chỉ trúng 1/3.
 *
 * Chỉ đọc dạng `PT<số>S` — đó là dạng Facebook dùng. Dạng ISO 8601 đầy đủ có
 * cả giờ và phút; thấy dạng khác thì trả `null` thay vì đoán sai.
 */
export function presentationDuration(xml: string): number | null {
  const m = /mediaPresentationDuration="PT([\d.]+)S"/i.exec(xml);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}
