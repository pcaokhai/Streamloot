import { isPartial, mediaKind, worthCapturing, contentLengthOf, contentTypeOf, extFromUrl, MIN_PROGRESSIVE_BYTES } from '../.tmp-capture.mjs';

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

// --- đuôi file: bản đầu nhặt phải mảnh từ tên miền và hiện ".com/" ---
t('đuôi thường', () => extFromUrl('https://cdn.example.test/a/v.mp4'), 'mp4');
t('bỏ qua query', () => extFromUrl('https://cdn.example.test/v.mp4?tok=1&x=2'), 'mp4');
t('URL KHÔNG có đuôi file -> mp4, KHÔNG lấy mảnh từ host',
  () => extFromUrl('https://cdn.example.test/stream/abc'), 'mp4');
t('dấu chấm chỉ nằm ở host thì bỏ qua',
  () => extFromUrl('https://media.sub.example.test/play'), 'mp4');
// Ca này TÁCH RIÊNG hai lớp bảo vệ. Danh sách trắng che được gần hết trường
// hợp đọc-nhầm-từ-cả-URL, vì rác thường không khớp đuôi nào và rơi về "mp4" —
// đúng bằng giá trị mặc định, nên test không phân biệt được. Chỉ khi đáp án
// đúng KHÁC "mp4" mới lộ ra: ở đây đuôi thật nằm ở đường dẫn (.webm) còn
// query lại chứa một đuôi hợp lệ khác (.mp4).
t('đuôi lấy từ đường dẫn, không phải từ query',
  () => extFromUrl('https://cdn.example.test/v.webm?fallback=a.mp4'), 'webm');
t('webm giữ nguyên', () => extFromUrl('https://cdn.example.test/v.webm'), 'webm');
t('m3u8 giữ nguyên', () => extFromUrl('https://cdn.example.test/master.m3u8'), 'm3u8');
t('đuôi lạ thì lùi về mp4', () => extFromUrl('https://cdn.example.test/v.xyzzy'), 'mp4');
t('URL rác không làm ném', () => extFromUrl('khong-phai-url'), 'mp4');
t('chuỗi rỗng', () => extFromUrl(''), 'mp4');

// --- mảnh range: tải về là file mở không lên ---
t('206 la mot manh', () => isPartial(206, []), true);
t('200 khong phai manh', () => isPartial(200, []), false);
t('co Content-Range la manh du ma trang thai 200',
  () => isPartial(200, [{ name: 'Content-Range', value: 'bytes 0-99/500' }]), true);
t('ten header khong phan biet hoa thuong',
  () => isPartial(200, [{ name: 'content-range', value: 'bytes 0-9/50' }]), true);
t('khong co gi thi khong phai manh', () => isPartial(undefined, null), false);
t('manh thi KHONG bat, du that lon',
  () => worthCapturing({ kind: 'progressive', contentLength: 90 * 1024 * 1024, partial: true }), false);
t('manifest cung khong bat neu la manh',
  () => worthCapturing({ kind: 'manifest', partial: true }), false);
t('khong phai manh thi van bat nhu cu',
  () => worthCapturing({ kind: 'progressive', contentLength: 90 * 1024 * 1024 }), true);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
