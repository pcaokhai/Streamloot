import { parseMpd, bestVideo, bestAudio } from '../.tmp-dash.mjs';

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

// MPD tự dựng theo chuẩn: luồng hình tách khỏi luồng tiếng, mỗi luồng một BaseURL.
const MPD = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static">
 <Period>
  <AdaptationSet mimeType="video/mp4" contentType="video">
   <Representation id="v1" width="640" height="360" bandwidth="800000" codecs="avc1.4d401e">
    <BaseURL>https://cdn.example.test/v360.mp4?tok=a&amp;b=2</BaseURL>
   </Representation>
   <Representation id="v2" width="1280" height="720" bandwidth="2400000" codecs="avc1.4d401f">
    <BaseURL>https://cdn.example.test/v720.mp4</BaseURL>
   </Representation>
  </AdaptationSet>
  <AdaptationSet mimeType="audio/mp4" contentType="audio">
   <Representation id="a1" bandwidth="128000" codecs="mp4a.40.5">
    <BaseURL>https://cdn.example.test/a128.m4a</BaseURL>
   </Representation>
  </AdaptationSet>
 </Period>
</MPD>`;

const reps = parseMpd(MPD);

t('đọc đủ ba luồng', () => reps.length, 3);
t('phân biệt hình với tiếng', () => reps.map((r) => r.audioOnly), [false, false, true]);
t('đọc kích thước và bitrate', () => [reps[1].width, reps[1].height, reps[1].bandwidth], [1280, 720, 2400000]);
t('gỡ &amp; trong URL — sai chỗ này là tải về 403',
  () => reps[0].url, 'https://cdn.example.test/v360.mp4?tok=a&b=2');
t('mimeType thừa hưởng từ AdaptationSet', () => reps[2].mimeType, 'audio/mp4');

t('chọn luồng hình cao nhất', () => bestVideo(reps).id, 'v2');
t('chọn luồng tiếng bitrate cao nhất', () => bestAudio(reps).id, 'a1');

// --- các ca hỏng phải trả rỗng, KHÔNG được ném ---
t('không phải MPD thì rỗng', () => parseMpd('<html>xin chào</html>'), []);
t('chuỗi rác thì rỗng', () => parseMpd('{{{'), []);
t('MPD rỗng thì rỗng', () => parseMpd('<MPD></MPD>'), []);

// SegmentTemplate: phải ghép mảnh mới ra file, tầng đọc không kham — trả rỗng
// chứ KHÔNG trả một danh sách nửa vời khiến người gọi tưởng tải được.
const TEMPLATE_MPD = `<MPD><Period><AdaptationSet mimeType="video/mp4">
 <Representation id="v1" height="720" bandwidth="1000">
  <SegmentTemplate media="seg-$Number$.m4s" initialization="init.mp4"/>
 </Representation></AdaptationSet></Period></MPD>`;
t('SegmentTemplate không có BaseURL thì bỏ qua', () => parseMpd(TEMPLATE_MPD), []);

const RELATIVE_MPD = `<MPD><Period><AdaptationSet mimeType="video/mp4">
 <Representation id="v1" height="720"><BaseURL>v720.mp4</BaseURL></Representation>
</AdaptationSet></Period></MPD>`;
t('BaseURL tương đối bị bỏ qua (không đoán gốc)', () => parseMpd(RELATIVE_MPD), []);

t('không có luồng hình thì bestVideo là null',
  () => bestVideo(parseMpd(MPD).filter((r) => r.audioOnly)), null);
t('không có luồng tiếng thì bestAudio là null', () => bestAudio([]), null);

// Codec-only audio: thiếu contentType và mimeType, chỉ có codecs
const CODEC_ONLY = `<MPD><Period><AdaptationSet>
 <Representation id="a" bandwidth="96000" codecs="mp4a.40.2"><BaseURL>https://cdn.example.test/a.m4a</BaseURL></Representation>
</AdaptationSet></Period></MPD>`;
t('suy ra luồng tiếng từ codec khi thiếu mimeType',
  () => parseMpd(CODEC_ONLY)[0].audioOnly, true);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
