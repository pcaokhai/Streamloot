import { worthReading, looksRelevant, mergeVideos, MAX_BODY_BYTES, MAX_VIDEOS } from '../.tmp-netcapture.mjs';

let pass = 0, fail = 0;
const t = (name, fn, want) => {
  let got;
  try { got = typeof fn === 'function' ? fn() : fn; }
  catch (err) { got = `THREW: ${err instanceof Error ? err.message : String(err)}`; }
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
};

// --- lọc trước khi đọc body ---
t('JSON thì đọc', () => worthReading({ contentType: 'application/json' }), true);
t('javascript cũng đọc — GraphQL hay trả kiểu này',
  () => worthReading({ contentType: 'application/x-javascript' }), true);
t('ảnh thì KHÔNG đọc', () => worthReading({ contentType: 'image/jpeg' }), false);
t('video thì KHÔNG đọc — đọc body video là nhân đôi RAM cả trang',
  () => worthReading({ contentType: 'video/mp4' }), false);
t('không biết kiểu thì vẫn thử', () => worthReading({ contentType: null }), true);
t('body quá lớn thì bỏ',
  () => worthReading({ contentType: 'application/json', contentLength: MAX_BODY_BYTES + 1 }), false);
t('body vừa phải thì đọc',
  () => worthReading({ contentType: 'application/json', contentLength: 1000 }), true);

// --- dấu hiệu rẻ trước khi phân tích tốn kém ---
t('thấy dash_manifests', () => looksRelevant('{"dash_manifests":[]}'), true);
t('thấy progressive_url', () => looksRelevant('{"progressive_url":"x"}'), true);
t('không liên quan thì bỏ', () => looksRelevant('{"comments":[]}'), false);
t('chuỗi rỗng', () => looksRelevant(''), false);

// --- gộp theo id ---
const v = (id, tag) => ({ id, tag });
t('thêm video mới', () => mergeVideos([v('1', 'a')], [v('2', 'b')]).map((x) => x.id), ['1', '2']);
t('trùng id thì GIỮ BẢN CŨ — bản sau thường rút gọn hơn',
  () => mergeVideos([v('1', 'day-du')], [v('1', 'rut-gon')])[0].tag, 'day-du');
t('bỏ mục không có id', () => mergeVideos([], [v('', 'x'), v('9', 'y')]).map((x) => x.id), ['9']);
t('danh sách rỗng thì giữ nguyên', () => mergeVideos([v('1', 'a')], []).map((x) => x.id), ['1']);
t('quá trần thì bỏ cái CŨ nhất, giữ phần vừa cuộn tới',
  () => {
    const many = Array.from({ length: 5 }, (_, i) => v(String(i), 'x'));
    return mergeVideos([], many, 3).map((x) => x.id);
  }, ['2', '3', '4']);
t('trần mặc định là số dương', () => MAX_VIDEOS > 0, true);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
