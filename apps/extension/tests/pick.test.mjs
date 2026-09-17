import { pickCapture } from '../.tmp-pick.mjs';
const PAGE = 'example-site.test';
const mk = (host, dur, referer) => ({ page:'', host, url:`https://${host}/${host}-${dur}-${Math.random()}.m3u8`, title:'', referer, at:Date.now(), ...(dur===undefined?{}:{durationSec:dur}) });
let pass=0, fail=0;
const t=(name, got, want)=>{ const ok=got===want; ok?pass++:fail++; console.log(`${ok?'PASS':'FAIL'}  ${name}${ok?'':`  got=${got} want=${want}`}`); };

// Kịch bản đúng như ảnh người dùng gửi: quảng cáo đo xong 5s, phim còn đang đo.
const ad  = mk('ads-network.test', 5, 'https://ads.example.net/frame');
const f1  = mk('cdn-content.test', undefined, 'https://example-site.test/watch/1');
const f2  = mk('cdn-content.test', undefined, 'https://example-site.test/watch/1');
t('không chọn quảng cáo khi phim còn đang đo (chọn ứng viên đúng trang)',
  pickCapture([ad,f1,f2], {pageHost:PAGE})?.host, 'cdn-content.test');

// Đo xong: phim dài 1:04:44 = 3884s
const film = {...f1, durationSec:3884};
t('chọn phim khi đã đo xong',
  pickCapture([ad,film,f2], {pageHost:PAGE})?.host, 'cdn-content.test');

// Khớp thời lượng thẻ <video>
const film2 = {...f2, durationSec:3884};
t('khớp thời lượng trang',
  pickCapture([ad,film,film2], {pageHost:PAGE, pageDurationSec:3884})?.host, 'cdn-content.test');

// Referer loại quảng cáo ngay cả khi quảng cáo là cái duy nhất đo được
t('referer loại quảng cáo dù nó đo xong trước',
  pickCapture([ad,f1], {pageHost:PAGE})?.host, 'cdn-content.test');

// Không bao giờ treo: còn ứng viên thì phải chọn được một cái.
t('không treo khi phép đo không bao giờ về',
  pickCapture([f1,f2], {pageHost:PAGE}) !== undefined, true);
t('không treo kể cả khi không có referer lẫn thời lượng',
  pickCapture([mk('x.com',undefined,undefined)], {pageHost:PAGE}) !== undefined, true);

// Người dùng tự chọn thì tôn trọng, kể cả chọn quảng cáo
t('tôn trọng lựa chọn tay',
  pickCapture([ad,film], {pageHost:PAGE, chosenUrl:ad.url})?.host, 'ads-network.test');

// Trang không đặt Referer: rơi về so thời lượng
const noref1 = mk('cdn-a.com', 12, undefined);
const noref2 = mk('cdn-b.com', 3600, undefined);
t('không có referer thì so thời lượng',
  pickCapture([noref1,noref2], {pageHost:PAGE})?.host, 'cdn-b.com');

// Đo thất bại hết (null) thì vẫn phải chọn được gì đó trong nhóm đúng referer
const failed1 = {...mk('cdn-content.test', undefined, 'https://example-site.test/x'), durationSec:null};
const failed2 = {...mk('cdn-content.test', undefined, 'https://example-site.test/x'), durationSec:null};
t('đo hỏng hết vẫn chọn trong nhóm đúng referer',
  pickCapture([ad,failed1,failed2], {pageHost:PAGE})?.host, 'cdn-content.test');

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail?1:0);
