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
import type { Capture, FormatOption, ProgressEvent, VideoInfoPayload } from '../../lib/types';
import { pickCapture } from '../../lib/pick';
import { pickAnchor, buttonPos, BTN_SIZE, BTN_PAD } from '../../lib/anchor';

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
    title: document.title || cap.host,
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
    let activeTask: string | null = null;
    // URL người dùng tự chọn trong danh sách stream — null là để hệ thống tự chọn.
    let chosenUrl: string | null = null;
    /**
     * Site này có plugin riêng không. `null` = chưa hỏi xong.
     *
     * Chưa biết thì coi như CÓ: giữ đường manifest vốn đã chạy, thay vì nhảy
     * sang yt-dlp rồi lại phải vẽ lại khi câu trả lời về.
     */
    let sitePlugin: boolean | null = null;
    let onProgress: ((e?: ProgressEvent, err?: string) => void) | null = null;

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

    /** Đo lại và đặt nút. Gọi từ observer, không từ bộ đếm. */
    function place(): void {
      const vids = [...document.querySelectorAll('video')] as HTMLVideoElement[];
      const shaped = vids.map((v) => ({
        rect: v.getBoundingClientRect(),
        playing: !v.paused && !v.ended && v.readyState > 2,
      }));
      const i = pickAnchor(shaped, { width: window.innerWidth, height: window.innerHeight });

      if (i < 0) {
        // Không tìm thấy video nào dùng được: lùi về góc trên phải CỬA SỔ, không
        // biến mất — spec §5.1.1 yêu cầu nút vẫn phải bấm được.
        anchored = null;
        fab.style.top = `${BTN_PAD}px`;
        fab.style.left = `${window.innerWidth - BTN_SIZE - BTN_PAD}px`;
        return;
      }
      anchored = vids[i];
      const pos = buttonPos(shaped[i].rect, BTN_SIZE, BTN_PAD);
      fab.style.top = `${pos.top}px`;
      fab.style.left = `${pos.left}px`;
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


    const fmtDur = (sec?: number | null): string => {
      // undefined = chưa đo xong; null = đo rồi mà không ra. Gộp hai cái làm một
      // là nói dối: người dùng ngồi đợi một phép đo đã kết thúc từ lâu.
      if (sec === undefined) return 'đang đo…';
      if (sec === null || sec <= 0) return 'không đo được';
      if (typeof sec !== 'number') return 'không đo được';
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = Math.floor(sec % 60);
      return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
               : `${m}:${String(s).padStart(2, '0')}`;
    };

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
      // Không bắt được manifest nào không còn nghĩa là bó tay: trang vẫn có thể
      // tải được qua yt-dlp (YouTube chẳng hạn, vốn không dùng manifest file).
      // Lúc đó panel chuyển sang hỏi thẳng backend bằng URL trang.
      // Đi đường yt-dlp khi KHÔNG bắt được manifest, HOẶC khi site không có
      // plugin riêng. Site có plugin thì manifest là đường đúng: plugin làm
      // những việc riêng của site (gỡ nguỵ trang segment, header, cookie) mà
      // hỏi yt-dlp bằng URL trang sẽ mất sạch.
      const byUrl = !cap || sitePlugin === false;
      if (byUrl && !hasVideo()) return;

      root.innerHTML = '';
      const head = document.createElement('div');
      head.className = 'sl-head';
      const title = document.createElement('div');
      title.className = 'sl-title';
      title.textContent = byUrl
        ? 'Streamloot — trang này'
        : `Streamloot — ${captures.length} stream`;
      const close = document.createElement('button');
      close.className = 'sl-x';
      close.textContent = '✕';
      close.onclick = () => {
        // Chỉ ẩn, không ui.remove() — remove() gỡ luôn nút nổi khỏi trang
        // (nó sống chung shadow host với panel), mà nút phải còn đó để mở lại.
        mounted = false;
        root.style.display = 'none';
      };
      head.append(title, close);

      const sub = document.createElement('div');
      sub.className = 'sl-sub';
      sub.textContent = byUrl
        ? `${location.hostname} · hỏi qua yt-dlp`
        : `${cap!.host} · ${fmtDur(cap!.durationSec)}`;

      // Nhiều stream thì cho chọn tay: phép đo thời lượng đúng gần hết các lần,
      // nhưng khi nó sai thì người dùng phải có đường sửa, chứ không phải tải về
      // rồi mới biết nhầm.
      let picker: HTMLSelectElement | null = null;
      if (!byUrl && captures.length > 1) {
        picker = document.createElement('select');
        const ranked = [...captures].sort(
          (a, b) => (b.durationSec ?? -1) - (a.durationSec ?? -1),
        );
        for (const c of ranked) {
          const o = document.createElement('option');
          o.value = c.url;
          o.textContent = `${c.host} · ${fmtDur(c.durationSec)}`;
          o.selected = c.url === cap!.url;
          picker.append(o);
        }
        picker.onchange = () => {
          chosenUrl = picker!.value;
          render(root);
        };
      }

      const row = document.createElement('div');
      row.className = 'sl-row';
      const select = document.createElement('select');
      select.innerHTML = '<option value="">Chất lượng tốt nhất</option>';
      const btn = document.createElement('button');
      btn.className = 'sl-btn';
      btn.textContent = 'Tải';
      row.append(select, btn);

      const msg = document.createElement('div');
      msg.className = 'sl-msg';
      const bar = document.createElement('div');
      bar.className = 'sl-bar';
      const fill = document.createElement('i');
      bar.append(fill);
      bar.style.display = 'none';

      root.append(head, sub);
      if (picker) root.append(picker);
      root.append(row, msg, bar);

      const say = (text: string, isError = false) => {
        msg.textContent = text;
        msg.className = isError ? 'sl-msg sl-err' : 'sl-msg';
      };

      // Nạp danh sách chất lượng ngay — người dùng chọn TRƯỚC khi bàn giao, đúng
      // cách IDM và Cốc Cốc làm (ADR 0005 §2.5d).
      const payload = cap ? toPayload(cap) : null;
      say(byUrl ? 'Đang hỏi yt-dlp xem trang này tải được không…' : 'Đang lấy danh sách chất lượng…');
      const askFormats = byUrl
        ? ask<{ ok: boolean; formats?: FormatOption[]; error?: string }>({
            type: 'formatsByUrl',
            url: location.href,
          })
        : ask<{ ok: boolean; formats?: FormatOption[]; error?: string }>({
            type: 'listFormats',
            info: payload!,
          });
      void askFormats.then((r) => {
        if (!r.ok) {
          if (byUrl) {
            // Không có manifest VÀ yt-dlp cũng chiều: thật sự bó tay. Nói thẳng,
            // đừng để người dùng bấm Tải rồi mới biết.
            say(r.error ?? 'Trang này chưa tải được', true);
            btn.disabled = true;
            return;
          }
          // Còn manifest thì vẫn tải được: backend tự chọn chất lượng tốt nhất.
          say(r.error ?? 'Không lấy được danh sách chất lượng');
          return;
        }
        const heights = [...new Set((r.formats ?? []).map((f) => f.height).filter(Boolean))] as number[];
        heights.sort((a, b) => b - a);
        for (const h of heights) {
          const o = document.createElement('option');
          o.value = String(h);
          o.textContent = `${h}p`;
          select.append(o);
        }
        say(heights.length ? `${heights.length} chất lượng` : 'Chỉ có một chất lượng');
      });

      btn.onclick = async () => {
        btn.disabled = true;
        say('Đang bắt đầu…');
        let r: { ok: boolean; taskId?: string; error?: string };
        try {
          r = await ask<{ ok: boolean; taskId?: string; error?: string }>(
            byUrl
              ? { type: 'startByUrl', url: location.href, formatId: select.value || null }
              : { type: 'startDownload', info: payload!, formatId: select.value || null },
          );
        } catch (err) {
          // Không bắt thì promise bị từ chối lặng lẽ và nút kẹt ở "Đang bắt đầu…".
          say(err instanceof Error ? err.message : String(err), true);
          btn.disabled = false;
          return;
        }
        if (!r.ok) {
          say(r.error ?? 'Tải thất bại', true);
          btn.disabled = false;
          return;
        }
        // Tiến trình do service worker đẩy về (xem onMessage 'progress').
        activeTask = r.taskId ?? null;
        onProgress = (e, err) => {
          if (err) {
            say(err, true);
            btn.disabled = false;
            return;
          }
          bar.style.display = '';
          fill.style.width = `${Math.round(e?.completed ?? 0)}%`;
          say(`${e?.description ?? e?.status ?? ''} · ${e?.speed ?? ''}`.trim());
          if (e && ['completed', 'failed', 'cancelled'].includes(e.status)) btn.disabled = false;
        };
      };
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
      root.style.display = '';
      render(root);
    };

    browser.runtime.onMessage.addListener((msg) => {
      const m = msg as {
        type?: string;
        captures?: Capture[];
        taskId?: string;
        event?: ProgressEvent;
        error?: string;
      };
      if (m?.type === 'captures' && m.captures) surface(m.captures);
      if (m?.type === 'progress' && m.taskId === activeTask) onProgress?.(m.event, m.error);
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

    // Hỏi một lần: site này có plugin riêng không. Quyết định panel đi đường
    // manifest hay đường yt-dlp, nên hỏi ngay chứ không đợi người dùng.
    void ask<{ plugin: boolean }>({ type: 'sitePlugin', url: location.href })
      .then((r) => {
        const changed = sitePlugin !== r.plugin;
        sitePlugin = r.plugin;
        // Vẽ lại chỉ khi câu trả lời ĐỔI quyết định và chưa có gì đang tải —
        // vẽ lại giữa chừng sẽ xoá thanh tiến trình đang chạy trên màn hình.
        if (changed && mounted && !activeTask) {
          const root = ui.shadow.querySelector('.sl-panel');
          if (root instanceof HTMLElement) render(root);
        }
      })
      .catch(() => {
        sitePlugin = true; // không hỏi được thì giữ đường manifest
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
      onProgress = null;
      void browser.runtime.sendMessage({ type: 'viewerClosed' }).catch(() => {});
    });
}
