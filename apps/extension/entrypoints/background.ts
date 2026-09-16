/**
 * Service worker — quan sát network, gom manifest theo tab, phục vụ panel.
 *
 * Tiến hoá từ probe Giai đoạn 0 (không có dòng nào phải vứt). Bốn điều dưới đây
 * đã kiểm chứng bằng đo thật, xem docs/impl/2026-09-16-stage0-probe-log.md:
 *
 *  - MV3 chỉ bỏ webRequest *blocking*; listener quan sát còn nguyên.
 *  - KHÔNG bao giờ đọc `<video>.src` — trang stream đưa blob URL qua MSE, vô
 *    dụng và không kèm header nào (B7).
 *  - Manifest nằm ở CDN khác hẳn tên miền trang, 2/3 site đi qua iframe — nên
 *    gom theo tabId chứ không gom theo host.
 *  - Bắt theo cả đuôi URL lẫn Content-Type (B12).
 */
import * as api from '../lib/api';
import { BackendError } from '../lib/api';
import type { Capture, VideoInfoPayload } from '../lib/types';

const MANIFEST_URL = /\.(m3u8|mpd)(\?|$)/i;
const MANIFEST_TYPE = /(mpegurl|dash\+xml)/i;

const keyFor = (tabId: number) => `captures:${tabId}`;

/** Trần mỗi tab: một trang có thể nạp nhiều biến thể playlist. */
const MAX_PER_TAB = 12;

async function getCaptures(tabId: number): Promise<Capture[]> {
  const k = keyFor(tabId);
  const stored = await browser.storage.session.get(k);
  return (stored as Record<string, Capture[]>)[k] ?? [];
}

async function addCapture(tabId: number, cap: Capture): Promise<void> {
  const existing = await getCaptures(tabId);
  if (existing.some((c) => c.url === cap.url)) return; // playlist bị fetch lại nhiều lần
  const next = [...existing, cap].slice(-MAX_PER_TAB);
  await browser.storage.session.set({ [keyFor(tabId)]: next });

  // B8 — badge cho biết ngay trang này bắt được mấy stream, không bắt người dùng
  // đi tìm. Đây là khác biệt giữa "công cụ tôi phải nhớ là mình có" và "công cụ
  // luôn ở đó" (R5 trong ADR 0005).
  await browser.action.setBadgeText({ tabId, text: String(next.length) }).catch(() => {});
  await browser.action.setBadgeBackgroundColor({ tabId, color: '#2563eb' }).catch(() => {});

  // Báo content script để panel tự nổi lên.
  browser.tabs.sendMessage(tabId, { type: 'captures', captures: next }).catch(() => {
    // Content script chưa nạp trên trang này — bỏ qua, nó sẽ tự hỏi lúc nạp.
  });
}

async function clearTab(tabId: number): Promise<void> {
  await browser.storage.session.remove(keyFor(tabId));
  await browser.action.setBadgeText({ tabId, text: '' }).catch(() => {});
}

function errorText(e: unknown): string {
  return e instanceof BackendError ? e.message : 'Lỗi không xác định';
}

/** Đọc stream tiến trình rồi chuyển tiếp về tab đã yêu cầu tải. */
async function pumpProgress(taskId: string, tabId?: number): Promise<void> {
  if (tabId === undefined) return;
  try {
    await api.streamProgress(taskId, (event) => {
      browser.tabs.sendMessage(tabId, { type: 'progress', taskId, event }).catch(() => {
        // Tab đã đóng hoặc điều hướng đi — dừng im lặng, không phải lỗi.
      });
    });
  } catch (e) {
    browser.tabs
      .sendMessage(tabId, { type: 'progress', taskId, error: errorText(e) })
      .catch(() => {});
  }
}

/** Origin của frame khởi tạo request — 2/3 site đích phục vụ stream qua iframe. */
function pageOf(d: { initiator?: string; documentUrl?: string }): string {
  const raw = d.initiator ?? d.documentUrl;
  try {
    return raw ? new URL(raw).hostname : '';
  } catch {
    return '';
  }
}

export default defineBackground(() => {
  // Mọi lời gọi runtime phải nằm trong đây: WXT import file này lúc build với
  // một fake browser để đọc config, nên addListener ở top-level làm hỏng build.

  // Cần 'extraHeaders' mới thấy Referer — Chrome lọc header này khỏi listener
  // theo mặc định.
  browser.webRequest.onSendHeaders.addListener(
    (d) => {
      if (d.tabId < 0 || !MANIFEST_URL.test(d.url)) return;
      const header = (n: string) =>
        d.requestHeaders?.find((h) => h.name.toLowerCase() === n)?.value;
      void addCapture(d.tabId, {
        page: pageOf(d),
        host: new URL(d.url).hostname,
        url: d.url,
        title: '',
        referer: header('referer'),
        origin: header('origin'),
        userAgent: header('user-agent'),
        at: Date.now(),
      });
    },
    { urls: ['<all_urls>'] },
    ['requestHeaders', 'extraHeaders'],
  );

  // Đường thứ hai (B12): manifest mà URL không lộ đuôi file. Đo thật trên 3 site
  // đích thì đường này chưa từng khớp, nhưng giữ vì rẻ và phòng site khác.
  browser.webRequest.onHeadersReceived.addListener(
    (d): undefined => {
      if (d.tabId < 0 || MANIFEST_URL.test(d.url)) return undefined;
      const ct = d.responseHeaders?.find((h) => h.name.toLowerCase() === 'content-type')?.value;
      if (!ct || !MANIFEST_TYPE.test(ct)) return undefined;
      void addCapture(d.tabId, {
        page: pageOf(d),
        host: new URL(d.url).hostname,
        url: d.url,
        title: '',
        at: Date.now(),
      });
      return undefined;
    },
    { urls: ['<all_urls>'] },
    ['responseHeaders'],
  );

  // Điều hướng sang trang khác thì kết quả cũ không còn đúng.
  browser.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status === 'loading' && info.url) void clearTab(tabId);
  });
  browser.tabs.onRemoved.addListener((tabId) => void clearTab(tabId));

  browser.runtime.onMessage.addListener((msg, sender) => {
    const m = msg as {
      type?: string;
      tabId?: number;
      info?: VideoInfoPayload;
      formatId?: string | null;
      taskId?: string;
    };

    if (m?.type === 'getCaptures') {
      const tabId = m.tabId ?? sender.tab?.id;
      return tabId === undefined ? Promise.resolve([]) : getCaptures(tabId);
    }
    if (m?.type === 'clearCaptures' && m.tabId !== undefined) {
      return clearTab(m.tabId).then(() => true);
    }

    // Mọi lời gọi HTTP đi qua ĐÂY, không gọi từ content script.
    //
    // Trong MV3, `fetch` từ content script được Chrome gắn origin của TRANG chứ
    // không phải của extension — nên backend (vốn nhận diện extension qua
    // Origin) trả 401. Service worker thì có đúng origin
    // `chrome-extension://<id>`. Đây là lý do kiến trúc, không phải tuỳ chọn.
    if (m?.type === 'listFormats' && m.info) {
      return api
        .listFormats(m.info)
        .then((r) => ({ ok: true as const, formats: r.formats }))
        .catch((e: unknown) => ({ ok: false as const, error: errorText(e) }));
    }

    if (m?.type === 'startDownload' && m.info) {
      const tabId = sender.tab?.id;
      return api
        .startDownload(m.info, m.formatId ?? null)
        .then(({ task_id }) => {
          // Stream ở background rồi đẩy từng sự kiện về tab. Content script
          // không tự stream được, cùng lý do Origin ở trên.
          void pumpProgress(task_id, tabId);
          return { ok: true as const, taskId: task_id };
        })
        .catch((e: unknown) => ({ ok: false as const, error: errorText(e) }));
    }

    if (m?.type === 'health') {
      return api.health().then((state) => ({ state }));
    }

    return undefined;
  });
});
