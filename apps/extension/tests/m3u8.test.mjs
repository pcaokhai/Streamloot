import { parseMaster, variantsToFormats, isMaster, isSubtitlePlaylist, isLive, totalDuration, singleFormat } from '../.tmp-m3u8.mjs';

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

const BASE = 'https://cdn.example.test/dir/master.m3u8';
const MASTER = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.42c01e,mp4a.40.2"
360p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2"
https://other.example.test/720/i.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=64000,CODECS="mp4a.40.2"
audio/index.m3u8`;
const MEDIA = `#EXTM3U
#EXTINF:9.009,
seg0.ts
#EXTINF:3.5,
seg1.ts
#EXT-X-ENDLIST`;
const SUBS = `#EXTM3U
#EXTINF:10,
sub0.vtt
#EXT-X-ENDLIST`;
const LIVE = `#EXTM3U
#EXTINF:6,
seg100.ts`;

// --- nhận dạng ---
t('master có STREAM-INF', () => isMaster(MASTER), true);
t('media playlist không phải master', () => isMaster(MEDIA), false);
t('playlist toàn .vtt là phụ đề, không phải video', () => isSubtitlePlaylist(SUBS), true);
t('playlist .ts không phải phụ đề', () => isSubtitlePlaylist(MEDIA), false);
t('không có ENDLIST là luồng trực tiếp', () => isLive(LIVE), true);
t('có ENDLIST là VOD', () => isLive(MEDIA), false);
t('master không bị coi là live', () => isLive(MASTER), false);
t('cộng thời lượng segment', () => totalDuration(MEDIA), 12.509);
t('không có EXTINF thì null, không phải 0', () => totalDuration(MASTER), null);

// --- biến thể ---
const vs = parseMaster(MASTER, BASE);
t('đọc đủ ba biến thể', () => vs.length, 3);
t('đường dẫn tương đối giải theo base', () => vs[0].url, 'https://cdn.example.test/dir/360p/index.m3u8');
t('đường dẫn tuyệt đối giữ nguyên', () => vs[1].url, 'https://other.example.test/720/i.m3u8');
t('đọc RESOLUTION và BANDWIDTH', () => [vs[1].width, vs[1].height, vs[1].bandwidth], [1280, 720, 2400000]);
t('chỉ codec tiếng + thiếu RESOLUTION = audio', () => vs[2].audioOnly, true);
t('có RESOLUTION thì không phải audio', () => vs[0].audioOnly, false);
t('CODECS trong nháy kép có dấu phẩy không làm hỏng phân tích', () => vs[0].bandwidth, 800000);
t('media playlist trả rỗng', () => parseMaster(MEDIA, BASE), []);
t('rác không làm ném', () => parseMaster('không phải m3u8', BASE), []);

// --- đổi sang FormatOption ---
const fs = variantsToFormats(vs);
t('720p là dòng khuyên chọn', () => fs.map((f) => f.recommended), [false, true, false]);
t('audio mang vcodec none để panel xếp đúng nhóm', () => fs[2].vcodec, 'none');
t('mang theo url biến thể để tải thẳng', () => fs[1].url, 'https://other.example.test/720/i.m3u8');
t('hình dạng khớp FormatOption của backend',
  () => Object.keys(fs[0]).sort(),
  ['acodec', 'ext', 'filesize', 'format_id', 'height', 'recommended', 'resolution', 'url', 'vcodec'].sort());

// --- master thiếu RESOLUTION: suy từ bandwidth, không bỏ dòng ---
const NORES = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=3500000
hi/i.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=900000
lo/i.m3u8`;
const nf = variantsToFormats(parseMaster(NORES, BASE));
t('thiếu RESOLUTION vẫn suy được cấp từ bandwidth', () => nf.map((f) => f.height), [720, 360]);
t('thiếu RESOLUTION vẫn chọn được dòng tốt nhất', () => nf.map((f) => f.recommended), [true, false]);

// --- media playlist: một dòng, không cần backend ---
t('một luồng vẫn ra được dòng bấm được',
  () => { const f = singleFormat('https://cdn.example.test/v.m3u8', 125); return [f.url, f.recommended, f.vcodec]; },
  ['https://cdn.example.test/v.m3u8', true, 'avc1']);
t('không đo được thời lượng thì để trống, không bịa',
  () => singleFormat('https://cdn.example.test/v.m3u8', null).resolution, '');
t('hình dạng khớp FormatOption',
  () => Object.keys(singleFormat('https://x.example.test/a.m3u8', 60)).sort(),
  ['acodec', 'ext', 'filesize', 'format_id', 'height', 'recommended', 'resolution', 'url', 'vcodec'].sort());

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
