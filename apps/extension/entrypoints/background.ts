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
import { applyIconState, flashCompleted } from '../lib/icon';
import { cacheTasks } from '../lib/cache';
import { nextPollMs, pickRingTask } from '../lib/tasks';
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
  await applyIconState(lastKnownTasks, tabId);

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
      /** URL trang, cho đường hỏi yt-dlp trực tiếp (formatsByUrl / startByUrl). */
      url?: string;
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
      return api
        .startDownload(m.info, m.formatId ?? null)
        .then(({ task_id }) => {
          // Đánh thức vòng poll.
          //
          // nextPollMs trả null khi không còn task, nên trước cú tải này vòng
          // poll đã DỪNG HẲN — và không có gì tự khởi động lại nó. Thiếu dòng
          // này thì icon không mọc vòng tiến trình cho tới khi người dùng tình
          // cờ mở popup (viewerOpen mới gọi runTick). Đã gặp thật.
          runTick();
          return { ok: true as const, taskId: task_id };
        })
        .catch((e: unknown) => ({ ok: false as const, error: errorText(e) }));
    }

    if (m?.type === 'sitePlugin' && typeof m.url === 'string') {
      return siteHasPlugin(m.url).then((plugin) => ({ plugin }));
    }

    if (m?.type === 'formatsByUrl' && typeof m.url === 'string') {
      return formatsByUrl(m.url);
    }

    if (m?.type === 'startByUrl' && typeof m.url === 'string') {
      return api
        .startDownloadByUrl(m.url, m.formatId ?? null)
        .then(({ task_id }) => {
          runTick();
          return { ok: true as const, taskId: task_id };
        })
        .catch((e: unknown) => ({ ok: false as const, error: errorText(e) }));
    }

    if (m?.type === 'health') {
      return api.health().then((state) => ({ state }));
    }

    if (m?.type === 'viewerOpen') {
      viewers += 1;
      runTick(); // đổi sang nhịp 1s ngay, đừng đợi hết chu kỳ 60s
      return Promise.resolve({ ok: true });
    }
    if (m?.type === 'viewerClosed') {
      viewers = Math.max(0, viewers - 1);
      return Promise.resolve({ ok: true });
    }
    return undefined;
  });

  /**
   * Nhớ kết quả hỏi yt-dlp theo URL trang.
   *
   * Panel hỏi tự động trên MỌI trang có video, nên không có bộ nhớ đệm thì mỗi
   * lần panel vẽ lại là một lượt gọi ra internet — và trang yt-dlp không hỗ trợ
   * vẫn tốn nguyên một lượt tải trang rồi mới bỏ cuộc. Nhớ cả lần THẤT BẠI:
   * "site này không tải được" cũng là một câu trả lời, hỏi lại không đổi.
   *
   * Sống trong RAM của service worker, mất khi MV3 thu hồi worker — chấp nhận
   * được, lúc đó hỏi lại một lần là xong.
   */
  const formatCache = new Map<string, { ok: boolean; title?: string; formats?: unknown; error?: string }>();
  const FORMAT_CACHE_MAX = 40;

  /**
   * Nhớ "site này có plugin không" theo HOST, không theo URL đầy đủ.
   *
   * Plugin khớp theo tên miền nên mọi trang cùng host cho cùng câu trả lời —
   * đệm theo URL sẽ hỏi lại vô ích ở mỗi video.
   */
  const pluginCache = new Map<string, boolean>();

  async function siteHasPlugin(url: string): Promise<boolean> {
    let host: string;
    try {
      host = new URL(url).host;
    } catch {
      return false;
    }
    const hit = pluginCache.get(host);
    if (hit !== undefined) return hit;
    try {
      const { plugin } = await api.hasPlugin(url);
      pluginCache.set(host, plugin);
      return plugin;
    } catch {
      // Không hỏi được thì coi như CÓ plugin: giữ nguyên đường manifest vốn đã
      // chạy, thay vì đẩy sang đường yt-dlp chưa chắc tốt hơn.
      return true;
    }
  }

  async function formatsByUrl(url: string) {
    const hit = formatCache.get(url);
    if (hit) return hit;
    let result;
    try {
      const r = await api.getFormatsByUrl(url);
      result = { ok: true as const, title: r.title, formats: r.formats };
    } catch (e: unknown) {
      result = { ok: false as const, error: errorText(e) };
    }
    // Trần đơn giản: xoá mục cũ nhất khi đầy. Map giữ thứ tự chèn nên cái đầu
    // tiên là cái cũ nhất.
    if (formatCache.size >= FORMAT_CACHE_MAX) {
      const oldest = formatCache.keys().next().value;
      if (oldest !== undefined) formatCache.delete(oldest);
    }
    formatCache.set(url, result);
    return result;
  }

  const ALARM = 'streamloot-poll';
  /** Số bề mặt đang mở (popup, panel). Quyết định nhịp 1s hay 60s (spec §4.2). */
  let viewers = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Task mà vòng tiến trình đang bám, để biết lúc nào nó kết thúc.
   *
   * `/downloads/active` chỉ trả task chưa xong, nên "biến mất khỏi danh sách"
   * là tín hiệu duy nhất ta có. Nhưng biến mất vì XONG và biến mất vì bị HUỶ
   * nhìn giống hệt nhau, nên phải hỏi lại trạng thái cuối — chỉ `completed`
   * mới đáng cho vòng chạy nốt tới 100% (spec §5.3).
   */
  let ringTaskId: string | null = null;

  async function notifyIfRingTaskFinished(tasks: TaskRecord[]): Promise<void> {
    const previous = ringTaskId;
    ringTaskId = pickRingTask(tasks)?.task_id ?? null;
    if (!previous || tasks.some((t) => t.task_id === previous)) return;
    try {
      const finished = await api.getTask(previous);
      if (finished.status === 'completed') await flashCompleted();
    } catch {
      // 404 (bản ghi đã bị xoá) hay app vừa tắt: không biết thì không ăn mừng.
    }
  }

  /** `null` = KHÔNG HỎI ĐƯỢC (khác hẳn mảng rỗng = hỏi được, và không có task). */
  async function refreshTasks(): Promise<TaskRecord[] | null> {
    try {
      const { tasks } = await api.getActiveTasks();
      setLastKnownTasks(tasks);
      // Cache cho popup mở ra hiện ngay (D1). Không await: popup đọc được bản
      // cũ một nhịp cũng chẳng sao, còn chặn vòng poll vì một lượt ghi storage
      // thì không đáng.
      void cacheTasks(tasks);
      // Hỏi tab đang mở chỉ để gỡ badge theo-tab còn sót từ bản cũ; badge bây
      // giờ luôn toàn cục nên không cần đếm stream bắt được nữa.
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      await applyIconState(tasks, tab?.id);
      // Sau applyIconState: nếu vòng vừa mất task của nó, kiểm xem có phải đã
      // xong để chạy nốt tới 100%.
      await notifyIfRingTaskFinished(tasks);
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
  /**
   * `browser.alarms` có thể KHÔNG tồn tại.
   *
   * Quyền `alarms` chỉ có hiệu lực sau khi Reload extension; bản đang chạy được
   * nạp trước lúc thêm quyền sẽ thấy `chrome.alarms === undefined`. Trước đây
   * mọi nhánh của schedule() đều chạm thẳng vào nó, nên một quyền thiếu ném lỗi
   * ngay lần gọi đầu — mà schedule() được gọi trong tick(), vốn trước đây chạy
   * qua `void tick()` nên lỗi bị nuốt
   * và CẢ vòng poll chết lặng: badge đứng yên, vòng tiến trình không bao giờ vẽ,
   * danh sách task không bao giờ mới. Đã gặp thật.
   *
   * Thiếu thì kêu to một lần rồi chạy tiếp bằng setTimeout: kém hơn (không sống
   * qua lần MV3 thu hồi worker) nhưng còn hoạt động, thay vì chết câm.
   */
  let alarmsWarned = false;
  function alarms(): typeof browser.alarms | null {
    const api = browser.alarms as typeof browser.alarms | undefined;
    if (api) return api;
    if (!alarmsWarned) {
      alarmsWarned = true;
      console.error(
        '[Streamloot] Không có chrome.alarms — quyền `alarms` chưa có trong bản đang chạy. ' +
          'Vào chrome://extensions bấm Reload cho Streamloot. ' +
          'Tạm thời chỉ còn nhịp ngắn, và nó sẽ chết khi MV3 thu hồi service worker.',
      );
    }
    return null;
  }

  function schedule(tasks: TaskRecord[]): void {
    if (timer) { clearTimeout(timer); timer = null; }
    const ms = nextPollMs({ viewersOpen: viewers > 0, hasActive: tasks.length > 0 });
    if (ms === null) {
      void alarms()?.clear(ALARM);
      return;
    }
    // Hợp đồng của nextPollMs chỉ trả 1000 | 60000 | null — so bằng đúng giá trị
    // ngắn thay vì ngưỡng lỏng (<= 5000) để không âm thầm chấp nhận giá trị lạ.
    if (ms === 1000) {
      // KHÔNG clear alarm ở đây. MV3 giết service worker sau 5 phút bất kể có
      // đang hoạt động hay không — setTimeout chết theo worker, giữ nguyên
      // alarm 60s làm lưới đỡ: worker hồi sinh, tick() lại chạy. Bắn trùng vô
      // hại vì tick() tự chặn bằng tickSeq.
      timer = setTimeout(runTick, ms);
      void alarms()?.create(ALARM, { periodInMinutes: 1 });
    } else if (alarms()) {
      void alarms()!.create(ALARM, { periodInMinutes: ms / 60000 });
    } else {
      // Không có alarms: lùi về setTimeout cho cả nhịp dài. Nó chết theo worker,
      // nhưng thà nhịp kém còn hơn không có nhịp nào.
      timer = setTimeout(runTick, ms);
    }
  }

  let tickSeq = 0;

  /**
   * Chạy tick mà KHÔNG nuốt lỗi.
   *
   * `void tick()` vứt promise đi, nên bất kỳ lỗi nào trong vòng poll — một API
   * trình duyệt vắng mặt, một thay đổi hình dạng dữ liệu — đều biến mất không
   * dấu vết và vòng poll chết câm. Ghi lại rồi mới bỏ qua.
   */
  function runTick(): void {
    tick().catch((err) => {
      console.error('[Streamloot] vòng poll hỏng — sẽ không tự chạy lại cho tới sự kiện kế tiếp:', err);
    });
  }

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
    if (a.name === ALARM) runTick();
  });

  // Task có thể đã chạy từ trước lần khởi động này (do app hoặc CLI bắt đầu, hoặc
  // service worker vừa bị thu hồi) — hỏi backend một phát để dựng lại.
  runTick();
});
