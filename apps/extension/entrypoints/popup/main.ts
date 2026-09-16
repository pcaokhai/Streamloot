import type { Hit } from '../background';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

async function render() {
  const { hits = [] } = (await browser.storage.local.get('hits')) as { hits?: Hit[] };
  const { seenTotal = 0 } = (await browser.storage.session.get('seenTotal')) as { seenTotal?: number };
  const score = document.getElementById('score')!;
  const out = document.getElementById('out')!;

  // Một số 0 có hai nghĩa rất khác nhau. Phải nói rõ là nghĩa nào.
  if (!hits.length) {
    if (seenTotal === 0) {
      score.textContent = 'Probe chưa chạy';
      out.innerHTML =
        '<div class="empty"><b>Chưa quan sát được request nào.</b> Listener chưa chạy — thử tải lại trang, ' +
        'hoặc mở <code>chrome://extensions</code> → "service worker" xem log lỗi.</div>';
      return;
    }
    score.textContent = '0 manifest';
    out.innerHTML =
      `<div class="empty"><b>Probe chạy tốt</b> — đã quan sát ~${seenTotal}+ request, nhưng không có manifest nào.<br><br>` +
      'Site này không dùng HLS/DASH. YouTube video thường là ví dụ: media đi qua ' +
      '<code>googlevideo.com/videoplayback</code> + range request qua MSE, không có file manifest. ' +
      'Đây là kết quả hợp lệ, không phải lỗi.</div>';
    return;
  }

  // Nhóm theo TRANG, không theo CDN: câu hỏi "mấy trong 3 site" hỏi về trang.
  const byPage = new Map<string, Hit[]>();
  for (const h of hits) byPage.set(h.page, [...(byPage.get(h.page) ?? []), h]);
  score.textContent = `${byPage.size} site bắt được`;

  out.innerHTML =
    `<div class="sub">đã quan sát ~${seenTotal}+ request</div>` +
    '<table><tr><th>Trang</th><th>Manifest ở</th><th>Hits</th><th>Qua</th><th>Ngữ cảnh phiên</th></tr>' +
    [...byPage].map(([page, hs]) => {
      const cdns = [...new Set(hs.map((h) => h.host))].join(', ');
      const via = [...new Set(hs.map((h) => h.via))].join(' + ');
      // Lấy hit giàu ngữ cảnh nhất — một số request thiếu header mà request khác có.
      const best = hs.find((h) => h.ctx.cookie) ?? hs[0];
      const ctx = [
        best.ctx.cookie ? 'cookie' : null,
        best.ctx.referer ? 'referer' : null,
        best.ctx.origin ? 'origin' : null,
        best.ctx.userAgent ? 'ua' : null,
      ].filter(Boolean).join(', ') || '—';
      return `<tr><td class="host" title="${esc(page)}">${esc(page)}</td><td class="host" title="${esc(cdns)}">${esc(cdns)}</td><td>${hs.length}</td><td>${esc(via)}</td><td>${esc(ctx)}</td></tr>`;
    }).join('') +
    '</table>';
}

document.getElementById('clear')!.addEventListener('click', async () => {
  await browser.storage.local.remove('hits');
  await browser.storage.session.remove('seenTotal');
  void render();
});

void render();
