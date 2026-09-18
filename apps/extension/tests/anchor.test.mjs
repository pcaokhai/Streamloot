import { pickAnchor, buttonPos, BTN_SIZE, BTN_PAD, MIN_VIDEO_PX } from '../.tmp-anchor.mjs';

let pass = 0, fail = 0;
const t = (name, fn, want) => {
  let got;
  try {
    got = typeof fn === 'function' ? fn() : fn;
  } catch (err) {
    got = `THREW: ${err instanceof Error ? err.message : String(err)}`;
  }
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
};
const v = (w, h, playing = false, top = 0, left = 0) =>
  ({ rect: { top, left, width: w, height: h }, playing });
const VIEW = { width: 1280, height: 800 };

// --- không có ứng viên ---
t('không có video nào', () => pickAnchor([], VIEW), -1);
t('video quá nhỏ bị bỏ qua (icon, sprite)',
  () => pickAnchor([v(40, 30, true)], VIEW), -1);

// --- đang phát thắng kích thước ---
t('một video thì chọn nó', () => pickAnchor([v(640, 360)], VIEW), 0);
t('ĐANG PHÁT thắng, dù nhỏ hơn',
  () => pickAnchor([v(1280, 720, false), v(320, 240, true)], VIEW), 1);
t('nhiều cái đang phát thì chọn cái LỚN NHẤT',
  () => pickAnchor([v(320, 240, true), v(1280, 720, true)], VIEW), 1);
t('không cái nào phát thì chọn cái lớn nhất',
  () => pickAnchor([v(320, 240), v(640, 480)], VIEW), 1);

// --- ngoài khung nhìn ---
t('video ngoài khung nhìn không được chọn khi có cái trong khung',
  () => pickAnchor([v(1280, 720, false, -2000, 0), v(320, 240, false, 10, 10)], VIEW), 1);
t('tất cả đều ngoài khung nhìn thì vẫn chọn cái lớn nhất, không trả -1',
  () => pickAnchor([v(320, 240, false, -2000, 0), v(1280, 720, false, -3000, 0)], VIEW), 1);

// --- vị trí nút: góc trên PHẢI, nằm trong video ---
t('nút ở góc trên phải, thụt vào trong',
  () => buttonPos({ top: 100, left: 200, width: 640, height: 360 }, BTN_SIZE, BTN_PAD),
  { top: 108, left: 200 + 640 - BTN_SIZE - BTN_PAD });
t('video sát mép trái vẫn tính đúng',
  () => buttonPos({ top: 0, left: 0, width: 300, height: 200 }, BTN_SIZE, BTN_PAD),
  { top: 8, left: 300 - BTN_SIZE - BTN_PAD });

t('hằng số có giá trị dùng được', () => [BTN_SIZE > 0, BTN_PAD >= 0, MIN_VIDEO_PX > 0], [true, true, true]);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
