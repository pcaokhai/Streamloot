/**
 * Đặt `Referer`/`Origin` cho `fetch` của chính extension.
 *
 * `fetch` KHÔNG cho đặt hai header này — chúng nằm trong danh sách header bị
 * cấm, Chrome lặng lẽ bỏ đi. Mà CDN video thì hay từ chối request thiếu
 * Referer. Đường vòng hợp lệ duy nhất là `declarativeNetRequest`: tạo session
 * rule sửa header cho đúng URL sắp gọi, gọi xong thì GỠ rule.
 *
 * Gỡ rule là bắt buộc, không phải dọn dẹp cho đẹp: rule còn sót sẽ sửa header
 * của những request khác trùng mẫu URL, tức extension âm thầm đổi request của
 * trang. Vì thế phần gỡ nằm trong `finally`.
 */

/** Nguồn id rule. Session rule sống tới khi trình duyệt tắt nên id phải không trùng. */
let nextId = 1;

function allocId(): number {
  // Quay vòng trong khoảng riêng để không đụng id của rule tĩnh (ta không có
  // rule tĩnh nào, nhưng giữ khoảng riêng thì thêm rule tĩnh sau này vẫn an toàn).
  nextId = nextId >= 100_000 ? 1 : nextId + 1;
  return nextId;
}

export interface HeaderRule {
  /** Tiền tố URL được áp header. */
  urlFilter: string;
  headers: Record<string, string>;
}

/**
 * Mẫu URL phủ cả thư mục chứa playlist.
 *
 * Segment nằm cạnh playlist và cũng cần Referer y hệt, nên phạm vi phải là thư
 * mục chứ không phải đúng một URL.
 */
export function dirFilter(url: string): string {
  try {
    return `${new URL('.', url).href}*`;
  } catch {
    return url;
  }
}

/**
 * Hình dạng tối thiểu ta thực sự dùng.
 *
 * Không mượn kiểu `chrome.*`: repo dùng `browser` của WXT và không nạp
 * @types/chrome, nên khai đúng phần cần vẫn rõ hơn là kéo cả bộ kiểu về chỉ
 * để lấy hai trường.
 */
interface SessionRule {
  id: number;
  priority: number;
  action: {
    type: 'modifyHeaders';
    requestHeaders: { header: string; operation: 'set'; value: string }[];
  };
  condition: { urlFilter: string; resourceTypes: ['xmlhttprequest'] };
}

interface DnrApi {
  updateSessionRules(o: { addRules?: SessionRule[]; removeRuleIds?: number[] }): Promise<void>;
}

function dnr(): DnrApi | undefined {
  // Quyền có thể thiếu nếu bản đang chạy là bản cũ chưa Reload sau khi manifest
  // đổi — trả undefined để caller lùi về đường backend thay vì ném.
  const api = (browser as unknown as { declarativeNetRequest?: DnrApi }).declarativeNetRequest;
  return typeof api?.updateSessionRules === 'function' ? api : undefined;
}

/** Có dùng được đường này không. */
export function canSetHeaders(): boolean {
  return dnr() !== undefined;
}

/**
 * Chạy `fn` trong lúc các header đã được cài, rồi gỡ sạch.
 *
 * Trả về kết quả của `fn`. Cài rule hỏng thì vẫn chạy `fn` (không có Referer,
 * có thể vẫn được) — hỏng việc phụ không được phép chặn việc chính.
 */
export async function withHeaders<T>(rules: HeaderRule[], fn: () => Promise<T>): Promise<T> {
  const api = dnr();
  const usable = rules.filter((r) => Object.keys(r.headers).length > 0);
  if (!api || !usable.length) return fn();

  const ids: number[] = [];
  const addRules: SessionRule[] = usable.map((r) => {
    const id = allocId();
    ids.push(id);
    return {
      id,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: Object.entries(r.headers).map(([header, value]) => ({
          header,
          operation: 'set' as const,
          value,
        })),
      },
      condition: { urlFilter: r.urlFilter, resourceTypes: ['xmlhttprequest'] },
    };
  });

  try {
    await api.updateSessionRules({ addRules });
  } catch (err) {
    console.warn('[Streamloot] không cài được header rule:', err);
    return fn();
  }
  try {
    return await fn();
  } finally {
    // Lỗi lúc gỡ được nuốt có chủ đích: ném trong finally sẽ che mất lỗi thật
    // của fn. Nhưng phải kêu to, vì rule sót thì extension đang âm thầm sửa
    // header của request khác.
    void api.updateSessionRules({ removeRuleIds: ids }).catch((err: unknown) => {
      console.warn('[Streamloot] không gỡ được header rule:', err);
    });
  }
}
