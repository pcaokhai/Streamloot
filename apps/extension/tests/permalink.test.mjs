import { deeperPermalink } from '../.tmp-permalink.mjs';

let pass = 0, fail = 0;
const t = (name, fn, want) => {
  let got;
  try { got = typeof fn === 'function' ? fn() : fn; }
  catch (err) { got = `THREW: ${err instanceof Error ? err.message : String(err)}`; }
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
};

const FEED = 'https://vidu.com/';

t('lay link rieng cua video tren feed',
  () => deeperPermalink(FEED, ['/p/ABC/']), 'https://vidu.com/p/ABC/');
t('bo qua link mot doan - do la trang ca nhan, khong phai video',
  () => deeperPermalink(FEED, ['/nguoidung/', '/p/ABC/']), 'https://vidu.com/p/ABC/');
t('link NGAN NHAT thang link sau nhat - link sau nhat la dia diem/hashtag',
  () => deeperPermalink(FEED, ['/explore/locations/9/ten-dia-diem/', '/p/ABC/']),
  'https://vidu.com/p/ABC/');
t('dang o trang bai viet thi GIU nguyen, du trong trang co link sau hon',
  () => deeperPermalink('https://vidu.com/p/ABC/', ['/explore/locations/9/ten/']), null);
t('bo qua link khac origin - tai nham site la hong hoan toan',
  () => deeperPermalink(FEED, ['https://site-khac.com/p/ABC/']), null);
t('dang o trang rieng roi thi GIU location.href',
  () => deeperPermalink('https://vidu.com/p/ABC/', ['/p/ABC/']), null);
t('tren trang ca nhan van tim duoc link video',
  () => deeperPermalink('https://vidu.com/nguoidung/', ['/p/ABC/']), 'https://vidu.com/p/ABC/');
t('khong co link nao du sau thi null', () => deeperPermalink(FEED, ['/nguoidung/']), null);
t('khong co link nao thi null', () => deeperPermalink(FEED, []), null);
t('href rac khong lam nem', () => deeperPermalink(FEED, ['::', '/p/ABC/']), 'https://vidu.com/p/ABC/');
t('pageUrl rac thi null, khong nem', () => deeperPermalink('rac', ['/p/ABC/']), null);
t('cat query va hash - tham so theo doi lam mot video thanh hai',
  () => deeperPermalink(FEED, ['/p/ABC/?igsh=xyz#c']), 'https://vidu.com/p/ABC/');

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
