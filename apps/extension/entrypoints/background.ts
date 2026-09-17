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
import { applyIconState } from '../lib/icon';
import { nextPollMs } from '../lib/tasks';
import type { Capture, TaskRecord, VideoInfoPayload } from '../lib/types';

const MANIFEST_URL = /\.(m3u8|mpd)(\?|$)/i;
const MANIFEST_TYPE = /(mpegurl|dash\+xml)/i;

const keyFor = (tabId: number) => `captures:${tabId}`;

/**
 * Ảnh chụp task gần nhất từ backend.
 *
 * Extension không phải nguồn sự thật (spec §4.1) — biến này chỉ để vẽ icon mà
 * không phải gọi mạng. Service worker chết thì nó về rỗng, và lần poll kế tiếp
 * dựng lại đầy đủ.
 */
let lastKnownTasks: TaskRecord[] = [];

function setLastKnownTasks(tasks: TaskRecord[]): void {
  lastKnownTasks = tasks;
}

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

  // Badge và vòng do applyIconState quyết (lib/tasks.ts), không đặt tay ở đây
  // nữa — hai chỗ cùng đặt badge là hai chỗ sẽ lệch nhau.
  await applyIconState(lastKnownTasks, next.length, tabId);

  // Báo content script để panel tự nổi lên.
  browser.tabs.sendMessage(tabId, { type: 'captures', captures: next }).catch(() => {
    // Content script chưa nạp trên trang này — bỏ qua, nó sẽ tự hỏi lúc nạp.
  });

  // Đo thời lượng ở nền rồi báo lại: panel hiện ngay, không đợi phép đo. Đo xong
  // mới biết cái nào là phim, cái nào là quảng cáo.
  void api.probeDuration(cap.url, cap.referer, cap.userAgent).then(async (durationSec) => {
    const list = await getCaptures(tabId);
    const i = list.findIndex((c) => c.url === cap.url);
    if (i < 0) return; // tab đã chuyển trang trong lúc đo
    list[i] = { ...list[i], durationSec };
    await browser.storage.session.set({ [keyFor(tabId)]: list });
    browser.tabs.sendMessage(tabId, { type: 'captures', captures: list }).catch(() => {});
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

    if (m?.type === 'viewerOpen') {
      viewers += 1;
      void tick(); // đổi sang nhịp 1s ngay, đừng đợi hết chu kỳ 60s
      return Promise.resolve({ ok: true });
    }
    if (m?.type === 'viewerClosed') {
      viewers = Math.max(0, viewers - 1);
      return Promise.resolve({ ok: true });
    }
    return undefined;
  });

  const ALARM = 'streamloot-poll';
  /** Số bề mặt đang mở (popup, panel). Quyết định nhịp 1s hay 60s (spec §4.2). */
  let viewers = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  /** `null` = KHÔNG HỎI ĐƯỢC (khác hẳn mảng rỗng = hỏi được, và không có task). */
  async function refreshTasks(): Promise<TaskRecord[] | null> {
    try {
      const { tasks } = await api.getActiveTasks();
      setLastKnownTasks(tasks);
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      const caps = tab?.id !== undefined ? await getCaptures(tab.id) : [];
      await applyIconState(tasks, caps.length, tab?.id);
      return tasks;
    } catch {
      // App tắt giữa chừng là chuyện bình thường. Không có dữ liệu mới thì
      // không ghi lastKnownTasks, không vẽ lại icon — trả null để tick() giữ
      // nguyên hiểu biết cũ thay vì kết luận nhầm là đã hết task.
      return null;
    }
  }

  /**
   * Đặt lịch lần poll kế tiếp.
   *
   * Hai cơ chế, cố ý: `setTimeout` cho nhịp 1s khi có người xem (chính xác, và
   * lúc đó đã có tin nhắn giữ service worker sống), `chrome.alarms` cho nhịp 60s
   * (setTimeout dài không sống nổi qua lần MV3 thu hồi worker). Hết task thì
   * DỪNG cả hai — poll rỗng chính là cách giữ worker sống mà D4 loại bỏ.
   */
  function schedule(tasks: TaskRecord[]): void {
    if (timer) { clearTimeout(timer); timer = null; }
    const ms = nextPollMs({ viewersOpen: viewers > 0, hasActive: tasks.length > 0 });
    if (ms === null) {
      void browser.alarms.clear(ALARM);
      return;
    }
    // Hợp đồng của nextPollMs chỉ trả 1000 | 60000 | null — so bằng đúng giá trị
    // ngắn thay vì ngưỡng lỏng (<= 5000) để không âm thầm chấp nhận giá trị lạ.
    if (ms === 1000) {
      // KHÔNG clear alarm ở đây. MV3 giết service worker sau 5 phút bất kể có
      // đang hoạt động hay không — setTimeout chết theo worker, giữ nguyên
      // alarm 60s làm lưới đỡ: worker hồi sinh, tick() lại chạy. Bắn trùng vô
      // hại vì tick() tự chặn bằng tickSeq.
      timer = setTimeout(() => void tick(), ms);
      void browser.alarms.create(ALARM, { periodInMinutes: 1 });
    } else {
      void browser.alarms.create(ALARM, { periodInMinutes: ms / 60000 });
    }
  }

  let tickSeq = 0;

  async function tick(): Promise<void> {
    const mine = ++tickSeq;
    const tasks = await refreshTasks();
    // Tick cũ về muộn thì bỏ qua: nó mang ảnh chụp cũ, mà schedule() chỉ được
    // nghe theo ảnh chụp mới nhất. Không có chốt này thì một response lạc hậu
    // ghi đè quyết định đúng và poll dừng giữa lúc đang tải.
    if (mine !== tickSeq) return;
    // Không hỏi được thì DỰA VÀO hiểu biết gần nhất, đừng kết luận là hết task.
    // Kết luận nhầm sẽ dừng poll vĩnh viễn cho tới khi người dùng mở popup —
    // app restart một nhịp là đủ để mất dấu một download đang chạy.
    schedule(tasks ?? lastKnownTasks);
  }

  browser.alarms.onAlarm.addListener((a) => {
    if (a.name === ALARM) void tick();
  });

  // Task có thể đã chạy từ trước lần khởi động này (do app hoặc CLI bắt đầu, hoặc
  // service worker vừa bị thu hồi) — hỏi backend một phát để dựng lại.
  void tick();
});
