import { parseMaster, variantsToFormats, isMaster, isSubtitlePlaylist, hasSeparateAudio, siblingMasterUrl } from '../.tmp-m3u8.mjs';

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

// --- tiếng ở rendition riêng: URL biến thể là hình CÂM ---
const SEP = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="vi",URI="aud/i.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=973000,RESOLUTION=1280x720,AUDIO="aud"
720/i.m3u8`;
t('nhận ra rendition tiếng riêng', () => hasSeparateAudio(SEP), true);
t('master gộp sẵn tiếng thì không', () => hasSeparateAudio(MASTER), false);

const sepF = variantsToFormats(parseMaster(SEP, BASE), true, BASE);
t('tách tiếng thì gửi MASTER, không gửi URL biến thể', () => sepF[0].url, BASE);
t('tách tiếng thì dùng bộ chọn theo chiều cao để yt-dlp ghép',
  () => sepF[0].format_id, 'bv*[height=720]+ba/b[height=720]');
t('master gộp sẵn thì vẫn gửi thẳng URL biến thể (nhanh hơn)',
  () => variantsToFormats(parseMaster(MASTER, BASE), false, BASE)[0].url,
  'https://cdn.example.test/dir/360p/index.m3u8');

// --- bắt trúng biến thể thay vì master: phải tìm lại master ---
t('biến thể tiếng -> master cùng thư mục',
  () => siblingMasterUrl('https://cdn.example.test/v/49/playlist_aac128.m3u8'),
  'https://cdn.example.test/v/49/master.m3u8');
t('biến thể hình -> master cùng thư mục',
  () => siblingMasterUrl('https://cdn.example.test/v/49/playlist_720p.m3u8'),
  'https://cdn.example.test/v/49/master.m3u8');
t('đã là master thì không tìm nữa',
  () => siblingMasterUrl('https://cdn.example.test/v/49/master.m3u8'), null);
t('giữ nguyên query khi dựng đường dẫn anh em',
  () => siblingMasterUrl('https://cdn.example.test/v/49/playlist_720p.m3u8?tok=1'),
  'https://cdn.example.test/v/49/master.m3u8');
t('URL rác thì null, không ném', () => siblingMasterUrl('không-phải-url'), null);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
