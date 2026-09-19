import { extractVideos, watchUrl, pickByDuration, listLabel } from '../.tmp-facebook.mjs';

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

const MPD = '<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Period/></MPD>';

/** Dựng một video theo đúng hình dạng đã quan sát: trường cha nằm NGOÀI object giao hàng. */
const vid = (id, { hd = true, dash = true, live = false, permalink = true } = {}) => {
  const parent = JSON.stringify({
    length_in_second: 42,
    is_live_streaming: live,
    ...(permalink ? { permalink_url: `https://www.facebook.com/watch/?v=${id}` } : {}),
  }).slice(1, -1);
  const delivery = JSON.stringify({
    id,
    progressive_urls: [
      { progressive_url: `https://video.example.test/${id}-sd.mp4`, metadata: { quality: 'SD' }, failure_reason: null },
      ...(hd ? [{ progressive_url: `https://video.example.test/${id}-hd.mp4`, metadata: { quality: 'HD' }, failure_reason: null }] : []),
    ],
    dash_manifests: dash ? [{ manifest_xml: MPD, failure_reason: null }] : [],
    hls_playlist_urls: [],
  });
  return `{"__typename":"Video",${parent},"media":${delivery}}`;
};

const page = (...vids) => `<html><script type="application/json">{"data":[${vids.join(',')}]}</script></html>`;

// --- ca thường: nhiều video trên một trang ---
const many = extractVideos(page(vid('111'), vid('222'), vid('333')));
t('bóc được mọi video trên trang, không chỉ cái đầu', () => many.length, 3);
t('giữ đúng thứ tự xuất hiện', () => many.map((v) => v.id), ['111', '222', '333']);
t('lấy cả SD lẫn HD', () => many[0].progressive.map((p) => p.quality), ['SD', 'HD']);
t('progressive là MP4 gộp sẵn — một URL, không phải ghép',
  () => many[0].progressive[1].url, 'https://video.example.test/111-hd.mp4');
t('giữ manifest DASH cho đường chất lượng cao', () => many[0].manifestXml.includes('<MPD'), true);
t('lấy permalink từ object cha', () => many[1].permalinkUrl, 'https://www.facebook.com/watch/?v=222');
t('lấy thời lượng từ object cha', () => many[0].lengthSec, 42);

// --- luồng trực tiếp: tải là tải mãi không dừng ---
t('bỏ qua video đang phát trực tiếp',
  () => extractVideos(page(vid('111'), vid('999', { live: true }))).map((v) => v.id), ['111']);

// --- thiếu đường này thì còn đường kia ---
t('không có DASH vẫn nhận nếu có progressive',
  () => extractVideos(page(vid('111', { dash: false })))[0].manifestXml, null);
t('không có progressive vẫn nhận nếu có DASH',
  () => extractVideos(page(vid('111', { hd: false })))[0].progressive.length, 1);

// --- không gán bừa ---
t('không thấy permalink thì trả null, KHÔNG mượn của video khác',
  () => extractVideos(page(vid('111', { permalink: false })))[0].permalinkUrl, null);

// --- trùng lặp: Facebook nhắc lại cùng một video nhiều lần trong payload ---
t('cùng id xuất hiện hai lần chỉ tính một',
  () => extractVideos(page(vid('111'), vid('111'))).length, 1);

// --- hỏng thì bỏ qua, không được ném ---
t('JSON hỏng không làm sập cả trang',
  () => extractVideos('<script>{"dash_manifests": [ }</script>' + page(vid('111'))).map((v) => v.id), ['111']);
t('trang không có video thì rỗng', () => extractVideos('<html>xin chào</html>'), []);
t('chuỗi rỗng thì rỗng', () => extractVideos(''), []);
t('object không có id thì bỏ qua',
  () => extractVideos('<script>{"dash_manifests":[{"manifest_xml":"<MPD/>"}]}</script>'), []);
t('URL không phải http bị loại',
  () => extractVideos(page(vid('111')).replace('https://video.example.test/111-sd.mp4', 'javascript:alert(1)'))[0].progressive.length,
  1);

// --- dựng URL xem từ id ---
t('dựng URL xem từ id số', () => watchUrl('123'), 'https://www.facebook.com/watch/?v=123');
t('id không phải số thì null, không dựng bừa', () => watchUrl('abc'), null);

// --- gắn thẻ <video> đang neo với đúng mục trong payload ---
const vids = [{ lengthSec: 30.1 }, { lengthSec: 19.4 }, { lengthSec: 125 }];
t('khớp đúng video theo thời lượng', () => pickByDuration(vids, 19.5), 1);
t('lệch trong dung sai vẫn khớp', () => pickByDuration(vids, 30.9), 0);
t('lệch quá dung sai thì không khớp', () => pickByDuration(vids, 60), -1);
t('HAI video cùng khớp thì trả -1 — đoán bừa là đưa nhầm video',
  () => pickByDuration([{ lengthSec: 30.0 }, { lengthSec: 30.2 }], 30.1), -1);
t('video thiếu thời lượng không bao giờ được chọn',
  () => pickByDuration([{ lengthSec: null }], 30), -1);
t('thời lượng không hợp lệ thì trả -1', () => pickByDuration(vids, NaN), -1);
t('thời lượng 0 thì trả -1', () => pickByDuration(vids, 0), -1);
t('danh sách rỗng', () => pickByDuration([], 30), -1);

// --- câu chữ: bản đầu ĐẢO NGƯỢC điều kiện, báo "không chắc" đúng lúc vừa lọc được ---
t('lọc ra đúng một video thì KHÔNG nói không chắc',
  () => listLabel({ matched: true, total: 12 }), 'Bấm một dòng để tải');
t('không lọc được thì nói rõ đang hiện cả trang',
  () => listLabel({ matched: false, total: 12 }), 'Không chắc video nào — hiện cả 12 video trên trang');
t('trang chỉ có một video thì không cần giải thích gì',
  () => listLabel({ matched: false, total: 1 }), 'Bấm một dòng để tải');
t('trang không có video nào', () => listLabel({ matched: false, total: 0 }), 'Bấm một dòng để tải');

// --- đường lùi cuối: không có progressive lẫn manifest thì còn permalink ---
const bare = (id) => `{"__typename":"Video","length_in_second":12,"permalink_url":"https://www.facebook.com/watch/?v=${id}","media":{"id":"${id}","progressive_urls":[],"dash_manifests":[]}}`;
t('video trơ trọi vẫn được giữ nếu dựng được URL xem',
  () => extractVideos(page(bare('777'))).map((v) => v.id), ['777']);
t('giữ permalink để nhờ yt-dlp',
  () => extractVideos(page(bare('777')))[0].permalinkUrl, 'https://www.facebook.com/watch/?v=777');
t('id không phải số thì KHÔNG giữ — không dựng nổi URL, giữ lại là dòng bấm không được',
  () => extractVideos(page(`{"media":{"id":"abc","progressive_urls":[],"dash_manifests":[]}}`)), []);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
