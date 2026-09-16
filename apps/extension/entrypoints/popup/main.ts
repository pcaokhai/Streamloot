import * as api from '../../lib/api';
import { loadSettings } from '../../lib/settings';
import type { Capture } from '../../lib/types';

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

async function render() {
  const status = document.getElementById('status')!;
  const hint = document.getElementById('hint')!;
  const caps = document.getElementById('caps')!;
  const { apiKey, port } = await loadSettings();

  // B6 — phân biệt ba trạng thái. "Không kết nối được" mà không nói vì sao thì
  // người dùng không biết phải sửa gì.
  if (!apiKey) {
    status.innerHTML = '<span class="dot off"></span>Chưa cấu hình';
    hint.textContent = 'Chưa có API key. Mở Cài đặt và dán key mà app hiện ra.';
  } else if (await api.ping()) {
    status.innerHTML = '<span class="dot on"></span>Đã kết nối';
    hint.textContent = `Backend 127.0.0.1:${port}`;
  } else {
    status.innerHTML = '<span class="dot off"></span>Không kết nối được';
    hint.textContent = `Không gọi được 127.0.0.1:${port}. App Streamloot đã chạy chưa? Kiểm tra icon ⤓ trên menu bar.`;
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

void render();
