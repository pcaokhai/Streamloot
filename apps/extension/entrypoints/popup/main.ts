import * as api from '../../lib/api';
import { loadSettings } from '../../lib/settings';
import type { Capture } from '../../lib/types';

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

async function render() {
  const status = document.getElementById('status')!;
  const hint = document.getElementById('hint')!;
  const caps = document.getElementById('caps')!;
  const { port } = await loadSettings();

  // B6 — ba trạng thái, không phải hai. "App chưa chạy" và "app từ chối" sửa
  // theo hai cách hoàn toàn khác nhau; gộp lại là chỉ sai đường cho người dùng.
  const state = await api.health();
  if (state === 'ok') {
    status.innerHTML = '<span class="dot on"></span>Đã kết nối';
    hint.textContent = `Backend 127.0.0.1:${port}`;
  } else if (state === 'unreachable') {
    status.innerHTML = '<span class="dot off"></span>App chưa chạy';
    hint.textContent = `Không gọi được 127.0.0.1:${port}. Mở app Streamloot — kiểm tra icon ⤓ trên menu bar.`;
  } else {
    status.innerHTML = '<span class="dot off"></span>App từ chối extension này';
    hint.textContent =
      'App đang chạy nhưng không nhận diện được extension. Thường là do bản build thiếu `key` trong manifest nên ID không khớp. Build lại rồi Reload extension.';
  }

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return;
  const list = (await browser.runtime.sendMessage({ type: 'getCaptures', tabId: tab.id })) as Capture[];
  caps.innerHTML = list?.length
    ? '<table>' + list.map((c) => `<tr><td class="h">${esc(c.host)}</td></tr>`).join('') + '</table>'
    : '<div class="hint">Chưa bắt được stream nào trên tab này.</div>';
}

document.getElementById('opts')!.addEventListener('click', () => {
  void browser.runtime.openOptionsPage();
});

// render() không bọc lỗi thì mọi exception (storage hỏng, bridge chưa sẵn
// sàng, JSON lỗi) đều để popup nằm nguyên ở "Đang kiểm tra…" — người dùng thấy
// một cái popup treo và không có gì để báo lại. Hiện lỗi ra ngay trong popup.
void render().catch((err) => {
  const status = document.getElementById('status');
  const hint = document.getElementById('hint');
  if (status) status.innerHTML = '<span class="dot off"></span>Popup lỗi';
  if (hint) hint.textContent = String(err?.message ?? err);
  console.error('Streamloot popup:', err);
});
