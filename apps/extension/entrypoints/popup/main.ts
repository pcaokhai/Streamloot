import type { Hit } from '../background';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

async function render() {
  const { hits = [] } = (await browser.storage.local.get('hits')) as { hits?: Hit[] };
  const score = document.getElementById('score')!;
  const out = document.getElementById('out')!;

  if (!hits.length) {
    score.textContent = '0 site';
    out.innerHTML = '<div class="empty">Chưa bắt được manifest nào. Mở site cần đo và bấm play.</div>';
    return;
  }

  // Con số duy nhất mà probe này tồn tại để trả lời: bắt được mấy site.
  const byHost = new Map<string, Hit[]>();
  for (const h of hits) byHost.set(h.host, [...(byHost.get(h.host) ?? []), h]);
  score.textContent = `${byHost.size} site bắt được`;

  out.innerHTML =
    '<table><tr><th>Host</th><th>Hits</th><th>Qua</th><th>Ngữ cảnh phiên</th></tr>' +
    [...byHost].map(([host, hs]) => {
      const via = [...new Set(hs.map((h) => h.via))].join(' + ');
      const best = hs.find((h) => h.ctx.cookie) ?? hs[0];
      const ctx = [
        best.ctx.cookie ? 'cookie' : null,
        best.ctx.referer ? 'referer' : null,
        best.ctx.userAgent ? 'ua' : null,
      ].filter(Boolean).join(', ') || '—';
      return `<tr><td class="host" title="${esc(host)}">${esc(host)}</td><td>${hs.length}</td><td>${esc(via)}</td><td>${esc(ctx)}</td></tr>`;
    }).join('') +
    '</table>';
}

document.getElementById('clear')!.addEventListener('click', async () => {
  await browser.storage.local.remove('hits');
  void render();
});

void render();
