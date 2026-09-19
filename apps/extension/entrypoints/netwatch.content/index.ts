/**
 * Quan sát response của chính trang, ở world MAIN.
 *
 * Vì sao phải ở MAIN: content script thường chạy ở world ISOLATED, nơi
 * `window.fetch` là bản riêng — bọc ở đó không thấy request nào của trang.
 *
 * Vì sao cần quan sát: Facebook nạp comment SAU khi trang tải, qua GraphQL.
 * Dữ liệu video trong comment không bao giờ vào DOM, nên quét `innerHTML`
 * không thấy (ADR 0007 §5.1). Đọc bản sao response lúc nó về thì thấy sớm,
 * không phải đợi người dùng bấm mở từng video.
 *
 * Ta chỉ ĐỌC BẢN SAO của thứ trang đã tự yêu cầu. Không tự gọi API nào.
 *
 * NGUYÊN TẮC BẤT DI BẤT DỊCH: không bao giờ được làm hỏng trang. Mọi nhánh đều
 * trả về đúng thứ bản gốc trả về, và mọi lỗi của ta đều bị nuốt tại chỗ.
 */
import { looksRelevant, worthReading, MAX_BODY_BYTES } from '../../lib/netcapture';

/** Khoá nhận dạng tin nhắn, để phía ISOLATED không nhặt nhầm tin của trang. */
const TAG = 'streamloot:net-body';

export default defineContentScript({
  matches: ['<all_urls>'],
  world: 'MAIN',
  // Phải chạy TRƯỚC script của trang, nếu không trang đã giữ tham chiếu tới
  // `fetch` gốc và bản bọc của ta thành vô dụng.
  runAt: 'document_start',
  allFrames: true,
  main() {
    const send = (body: string) => {
      try {
        // Chỉ gửi khi có dấu hiệu: postMessage là structured clone, gửi mọi
        // response JSON của Facebook sang world khác là tự tạo nghẽn.
        if (!looksRelevant(body)) return;
        window.postMessage({ tag: TAG, body }, '*');
      } catch {
        // Nuốt: việc của ta hỏng không được phép ảnh hưởng tới trang.
      }
    };

    const origFetch = window.fetch;
    if (typeof origFetch === 'function') {
      window.fetch = function patched(this: unknown, ...args: Parameters<typeof fetch>) {
        const p = origFetch.apply(this as never, args);
        try {
          void p.then((res) => {
            try {
              if (!res || typeof res.clone !== 'function') return;
              const len = Number(res.headers?.get?.('content-length') ?? '');
              if (!worthReading({
                contentType: res.headers?.get?.('content-type') ?? null,
                contentLength: Number.isFinite(len) ? len : null,
              })) return;
              // `clone()` BẮT BUỘC: đọc thẳng `res` là tiêu mất body và trang
              // sẽ nhận một stream đã cạn.
              void res.clone().text().then(send).catch(() => {});
            } catch {
              /* nuốt */
            }
            return undefined;
          }).catch(() => {});
        } catch {
          /* nuốt */
        }
        return p; // LUÔN trả bản gốc, nguyên vẹn
      } as typeof window.fetch;
    }

    // XMLHttpRequest: Facebook vẫn dùng cho một phần request.
    const XHR = window.XMLHttpRequest;
    if (typeof XHR === 'function' && XHR.prototype) {
      const origSend = XHR.prototype.send;
      XHR.prototype.send = function patchedSend(this: XMLHttpRequest, ...args: unknown[]) {
        try {
          this.addEventListener('load', () => {
            try {
              // `responseText` ném nếu responseType không phải '' hay 'text' —
              // đó là ca thường, không phải lỗi.
              if (this.responseType !== '' && this.responseType !== 'text') return;
              const body = this.responseText;
              if (typeof body === 'string' && body.length <= MAX_BODY_BYTES) send(body);
            } catch {
              /* nuốt */
            }
          });
        } catch {
          /* nuốt */
        }
        // eslint-disable-next-line prefer-spread
        return origSend.apply(this, args as never);
      } as typeof XHR.prototype.send;
    }
  },
});
