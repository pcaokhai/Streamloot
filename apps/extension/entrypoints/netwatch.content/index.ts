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
 *
 * CỐ Ý KHÔNG bọc `XMLHttpRequest`. Bản đầu có bọc, và hệ quả đo được khi thử
 * tay: tên file này xuất hiện trong ngăn xếp của một lỗi `chrome-extension://invalid/`
 * mà TRANG tự gây ra — bản bọc chỉ nằm trên đường đi, không phát ra request nào
 * (file build 1513 byte, không có tham chiếu nào tới URL extension). Nhưng nhận
 * tiếng cho lỗi của người khác là cái giá không đáng: Facebook dùng `fetch` cho
 * GraphQL, nên bỏ XHR gần như không mất gì.
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
          // Chỉ quan sát request http(s) của trang. Request sang scheme khác
          // (chrome-extension:, blob:, data:) không bao giờ mang dữ liệu ta cần,
          // và đứng ngoài chúng giữ cho tên file này không lọt vào ngăn xếp lỗi
          // của những thứ không liên quan.
          const target = typeof args[0] === 'string'
            ? args[0]
            : (args[0] as Request | URL | undefined)?.toString?.() ?? '';
          if (!/^https?:/i.test(target)) return p;
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

  },
});
