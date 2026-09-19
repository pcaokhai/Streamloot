import { mediaKind, worthCapturing, contentLengthOf, contentTypeOf, MIN_PROGRESSIVE_BYTES } from '../.tmp-capture.mjs';

let pass = 0, fail = 0;
const t = (name, fn, want) => {
  let got;
  try { got = typeof fn === 'function' ? fn() : fn; }
  catch (err) { got = `THREW: ${err instanceof Error ? err.message : String(err)}`; }
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
};

const U = 'https://cdn.example.test/';

// --- nhận loại ---
t('m3u8 là manifest', () => mediaKind(U + 'master.m3u8'), 'manifest');
t('mpd là manifest', () => mediaKind(U + 'v.mpd'), 'manifest');
t('m3u8 kèm query vẫn nhận', () => mediaKind(U + 'master.m3u8?tok=1'), 'manifest');
t('mp4 là progressive', () => mediaKind(U + 'v.mp4'), 'progressive');
t('webm là progressive', () => mediaKind(U + 'v.webm'), 'progressive');
t('nhận manifest theo content-type khi URL không lộ đuôi',
  () => mediaKind(U + 'play', 'application/vnd.apple.mpegurl'), 'manifest');
t('nhận progressive theo content-type', () => mediaKind(U + 'play', 'video/mp4'), 'progressive');
t('ảnh thì không phải media tải được', () => mediaKind(U + 'a.jpg', 'image/jpeg'), null);
t('trang html thì không', () => mediaKind(U + 'a.html', 'text/html'), null);

// --- mảnh HLS: bắt nhầm là đưa người dùng vài giây video rồi bảo đó là cả phim ---
t('.ts là MẢNH, không phải file tải được', () => mediaKind(U + 'seg1.ts'), null);
t('.m4s là mảnh', () => mediaKind(U + 'seg1.m4s'), null);
t('mảnh mang content-type video/mp4 vẫn bị loại',
  () => mediaKind(U + 'seg1.m4s', 'video/mp4'), null);

// --- ngưỡng: quảng cáo đo được 1.7–2.4 MB ---
t('manifest luôn bắt, không cần biết kích thước',
  () => worthCapturing({ kind: 'manifest' }), true);
t('mp4 cỡ quảng cáo (2.4MB) bị loại',
  () => worthCapturing({ kind: 'progressive', contentLength: 2.4 * 1024 * 1024 }), false);
t('mp4 đủ lớn thì bắt',
  () => worthCapturing({ kind: 'progressive', contentLength: MIN_PROGRESSIVE_BYTES }), true);
t('không biết kích thước thì BẮT — thiếu header không đáng để bỏ sót video thật',
  () => worthCapturing({ kind: 'progressive', contentLength: null }), true);
t('kích thước 0 coi như không biết',
  () => worthCapturing({ kind: 'progressive', contentLength: 0 }), true);
t('không phải media thì không bắt', () => worthCapturing({ kind: null }), false);

// --- đọc header ---
const H = [{ name: 'Content-Length', value: '12345' }, { name: 'Content-Type', value: 'video/mp4' }];
t('đọc content-length', () => contentLengthOf(H), 12345);
t('tên header không phân biệt hoa thường',
  () => contentLengthOf([{ name: 'content-length', value: '7' }]), 7);
t('thiếu header thì null', () => contentLengthOf([]), null);
t('header rác thì null', () => contentLengthOf([{ name: 'Content-Length', value: 'abc' }]), null);
t('undefined thì null', () => contentLengthOf(undefined), null);
t('đọc content-type', () => contentTypeOf(H), 'video/mp4');
t('thiếu content-type thì null', () => contentTypeOf([]), null);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
