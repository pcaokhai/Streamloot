/**
 * Panel nổi trên trang (B8).
 *
 * Vanilla DOM chứ không React: content script chạy trên MỌI trang người dùng mở,
 * nên React ~45KB gzip nhân cho mỗi tab là chi phí thật. Panel chỉ là danh sách
 * format + một nút + thanh tiến trình (ADR 0006 §2.2).
 *
 * Shadow DOM là bắt buộc: panel sống trong trang của người khác, CSS của họ và
 * của ta không được đụng nhau. `createShadowRootUi` của WXT bọc sẵn việc này.
 *
 * B7 — KHÔNG đọc `<video>.src` ở đâu trong file này. Trang stream đưa cho
 * `<video>` một blob URL qua MSE: không tải được, không header. Nguồn duy nhất
 * đáng tin là những gì service worker quan sát được từ network.
 */
import './style.css';
import type { Capture, FormatOption, VideoInfoPayload } from '../../lib/types';
import { pickCapture } from '../../lib/pick';
import { pickAnchor, buttonPos, panelPos, shouldHideFab, isOverRect, isUsableRect, BTN_SIZE, BTN_PAD, HOVER_FRESH_MS, HOVER_TICK_MS } from '../../lib/anchor';
import { groupFormats, qualityName } from '../../lib/formats';
import type { FormatRow } from '../../lib/formats';
import { canSubmit } from '../../lib/submitGuard';
import { extFromUrl } from '../../lib/capture';
import { cleanTitle } from '../../lib/title';
import { extractPlayerResponse, formatsFromPlayerResponse, playerResponseVideoId, currentVideoId, sameVideo } from '../../lib/youtube';
import { extractVideos, pickByDuration, listLabel, watchUrl } from '../../lib/facebook';
import { parseMpd } from '../../lib/dash';
import type { FbVideo } from '../../lib/facebook';
import { downloadName } from '../../lib/filename';

/**
 * Panel KHÔNG gọi HTTP trực tiếp.
 *
 * Trong MV3, `fetch` từ content script được Chrome gắn origin của TRANG chứ
 * không phải của extension — backend nhận diện extension qua Origin nên sẽ trả
 * 401. Mọi lời gọi đi qua service worker, nơi có đúng origin
 * `chrome-extension://<id>`.
 */
/**
 * Content script bị mồ côi sau khi extension được nạp lại.
 *
 * Gỡ/cài lại hay bấm Reload trong chrome://extensions sẽ cắt đứt mọi content
 * script ĐÃ tiêm vào các tab đang mở: `sendMessage` từ đó ném "Extension context
 * invalidated". Trang phải được tải lại thì bản mới mới vào. Chrome không có
 * cách nào để script cũ tự hồi sinh.
 */
const RELOAD_PAGE_MSG = 'Extension vừa được nạp lại — tải lại trang (⌘R) để dùng tiếp.';

function isOrphaned(err: unknown): boolean {
  return /Extension context invalidated|message port closed|receiving end does not exist/i.test(
    err instanceof Error ? err.message : String(err),
  );
}

const ask = async <T,>(msg: unknown): Promise<T> => {
  try {
    // Có hạn giờ: trong MV3, service worker bị giết khi rảnh, và nếu nó chết
    // đúng lúc đang xử lý thì `sendMessage` không bao giờ resolve — panel đứng
    // im ở "Đang bắt đầu…" và người dùng không biết là đang chờ hay đã hỏng.
    return await Promise.race([
      browser.runtime.sendMessage(msg) as Promise<T>,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('Service worker không trả lời (thử tải lại trang)')), 15000),
      ),
    ]);
  } catch (err) {
    // Dịch lỗi kỹ thuật sang việc người dùng làm được. "Extension context
    // invalidated" không nói cho ai biết phải làm gì.
    throw isOrphaned(err) ? new Error(RELOAD_PAGE_MSG) : err;
  }
};

function toPayload(cap: Capture): VideoInfoPayload {
  return {
    // Tiêu đề đã bỏ đuôi tên site: đây là thứ backend dùng làm TÊN FILE, nên
    // để nguyên là mọi file tải về đều mang tên site.
    title: cleanTitle(document.title, location.hostname) || cap.host,
    m3u8_url: cap.url,
    page_url: location.href,
    referer: cap.referer ?? location.origin + '/',
    origin: cap.origin ?? location.origin,
    user_agent: cap.userAgent ?? navigator.userAgent,
  };
}

export default defineContentScript({
  matches: ['<all_urls>'],
  // Đo thật: 2/3 site đích phục vụ stream qua iframe player riêng (ADR 0005
  // §7.1), mà content script ở khung trên cùng không thấy <video> bên trong
  // iframe. Không bật thì nút không bao giờ neo đúng chỗ trên các site đó.
  allFrames: true,
  cssInjectionMode: 'ui',

  async main(ctx) {
    // Thoát NGAY nếu khung này không có video.
    //
    // all_frames nghĩa là script chạy trong mọi iframe, kể cả quảng cáo và
    // tracker — hàng chục khung trên một trang tin. Phép kiểm này gần như miễn
    // phí và loại bỏ tuyệt đại đa số chúng. Không thoát sớm thì `all_frames`
    // biến từ tính năng thành gánh nặng.
    //
    // Video có thể nạp sau, nên vẫn nghe sự kiện một lần trước khi bỏ hẳn.
    if (!document.querySelector('video')) {
      const wake = () => {
        document.removeEventListener('loadedmetadata', wake, true);
        document.removeEventListener('play', wake, true);
        void start(ctx);
      };
      document.addEventListener('loadedmetadata', wake, true);
      document.addEventListener('play', wake, true);
      ctx.onInvalidated(() => {
        document.removeEventListener('loadedmetadata', wake, true);
        document.removeEventListener('play', wake, true);
      });
      return;
    }
    await start(ctx);
  },
});

async function start(ctx: InstanceType<typeof ContentScriptContext>) {
    let captures: Capture[] = [];
    let mounted = false;
    // URL người dùng tự chọn trong danh sách stream — null là để hệ thống tự chọn.
    let chosenUrl: string | null = null;

    const ui = await createShadowRootUi(ctx, {
      name: 'streamloot-panel',
      position: 'inline',
      anchor: 'body',
      onMount(container) {
        const root = document.createElement('div');
        root.className = 'sl-panel';
        root.style.display = 'none'; // đóng theo mặc định — mở khi bấm nút nổi
        container.append(root);
        container.append(fab);
        return root;
      },
      onRemove(root) {
        root?.remove();
      },
    });

    const fab = document.createElement('div');
    fab.className = 'sl-fab';
    fab.textContent = '⤓';
    fab.title = 'Tải video này bằng Streamloot';
    fab.style.width = `${BTN_SIZE}px`;
    fab.style.height = `${BTN_SIZE}px`;

    let anchored: HTMLVideoElement | null = null;

    // Nút chỉ hiện khi rê chuột vào video, nán lại FAB_HIDE_MS rồi ẩn — như
    // thanh nút của Cốc Cốc. Quyết định ẩn/hiện nằm ở shouldHideFab (có test);
    // ở đây chỉ là nối sự kiện chuột và một bộ hẹn giờ.
    /**
     * Lần cuối THẤY con trỏ trên video, chứ không phải cờ "đang rê".
     *
     * Bản trước dò theo cạnh lên/xuống (vào -> hiện, ra -> hẹn giờ ẩn) và hỏng
     * ở một ca rất thường: con trỏ rời video sang một <iframe> (quảng cáo, hoặc
     * chính khung player) thì document gốc NGỪNG nhận mousemove — không có sự
     * kiện "ra" nào cả, nên cờ đóng băng ở true và nút không bao giờ ẩn.
     *
     * Đo mức thì không cần sự kiện "ra": mốc thời gian tự cũ đi, và một nhịp
     * kiểm tra định kỳ đủ để nút biến mất đúng hạn kể cả khi không còn sự kiện
     * chuột nào nữa.
     */
    let lastOverAt = 0;
    let hoverTick: ReturnType<typeof setInterval> | undefined;

    function applyFabVisibility(): void {
      const msSinceLeave = Date.now() - lastOverAt;
      const hide = shouldHideFab({
        // "Đang rê" = vừa mới thấy con trỏ ở đó. Mousemove bắn dày hơn nhiều so
        // với ngưỡng này, nên chỉ cần con trỏ còn trên video là luôn đúng.
        hovering: msSinceLeave < HOVER_FRESH_MS,
        panelOpen: mounted,
        anchored: anchored !== null,
        msSinceLeave,
      });
      fab.classList.toggle('sl-hidden', hide);
      // Chỉ chạy nhịp kiểm khi nút đang hiện: ẩn rồi thì chỉ mousemove mới đánh
      // thức, không cần bộ đếm chạy không.
      if (hide && hoverTick !== undefined) {
        clearInterval(hoverTick);
        hoverTick = undefined;
      } else if (!hide && hoverTick === undefined) {
        hoverTick = setInterval(applyFabVisibility, HOVER_TICK_MS);
      }
    }
    function markOver(): void {
      lastOverAt = Date.now();
      applyFabVisibility();
    }
    /**
     * Theo dõi chuột bằng TOẠ ĐỘ trên document, không bằng mouseenter của
     * <video>.
     *
     * Player thật phủ lớp điều khiển lên trên video (JW Player, video.js, plyr…),
     * nên mouseenter gắn vào phần tử video không bao giờ nổ — đó chính là lý do
     * nút không hiện dù đã rê chuột vào video. Đo toạ độ thì lớp phủ vô hại.
     *
     * Gộp theo rAF: mousemove bắn hàng trăm lần mỗi giây, còn
     * getBoundingClientRect thì ép trình duyệt tính lại layout.
     */
    let moveQueued = false;
    function onMove(ev: MouseEvent): void {
      if (moveQueued) return;
      moveQueued = true;
      const { clientX: x, clientY: y } = ev;
      requestAnimationFrame(() => {
        moveQueued = false;
        // Phần tử neo có thể đã bị player thay mất (SPA dựng lại <video> sau khi
        // bắt đầu tải). Node rời DOM trả rect toàn số 0 mà không báo gì, nên
        // nếu cứ tin vào nó thì nút ẩn vĩnh viễn. Thấy rect hỏng thì neo lại.
        if (anchored && (!anchored.isConnected || !isUsableRect(anchored.getBoundingClientRect()))) {
          place();
        }
        const rects = [];
        if (anchored) {
          const r = anchored.getBoundingClientRect();
          if (isUsableRect(r)) rects.push(r);
        }
        if (!fab.classList.contains('sl-hidden')) rects.push(fab.getBoundingClientRect());
        // Vùng đệm bằng cả nút + lề: nút nằm NGOÀI mép trên video, nên đường đi
        // từ video lên tới nút không được tính là "đã rời video".
        if (isOverRect({ x, y }, rects, BTN_SIZE + BTN_PAD)) markOver();
        else applyFabVisibility();
      });
    }
    document.addEventListener('mousemove', onMove, { passive: true, capture: true });

    /**
     * Bấm ra ngoài thì đóng panel — thói quen chung của mọi popover.
     *
     * Dùng composedPath(): panel sống trong shadow root, nên `event.target` ở
     * document chỉ là phần tử host, không phân biệt được bấm trong hay ngoài.
     * composedPath() xuyên qua shadow boundary và cho biết chính xác.
     */
    const onDocClick = (ev: MouseEvent) => {
      if (!mounted) return;
      const root = ui.shadow.querySelector('.sl-panel');
      const path = ev.composedPath();
      if ((root && path.includes(root)) || path.includes(fab)) return;
      mounted = false;
      if (root instanceof HTMLElement) root.style.display = 'none';
      applyFabVisibility();
    };
    document.addEventListener('click', onDocClick, true);

    /** Đo lại và đặt nút. Gọi từ observer, không từ bộ đếm. */
    function place(): void {
      const vids = [...document.querySelectorAll('video')] as HTMLVideoElement[];
      const shaped = vids.map((v) => ({
        rect: v.getBoundingClientRect(),
        playing: !v.paused && !v.ended && v.readyState > 2,
      }));
      const i = pickAnchor(shaped, { width: window.innerWidth, height: window.innerHeight });

      let pos: { top: number; left: number };
      if (i < 0) {
        // Không tìm thấy video nào dùng được: lùi về góc trên phải CỬA SỔ, không
        // biến mất — spec §5.1.1 yêu cầu nút vẫn phải bấm được.
        anchored = null;
        pos = { top: BTN_PAD, left: window.innerWidth - BTN_SIZE - BTN_PAD };
      } else {
        anchored = vids[i];
        pos = buttonPos(shaped[i].rect, BTN_SIZE, BTN_PAD);
      }
      fab.style.top = `${pos.top}px`;
      fab.style.left = `${pos.left}px`;
      placePanel(pos);
      applyFabVisibility();
    }

    /**
     * Panel bám theo nút: gọi mỗi lần nút đổi chỗ (cuộn, đổi cỡ) và lúc mở.
     * Panel đang ẩn thì vẫn đặt — để lần mở kế tiếp không hiện ra ở chỗ cũ.
     */
    function placePanel(btn: { top: number; left: number }): void {
      const root = ui.shadow.querySelector('.sl-panel');
      if (!(root instanceof HTMLElement)) return;
      const p = panelPos(btn, BTN_SIZE, BTN_PAD, { width: window.innerWidth, height: window.innerHeight });
      root.style.top = `${p.top}px`;
      root.style.left = `${p.left}px`;
    }

    // Theo dõi bằng observer, KHÔNG bằng setInterval: đổi kích thước, cuộn,
    // vào toàn màn hình, và SPA thay hẳn phần tử video — mỗi thứ có một sự
    // kiện riêng, poll chỉ là cách né việc nghe cho đúng.
    const ro = new ResizeObserver(() => place());
    const io = new IntersectionObserver(() => place());
    const mo = new MutationObserver(() => {
      observeAll();
      place();
    });

    function observeAll(): void {
      ro.disconnect();
      io.disconnect();
      for (const v of document.querySelectorAll('video')) {
        ro.observe(v);
        io.observe(v);
      }
    }

    mo.observe(document.documentElement, { childList: true, subtree: true });
    observeAll();
    place();

    // Cuộn và đổi cỡ cửa sổ không sinh ResizeObserver trên chính phần tử video,
    // nên vẫn phải nghe hai sự kiện này. `passive` để không cản cuộn.
    const onScroll = () => place();
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    window.addEventListener('resize', onScroll, { passive: true });
    document.addEventListener('fullscreenchange', onScroll, true);

    ctx.onInvalidated(() => {
      ro.disconnect();
      io.disconnect();
      mo.disconnect();
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      document.removeEventListener('fullscreenchange', onScroll, true);
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('click', onDocClick, true);
      clearInterval(hoverTick);
    });

    // Mount ngay để nút nổi lên trang — không có cách nào bấm mở panel lần
    // đầu nếu chờ chính cú bấm đó mới mount. Panel bên trong vẫn đóng: onMount
    // chỉ ẩn nó đi (display:none), không vẽ nội dung.
    ui.mount();

    /**
     * Chọn stream để tải: DÀI NHẤT, không phải mới nhất.
     *
     * Trang phát phim nạp nhiều manifest từ nhiều host cùng lúc, và quảng cáo
     * thường nạp sau — lấy cái mới nhất là lấy trúng quảng cáo (đã gặp: tải về
     * một file 805 KB toàn quảng cáo trong khi phim dài một tiếng).
     * Thời lượng tách hai thứ đó dứt khoát mà không cần đoán tên miền.
     * Chưa đo xong thì tạm giữ nếp cũ là cái mới nhất.
     */
    /**
     * Thời lượng phim mà TRANG đang phát, lấy từ thẻ <video>.
     *
     * Đây là tín hiệu chuẩn nhất: trang biết chính xác nó đang phát gì. Đọc
     * `.duration` không vi phạm B7 — B7 cấm đọc `.src` (blob URL của MSE thì
     * tải không được), còn thời lượng chỉ là một con số.
     */
    function pageDuration(): number | null {
      for (const v of document.querySelectorAll('video')) {
        const d = (v as HTMLVideoElement).duration;
        if (Number.isFinite(d) && d > 0) return d;
      }
      return null;
    }



    /**
     * Danh sách chất lượng đọc thẳng từ HTML trang (hiện chỉ YouTube).
     *
     * Rẻ đến mức không cần điều kiện theo tên miền: không thấy dữ liệu thì trả
     * rỗng và người gọi đi đường cũ. Gắn theo tên miền sẽ là đưa danh sách site
     * vào code, mà đó đúng thứ CLAUDE.md §3.1 cấm.
     */
    function parsePage(html: string): FormatOption[] {
      try {
        const pr = extractPlayerResponse(html);
        if (!pr) return [];
        // Đối chiếu id: trang có thể mang dữ liệu của video KHÁC — YouTube điều
        // hướng kiểu SPA nên khối cũ còn sót lại. Lệch id thì coi như không có;
        // thà đi đường chậm còn hơn tải nhầm video.
        if (!sameVideo(currentVideoId(location.href), playerResponseVideoId(pr))) return [];
        return formatsFromPlayerResponse(pr);
      } catch (err) {
        console.warn('[Streamloot] đọc danh sách từ trang hỏng:', err);
        return [];
      }
    }

    /**
     * Danh sách chất lượng lấy từ chính trang.
     *
     * Đọc DOM trước vì rẻ. Nhưng DOM thường KHÔNG còn dữ liệu: YouTube xoá các
     * thẻ `<script>` bootstrap sau khi chạy để giải phóng bộ nhớ, nên
     * `innerHTML` không có `ytInitialPlayerResponse` dù HTML máy chủ trả thì có
     * (đo: 1.39 MB, 27 format).
     *
     * Lúc đó tải lại chính URL này — same-origin nên không vướng CORS, và bản
     * máy chủ trả luôn ứng với video ĐANG mở, nên giải quyết luôn ca điều hướng
     * SPA. Vẫn rẻ hơn nhiều so với đường backend (hai lần chạy yt-dlp).
     */
    async function formatsFromPage(): Promise<FormatOption[]> {
      const fromDom = parsePage(document.documentElement.innerHTML);
      if (fromDom.length) return fromDom;
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), PAGE_FETCH_TIMEOUT_MS);
        try {
          const res = await fetch(location.href, {
            credentials: 'same-origin',
            headers: { Accept: 'text/html' },
            signal: ctl.signal,
          });
          if (!res.ok) return [];
          return parsePage(await res.text());
        } finally {
          clearTimeout(timer);
        }
      } catch (err) {
        console.warn('[Streamloot] tải lại trang để đọc danh sách hỏng:', err);
        return [];
      }
    }

    /**
     * Video có URL file hoàn chỉnh nhúng sẵn trong HTML trang.
     *
     * Đọc `innerHTML` là dựng một chuỗi vài MB (trang Facebook đo được 7 MB),
     * nên CHỈ gọi khi người dùng mở panel — không gọi theo nhịp.
     */
    function videosFromPage(): FbVideo[] {
      try {
        return extractVideos(document.documentElement.innerHTML);
      } catch (err) {
        console.warn('[Streamloot] đọc video từ trang hỏng:', err);
        return [];
      }
    }

    /** Quá ngưỡng này thì bỏ, đi đường backend. */
    const PAGE_FETCH_TIMEOUT_MS = 5000;

    function render(root: HTMLElement) {
      const cap = pickCapture(captures, {
        pageHost: location.hostname,
        pageDurationSec: pageDuration(),
        chosenUrl,
      });
      // Vì sao chọn cái này: in ra để khi chọn sai còn có cơ sở mà lần, thay vì
      // phải đoán từ ảnh chụp màn hình. Referer là tín hiệu chính, nên nó phải
      // nhìn thấy được.
      console.debug(
        '[Streamloot] ứng viên:',
        captures.map((c) => ({
          host: c.host,
          referer: c.referer,
          duration: c.durationSec,
        })),
        '| trang:', location.hostname,
        '| thời lượng <video>:', pageDuration(),
        '| chọn:', cap?.host,
      );
      // Bắt được manifest thì ĐI ĐƯỜNG MANIFEST, kể cả site không có plugin.
      //
      // Trước đây site không plugin bị đẩy sang hỏi yt-dlp bằng URL trang, tức
      // chờ backend spawn tiến trình rồi tự tải lại đúng cái manifest ta đã có
      // trong tay. Giờ service worker đọc thẳng manifest đó (declarativeNetRequest
      // đặt hộ Referer), nên đường này vừa nhanh hơn vừa không đòi app phải chạy.
      // Đọc không ra thì nhánh `!r.ok` bên dưới vẫn để lại một dòng cho backend
      // tự chọn, nên không mất đường lùi.
      //
      // Không bắt được manifest nào mới đi đường yt-dlp: trang vẫn tải được
      // (YouTube chẳng hạn, vốn không dùng manifest file).
      const byUrl = !cap;
      if (byUrl && !hasVideo()) return;

      root.innerHTML = '';
      const head = document.createElement('div');
      head.className = 'sl-head';
      const logo = document.createElement('span');
      logo.className = 'sl-logo';
      logo.textContent = '⤓';
      const title = document.createElement('div');
      title.className = 'sl-title';
      title.textContent = 'Chọn để tải';
      const close = document.createElement('button');
      close.className = 'sl-x';
      close.textContent = '✕';
      close.onclick = () => {
        // Chỉ ẩn, không ui.remove() — remove() gỡ luôn nút nổi khỏi trang
        // (nó sống chung shadow host với panel), mà nút phải còn đó để mở lại.
        mounted = false;
        root.style.display = 'none';
        // Không ép trạng thái rê chuột: con trỏ vẫn đang ở trên video. Mốc
        // lastOverAt quyết định, và nó chỉ cũ đi khi con trỏ thật sự rời đi.
        applyFabVisibility();
      };
      head.append(logo, title, close);

      const list = document.createElement('div');
      list.className = 'sl-list';

      const msg = document.createElement('div');
      msg.className = 'sl-msg';

      root.append(head, list, msg);

      const say = (text: string, isError = false) => {
        msg.textContent = text;
        msg.className = isError ? 'sl-msg sl-err' : 'sl-msg';
      };

      // Có một lệnh tải đang bay không. Bấm dồn trong lúc `await ask(...)` chưa
      // trả lời sẽ sinh hai download trùng file — canSubmit là quyết định
      // (testable), disable từng dòng là phần vẽ (không testable, ADR 0006).
      let pending = false;
      const rowEls: HTMLElement[] = [];
      const setPending = (v: boolean) => {
        pending = v;
        for (const el of rowEls) el.classList.toggle('sl-pending', v);
      };

      /** Một dòng bấm được. Bấm là tải luôn — không có bước xác nhận (§5.1). */
      function addRow(row: FormatRow): void {
        const el = document.createElement('div');
        el.className = row.recommended ? 'sl-row-item sl-rec' : 'sl-row-item';
        // Ba cột như Cốc Cốc: tên cấp · độ phân giải · đuôi. Không rõ tên cấp
        // thì cột 1 lấy luôn độ phân giải, cột 2 để trống — không bịa.
        const c1 = document.createElement('span');
        c1.className = 'sl-row-label';
        c1.textContent = row.name || row.label;
        const c2 = document.createElement('span');
        c2.className = 'sl-row-res';
        c2.textContent = row.name ? row.label : '';
        const c3 = document.createElement('span');
        c3.className = 'sl-row-ext';
        c3.textContent = row.ext ? `.${row.ext}` : '';
        el.append(c1, c2, c3);
        el.onclick = () => {
          if (!canSubmit(pending)) return; // đang bay — bấm thêm không làm gì
          void (row.directUrl
            ? saveDirect(row)
            : row.manifestXml
            ? startByManifest(row)
            : row.pageUrl
            ? startByPageUrl(row)
            : startDownload(row));
        };
        rowEls.push(el);
        list.append(el);
      }

      function addGroup(title: string, icon: string, rows: FormatRow[]): void {
        if (!rows.length) return;
        const h = document.createElement('div');
        h.className = 'sl-group';
        const ic = document.createElement('span');
        ic.className = 'sl-group-ic';
        ic.textContent = icon;
        h.append(ic, document.createTextNode(title));
        list.append(h);
        for (const r of rows) addRow(r);
      }

      /**
       * Gửi lệnh tải rồi ĐÓNG panel (§5.1).
       *
       * Panel là bộ chọn format, không phải trình quản lý: nó không theo dõi gì
       * sau khi bàn giao. Muốn xem tiến trình thì mở popup, hoặc nhìn vòng trên
       * icon. Để panel ở lại là chắn mất video người dùng đang xem.
       */
      /**
       * Đường lùi cuối: nhờ yt-dlp tải từ URL xem của chính video đó.
       *
       * Dùng khi video không có progressive lẫn manifest. Gửi URL RIÊNG của
       * video chứ không phải `location.href` — trang feed có nhiều video, gửi
       * URL trang thì backend tải nhầm cái đầu tiên nó thấy.
       */
      async function startByPageUrl(row: FormatRow): Promise<void> {
        setPending(true);
        say('Đang giao cho app tải…');
        let r: { ok: boolean; error?: string };
        try {
          r = await ask<{ ok: boolean; error?: string }>({
            type: 'startByUrl',
            url: row.pageUrl,
            formatId: row.formatId || null,
          });
        } catch (err) {
          say(err instanceof Error ? err.message : String(err), true);
          setPending(false);
          return;
        }
        if (!r.ok) {
          say(r.error ?? 'Cần mở app Streamloot để tải video này', true);
          setPending(false);
          return;
        }
        mounted = false;
        setPending(false);
        root.style.display = 'none';
        applyFabVisibility();
      }

      /**
       * Mức chất lượng chỉ có trong manifest DASH — phải qua backend.
       *
       * DASH tách hình khỏi tiếng nên cần ghép. Ghép trong trình duyệt thì phải
       * nhúng ffmpeg-wasm (~5 MB), cái giá ADR 0007 D3 đã từ chối. Backend có
       * ffmpeg thật và nhanh hơn hẳn.
       */
      async function startByManifest(row: FormatRow): Promise<void> {
        setPending(true);
        say('Đang giao cho app tải…');
        let r: { ok: boolean; error?: string };
        try {
          r = await ask<{ ok: boolean; error?: string }>({
            type: 'startByManifest',
            manifestXml: row.manifestXml,
            title: cleanTitle(document.title, location.hostname),
            url: location.href,
            formatId: row.formatId || null,
          });
        } catch (err) {
          say(err instanceof Error ? err.message : String(err), true);
          setPending(false);
          return;
        }
        if (!r.ok) {
          // Đường này cần app đang chạy — nói rõ thay vì để người dùng đoán.
          say(r.error ?? 'Cần mở app Streamloot để tải mức này', true);
          setPending(false);
          return;
        }
        mounted = false;
        setPending(false);
        root.style.display = 'none';
        applyFabVisibility();
      }

      /**
       * Tải THẲNG bằng trình duyệt, không đụng tới backend (ADR 0007 D2).
       *
       * Dùng cho URL là file hoàn chỉnh đã có sẵn tiếng. Chạy được cả khi app
       * Streamloot chưa mở — đó là cả điểm của đường này.
       */
      async function saveDirect(row: FormatRow): Promise<void> {
        setPending(true);
        say('Đang giao cho trình duyệt tải…');
        let r: { ok: boolean; error?: string };
        try {
          r = await ask<{ ok: boolean; error?: string }>({
            type: 'saveDirect',
            url: row.directUrl,
            filename: row.fileName ?? 'video.mp4',
          });
        } catch (err) {
          say(err instanceof Error ? err.message : String(err), true);
          setPending(false);
          return;
        }
        if (!r.ok) {
          say(r.error ?? 'Không tải được', true);
          setPending(false);
          return;
        }
        mounted = false;
        setPending(false);
        root.style.display = 'none';
        applyFabVisibility();
      }

      async function startDownload(row: FormatRow): Promise<void> {
        setPending(true);
        say('Đang bắt đầu…');
        let r: { ok: boolean; error?: string };
        // Dòng lấy từ master m3u8 mang URL biến thể: tải bằng chính URL đó làm
        // m3u8_url và bỏ format_id — yt-dlp tải thẳng media playlist, không
        // phải dò lại. format_id `hls-<bandwidth>` của nó không ổn định.
        const info = row.url && payload ? { ...payload, m3u8_url: row.url } : payload;
        const formatId = row.url ? null : row.formatId || null;
        try {
          r = await ask<{ ok: boolean; error?: string }>(
            byUrl
              ? { type: 'startByUrl', url: location.href, formatId }
              : { type: 'startDownload', info: info!, formatId },
          );
        } catch (err) {
          say(err instanceof Error ? err.message : String(err), true);
          setPending(false); // panel ở lại — phải bấm lại được
          return;
        }
        if (!r.ok) {
          // Lỗi thì GIỮ panel mở: đóng lại là người dùng mất cả thông báo lẫn
          // danh sách vừa chọn.
          say(r.error ?? 'Tải thất bại', true);
          setPending(false);
          return;
        }
        // Chỉ ẩn, không ui.remove() — remove() gỡ luôn nút nổi khỏi trang (nó
        // sống chung shadow host với panel, như nút ✕ ở trên đã xử lý đúng).
        mounted = false;
        setPending(false); // mở lại panel lần sau phải bấm được ngay, không kẹt
        root.style.display = 'none';
        applyFabVisibility(); // vị trí chuột thật quyết định, không ép trạng thái
      }

      // Nạp danh sách chất lượng ngay — người dùng chọn TRƯỚC khi bàn giao, đúng
      // cách IDM và Cốc Cốc làm (ADR 0005 §2.5d).
      const payload = cap ? toPayload(cap) : null;
      say(byUrl ? 'Đang hỏi yt-dlp xem trang này tải được không…' : 'Đang lấy danh sách chất lượng…');
      // Trang nhúng sẵn URL file hoàn chỉnh (Facebook — ADR 0007).
      //
      // Nhận diện theo HÌNH DẠNG DỮ LIỆU, không theo tên miền: không thấy thì
      // trả rỗng và đi đường cũ. Gắn theo tên miền là đưa danh sách site vào
      // code, mà CLAUDE.md §3.1 cấm.
      const all = videosFromPage();
      if (all.length) {
        // Trang feed có nhiều video, nhưng nút nổi neo vào ĐÚNG MỘT cái. Gắn
        // theo thời lượng: `<video>` và manifest đều biết con số đó, còn
        // `<video>` thì không mang id nào để đối chiếu.
        //
        // Không chắc thì hiện cả danh sách, KHÔNG đoán: đưa nhầm video là thứ
        // người dùng không có cách nào tự phát hiện trước khi tải xong.
        const dur = anchored?.duration ?? NaN;
        const hit = pickByDuration(all, dur);
        const embedded = hit >= 0 ? [all[hit]] : all;
        say(listLabel({ matched: hit >= 0, total: all.length }));
        embedded.forEach((v, i) => {
          const rows: FormatRow[] = v.progressive.map((p) => ({
            formatId: '',
            label: p.quality || 'video',
            detail: 'mp4',
            recommended: p.quality.toUpperCase() === 'HD',
            name: p.quality || 'Video',
            ext: 'mp4',
            url: null,
            directUrl: p.url,
            fileName: downloadName({
              title: cleanTitle(document.title, location.hostname),
              id: v.id,
              quality: p.quality,
              ext: 'mp4',
            }),
          }));
          const secs = v.lengthSec;
          const dur = typeof secs === 'number' && secs > 0
            ? ` · ${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}`
            : '';
          addGroup(embedded.length > 1 ? `VIDEO ${i + 1}${dur}` : `VIDEO${dur}`, '▭', rows);

          // Mức cao hơn nằm trong manifest DASH. Chọn theo CHIỀU CAO chứ không
          // theo id: id do yt-dlp tự đặt, không đoán trước được.
          if (v.manifestXml) {
            const heights = [...new Set(
              parseMpd(v.manifestXml)
                .filter((r) => !r.audioOnly && r.height)
                .map((r) => r.height as number),
            )].sort((a, b) => b - a);
            const hi: FormatRow[] = heights.map((h) => ({
              formatId: `bv*[height=${h}]+ba/b[height=${h}]`,
              label: `${h}p`,
              detail: 'mp4',
              recommended: false,
              name: qualityName(h),
              ext: 'mp4',
              url: null,
              manifestXml: v.manifestXml ?? undefined,
            }));
            addGroup('CHẤT LƯỢNG CAO (cần app)', '▲', hi);
          }

          // Không có mức nào đọc được: còn permalink thì nhờ yt-dlp.
          if (!rows.length && !v.manifestXml) {
            const pageUrl = v.permalinkUrl ?? watchUrl(v.id);
            if (pageUrl) {
              addGroup('VIDEO', '▭', [{
                formatId: '',
                label: 'Chất lượng tốt nhất',
                detail: 'app tự chọn',
                recommended: true,
                name: 'Tốt nhất',
                ext: 'mp4',
                url: null,
                pageUrl,
              }]);
            }
          }
        });
        return;
      }

      // Capture là FILE HOÀN CHỈNH (MP4/WebM): không có danh sách nào để lấy.
      //
      // Hỏi backend ở đây là treo panel ở "Đang lấy danh sách chất lượng…" cho
      // tới khi hết giờ — đúng lỗi đã gặp. Hiện ngay một dòng tải thẳng.
      if (cap?.kind === 'progressive') {
        const ext = extFromUrl(cap.url);
        // Độ phân giải lấy từ chính thẻ <video> đang phát: capture không mang
        // thông tin đó, nhưng trình duyệt thì biết. Nhờ vậy dòng hiện đúng tên
        // mức ("Full HD", "HD"…) thay vì một chữ "Gốc" chung chung.
        const h = anchored?.videoHeight || 0;
        const name = qualityName(h) || 'Gốc';
        say('Bấm một dòng để tải');
        addGroup('VIDEO', '▭', [{
          formatId: '',
          label: h > 0 ? `${h}p` : 'Chất lượng gốc',
          detail: ext,
          recommended: true,
          name,
          ext,
          url: null,
          directUrl: cap.url,
          fileName: downloadName({
            title: cleanTitle(document.title, location.hostname),
            id: cap.host,
            ext,
          }),
        }]);
        // Đường qua app làm dự phòng: nó gửi kèm Referer đã bắt được, nên chạy
        // được cả khi CDN từ chối lượt tải thẳng của trình duyệt (thiếu Referer).
        addGroup('NẾU TẢI THẲNG BỊ CHẶN', '▲', [{
          formatId: '',
          label: h > 0 ? `${h}p` : 'Chất lượng gốc',
          detail: ext,
          recommended: false,
          name: 'Qua app',
          ext,
          url: null,
        }]);
        return;
      }

      // Trang tự mang sẵn danh sách chất lượng (YouTube). Đọc được thì khỏi
      // phải đợi backend chạy yt-dlp hai lần. Tải thì vẫn giao cho backend —
      // nó lo phần giải chữ ký — nên đây thuần tuý là rút ngắn phần CHỜ.
      type FormatsReply = { ok: boolean; formats?: FormatOption[]; error?: string };
      const askFormats: Promise<FormatsReply> = byUrl
        ? formatsFromPage().then((f) =>
            f.length
              ? { ok: true as const, formats: f }
              : ask<FormatsReply>({ type: 'formatsByUrl', url: location.href }),
          )
        : ask<FormatsReply>({ type: 'listFormats', info: payload! });
      void askFormats.then((r) => {
        if (!r.ok) {
          if (byUrl) {
            say(r.error ?? 'Trang này chưa tải được', true);
            return;
          }
          // Không lấy được danh sách KHÔNG chặn việc tải (§7): vẫn cho một dòng
          // để backend tự chọn chất lượng tốt nhất.
          say(r.error ?? 'Không lấy được danh sách chất lượng');
          addGroup('VIDEO', '▭', [{
            formatId: '', label: 'Chất lượng tốt nhất', detail: 'backend tự chọn', recommended: true,
            name: '', ext: '', url: null,
          }]);
          return;
        }
        const { video, audio } = groupFormats(r.formats ?? []);
        addGroup('VIDEO', '▭', video);
        addGroup('ÂM THANH', '♪', audio);
        if (!video.length && !audio.length) {
          say('Không có chất lượng nào để chọn', true);
        } else {
          say('Bấm một dòng để tải');
        }
      }).catch((err: unknown) => {
        // THIẾU nhánh này là panel đứng mãi ở "Đang lấy danh sách chất lượng…":
        // ask() có hạn giờ và ném khi service worker không trả lời, mà promise
        // bị ném không ai bắt thì giao diện không bao giờ đổi. Đã gặp thật.
        say(err instanceof Error ? err.message : String(err), true);
      });
    }

    /** Trang có thẻ <video> thật sự phát được không. */
    function hasVideo(): boolean {
      for (const v of document.querySelectorAll('video')) {
        const el = v as HTMLVideoElement;
        if (el.currentSrc || el.src || Number.isFinite(el.duration)) return true;
      }
      return false;
    }

    function surface(next: Capture[]) {
      captures = next;
      if (!mounted) return; // panel chỉ mở khi người dùng bấm nút
      const root = ui.shadow.querySelector('.sl-panel');
      if (root instanceof HTMLElement) render(root);
    }

    fab.onclick = () => {
      const root = ui.shadow.querySelector('.sl-panel');
      if (!(root instanceof HTMLElement)) return;
      // ui.mount() đã chạy ngay từ đầu (để nút hiện ra) — bấm nút chỉ còn việc
      // mở panel ra và vẽ nội dung, không cần mount lại.
      mounted = true;
      applyFabVisibility();
      // Đặt panel theo vị trí HIỆN TẠI của nút trước khi hiện — nút có thể đã
      // dời chỗ từ lần placePanel gần nhất mà panel lúc đó chưa được mount.
      placePanel({ top: parseFloat(fab.style.top) || 0, left: parseFloat(fab.style.left) || 0 });
      root.style.display = '';
      render(root);
    };

    browser.runtime.onMessage.addListener((msg) => {
      const m = msg as { type?: string; captures?: Capture[] };
      if (m?.type === 'captures' && m.captures) surface(m.captures);
    });

    // Service worker có thể đã bắt được manifest TRƯỚC khi content script nạp
    // xong (SPA điều hướng, hoặc trang tải chậm) — hỏi lại một lần lúc khởi động.
    // Không để lời gọi này ném ra ngoài: content script mồ côi (extension vừa
    // nạp lại) sẽ ném ngay tại đây và giết luôn phần khởi tạo còn lại bên dưới,
    // nên panel không bao giờ xuất hiện để nói cho người dùng biết vì sao.
    try {
      const existing = (await browser.runtime.sendMessage({ type: 'getCaptures' })) as Capture[];
      if (existing?.length) surface(existing);
      else surface([]); // không có manifest nhưng trang có thể vẫn có <video>
    } catch (err) {
      if (isOrphaned(err)) console.warn('[Streamloot]', RELOAD_PAGE_MSG);
      else console.warn('[Streamloot] không hỏi được stream đã bắt:', err);
    }

    // Panel là bề mặt xem thứ hai bên cạnh popup (spec §4.2 hàng 1) — nếu chỉ
    // popup báo viewer thì mở mỗi panel vẫn poll ở nhịp 60s.
    void browser.runtime.sendMessage({ type: 'viewerOpen' }).catch(() => {});
    // F4 — chỉ gỡ ở onInvalidated (extension reload) là không đủ: điều hướng
    // SPA hay đóng tab không invalidate context, nên viewers chỉ tăng không
    // bao giờ giảm. Theo đúng mẫu popup/main.ts: cặp với 'pagehide', bắn ở CẢ
    // điều hướng thường lẫn khi trang vào bfcache (dù bfcache có bật lại thì
    // panel cũng mount lại và gửi viewerOpen mới, không lệch vĩnh viễn).
    window.addEventListener('pagehide', () => {
      void browser.runtime.sendMessage({ type: 'viewerClosed' }).catch(() => {});
    });

    // Video thường nạp SAU khi content script chạy (SPA, lazy player), nên một
    // lần kiểm lúc khởi động là hụt. Nghe sự kiện thay vì poll: rẻ hơn và bắt
    // đúng khoảnh khắc video sẵn sàng.
    //
    // Chỉ gọi khi CHƯA mount: mount rồi mà vẽ lại thì nó hỏi format lần nữa và
    // có thể xoá trạng thái đang tải trên màn hình.
    const onVideoReady = () => {
      if (!mounted) surface(captures);
    };
    document.addEventListener('loadedmetadata', onVideoReady, true);
    document.addEventListener('play', onVideoReady, true);

    ctx.onInvalidated(() => {
      document.removeEventListener('loadedmetadata', onVideoReady, true);
      document.removeEventListener('play', onVideoReady, true);
      void browser.runtime.sendMessage({ type: 'viewerClosed' }).catch(() => {});
    });
}
