# ADR 0006: Tech Stack cho Browser Extension

## Status

**Proposed** (2026-09-16) — phụ thuộc ADR 0005 (§8) được chốt trước.

> Tài liệu này chỉ bàn *xây extension bằng gì*. *Vì sao* cần extension và nó chịu
> trách nhiệm phần nào nằm ở [ADR 0005](0005-stream-capture-architecture.md).

---

## 1. Context

ADR 0005 §6.3 mô tả extension cần 5 thành phần: service worker bắt manifest,
content script hiện panel trên trang, popup, options page, và một lớp gọi HTTP tới
backend local. Câu hỏi còn lại: dựng bằng stack nào.

### 1.1. Ràng buộc

| # | Ràng buộc | Nguồn |
|---|---|---|
| C1 | Manifest V3 | Chrome Web Store không còn nhận MV2 |
| C2 | Panel phải nổi trên trang bất kỳ **mà không đụng CSS của trang đó** | ADR 0005 B8 |
| C3 | State không được giữ trong biến module | MV3 service worker bị thu hồi bất kỳ lúc nào (ADR 0005 §6.8) |
| C4 | Kiểu dữ liệu phải khớp `VideoInfo` ở `core/models.py` | ADR 0005 §6.1 |
| C5 | Không vi phạm R1 (các mode không import chéo) | `CLAUDE.md` §3.2 |

### 1.2. Nền tảng đã kiểm chứng

**`webRequest` quan sát vẫn dùng được trong MV3.** Đây là giả định mà cả ADR 0005
dựa vào, nên đã xác minh tại tài liệu Chrome:

> *"As of Manifest V3, the `webRequestBlocking` permission is no longer available
> for most extensions... Aside from `webRequestBlocking`, the webRequest API is
> unchanged and available for normal use."*

MV3 chỉ bỏ biến thể **blocking** (thay bằng `declarativeNetRequest`). Các listener
quan sát — `onBeforeRequest`, `onSendHeaders`, `onCompleted` — không đổi. Đó đúng
là thứ B12 cần.

### 1.3. Stack sẵn có trong repo

`apps/desktop/ui/package.json`: React `^18.3.1`, TypeScript `^5.7.2`,
Vite `^6.0.3`, Tailwind `^3.4.15`. Ưu tiên tái dùng để không phải nuôi hai hệ.

---

## 2. Decision

| Lớp | Chọn |
|---|---|
| Framework | **WXT** |
| Ngôn ngữ | **TypeScript 5.7** |
| Bundler | **Vite 6** (WXT dùng bên dưới) |
| Content script UI | **Vanilla TS + Shadow DOM** |
| Popup / Options | **React 18 + Tailwind 3.4** |
| Gọi API | `fetch` trần |
| Test | Vitest + `WxtVitest` |

### 2.1. Vì sao WXT, không phải Vite thuần

Ba thứ WXT cho sẵn mà tự làm sẽ tốn thời gian thật:

1. **`createShadowRootUi`** — giải trực tiếp C2. Bọc sẵn Shadow DOM kèm
   `cssInjectionMode: 'ui'` để Tailwind vẫn hoạt động bên trong shadow root, và có
   `onMount`/`onRemove` cho vòng đời. Tự làm thì phải tay bo shadow root, chèn
   style, dọn dẹp khi SPA điều hướng.
2. **HMR cho content script.** Không có nó, mỗi lần sửa panel là reload extension
   rồi reload trang. B8 đòi tinh chỉnh UI nhiều lần — đây là khác biệt DX lớn nhất.
3. **Sinh manifest từ code** (`defineBackground`, `defineContentScript`) — khỏi tay
   bo `manifest.json` và khỏi quên permission.

**Đã cân nhắc và loại:**

| Lựa chọn | Lý do loại |
|---|---|
| Vite thuần + manifest tay | Phải tự làm cả 3 thứ trên. Đổi lại được kiểm soát hoàn toàn — không đáng với quy mô này |
| CRXJS | Từng là chuẩn cho Vite + MV3, nhưng có giai đoạn ngưng bảo trì. Rủi ro không cần thiết |
| Plasmo | Nặng và ép React ở mọi entrypoint — chống lại quyết định §2.2 |

### 2.2. Vì sao **không** dùng React trong content script

Ranh giới không phải sở thích, mà theo **nơi code chạy**:

| | Chạy ở đâu | Chi phí trọng lượng |
|---|---|---|
| Content script | **Mọi trang user mở** | React ~45KB gzip + parse, nhân cho mỗi tab |
| Popup / Options | Trang riêng của extension, mở khi cần | Không đáng kể |

Panel thực chất là: danh sách format + nút + thanh tiến trình — khoảng 150 dòng
DOM. `createShadowRootUi` nhận vanilla DOM y hệt nhận React (ví dụ đầu tiên trong
docs WXT chính là vanilla).

Đây là **chia theo ranh giới thật, không phải thiếu nhất quán**. Nếu panel phức
tạp lên, đổi sang React chỉ là sửa hàm `onMount` — WXT không khóa lựa chọn.

### 2.3. Không đưa vào

| Thứ | Lý do |
|---|---|
| `webextension-polyfill` | WXT đã chuẩn hóa `browser` |
| Zustand / Redux | C3 bắt state phải nằm ở `chrome.storage`; store trong RAM là vô nghĩa khi service worker bị thu hồi |
| axios / TanStack Query | 4–5 lời gọi `fetch` |
| shadcn/ui, component lib | Panel 150 dòng. Lib CSS-in-JS còn phải cấu hình portal vào shadow root — thêm việc chứ không bớt |

---

## 3. Cấu trúc thư mục

```
apps/extension/
├── wxt.config.ts
├── entrypoints/
│   ├── background.ts          # webRequest, gom theo tabId          [B12]
│   ├── panel.content/
│   │   ├── index.ts           # createShadowRootUi, vanilla DOM     [B7][B8]
│   │   └── style.css
│   ├── popup/                 # React — trạng thái backend          [B6]
│   └── options/               # React — API_KEY, port, concurrency  [B10]
├── lib/
│   ├── api.ts                 # fetch tới 127.0.0.1
│   └── types.ts               # VideoInfo, khớp core/models.py      [C4]
└── package.json
```

Đặt ở `apps/extension/` cho khớp quy ước `apps/` hiện có. **Không vi phạm C5/R1**:
extension là codebase JS độc lập, chỉ nói chuyện với backend qua HTTP, không import
Python và không bị Python import.

---

## 4. Hai điểm dễ sai

### 4.1. `lib/types.ts` phải khớp `core/models.py`

`VideoInfo` là hợp đồng giữa hai ngôn ngữ, và là chỗ dễ lệch nhất — thêm một field
ở Python mà quên bên TS thì lỗi chỉ lộ lúc chạy.

Rẻ nhất: **sinh TS type từ `/openapi.json` của FastAPI** thay vì gõ tay, sau khi
làm B1 (ADR 0005 §6.3). Pydantic đã tự xuất schema, chỉ cần một bước generate.

### 4.2. Pin `key` trong manifest để cố định Extension ID

Load unpacked thì Chrome sinh ID mới mỗi lần → CORS allowlist ở B5 gãy liên tục
lúc dev. Sinh một keypair, đặt public key vào `manifest.key` → ID cố định.

Nếu làm B11 (handshake Native Messaging) thì việc này còn bắt buộc hơn:
`allowed_origins` trong manifest của native host **không chấp nhận wildcard**, phải
ghi cứng đúng `chrome-extension://<ID>/`.

---

## 5. Consequences

**Tích cực**

- Tái dùng đúng bộ TypeScript/Vite/Tailwind đã có ở `apps/desktop/ui` — không nuôi thêm hệ thứ hai.
- C2 được giải bằng API có sẵn, không tự chế Shadow DOM.
- HMR content script rút ngắn vòng lặp sửa–xem của B8.
- Vanilla ở content script giữ trang của người dùng nhẹ.

**Tiêu cực**

- Thêm một dependency framework (WXT) vào giữa code và API trình duyệt — khi WXT
  thiếu thứ gì thì phải đọc xuống tầng dưới.
- Hai paradigm UI trong một codebase nhỏ (vanilla + React). Có lý do rõ ràng (§2.2)
  nhưng vẫn là thứ phải giải thích cho người mới.
- WXT có Source Reputation ở mức *Medium* trên Context7 — hệ sinh thái trẻ hơn
  Vite thuần. Rủi ro bảo trì thấp nhưng không bằng không.

**Trung tính**

- `apps/extension/` là thư mục JS đầu tiên nằm ngoài `apps/desktop/ui/`. Cần nói rõ
  trong `CLAUDE.md` rằng `apps/` giờ chứa cả entrypoint Python lẫn JS.

---

## 6. Cần xác nhận

1. **Phụ thuộc ADR 0005 §8.** Nếu Phương án 2 không được chốt thì ADR này vô nghĩa.
2. **Giai đoạn 0 (probe) nên dựng luôn bằng WXT?** Nếu có, probe không phải code
   vứt đi — nó thành bộ khung `background.ts` của extension thật.
3. **Chỉ Chrome, hay cả Firefox/Edge?** WXT hỗ trợ đa trình duyệt sẵn, nhưng
   Native Messaging (B11) và đường dẫn manifest khác nhau giữa các trình duyệt.
   Đề xuất: Chrome trước, đừng trả giá đa trình duyệt khi chưa cần.
4. **Phân phối:** Chrome Web Store (phải review, cần trả phí developer) hay load
   unpacked cho cá nhân dùng? Ảnh hưởng trực tiếp tới §4.2.
