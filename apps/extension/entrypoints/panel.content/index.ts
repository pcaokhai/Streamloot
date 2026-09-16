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
import * as api from '../../lib/api';
import { BackendError } from '../../lib/api';
import type { Capture, FormatOption, VideoInfoPayload } from '../../lib/types';

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
    let abort: AbortController | null = null;

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
      api
        .listFormats(payload)
        .then(({ formats }: { formats: FormatOption[] }) => {
          const heights = [...new Set(formats.map((f) => f.height).filter(Boolean))] as number[];
          heights.sort((a, b) => b - a);
          for (const h of heights) {
            const o = document.createElement('option');
            o.value = String(h);
            o.textContent = `${h}p`;
            select.append(o);
          }
          say(heights.length ? `${heights.length} chất lượng` : 'Chỉ có một chất lượng');
        })
        .catch((e: unknown) => {
          // Không chặn việc tải: backend vẫn tự chọn được chất lượng tốt nhất.
          say(e instanceof BackendError ? e.message : 'Không lấy được danh sách chất lượng');
        });

      btn.onclick = async () => {
        btn.disabled = true;
        say('Đang bắt đầu…');
        try {
          const { task_id } = await api.startDownload(payload, select.value || null);
          bar.style.display = '';
          abort = new AbortController();
          await api.streamProgress(
            task_id,
            (e) => {
              fill.style.width = `${Math.round(e.completed ?? 0)}%`;
              say(`${e.description ?? e.status} · ${e.speed ?? ''}`.trim());
            },
            abort.signal,
          );
        } catch (e) {
          say(e instanceof BackendError ? e.message : 'Tải thất bại', true);
        } finally {
          btn.disabled = false;
        }
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
      const m = msg as { type?: string; captures?: Capture[] };
      if (m?.type === 'captures' && m.captures) surface(m.captures);
    });

    // Service worker có thể đã bắt được manifest TRƯỚC khi content script nạp
    // xong (SPA điều hướng, hoặc trang tải chậm) — hỏi lại một lần lúc khởi động.
    const existing = (await browser.runtime.sendMessage({ type: 'getCaptures' })) as Capture[];
    if (existing?.length) surface(existing);

    ctx.onInvalidated(() => abort?.abort());
  },
});
