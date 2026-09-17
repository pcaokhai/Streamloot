import * as api from '../../lib/api';
import { loadSettings } from '../../lib/settings';
import type { Capture, HistoryRow, TaskRecord } from '../../lib/types';
import { TERMINAL_STATUSES } from '../../lib/types';

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const el = (id: string) => document.getElementById(id)!;
const nameOf = (t: TaskRecord) => t.title || t.url;

// task_id đang có hành động bay tới backend. Nút của chúng phải luôn mờ, kể cả
// sau khi danh sách được vẽ lại — nếu không người dùng bấm được lần hai trong
// khoảng thời gian request còn đang bay.
const pending = new Set<string>();

// Đếm lượt gọi renderTasks còn hiệu lực. Interval 1s và click handler đều tự
// gọi renderTasks với fetch riêng, không đảm bảo thứ tự resolve — nếu không
// chặn, response cũ (bắt đầu trước) có thể về sau và ghi đè trạng thái mới.
let renderSeq = 0;

/**
 * Popup gọi thẳng backend, không qua service worker.
 *
 * Popup là extension page nên `fetch` mang đúng quyền host (spec §4.2); đi vòng
 * qua service worker chỉ thêm một chặng có thể chết giữa chừng.
 */
async function renderTasks(): Promise<void> {
  const mine = ++renderSeq;
  const box = el('tasks');
  let tasks: TaskRecord[];
  try {
    tasks = (await api.getActiveTasks()).tasks;
  } catch {
    // Response cũ về muộn thì bỏ: vẽ nó lên là xoá mất trạng thái người dùng vừa đổi.
    if (mine !== renderSeq) return;
    box.innerHTML = '<div class="empty">Không đọc được danh sách tải.</div>';
    return;
  }
  if (mine !== renderSeq) return;
  const live = tasks.filter((t) => !TERMINAL_STATUSES.has(t.status));
  if (!live.length) {
    box.innerHTML = '<div class="empty">Không có gì đang tải.</div>';
    return;
  }
  box.innerHTML = live.map((t) => {
    const paused = t.status === 'paused';
    const pct = Math.round(t.progress);
    const right = paused ? 'Tạm dừng' : `${pct}%`;
    const busy = pending.has(t.task_id);
    return `<div class="task" data-id="${esc(t.task_id)}">
      <div class="t"><span class="name">${esc(nameOf(t))}</span><span>${right}</span></div>
      <div class="bar${paused ? ' paused' : ''}"><i style="width:${pct}%"></i></div>
      <div class="t">
        <span class="hint">${esc(t.avg_speed ?? '')}</span>
        <span class="ctl">
          <button data-act="${paused ? 'resume' : 'pause'}"${busy ? ' disabled' : ''}>${paused ? '▶' : '⏸'}</button>
          <button data-act="cancel"${busy ? ' disabled' : ''}>✕</button>
        </span>
      </div>
    </div>`;
  }).join('');
}

async function renderHistory(): Promise<void> {
  const box = el('history');
  let rows: HistoryRow[];
  try {
    rows = await api.getHistory('extension');
  } catch {
    box.innerHTML = '<div class="empty">Không đọc được lịch sử.</div>';
    return;
  }
  if (!rows.length) {
    box.innerHTML = '<div class="empty">Chưa tải file nào qua extension.</div>';
    return;
  }
  box.innerHTML = '<table>' + rows.map((r) => {
    const ok = r.status === 'SUCCESS';
    return `<tr><td>${esc(r.title)}</td><td style="text-align:right">${ok ? '✓' : '✗'}</td></tr>`;
  }).join('') + '</table>';
}

async function renderCaptures(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return;
  const list = (await browser.runtime.sendMessage({ type: 'getCaptures', tabId: tab.id })) as Capture[];
  el('caps').innerHTML = list?.length
    ? `<div class="sep">Bắt được trên tab này: ${list.length}</div>`
      + '<table>' + list.map((c) => `<tr><td class="h">${esc(c.host)}</td></tr>`).join('') + '</table>'
    : '<div class="sep">Chưa bắt được stream nào trên tab này.</div>';
}

async function renderStatus(): Promise<void> {
  const { port } = await loadSettings();
  const t0 = performance.now();
  const state = await api.health();
  const ms = Math.round(performance.now() - t0);
  if (state === 'ok') {
    el('status').innerHTML = '<span class="dot on"></span>Đã kết nối';
    el('hint').textContent = `Backend 127.0.0.1:${port} · ${ms}ms`;
  } else if (state === 'unreachable') {
    el('status').innerHTML = '<span class="dot off"></span>App chưa chạy';
    el('hint').textContent = `Không gọi được 127.0.0.1:${port}. Mở app Streamloot — kiểm tra icon ⤓ trên menu bar.`;
  } else {
    el('status').innerHTML = '<span class="dot off"></span>App từ chối extension này';
    el('hint').textContent =
      'App đang chạy nhưng không nhận diện được extension. Thường là do bản build thiếu `key` trong manifest nên ID không khớp. Build lại rồi Reload extension.';
  }
}

function showTab(which: 'dl' | 'hist'): void {
  el('tab-dl').classList.toggle('on', which === 'dl');
  el('tab-hist').classList.toggle('on', which === 'hist');
  (el('pane-dl') as HTMLElement).hidden = which !== 'dl';
  (el('pane-hist') as HTMLElement).hidden = which === 'dl';
  if (which === 'hist') void renderHistory();
}

el('tab-dl').addEventListener('click', () => showTab('dl'));
el('tab-hist').addEventListener('click', () => showTab('hist'));
el('opts').addEventListener('click', () => void browser.runtime.openOptionsPage());

// Uỷ quyền sự kiện: danh sách vẽ lại mỗi giây nên gắn listener lên từng nút sẽ
// mất ngay ở lần vẽ kế tiếp.
el('tasks').addEventListener('click', (ev) => {
  const btn = (ev.target as HTMLElement).closest('button');
  const id = (ev.target as HTMLElement).closest('.task')?.getAttribute('data-id');
  if (!btn || !id || pending.has(id)) return;
  const act = btn.getAttribute('data-act');
  const call = act === 'pause' ? api.pauseTask : act === 'resume' ? api.resumeTask : api.cancelTask;
  pending.add(id);
  btn.disabled = true;
  void call(id)
    .then(() => { el('err').textContent = ''; })
    .catch((err) => { el('err').textContent = String(err?.message ?? err); })
    .finally(() => {
      pending.delete(id);
      void renderTasks();
    });
});

// Báo service worker là có người đang xem => nó chuyển sang nhịp 1s (spec §4.2).
void browser.runtime.sendMessage({ type: 'viewerOpen' }).catch(() => {});
window.addEventListener('pagehide', () => {
  void browser.runtime.sendMessage({ type: 'viewerClosed' }).catch(() => {});
});

const POLL_MS = 1000;
const timer = setInterval(() => void renderTasks(), POLL_MS);
window.addEventListener('pagehide', () => clearInterval(timer));

void (async () => {
  await renderStatus();
  await renderTasks();
  await renderCaptures();
})().catch((err) => {
  el('status').innerHTML = '<span class="dot off"></span>Popup lỗi';
  el('hint').textContent = String(err?.message ?? err);
  console.error('Streamloot popup:', err);
});
