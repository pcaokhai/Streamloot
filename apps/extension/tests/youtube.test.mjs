import { extractPlayerResponse, formatsFromPlayerResponse, ytFormatId, playerResponseVideoId, currentVideoId, sameVideo } from '../.tmp-youtube.mjs';

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

const PR = {
  streamingData: {
    formats: [
      { itag: 18, mimeType: 'video/mp4; codecs="avc1.42001E, mp4a.40.2"', qualityLabel: '360p', height: 360, contentLength: '10485760' },
    ],
    adaptiveFormats: [
      { itag: 137, mimeType: 'video/mp4; codecs="avc1.640028"', qualityLabel: '1080p', height: 1080, contentLength: '52428800' },
      { itag: 248, mimeType: 'video/webm; codecs="vp9"', qualityLabel: '1080p', height: 1080 },
      { itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', contentLength: '3145728' },
    ],
  },
};
const HTML = `<html><script>var ytInitialPlayerResponse = ${JSON.stringify(PR)};</script></html>`;

// --- cắt JSON khỏi HTML ---
t('đọc được khối JSON trong trang', () => extractPlayerResponse(HTML)?.streamingData?.formats?.[0]?.itag, 18);
t('trang không phải YouTube thì null', () => extractPlayerResponse('<html>xin chào</html>'), null);
t('JSON hỏng thì null, không ném', () => extractPlayerResponse('ytInitialPlayerResponse = {"a":'), null);
t('chuỗi chứa ngoặc không làm lệch phép đếm',
  () => extractPlayerResponse('ytInitialPlayerResponse = {"t":"} thử }{ xem","x":1}').x, 1);
t('dấu nháy escape trong chuỗi không làm lệch',
  () => extractPlayerResponse('ytInitialPlayerResponse = {"t":"a\\"}","x":2}').x, 2);

// --- mã format: luồng hình phải ghép tiếng, nếu không video bị câm ---
t('luồng hình tách phải ghép bestaudio', () => ytFormatId(137, true), '137+bestaudio/137');
t('luồng progressive dùng itag trần', () => ytFormatId(18, false), '18');

const fs = formatsFromPlayerResponse(PR);
t('gom đủ bốn luồng', () => fs.length, 4);
t('itag 18 có sẵn tiếng nên không ghép', () => fs.find((f) => f.format_id === '18') !== undefined, true);
t('itag 137 là hình tách nên phải ghép', () => fs.some((f) => f.format_id === '137+bestaudio/137'), true);
t('luồng tiếng mang vcodec none để panel xếp đúng nhóm',
  () => fs.find((f) => f.format_id === '140').vcodec, 'none');
t('đọc dung lượng thành số', () => fs.find((f) => f.format_id === '18').filesize, 10485760);
t('thiếu contentLength thì null, không phải 0',
  () => fs.find((f) => f.format_id === '248+bestaudio/248').filesize, null);
t('chỉ MỘT dòng được khuyên dù hai luồng cùng 1080p',
  () => fs.filter((f) => f.recommended).length, 1);
t('dòng khuyên là luồng hình cao nhất',
  () => fs.find((f) => f.recommended).height, 1080);
t('không có streamingData thì rỗng, không ném', () => formatsFromPlayerResponse({}), []);
t('null không làm ném', () => formatsFromPlayerResponse(null), []);
t('hình dạng khớp FormatOption',
  () => Object.keys(fs[0]).sort(),
  ['acodec', 'ext', 'filesize', 'format_id', 'height', 'recommended', 'resolution', 'url', 'vcodec'].sort());

// --- đối chiếu id: SPA để lại dữ liệu của video TRƯỚC trong DOM ---
t('đọc id từ videoDetails',
  () => playerResponseVideoId({ videoDetails: { videoId: 'abc123' } }), 'abc123');
t('không có videoDetails thì null', () => playerResponseVideoId({}), null);
t('null không làm ném', () => playerResponseVideoId(null), null);
t('id rỗng coi như không có', () => playerResponseVideoId({ videoDetails: { videoId: '' } }), null);

t('lấy id từ URL đang mở',
  () => currentVideoId('https://www.youtube.com/watch?v=xyz789&list=RD1'), 'xyz789');
t('URL không có v thì null', () => currentVideoId('https://www.youtube.com/'), null);
t('URL rác thì null, không ném', () => currentVideoId('khong-phai-url'), null);

t('cùng id thì dùng được', () => sameVideo('abc', 'abc'), true);
t('KHÁC id thì không dùng — đây là ca tải nhầm video sau khi chuyển bài',
  () => sameVideo('abc', 'xyz'), false);
t('trang không có ?v= thì cho qua, không chặn oan', () => sameVideo(null, 'abc'), true);
t('dữ liệu không khai id thì cho qua', () => sameVideo('abc', null), true);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
