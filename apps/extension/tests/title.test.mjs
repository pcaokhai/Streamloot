import { cleanTitle, brandOf } from '../.tmp-title.mjs';

let pass = 0, fail = 0;
const t = (name, fn, want) => {
  let got;
  try { got = typeof fn === 'function' ? fn() : fn; }
  catch (err) { got = `THREW: ${err instanceof Error ? err.message : String(err)}`; }
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
};

// --- nhãn thương hiệu từ hostname ---
t('bỏ www và đuôi miền', () => brandOf('www.vidu.com'), 'vidu');
t('miền nhiều cấp', () => brandOf('play.vidu.co.uk'), 'play');
t('hostname rỗng', () => brandOf(''), '');

// --- cắt đuôi tên site ---
t('cắt đuôi sau dấu gạch đứng',
  () => cleanTitle('Ten Phim Hay | VIDU', 'www.vidu.com'), 'Ten Phim Hay');
t('cắt đuôi sau dấu gạch ngang',
  () => cleanTitle('Ten Phim Hay - Vidu', 'vidu.com'), 'Ten Phim Hay');
t('cắt nhiều đuôi liên tiếp',
  () => cleanTitle('Ten Phim | Vidu Free | VIDU.COM', 'www.vidu.com'), 'Ten Phim');
t('không phân biệt hoa thường',
  () => cleanTitle('Ten Phim | vIdU', 'VIDU.com'), 'Ten Phim');

// --- KHÔNG cắt bừa: rất nhiều tiêu đề thật có dấu gạch ngang ---
t('giữ dấu gạch ngang khi đuôi không phải tên site',
  () => cleanTitle('Tap 3 - Phan cuoi', 'vidu.com'), 'Tap 3 - Phan cuoi');
t('giữ nguyên khi hostname không khớp gì',
  () => cleanTitle('Ten Phim | Kenh Khac', 'vidu.com'), 'Ten Phim - Kenh Khac');
t('không có hostname thì không cắt gì',
  () => cleanTitle('Ten Phim | VIDU'), 'Ten Phim - VIDU');

// --- không bao giờ trả rỗng: tên rỗng làm downloads.download từ chối cả lượt tải ---
t('tiêu đề CHỈ có tên site thì giữ lại',
  () => cleanTitle('VIDU', 'vidu.com'), 'VIDU');
t('tiêu đề rỗng', () => cleanTitle('', 'vidu.com'), '');
t('toàn khoảng trắng', () => cleanTitle('   ', 'vidu.com'), '');

// --- giữ tiếng Việt có dấu ---
t('giữ dấu tiếng Việt',
  () => cleanTitle('Mẹ tôi kể chuyện | VIDU', 'vidu.com'), 'Mẹ tôi kể chuyện');

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
