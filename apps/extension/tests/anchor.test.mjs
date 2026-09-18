import { pickAnchor, buttonPos, panelPos, shouldHideFab, isOverRect, isUsableRect, BTN_SIZE, BTN_PAD, MIN_VIDEO_PX, PANEL_W, PANEL_GAP, FAB_HIDE_MS } from '../.tmp-anchor.mjs';

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
t('nút nằm ngay trên góc phải video, ngoài khung',
  () => buttonPos({ top: 100, left: 200, width: 640, height: 360 }, BTN_SIZE, BTN_PAD),
  { top: 100 - BTN_SIZE - BTN_PAD, left: 200 + 640 - BTN_SIZE - BTN_PAD });
t('video sát mép trên+trái: nút kẹp xuống pad, không bay khỏi màn hình',
  () => buttonPos({ top: 0, left: 0, width: 300, height: 200 }, BTN_SIZE, BTN_PAD),
  { top: 8, left: 300 - BTN_SIZE - BTN_PAD });

t('hằng số có giá trị dùng được', () => [BTN_SIZE > 0, BTN_PAD >= 0, MIN_VIDEO_PX > 0], [true, true, true]);

const PV = { width: 1200, height: 800 };
t('panel thả ngay dưới nút, mép phải thẳng hàng với nút',
  () => panelPos({ top: 100, left: 700 }, BTN_SIZE, BTN_PAD, PV),
  { top: 100 + BTN_SIZE + PANEL_GAP, left: 700 + BTN_SIZE - PANEL_W });

t('nút sát mép trái: panel không tràn ra ngoài trái',
  () => panelPos({ top: 100, left: 40 }, BTN_SIZE, BTN_PAD, PV).left,
  BTN_PAD);

t('nút sát đáy: panel được kéo lên để còn lộ ra',
  () => panelPos({ top: 790, left: 700 }, BTN_SIZE, BTN_PAD, PV).top < 790,
  true);

t('nút sát mép phải: panel không tràn ra ngoài phải',
  () => panelPos({ top: 100, left: 1190 }, BTN_SIZE, BTN_PAD, PV).left + PANEL_W <= PV.width,
  true);

// --- ẩn/hiện nút theo hover ---
const base = { hovering: false, panelOpen: false, anchored: true, msSinceLeave: FAB_HIDE_MS };
t('rời chuột đủ lâu thì ẩn', () => shouldHideFab(base), true);
t('rời chuột chưa đủ lâu thì còn hiện', () => shouldHideFab({ ...base, msSinceLeave: FAB_HIDE_MS - 1 }), false);
t('đang rê chuột thì không ẩn', () => shouldHideFab({ ...base, hovering: true }), false);
t('panel đang mở thì không ẩn', () => shouldHideFab({ ...base, panelOpen: true }), false);
t('không neo được video thì luôn hiện (§5.1.1)', () => shouldHideFab({ ...base, anchored: false }), false);

// --- con trỏ trên video: đo toạ độ, KHÔNG dựa vào mouseenter của <video> ---
const VID = [{ top: 100, left: 200, width: 640, height: 360 }];
t('con trỏ giữa video thì tính là đang trên video', () => isOverRect({ x: 500, y: 250 }, VID), true);
t('con trỏ ngoài video thì không', () => isOverRect({ x: 50, y: 50 }, VID), false);
t('sát mép vẫn tính là trên video', () => isOverRect({ x: 200, y: 100 }, VID), true);
t('ngoài mép một chút nhưng trong vùng đệm thì vẫn tính', () => isOverRect({ x: 195, y: 100 }, VID, 8), true);
t('không có vùng nào thì luôn false', () => isOverRect({ x: 1, y: 1 }, []), false);

// --- phần tử rời DOM: rect toàn số 0, không được coi là vùng hợp lệ ---
t('rect của node đã rời DOM không dùng được', () => isUsableRect({ top: 0, left: 0, width: 0, height: 0 }), false);
t('rect thật thì dùng được', () => isUsableRect({ top: 10, left: 10, width: 640, height: 360 }), true);
t('cao bằng 0 cũng không dùng được', () => isUsableRect({ top: 0, left: 0, width: 640, height: 0 }), false);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
