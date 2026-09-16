// ADR 0005 §6.7 Giai đoạn 0 — probe đo một thứ duy nhất:
// webRequest có quan sát được manifest stream trên các site đích không?
//
// Chỉ QUAN SÁT. Không tải, không gọi backend, không gửi gì ra ngoài.
// Kết quả nằm trong browser.storage.local, xem qua popup.
//
// Hai điều đã kiểm chứng trước khi viết (ADR 0005 §1.2, §6.3 B7):
//  - MV3 chỉ bỏ webRequest *blocking*; listener quan sát còn nguyên.
//  - KHÔNG đọc <video>.src — trang stream đưa blob URL qua MSE, vô dụng.

const MANIFEST_URL = /\.(m3u8|mpd)(\?|$)/i;
const MANIFEST_TYPE = /(mpegurl|dash\+xml)/i;

// B12: URL manifest thường có query string hoặc không đuôi, nên bắt cả hai đường.
const detect = (url: string, contentType?: string) =>
  MANIFEST_URL.test(url) ? 'url' : contentType && MANIFEST_TYPE.test(contentType) ? 'content-type' : null;

export interface Hit {
  /** B14: manifest hay segment. Câu hỏi cookie chỉ trả lời được ở segment. */
  kind: 'manifest' | 'segment';
  /** Trang đã khởi tạo request — câu hỏi "mấy trong 3 site" hỏi về cái này. */
  page: string;
  /** Host của chính manifest; thường là CDN riêng, khác tên miền trang. */
  host: string;
  url: string;
  via: 'url' | 'content-type';
  at: number;
  /** Ngữ cảnh phiên mà bước 3 của IDM cần bàn giao cho downloader (ADR 0005 §2.1). */
  ctx: { cookie: boolean; referer: boolean; userAgent: boolean; origin: boolean };
}

// B14 — segment. KHÔNG nhận diện theo đuôi file là chính, vì có site ngụy trang
// segment MPEG-TS thành PNG (xem cờ clean_disguised_ts của Plugin C). Đường chắc
// hơn: bất kỳ request nào tới host đã từng phục vụ manifest.
const SEGMENT_URL = /\.(ts|m4s|mp4|aac|m4a)(\?|$)/i;
const manifestHosts = new Set<string>();
const segCount = new Map<string, number>();
const SEG_SAMPLES = 3; // đủ trả lời "có cookie không", không làm ngập storage

const isSegment = (url: string, host: string) =>
  !MANIFEST_URL.test(url) && (manifestHosts.has(host) || SEGMENT_URL.test(url));

// d.initiator là origin của trang khởi tạo request. Thiếu nó thì popup chỉ hiện
// hostname CDN, và người đo phải tự nhớ CDN nào thuộc site nào.
const pageOf = (d: { initiator?: string; documentUrl?: string }) => {
  const raw = d.initiator ?? d.documentUrl;
  try {
    return raw ? new URL(raw).hostname : '(không rõ)';
  } catch {
    return '(không rõ)';
  }
};

// Một số 0 phải đọc được: nếu không đếm tổng request thì "0 manifest" vừa có thể
// nghĩa là listener chưa chạy, vừa có thể nghĩa là site không có manifest nào.
// Đếm trong RAM rồi flush theo lô — storage.session nằm trong bộ nhớ (không chạm
// đĩa) và sống qua các lần service worker bị thu hồi.
let seen = 0;
async function bumpSeen() {
  if (++seen % 20 !== 0) return; // mất tối đa 19 lần đếm nếu SW chết — không ảnh hưởng câu hỏi "có > 0 không"
  const { seenTotal = 0 } = (await browser.storage.session.get('seenTotal')) as { seenTotal?: number };
  await browser.storage.session.set({ seenTotal: seenTotal + 20 });
}

// C3 (ADR 0006): MV3 thu hồi service worker bất kỳ lúc nào, nên state phải nằm ở
// storage. Giữ trong biến module là mất sạch kết quả probe giữa chừng.
async function record(hit: Hit) {
  if (hit.kind === 'manifest') manifestHosts.add(hit.host);
  const { hits = [] } = (await browser.storage.local.get('hits')) as { hits?: Hit[] };
  if (hits.some((h) => h.url === hit.url)) return; // playlist được fetch lại nhiều lần
  await browser.storage.local.set({ hits: [...hits, hit].slice(-200) });
  console.log(`[probe] ${hit.host} via ${hit.via}`, hit.url, hit.ctx);
}

// Mọi lời gọi runtime PHẢI nằm trong main(): WXT import file này lúc build (với
// một fake browser) để đọc config, nên addListener ở top-level sẽ làm hỏng build.
export default defineBackground(() => {
  // Request headers: cần 'extraHeaders' mới thấy Cookie/Referer (Chrome lọc mặc định).
  browser.webRequest.onSendHeaders.addListener(
    (d) => {
      void bumpSeen();
      const host = new URL(d.url).hostname;
      const via = detect(d.url);

      let kind: Hit['kind'];
      if (via) {
        kind = 'manifest';
      } else if (isSegment(d.url, host)) {
        // Chỉ lấy vài mẫu mỗi host: một video là hàng trăm segment.
        const n = segCount.get(host) ?? 0;
        if (n >= SEG_SAMPLES) return;
        segCount.set(host, n + 1);
        kind = 'segment';
      } else {
        return;
      }

      const has = (n: string) => !!d.requestHeaders?.some((h) => h.name.toLowerCase() === n);
      void record({
        kind,
        page: pageOf(d),
        host,
        url: d.url,
        via: via ?? 'url',
        at: Date.now(),
        ctx: { cookie: has('cookie'), referer: has('referer'), userAgent: has('user-agent'), origin: has('origin') },
      });
    },
    { urls: ['<all_urls>'] },
    ['requestHeaders', 'extraHeaders'],
  );

  // Response headers: đường thứ hai, bắt manifest mà URL không lộ đuôi file.
  browser.webRequest.onHeadersReceived.addListener(
    // Trả undefined tường minh: chữ ký của onHeadersReceived là
    // BlockingResponse | undefined, nên `return;` trần cho ra void và không khớp.
    (d): undefined => {
      const ct = d.responseHeaders?.find((h) => h.name.toLowerCase() === 'content-type')?.value;
      const via = detect(d.url, ct);
      if (via !== 'content-type') return undefined; // đường URL đã do listener trên lo
      void record({
        kind: 'manifest',
        page: pageOf(d),
        host: new URL(d.url).hostname,
        url: d.url,
        via,
        at: Date.now(),
        ctx: { cookie: false, referer: false, userAgent: false, origin: false },
      });
      return undefined;
    },
    { urls: ['<all_urls>'] },
    ['responseHeaders'],
  );

  // MV3 thu hồi service worker liên tục; seed lại danh sách host manifest từ
  // storage, nếu không thì sau mỗi lần thu hồi sẽ mất khả năng nhận diện segment.
  void browser.storage.local.get('hits').then(({ hits = [] }) => {
    for (const h of hits as Hit[]) if (h.kind === 'manifest') manifestHosts.add(h.host);
  });

  console.log('[probe] armed — mở site cần đo, rồi bấm icon extension để xem kết quả');
});
