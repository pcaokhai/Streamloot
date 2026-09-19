import { groupFormats, humanSize, qualityName } from '../.tmp-formats.mjs';

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
const f = (o) => ({
  format_id: 'x', ext: 'mp4', resolution: '', height: null,
  filesize: null, vcodec: 'avc1', acodec: 'mp4a', recommended: false, ...o,
});

// --- tách VIDEO / ÂM THANH bằng vcodec, KHÔNG bằng height ---
t('vcodec none là âm thanh',
  () => groupFormats([f({ format_id: 'a', vcodec: 'none', acodec: 'mp4a' })]).audio.length, 1);
t('có vcodec là video',
  () => groupFormats([f({ format_id: 'v', height: 720 })]).video.length, 1);
t('luồng câm vẫn là video',
  () => groupFormats([f({ format_id: 'v', height: 720, acodec: 'none' })]).video.length, 1);

// --- video xếp cao xuống thấp ---
t('video sắp từ cao xuống thấp',
  () => groupFormats([
    f({ format_id: 'a', height: 360 }),
    f({ format_id: 'b', height: 1080 }),
    f({ format_id: 'c', height: 720 }),
  ]).video.map((r) => r.formatId), ['b', 'c', 'a']);

// --- nhãn ---
t('nhãn video là chiều cao kèm p',
  () => groupFormats([f({ format_id: 'v', height: 720 })]).video[0].label, '720p');
t('không biết chiều cao thì dùng resolution',
  () => groupFormats([f({ format_id: 'v', resolution: '1920x1080' })]).video[0].label, '1920x1080');
t('không có gì cả thì vẫn có nhãn đọc được',
  () => groupFormats([f({ format_id: 'v', resolution: '' })]).video[0].label, 'Chất lượng không rõ');

// --- detail: đuôi file + dung lượng ---
t('detail ghép đuôi và dung lượng',
  () => groupFormats([f({ format_id: 'v', height: 720, ext: 'mp4', filesize: 1048576 })]).video[0].detail,
  'mp4 · 1.0 MB');
t('không biết dung lượng thì chỉ có đuôi',
  () => groupFormats([f({ format_id: 'v', height: 720, ext: 'mp4' })]).video[0].detail, 'mp4');

// --- cờ recommended đi theo đúng dòng ---
t('recommended giữ nguyên',
  () => groupFormats([f({ format_id: 'v', height: 720, recommended: true })]).video[0].recommended, true);

// --- humanSize ---
t('byte', () => humanSize(512), '512 B');
t('kB', () => humanSize(2048), '2.0 KB');
t('MB', () => humanSize(5 * 1024 * 1024), '5.0 MB');
t('GB', () => humanSize(3 * 1024 ** 3), '3.0 GB');
t('null thì rỗng', () => humanSize(null), '');
t('số âm coi như không biết', () => humanSize(-5), '');

// --- rỗng ---
t('không có format nào', () => groupFormats([]), { video: [], audio: [] });

// --- tên cấp chất lượng (cột 1 của panel, thang IDM/Cốc Cốc) ---
t('720 là HD', () => qualityName(720), 'HD');
t('1080 là Full HD', () => qualityName(1080), 'Full HD');
t('480 là Standard', () => qualityName(480), 'Standard');
t('360 là Medium', () => qualityName(360), 'Medium');
t('2160 là 4K', () => qualityName(2160), '4K');
t('không rõ chiều cao thì rỗng, không bịa', () => qualityName(null), '');
t('dòng mang name/ext/url từ format',
  () => groupFormats([{ format_id: 'a', ext: 'mp4', resolution: '', height: 720, filesize: null, vcodec: 'v', acodec: 'a', recommended: false, url: 'https://cdn.example.test/720/i.m3u8' }]).video[0],
  { formatId: 'a', label: '720p', detail: 'mp4', recommended: false, name: 'HD', ext: 'mp4', url: 'https://cdn.example.test/720/i.m3u8' });
t('không có url thì null, không phải undefined',
  () => groupFormats([{ format_id: 'a', ext: 'mp4', resolution: '', height: 480, filesize: null, vcodec: 'v', acodec: 'a', recommended: false }]).video[0].url,
  null);

// --- gộp dòng trùng: yt-dlp trả nhiều biến thể cùng chiều cao ---
const vf = (h, ext, size, rec = false) => ({
  format_id: `${h}-${ext}-${size}`, ext, resolution: '', height: h, filesize: size,
  vcodec: 'v', acodec: 'a', recommended: rec,
});
t('bốn biến thể 1080p mp4 gộp còn một dòng',
  () => groupFormats([vf(1080, 'mp4', 100), vf(1080, 'mp4', 200), vf(1080, 'mp4', 300), vf(1080, 'mp4', 150)]).video.length,
  1);
t('giữ bản NẶNG NHẤT — cùng độ phân giải thì nặng hơn là nét hơn',
  () => groupFormats([vf(1080, 'mp4', 100), vf(1080, 'mp4', 3 * 1024 * 1024)]).video[0].detail,
  'mp4 · 3.0 MB');
t('khác đuôi thì KHÔNG gộp — người dùng phân biệt được',
  () => groupFormats([vf(1080, 'mp4', 100), vf(1080, 'webm', 100)]).video.length, 2);
t('khác chiều cao thì không gộp',
  () => groupFormats([vf(1080, 'mp4', 100), vf(720, 'mp4', 100)]).video.length, 2);
t('dấu khuyên chọn không bị mất khi gộp',
  () => groupFormats([vf(1080, 'mp4', 999999), vf(1080, 'mp4', 100, true)]).video[0].recommended, true);
t('không biết dung lượng thì giữ bản gặp trước',
  () => groupFormats([vf(1080, 'mp4', null), vf(1080, 'mp4', null)]).video.length, 1);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
