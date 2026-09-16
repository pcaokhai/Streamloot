import { DEFAULTS, loadSettings, saveSettings } from '../../lib/settings';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function hydrate() {
  const s = await loadSettings();
  $<HTMLInputElement>('port').value = String(s.port);
  $<HTMLInputElement>('concurrency').value = String(s.concurrency);
}

$('save').addEventListener('click', async () => {
  const port = Number($<HTMLInputElement>('port').value);
  const concurrency = Number($<HTMLInputElement>('concurrency').value);
  await saveSettings({
    // Chặn giá trị vô nghĩa ngay tại biên: input number vẫn cho gõ 0 hoặc rỗng,
    // mà port 0 thì mọi lời gọi về sau fail với lỗi không liên quan gì.
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULTS.port,
    concurrency: Number.isInteger(concurrency) && concurrency > 0 && concurrency <= 16
      ? concurrency
      : DEFAULTS.concurrency,
  });
  await hydrate();
  const badge = $('saved');
  badge.classList.add('show');
  setTimeout(() => badge.classList.remove('show'), 1400);
});

void hydrate();
