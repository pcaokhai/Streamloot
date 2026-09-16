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

  // Lấy hit giàu ngữ cảnh nhất — một số request thiếu header mà request khác có.
  const ctxOf = (hs: Hit[]) => {
    if (!hs.length) return '<span class="none">chưa có</span>';
    const best = hs.find((h) => h.ctx.cookie) ?? hs[0];
    const parts = [
      best.ctx.cookie ? '<b>cookie</b>' : null,
      best.ctx.referer ? 'referer' : null,
      best.ctx.origin ? 'origin' : null,
      best.ctx.userAgent ? 'ua' : null,
    ].filter(Boolean);
    return parts.length ? parts.join(', ') : '<span class="none">không header nào</span>';
  };

  // Nhóm theo TRANG, không theo CDN: câu hỏi "mấy trong 3 site" hỏi về trang.
  const byPage = new Map<string, Hit[]>();
  for (const h of hits) byPage.set(h.page, [...(byPage.get(h.page) ?? []), h]);
  const pages = [...byPage].filter(([, hs]) => hs.some((h) => h.kind === 'manifest'));
  score.textContent = `${pages.length} site bắt được`;

  out.innerHTML =
    `<div class="sub">đã quan sát ~${seenTotal}+ request</div>` +
    '<table><tr><th>Trang</th><th>Manifest ở</th><th>Manifest: ngữ cảnh</th><th>Segment: ngữ cảnh</th></tr>' +
    pages.map(([page, hs]) => {
      const man = hs.filter((h) => h.kind === 'manifest');
      const seg = hs.filter((h) => h.kind === 'segment');
      const cdns = [...new Set(man.map((h) => h.host))].join(', ');

      // Liệt kê TỪNG host segment: gộp lại sẽ che mất host nào mang cookie.
      const byHost = new Map<string, Hit[]>();
      for (const h of seg) byHost.set(`${h.host} (${h.rtype})`, [...(byHost.get(`${h.host} (${h.rtype})`) ?? []), h]);
      const segLabel = byHost.size
        ? [...byHost].map(([k, hs2]) => `<div class="seg"><span class="host">${esc(k)}</span> → ${ctxOf(hs2)}</div>`).join('')
        : '<span class="none">chưa bắt được</span>';

      return `<tr><td class="host" title="${esc(page)}">${esc(page)}</td><td class="host" title="${esc(cdns)}">${esc(cdns)}</td><td>${ctxOf(man)}</td><td>${segLabel}</td></tr>`;
    }).join('') +
    '</table>' +
    '<div class="sub" style="margin-top:8px">B14: cột <b>Segment</b> trả lời câu hỏi cookie. Có <b>cookie</b> ở host phục vụ byte mà không có ở manifest → extension phải dùng <code>chrome.cookies</code>, không dựa được vào header quan sát.</div>';
}

document.getElementById('clear')!.addEventListener('click', async () => {
  await browser.storage.local.remove('hits');
  await browser.storage.session.remove('seenTotal');
  void render();
});

void render();
