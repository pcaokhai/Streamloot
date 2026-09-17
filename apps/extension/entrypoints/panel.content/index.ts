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

/**
 * Panel KHÔNG gọi HTTP trực tiếp.
 *
 * Trong MV3, `fetch` từ content script được Chrome gắn origin của TRANG chứ
 * không phải của extension — backend nhận diện extension qua Origin nên sẽ trả
 * 401. Mọi lời gọi đi qua service worker, nơi có đúng origin
 * `chrome-extension://<id>`.
 */
const ask = <T,>(msg: unknown): Promise<T> =>
  // Có hạn giờ: trong MV3, service worker bị giết khi rảnh, và nếu nó chết đúng
  // lúc đang xử lý thì `sendMessage` không bao giờ resolve — panel đứng im ở
  // "Đang bắt đầu…" và người dùng không biết là đang chờ hay đã hỏng.
  Promise.race([
    browser.runtime.sendMessage(msg) as Promise<T>,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('Service worker không trả lời (thử tải lại trang)')), 15000),
    ),
  ]);

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
  cssInjectionMode: 'ui',

  async main(ctx) {
    let captures: Capture[] = [];
    let mounted = false;
    let activeTask: string | null = null;
    let onProgress: ((e?: ProgressEvent, err?: string) => void) | null = null;

    const ui = await createShadowRootUi(ctx, {
      name: 'streamloot-panel',
      position: 'inline',
      anchor: 'body',
      onMount(container) {
        const root = document.createElement('div');
        root.className = 'sl-panel';
        container.append(root);
        render(root);
        return root;
      },
      onRemove(root) {
        root?.remove();
      },
    });

    function render(root: HTMLElement) {
      const cap = captures[captures.length - 1];
      if (!cap) return;

      root.innerHTML = '';
      const head = document.createElement('div');
      head.className = 'sl-head';
      const title = document.createElement('div');
      title.className = 'sl-title';
      title.textContent = `Streamloot — ${captures.length} stream`;
      const close = document.createElement('button');
      close.className = 'sl-x';
      close.textContent = '✕';
      close.onclick = () => {
        mounted = false;
        ui.remove();
      };
      head.append(title, close);

      const sub = document.createElement('div');
      sub.className = 'sl-sub';
      sub.textContent = cap.host;

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

      root.append(head, sub, row, msg, bar);

      const say = (text: string, isError = false) => {
        msg.textContent = text;
        msg.className = isError ? 'sl-msg sl-err' : 'sl-msg';
      };

      // Nạp danh sách chất lượng ngay — người dùng chọn TRƯỚC khi bàn giao, đúng
      // cách IDM và Cốc Cốc làm (ADR 0005 §2.5d).
      const payload = toPayload(cap);
      say('Đang lấy danh sách chất lượng…');
      void ask<{ ok: boolean; formats?: FormatOption[]; error?: string }>({
        type: 'listFormats',
        info: payload,
      }).then((r) => {
        if (!r.ok) {
          // Không chặn việc tải: backend vẫn tự chọn được chất lượng tốt nhất.
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
          r = await ask<{ ok: boolean; taskId?: string; error?: string }>({
            type: 'startDownload',
            info: payload,
            formatId: select.value || null,
          });
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

    function surface(next: Capture[]) {
      captures = next;
      if (!captures.length) return;
      if (!mounted) {
        mounted = true;
        ui.mount(); // B8 — tự nổi lên khi bắt được, không đợi người dùng đi tìm.
      } else {
        const root = ui.shadow.querySelector('.sl-panel');
        if (root instanceof HTMLElement) render(root);
      }
    }

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
    const existing = (await browser.runtime.sendMessage({ type: 'getCaptures' })) as Capture[];
    if (existing?.length) surface(existing);

    ctx.onInvalidated(() => {
      onProgress = null;
    });
  },
});
