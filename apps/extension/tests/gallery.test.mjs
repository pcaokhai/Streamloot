import { bestSrc, photoKey, collectPhotos, photoExt, photoIndex, MIN_PHOTO_PX } from '../.tmp-gallery.mjs';

let pass = 0, fail = 0;
const t = (name, fn, want) => {
  let got;
  try { got = typeof fn === 'function' ? fn() : fn; }
  catch (err) { got = `THREW: ${err instanceof Error ? err.message : String(err)}`; }
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
};

const big = (src, extra = {}) => ({ src, width: 640, height: 640, ...extra });

// --- bestSrc: lay ban to nhat ---
t('khong co srcset thi dung src', () => bestSrc({ src: 'a.jpg' }), 'a.jpg');
t('lay ban to nhat trong srcset - src thuong chi la ban vua man hinh',
  () => bestSrc({ src: 'a.jpg', srcset: 'a320.jpg 320w, a1080.jpg 1080w, a640.jpg 640w' }), 'a1080.jpg');
t('srcset rong thi ve src', () => bestSrc({ src: 'a.jpg', srcset: '' }), 'a.jpg');
t('srcset khong khai be rong van ra mot url dung duoc',
  () => bestSrc({ src: 'a.jpg', srcset: 'b.jpg 2x' }), 'b.jpg');

// --- photoKey: cung mot tam thi cung mot khoa ---
t('bo query khi so sanh', () => photoKey('https://x.com/p/a.jpg?w=320'), '/p/a.jpg');
t('url rac khong lam nem', () => photoKey('::a.jpg?x=1'), '::a.jpg');

// --- collectPhotos ---
t('bo anh nho - do la avatar/icon chu khong phai noi dung',
  () => collectPhotos([{ src: 'ava.jpg', width: 32, height: 32 }, big('p.jpg')]), ['p.jpg']);
t('anh trung nhau qua nhieu luot luot chi tinh mot lan',
  () => collectPhotos([big('https://x.com/p/a.jpg?w=320'), big('https://x.com/p/a.jpg?w=1080')]),
  ['https://x.com/p/a.jpg?w=320']);
t('giu THU TU gap - do la thu tu slide, cung la so thu tu file',
  () => collectPhotos([big('1.jpg'), big('2.jpg'), big('3.jpg')]), ['1.jpg', '2.jpg', '3.jpg']);
t('bo data: uri - khong tai duoc ma cung khong phai anh that',
  () => collectPhotos([big('data:image/png;base64,AAA')]), []);
t('anh vua dung nguong thi GIU - bo di la mat anh that',
  () => collectPhotos([{ src: 'p.jpg', width: MIN_PHOTO_PX, height: MIN_PHOTO_PX }]), ['p.jpg']);
t('khong co gi thi rong, khong nem', () => collectPhotos([]), []);

// --- ten file ---
t('duoi doc tu duong dan', () => photoExt('https://x.com/p/a.webp?w=9'), 'webp');
t('duoi la thi ve jpg', () => photoExt('https://x.com/p/a.bin'), 'jpg');
t('khong co duoi thi ve jpg', () => photoExt('https://x.com/p/a'), 'jpg');
t('dem 0 theo tong - neu khong thi 10 dung truoc 2',
  () => [photoIndex(0, 12), photoIndex(9, 12)], ['01', '10']);
t('bai it anh thi khong dem thua', () => photoIndex(0, 4), '1');

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
