# ADR 0005: Kiến trúc bắt stream — Browser Extension vs Headless Browser

## Status

**Accepted** (2026-09-16) — probe Giai đoạn 0 cho 3/3, xem §7. Các câu hỏi còn mở ở §9.

> **Lưu ý privacy:** Tài liệu này được commit công khai, nên các private extractor
> được gọi bằng vai trò (Plugin A/B/C), không nêu tên file hay tên miền. Mapping
> thật nằm ở các file `plugins/*_private.py` (gitignored, xem `.gitignore`).

---

## 1. Context

### 1.1. Requirements ban đầu

Tổng hợp từ `docs/architecture_v2.md`, `CLAUDE.md`, và
`docs/brainstorm/2026-08-22-redesign-and-features.md`.

**R1 — Ba chế độ chạy độc lập.**
CLI, API Backend (FastAPI), Desktop App (pywebview). Không mode nào được import
code của mode khác (`CLAUDE.md` §3.2).

**R2 — Core không dính UI.**
`core/` và `downloaders/` không import bất kỳ thư viện giao diện nào. Tiến trình
tải chỉ đi qua `progress_callback(data: dict)`, để CLI dùng `rich`, API dùng SSE,
Desktop bridge vào webview — Core không cần biết ai đang nghe.

**R3 — Plugin phải riêng tư và tháo rời được.**
Toàn bộ logic bóc tách của từng site nằm gọn trong một file ở `plugins/`. Không
để lộ tên miền hay business logic đặc thù vào `core/`, `extractors/`, `services/`,
`utils/`. **Xóa sạch `plugins/` thì app vẫn phải chạy**, fallback về
`YtDlpDefaultExtractor`.

**R4 — API Backend phục vụ Chrome Extension.**
`architecture_v2.md` §1 ghi rõ API Mode tồn tại để "cung cấp API cho Chrome
Extension". ADR 0004 đã thiết kế sẵn lớp bảo mật cho đúng client đó: bind
`127.0.0.1`, CORS allowlist có `chrome-extension://<EXTENSION_ID>`, và
`Authorization: Bearer <API_KEY>`.
**Extension là client được dự trù từ đầu — chỉ là chưa ai xây.**

**R5 — One-click capture là feature gap lớn nhất.**
`brainstorm/2026-08-22` xếp hạng #1 trong các khoảng trống so với
JDownloader2 / XDM / 4K Video Downloader: "sự khác biệt giữa *một công cụ tôi
phải mở terminal lên dùng* và *một công cụ luôn sẵn ở đó*".

**R6 — Quản lý tải phải ở mức process.**
Pause/resume hiện được cài bằng `SIGSTOP`/`SIGCONT` lên process `yt-dlp`. Cộng
với history SQLite, `--download-archive` chống tải trùng, và ghi file vào thư mục
người dùng chọn.

**R7 — An toàn filesystem.**
`yt-dlp` luôn tách `-P <output_dir>` và `-o <template>`, kèm `--windows-filenames`,
để ký tự `/` trong tiêu đề không tự tạo thư mục con (`CLAUDE.md` §3.4).

### 1.2. Hiện trạng: chi phí của cách tiếp cận headless browser

3 private plugin hiện kế thừa `BaseBrowserExtractor`, mỗi lần extract sẽ spawn một
Chromium riêng qua DrissionPage với **profile trống** (`tempfile.mkdtemp`) và port
ngẫu nhiên. Hệ quả:

| Vấn đề | Biểu hiện trong code |
|---|---|
| Bắt đầu từ session rỗng | Không cookie, không lịch sử → **tự mình phải vượt Cloudflare** |
| Cloudflare thành code phải bảo trì | Plugin A có nguyên khối tìm iframe Turnstile, click checkbox, chờ `title_change`, fail thì bảo user click tay |
| Không chạy song song được | `_browser_lock` khóa toàn tiến trình, nối tiếp mọi lần extract (đã đánh dấu `ponytail:` trong code) |
| Nặng | Mỗi lần extract = 1 Chromium khởi động nguội + 1 profile tạm |
| Dễ vỡ | Đổi layout Turnstile hoặc đổi cấu trúc iframe là plugin chết |

**Đây là chi phí để giả lập một thứ mà người dùng đã có sẵn: một trình duyệt thật,
đã đăng nhập, đã vượt Cloudflare.**

---

## 2. Nghiên cứu: IDM và Cốc Cốc tải video "từ mọi site" bằng cách nào?

Câu hỏi gốc: hai công cụ này làm sao tải được video từ gần như mọi site, trong khi
codebase này phải viết plugin riêng cho từng site?

### 2.1. IDM (Internet Download Manager)

Cơ chế gồm 4 bước, và **không có bước nào là "hiểu website"**:

1. **Extension `IDM Integration Module`** cài vào trình duyệt, đăng ký một
   *native messaging host* để nói chuyện với app IDM chạy native trên máy.
2. **Extension theo dõi network request** của trang. Trang stream thường đưa cho
   `<video>` một blob URL qua Media Source Extensions — không có file nào để
   right-click → save. Nên extension không nhìn thẻ `<video>`, nó **rình cái
   `.m3u8` / `.mpd` mà player đi fetch**.
3. **Bắt được manifest, extension gói kèm toàn bộ ngữ cảnh phiên**: cookies,
   `Referer`, `Origin`, `User-Agent`, các header xác thực — rồi đẩy sang app native.
   Bước này bắt buộc vì URL stream thường được ký (signed URL) và ràng theo session;
   thiếu header là 403.
4. **App native tải**: chia segment, nhiều kết nối song song, rồi **remux lossless
   sang `.mp4` bằng ffmpeg**.

### 2.2. Cốc Cốc

Cốc Cốc là một **bản fork của Chromium**, nên không bị giới hạn sandbox của
extension — họ vá thẳng vào network stack của trình duyệt và có sẵn cookie jar,
không cần cầu native messaging. Về mặt nguyên lý thì vẫn là cùng một mô hình:
*quan sát network → nhận diện media → tải bằng engine riêng*.

> Chi tiết implementation của Cốc Cốc không được công bố công khai. Phần trên là
> suy luận từ kiến trúc Chromium fork + tài liệu marketing của họ, **không phải
> nguồn chính thức**. Cần đánh dấu là giả định nếu sau này ra quyết định dựa vào nó.

### 2.3. "Tải được mọi site" là marketing, không phải sự thật kỹ thuật

Cả hai đều là **generic sniffer**: chúng không hiểu site nào cả, chỉ vớ lấy media
URL nào bay qua. Điều đó làm chúng chạy được trên *đa số* site, nhưng có ba chỗ
chúng thua hẳn:

| Thua ở đâu | Vì sao |
|---|---|
| **DRM (Widevine)** — Netflix, Disney+ | Stream giải mã bên trong CDM sandbox, key không bao giờ lộ ra network. Sniff được cũng vô dụng. |
| **Nội dung ngụy trang** | Nếu site cố tình bóp méo định dạng segment, sniffer tải về file hỏng mà không biết. |
| **Cần tương tác mới lộ stream** | Phải click/scroll/giải captcha mới có manifest thì sniffer thụ động không thấy. |

HLS mã hóa AES-128 thì **không** nằm trong danh sách này — key lấy qua HTTP thường,
sniff được, nên các tool đều xử lý được.

### 2.4. Đối chiếu: 3 private plugin của dự án đang làm gì?

Đây là phần đáng giá nhất của nghiên cứu này.

| Plugin | Đang làm gì | Extension thay thế được? |
|---|---|---|
| **A** | Sniff `m3u8` + **auto-click Turnstile** để qua Cloudflare | **Được, và tốt hơn.** User đã vượt Cloudflare rồi khi họ mở trang. Toàn bộ khối code auto-click biến mất. |
| **B** | Sniff `m3u8`, không thấy thì quét `<iframe>` tìm player nhúng | **Được.** Extension đọc DOM/iframe native, và bắt request từ iframe cũng dễ hơn. |
| **C** | Sniff `m3u8` + **thu cookie & User-Agent từ session** + cờ `clean_disguised_ts`, `disable_fixup`, `embed_metadata=False` | **Phần extract: được.** Phần hậu xử lý: **không**, phải ở native. |

Phát hiện: **Plugin C đã chính là mô hình IDM rồi** — nó gọi `page.cookies()` và
`page.user_agent` rồi truyền sang downloader, đúng bước 3 của IDM. Khác biệt duy
nhất là nó thu từ một Chromium tạm do mình spawn, thay vì từ trình duyệt thật của
người dùng.

Và cái mà generic sniffer (IDM/Cốc Cốc) **không** làm được — trường hợp "nội dung
ngụy trang" ở §2.3 — chính là cờ `clean_disguised_ts` của Plugin C. Logic đó là
**hậu xử lý byte-level, không phải extract**: đọc 4 byte đầu, tìm marker, cắt bỏ n
byte, rồi remux. Nó thuộc về phía native, bất kể phần extract nằm ở đâu.

### 2.5. Bài học áp dụng được cho Phương án 2

#### (a) IDM không dùng HTTP server trên localhost — nó dùng Native Messaging

Đây là khác biệt kiến trúc quan trọng nhất phát hiện được, vì nó chạm thẳng vào
ADR 0004.

| | HTTP localhost (cách hiện tại) | Native Messaging (cách IDM) |
|---|---|---|
| Ai khởi động process | Người dùng tự mở app | **Chrome spawn** khi extension gọi `connectNative()` |
| Cổng mạng | Mở port `8000` | **Không có port nào** |
| CSRF | Trang độc hại gọi được `localhost:8000` → phải chống | Không tồn tại — không có gì để gọi |
| Xác thực | Tự nghĩ ra `API_KEY` | **Chrome bảo đảm**: tham số đầu tiên truyền cho host là `chrome-extension://<ID>`; `allowed_origins` trong manifest ghim cứng extension nào được phép |
| Giao thức | REST + SSE | stdio, JSON có prefix độ dài 32-bit. Tối đa **1MB** host→Chrome, **64MB** Chrome→host |
| Vị trí khai báo (macOS) | — | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/<name>.json` |

Nghĩa là **cả ba lớp bảo vệ của ADR 0004** (bind `127.0.0.1` + CORS allowlist +
Bearer token) tồn tại để giải quyết một mô hình đe dọa mà Native Messaging đơn
giản là không có.

**Nhưng IDM dùng cả hai, không phải chọn một.** Vì Chrome giết native host ngay
khi port đóng — đóng trình duyệt, reload extension, hoặc service worker bị thu
hồi. Một download 2GB không sống nổi trong vòng đời đó. Nên native host của IDM
chỉ là **cầu mỏng**, nhận tín hiệu rồi bàn giao sang app IDM chạy thường trú.

#### (b) Ý tưởng lai: dùng Native Messaging chỉ cho cái bắt tay

ADR 0004 (mục Consequences) và ADR này (§9) đều đang treo hai câu hỏi:

- Extension lấy `API_KEY` ở đâu mà không bắt user copy-paste tay?
- `chrome-extension://<EXTENSION_ID>` cố định thế nào để đưa vào CORS allowlist?

Native Messaging giải cả hai với chi phí rất nhỏ:

1. Extension gọi `runtime.sendNativeMessage()` **một lần**, hỏi *"port nào, key nào?"*
2. Native host (một script Python ngắn) đọc config, trả về `{port, api_key}`
3. **Mọi việc còn lại vẫn đi qua HTTP + SSE như thiết kế hiện tại**

Không phải viết lại `apps/api/`, không mất SSE cho progress real-time, mà API key
không bao giờ phải hiển thị cho người dùng. Danh tính extension do Chrome bảo đảm,
nên native host biết chắc ai đang hỏi.

#### (c) Sniff theo `Content-Type`, không chỉ theo đuôi file

URL manifest thường kèm query string hoặc không có đuôi gì cả. Ngoài chuỗi
`m3u8`/`mpd` trong URL, cần bắt cả header:
`application/vnd.apple.mpegurl`, `application/x-mpegURL`, `application/dash+xml`.

Plugin hiện tại chỉ lọc chuỗi `'m3u8'` (`page.listen.start('m3u8')`) — đủ cho 3
site đã biết, nhưng extension muốn phủ rộng hơn thì cần cả hai đường.

#### (d) Chọn chất lượng ở trình duyệt, tải ở native

Cả IDM lẫn Cốc Cốc đều hiện panel ngay trên trang, liệt kê sẵn các mức chất lượng
để người dùng chọn *trước khi* bàn giao. Codebase đã có sẵn phần này ở phía
native: endpoint formats gọi `list_formats()` của `YtDlpDownloader`. Extension chỉ
cần gọi nó rồi render.

#### (e) Bài học ngược từ Cốc Cốc

Họ fork hẳn Chromium để thoát khỏi sandbox extension. Không áp dụng được (không ai
đi ship một trình duyệt cho việc này), nhưng nó nói lên một điều: **sandbox của
extension chính là ràng buộc mà một đội kỹ thuật đánh giá là đáng fork cả trình
duyệt để né.** Nên đừng kỳ vọng extension làm được mọi thứ — đó là lý do Phương án
2 chia việc thay vì dồn hết sang extension.

---

## 3. Các phương án đã cân nhắc

### Phương án 1 — Giữ nguyên headless browser (status quo)

Không đổi gì.

- **Ưu:** Không tốn công. Đang chạy được.
- **Nhược:** Giữ nguyên toàn bộ chi phí ở §1.2. Không đáp ứng R5 (one-click capture).

### Phương án 2 — Extension extract + native app tải *(đề xuất)*

Extension bắt manifest & thu ngữ cảnh phiên trong trình duyệt thật của user, gửi
sang API backend; app local tải, hậu xử lý, remux, quản lý file.

- **Ưu:** Đúng mô hình IDM. Đáp ứng R4 + R5. Xóa hẳn code Cloudflare. Giữ R6/R7 ở
  native — nơi duy nhất làm được.
- **Nhược:** Phải xây extension (chưa có). Cần chạy app local song song. Đóng gói
  & phân phối phức tạp hơn (hai thành phần).

### Phương án 3 — Extension tự tải, nhúng ffmpeg.wasm

Extension làm hết, không cần app native.

- **Ưu:** Một thành phần duy nhất. Không cần cài app.
- **Nhược:**
  - Core ffmpeg.wasm **~31MB**; MV3 cấm remote code nên phải nhúng thẳng vào package.
  - **Trần bộ nhớ:** WASM32 giới hạn ~2GB. Input cứu được bằng `mount(WORKERFS)`
    (đọc từ Blob, không copy vào RAM), nhưng **output vẫn nằm trong MEMFS** → video
    lớn là chết.
  - **Vòng đời MV3:** service worker bị kill khi idle → phải chạy trong
    `chrome.offscreen`, và khai báo `"content_security_policy": {"extension_pages":
    "script-src 'self' 'wasm-unsafe-eval'"}` (Chrome 103+ không cấp mặc định nữa).
  - Mất R6 hoàn toàn: không có pause/resume mức process, không SQLite bền vững.
- **Ưu điểm bị bỏ sót lúc đầu — ma sát demo:** đây là phương án duy nhất mà người
  xem chỉ phải làm **một** việc: *"cài extension này"*. Xem §3.1.

### Phương án 4 — Port yt-dlp sang WASM

- **Không khả thi.** yt-dlp là Python → cần Pyodide (~10MB+). Pyodide không có raw
  socket (mọi request qua `fetch`, dính CORS → phải vá toàn bộ tầng network của
  yt-dlp) và không có `subprocess` (yt-dlp gọi ffmpeg qua subprocess).
- Quan trọng hơn: **port đúng phần không cần.** Giá trị của yt-dlp là (a) extract
  cho 1000+ site và (b) mux. Trong extension, (a) đã có sẵn và làm tốt hơn.

### 3.1. Trục bị bỏ sót: ma sát demo

Bốn phương án trên ban đầu chỉ được so bằng tiêu chí kỹ thuật (bộ nhớ, vòng đời,
R6). Với mục tiêu portfolio thì thiếu một trục có chi phí thật: **người xem phải
làm bao nhiêu bước trước khi thấy nó chạy.**

| Phương án | Số bước để demo | Chi tiết |
|---|---|---|
| 1 (status quo) | 3 | Cài Python + uv → `uv sync` → chạy CLI. Không demo được cho người không phải dev |
| **2 (đề xuất)** | **4** | Tải `.app` 146MB → mở (Gatekeeper chặn nếu chưa ký) → cài extension → hai bên bắt tay qua localhost |
| 3 (ffmpeg.wasm) | **1** | Cài extension. Hết |
| 4 (yt-dlp WASM) | — | Không khả thi |

Phương án 2 còn có một điểm gãy mà các phương án khác không có: **nếu app local
chưa chạy thì extension chết câm.** Đúng thứ sẽ xảy ra khi người xem thử lần đầu.
B6 (báo trạng thái offline) giảm nhẹ, không xóa được.

**Điều này không đảo ngược quyết định.** Các lý do kỹ thuật loại Phương án 3 vẫn
đứng: trần bộ nhớ 2GB giết video dài, và mất R6 nghĩa là mất pause/resume cùng
history — hai thứ đã chạy được rồi. Đánh đổi 3 bước demo để giữ những thứ đó là
lựa chọn có ý thức.

Nhưng nó đổi **điều kiện để xem lại quyết định**: nếu probe ở §6.7 GĐ 0 trượt, đọc
lại bảng này trước khi sửa Phương án 2 — vì lúc đó Phương án 3 vừa rẻ hơn về demo
vừa không còn bị Phương án 2 vượt về năng lực.

### Ghi chú: có thể không cần ffmpeg cho luồng chính

MPEG-TS vốn nối thẳng được (`cat a.ts b.ts > out.ts` ra file chạy được), và việc
cắt header ngụy trang là `buffer.slice(n)`. Cộng với File System Access API
(`WritableStream`, ghi thẳng ra đĩa, không giữ trong RAM → không dính trần 2GB),
một luồng "tải + ghép" thuần JS là khả thi mà **không cần WASM**.

ffmpeg chỉ thật sự cần khi muốn container `.mp4` chuẩn. Đây là lý do Phương án 3
không hoàn toàn vô lý — nhưng nó vẫn mất R6, và vẫn phải nhét app local vào
trình duyệt rồi nhận hết nhược điểm của trình duyệt.

---

## 4. Decision

Chọn **Phương án 2**, chia theo thế mạnh. Đã xác nhận bằng đo thực tế (§7):

| Thành phần | Chịu trách nhiệm | Lý do |
|---|---|---|
| **Extension** | Bắt manifest (`chrome.webRequest`), đọc DOM/iframe, thu cookie + UA + Referer + Origin, gửi sang API | Nó nằm sẵn trong session thật: cookie thật, TLS fingerprint thật, Cloudflare đã qua |
| **App local** | Tải segment, hậu xử lý byte-level, remux ffmpeg, ghi file, history, pause/resume | Cần filesystem, process control và ffmpeg — browser không có |

Ranh giới: **extension chỉ gửi đi một `VideoInfo`** (đúng DTO đang có ở
`core/models.py`: `m3u8_url`, `title`, `referer`, `origin`, `cookies`,
`user_agent`, và các cờ hậu xử lý). Extension không tải, không mux, không biết gì
về filesystem.

Điều này **không phá vỡ R1–R3**: extension chỉ là một client mới của API đã có;
`core/` không đổi; các private plugin vẫn ở `plugins/` và vẫn tháo rời được.

---

## 5. Vòng đời process trên macOS

Phương án 2 đòi hỏi backend phải sống độc lập với cửa sổ UI — extension gọi được
bất cứ lúc nào, kể cả khi người dùng chưa mở app. Đây là phần chưa được thiết kế.

### 5.1. Bug hiện có: đóng cửa sổ là tắt backend

`apps/desktop/main.py` hiện làm thế này:

```python
server_thread = threading.Thread(target=start_backend, daemon=True)
server_thread.start()
...
webview.start(...)   # block cho tới khi mọi cửa sổ đóng
```

`daemon=True` nghĩa là thread backend chết theo main thread. `webview.start()`
return khi cửa sổ cuối cùng đóng → `main()` thoát → process chết → **backend biến
mất**. Với Desktop mode thuần thì không sao, nhưng với extension thì đóng nhầm cửa
sổ là mất kết nối, và thông báo lỗi phía extension sẽ không nói được vì sao.

Đây là thay đổi bắt buộc của Phương án 2, không phải tùy chọn.

### 5.2. Có cần icon trên menu bar không?

Phụ thuộc kiến trúc transport:

| Kiến trúc | App chạy nền? | Cần menu bar? |
|---|---|---|
| Native Messaging thuần | Không — Chrome spawn khi cần | Không. Nhưng download chết khi đóng trình duyệt |
| HTTP localhost (hiện tại) | **Có, phải luôn chạy** | **Có** |
| Lai (§2.5b): handshake qua Native Messaging + HTTP/SSE cho phần còn lại | **Có** | **Có** |

Vì codebase đã có sẵn HTTP + SSE + ADR 0004, giữ transport hiện tại là hợp lý →
**cần menu bar**. Bốn lý do, không phải thẩm mỹ:

1. **Người dùng phải biết nó đang chạy.** Không thì extension báo "không kết nối
   được backend" mà không ai hiểu vì sao và sửa kiểu gì.
2. **Phải có cách thoát** mà không cần mở Activity Monitor đi tìm process Python.
3. **Niềm tin.** Một tiến trình Python âm thầm giữ port `8000`, không dấu hiệu gì
   trên giao diện — đó đúng là thứ khiến người ta gỡ app.
4. **Xem tiến trình** mà không cần mở cửa sổ chính.

### 5.3. Cách làm, không cần thêm dependency

- **`NSStatusItem` qua pyobjc.** pywebview trên macOS đã kéo sẵn pyobjc/AppKit
  (thấy `_AppKit.cpython-312-darwin.so` trong bundle `.app` đã build), nên không
  phát sinh dependency mới.
- **Ẩn icon Dock:** `LSUIElement` trong `Info.plist` (spec đã có chỗ đặt
  `info_plist` ở `packaging/Streamloot.spec`), hoặc gọi
  `NSApp.setActivationPolicy_()` để bật/tắt động khi mở cửa sổ chính.
- **Ẩn thay vì thoát:** pywebview có sẵn `window.hide()`, tham số `hidden=True`,
  và event `window.events.closing` — hook `closing` để ẩn cửa sổ thay vì hủy.
- **Không dùng `rumps`.** Đây là thư viện menu-bar phổ biến nhất cho Python, nhưng
  nó chạy NSApplication run loop riêng, xung đột với run loop của pywebview. Gắn
  `NSStatusItem` thẳng vào NSApplication mà pywebview đã tạo thì sạch hơn.

### 5.4. Hệ quả cho việc đóng gói

- `build_app.sh` không đổi.
- `packaging/Streamloot.spec` cần thêm `LSUIElement` (hoặc để code tự set
  activation policy).
- Nếu dùng ý tưởng lai ở §2.5b thì phải ghi file manifest native host vào
  `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` lúc cài —
  tức là app cần một bước "cài đặt tích hợp trình duyệt", đúng như IDM làm.

---

## 6. Implementation Plan (Phương án 2)

### 6.1. Ranh giới trách nhiệm

| Việc | Extension | App local |
|---|---|---|
| Bắt manifest (`m3u8`/`mpd`) | ✅ `chrome.webRequest` | — |
| Vượt Cloudflare | ✅ *miễn phí* — user đã qua khi mở trang | — |
| Thu cookie / UA / Referer / Origin | ✅ session thật | — |
| Liệt kê chất lượng | ✅ render | ✅ `/api/v1/formats` tính |
| Tải segment, đa kết nối | — | ✅ `yt-dlp -N` |
| Hậu xử lý byte-level + remux | — | ✅ ffmpeg |
| Pause/resume, history, ghi file | — | ✅ |

**Extension không tải, không mux, không biết filesystem.** Nó chỉ gửi đi một
`VideoInfo` — đúng DTO đang có ở `core/models.py`.

### 6.2. Phát hiện then chốt khi khảo sát code

1. **`DownloadRequest` hiện chỉ nhận `url`** (`apps/api/main.py:117`), tức API tự
   extract phía server. Extension đã extract sẵn rồi → cần thêm đường nhận
   `VideoInfo` dựng sẵn. Đây là thay đổi API chính.
2. **`VideoInfo` không cần đổi.** Đã có đủ `referer`, `origin`, `user_agent`,
   `cookies`, `disable_fixup`, `embed_metadata`, `clean_disguised_ts`,
   `extra_ytdlp_args`. Extension chỉ cần điền đúng shape.
3. **Multi-connection đã chạy sẵn** — `ytdlp.py:125` truyền `-N`, mặc định 4.
   Không phải xây, chỉ cần expose ra extension.
4. **SSE là endpoint duy nhất không xác thực** —
   `@app.get("/api/v1/downloads/{task_id}/stream")` (dòng 274) không có
   `Depends(verify_api_key)`, mọi endpoint khác đều có. Lý do chính đáng:
   `EventSource` không set được header `Authorization`. ADR 0004 đã biết và cố ý
   ("trừ SSE stream"). `task_id` là UUID4 nên không đoán được. Khi có extension
   nên siết lại — token dùng-một-lần trong query string, hoặc `fetch()` +
   `ReadableStream` thay `EventSource` (fetch set được header).

### 6.3. Hạng mục công việc

#### Nhóm A — Extension (mới hoàn toàn)

| Thành phần | Nội dung |
|---|---|
| `manifest.json` | MV3; permissions `webRequest`, `cookies`, `storage`, `nativeMessaging` (nếu làm B11), `host_permissions` |
| Service worker | Nghe `webRequest`, lọc manifest, gom theo `tabId` |
| Content script | Panel nổi trên trang + danh sách chất lượng |
| Popup | Trạng thái kết nối backend |
| Options | `API_KEY`, port, `concurrency` |

#### Nhóm B — Sửa app hiện có

| # | Việc | File | Vì sao |
|---|---|---|---|
| **B1** | Endpoint nhận `VideoInfo` dựng sẵn | `apps/api/main.py` | Xem §6.2.1 |
| **B2** | Sửa vòng đời process | `apps/desktop/main.py` | `daemon=True` → đóng cửa sổ là backend chết (§5.1) |
| **B3** | Menu bar `NSStatusItem` | `apps/desktop/statusbar.py` (mới) | pywebview không có (§6.4) |
| **B4** | `LSUIElement` / activation policy | `packaging/Streamloot.spec` | Bỏ icon Dock khi chạy nền |
| **B5** | CORS cho `chrome-extension://<ID>` | `apps/api/main.py` | ADR 0004 đã dự trù |
| **B6** | Trạng thái "backend offline" | extension | Báo rõ, không để user đoán |

#### Nhóm B' — Các bài học từ IDM/Cốc Cốc (§2.5) chuyển thành việc

| # | Việc | Nguồn | Chi tiết |
|---|---|---|---|
| **B7** | **Không bao giờ đọc `<video>.src`** | §2.1 bước 2 | Trang stream đưa cho `<video>` một **blob URL qua MSE**. Scan DOM chỉ ra `blob:https://...` — không tải được, không header. Chỉ tin `webRequest`. **Ghi comment trong code** để người sau không thử lại. |
| **B8** | **Panel tự nổi khi phát hiện media** + badge đếm trên icon | §2.5d, ảnh tham chiếu IDM/Cốc Cốc | Không đợi user đi tìm nút. Đây đúng là R5: khác biệt giữa "công cụ tôi phải nhớ là mình có" và "công cụ luôn ở đó". |
| **B9** | **Giữ cả hai đường; extension có fallback** | §2.5e (bài học ngược từ Cốc Cốc) | Cốc Cốc fork cả trình duyệt để thoát sandbox extension — ta không làm được, nên phải chấp nhận có site extension bó tay (loại "cần tương tác mới lộ stream", §2.3). B1 **thêm vào bên cạnh**, không thay thế `/api/v1/downloads` cũ. Extension bắt được manifest → gửi `VideoInfo`; không bắt được → gửi URL trần, app dùng đường headless browser cũ. |
| **B10** | Expose `concurrency` ra options page | §2.1 bước 4 | `-N` đã chạy sẵn (§6.2.3). IDM nổi tiếng vì multi-connection. Gần như miễn phí. |
| **B11** | Handshake qua Native Messaging *(tùy chọn)* | §2.5b | Extension hỏi một phát `{port, api_key}` rồi quay lại HTTP. Giải 2 điểm treo của ADR 0004 (phân phối API key, ghim extension ID) mà không đụng transport. |
| **B12** | Sniff theo cả `Content-Type` | §2.5c | Ngoài chuỗi `m3u8`/`mpd` trong URL, bắt thêm `application/vnd.apple.mpegurl`, `application/x-mpegURL`, `application/dash+xml`. URL manifest thường có query string hoặc không đuôi. |
| **B13** | **Siết xác thực cho luồng SSE** | §6.2.4 | Xem §6.3.1 bên dưới. Bắt buộc trước khi extension gọi endpoint này, vì extension mở rộng bề mặt tấn công so với desktop app tự gọi chính mình. |

#### 6.3.1. B13 — Lỗ hổng SSE, chi tiết

`apps/api/main.py:274` là endpoint duy nhất thiếu `Depends(verify_api_key)`.

**Vì sao nó tồn tại:** `EventSource` của trình duyệt không set được header
`Authorization`. ADR 0004 biết và cố ý ghi ngoại lệ ("trừ SSE stream").

**Vì sao hiện chấp nhận được:** `task_id` là UUID4 — không đoán được, và chỉ client
vừa tạo task mới biết nó.

**Vì sao extension làm nó tệ hơn:** desktop app hiện tại tự gọi backend của chính
nó trên một origin nó tự kiểm soát. Extension chạy trên mọi trang người dùng mở,
nên bất kỳ trang nào cũng có thể thử `EventSource` tới `127.0.0.1:8001`. Vẫn cần
đoán trúng UUID4, nhưng bề mặt tấn công rộng hơn hẳn.

**Hai cách sửa:**

| Cách | Chi tiết | Đánh giá |
|---|---|---|
| **Token dùng-một-lần trong query** | `POST /downloads` trả thêm `stream_token`; endpoint stream nhận `?token=`, dùng xong hủy | Nhỏ, giữ nguyên `EventSource` phía client |
| `fetch()` + `ReadableStream` | Thay `EventSource`, `fetch` set được header `Authorization` bình thường | Sạch hơn về mặt mô hình, nhưng phải viết lại phần đọc stream ở cả desktop UI lẫn extension |

Đề xuất: **token dùng-một-lần** — nhỏ hơn, không đụng UI desktop đang chạy tốt.
Cần cập nhật ADR 0004 để ghi nhận ngoại lệ "trừ SSE stream" đã được đóng lại.

#### Nhóm C — Không đụng

`core/`, `downloaders/`, `services/`, `extractors/`, `plugins/`, CLI, `build_app.sh`.

### 6.4. Vì sao **không** chuyển transport sang Native Messaging

| Lý do | Chi tiết |
|---|---|
| Mất SSE | Native messaging là stdio message-passing; progress real-time phải viết lại. SSE đã chạy được. |
| Trần 1MB/message | Host→Chrome tối đa 1MB. Đủ cho progress nhưng là ràng buộc không cần thiết. |
| Vòng đời | Chrome giết host khi port đóng → download dài không sống nổi. Chính lý do IDM vẫn giữ app thường trú. |
| Phá ADR 0004 | Ba lớp bảo vệ đã thiết kế và code xong. |

→ Giữ HTTP+SSE, chỉ mượn Native Messaging cho cái bắt tay (B11).

### 6.5. Menu bar: pywebview không hỗ trợ

Đã kiểm chứng trực tiếp trên pywebview **6.2.1** đang cài:

| Kiểm tra | Kết quả |
|---|---|
| `grep -r "NSStatusItem\|NSStatusBar"` toàn package | **0 lần xuất hiện** |
| `webview/menu.py` | Chỉ có `Menu`/`MenuAction`/`MenuSeparator` → dùng cho `setMainMenu_()`, tức **menu ứng dụng** (File/Edit/View khi app focus), không phải icon góc phải menu bar |
| `platforms/cocoa.py:59` | `app.setActivationPolicy_(0)` hardcode = Regular → **luôn có icon Dock**, không tắt được qua API |

Nhưng làm được, không thêm dependency:

- `platforms/cocoa.py:58` dùng `AppKit.NSApplication.sharedApplication()` — singleton.
  Code của ta gọi lại đúng hàm đó là được **cùng một instance**, rồi tự gắn `NSStatusItem`.
- `setActivationPolicy_(0)` chạy lúc **import module**, nên phải override **sau** khi
  GUI loop khởi động. Hook có sẵn: `webview.start(func=...)` gọi `func` sau khi loop chạy.
- Ẩn thay vì thoát: `window.events.closing` + `window.hide()`.
- **Không dùng `rumps`** — nó chạy NSApplication run loop riêng, xung đột với pywebview.

Ước lượng ~40 dòng pyobjc.

### 6.6. Luồng dữ liệu

```
1. User mở trang video
2. Player fetch master.m3u8
   → service worker bắt được qua webRequest, lưu {url, headers, tabId}   [B12]
   → KHÔNG đọc <video>.src (blob/MSE, vô dụng)                           [B7]
3. Panel tự nổi + badge đếm trên icon                                    [B8]
4. User bấm → extension GET /api/v1/formats
5. Panel hiện Quad HD / Full HD / HD / ...
6. User chọn → POST VideoInfo + format_id + concurrency                  [B1][B10]
   → nếu bước 2 không bắt được gì: POST url trần, app tự extract         [B9]
7. App tải (yt-dlp -N), phát SSE
8. Extension nghe SSE, cập nhật panel
9. Xong → menu bar báo, file nằm trong thư mục đã chọn
```

### 6.7. Thứ tự làm

| GĐ | Việc | Ra được gì |
|---|---|---|
| **0** | Extension probe ~50 dòng, chỉ `console.log` request khớp manifest, mở 3 site | **Cổng chặn.** Một buổi tối. Không bắt được thì dừng, khỏi tốn gì thêm |
| **1** | B2 + B3 + B4 | App chạy nền được, đóng cửa sổ không chết |
| **2** | B1 + B5 + B9 + **B13** | `curl` giả lập extension tải được, cả 2 đường, và luồng SSE đã xác thực |
| **3** | Nhóm A + B7 + B8 + B12 | One-click capture chạy thật |
| **4** | B6 + B10 + B11 | Dùng được hàng ngày |

Mỗi giai đoạn kết thúc bằng một thứ chạy được. **Giai đoạn 0 làm trước, không bỏ qua.**

### 6.8. Rủi ro

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| `webRequest` không bắt được manifest của 1 trong 3 site | **Cao** | GĐ 0 trả lời trước khi tốn công. Nếu trượt → B9 fallback vẫn cứu được |
| Extension ID không cố định → CORS gãy | Trung bình | Pin `key` trong manifest, hoặc B11 |
| MV3 service worker bị thu hồi giữa chừng | Trung bình | State vào `chrome.storage`, không giữ trong biến module |
| User đóng app → extension mất backend | Trung bình | B2 + B3; B6 báo rõ trạng thái |

---

## 7. Kết quả đo Giai đoạn 0 (2026-09-16)

Probe (`apps/extension/`) đã chạy trên cả 3 site. **Kết quả: 3/3.**

> Nhật ký từng lần chạy — gồm ba lần đoán sai và vì sao — ở
> [`docs/impl/2026-09-16-stage0-probe-log.md`](../impl/2026-09-16-stage0-probe-log.md).

| Plugin | Manifest bắt được? | Qua | Ngữ cảnh phiên bắt được |
|---|---|---|---|
| **A** (auto-click Turnstile) | ✅ | `url` | `referer, origin, ua` |
| **B** (quét iframe) | ✅ | `url` | `referer, origin, ua` |
| **C** (thu cookie + `clean_disguised_ts`) | ✅ | `url` | `origin, ua` — **thiếu `referer` và `cookie`** |

~400 request được quan sát trong phiên đo, nên số 0 ở cột nào cũng là "không có",
không phải "listener chết".

### 7.1. Luận điểm trung tâm được xác nhận

`webRequest` quan sát được manifest trên cả 3 site, trong session thật, **không
cần một dòng auto-click Turnstile nào**. Đây đúng là thứ §1.2 dự đoán: cách
headless hiện tại đang trả giá để giả lập cái mà trình duyệt người dùng đã có sẵn.

Cả 3 site đều đưa manifest sang **CDN riêng**, khác tên miền trang. Hai trong ba
đi qua **iframe player riêng** — cột "Trang" của probe hiển thị origin của iframe
(từ `d.initiator`) chứ không phải tab, và điều đó xác nhận đúng kiến trúc mà
Plugin B vốn đã phải quét iframe để xử lý.

### 7.2. B12 chưa chứng minh được giá trị

**Không có hit nào qua đường `content-type`** — cả 3 site đều lộ đuôi `.m3u8`
trong URL. Giữ B12 vì nó rẻ và phòng site khác, nhưng hạ ưu tiên: nó không phải
thứ làm cho 3 site này chạy được.

### 7.3. B14 — cookie: ĐÃ ĐO XONG, kết luận là **không cần**

Plugin C thu cookie (`page.cookies()`) và truyền vào `VideoInfo.cookies`, nhưng
probe cho thấy trình duyệt không gửi cookie trên request manifest. Câu hỏi treo
lại: cookie thừa, hay cần cho segment mà probe chưa quan sát?

Probe được mở rộng sang request segment (B14) và đo lại. Trang đó nói chuyện với
5 host trong lúc phát:

| Host | Resource type | Ngữ cảnh gửi đi | Vai trò |
|---|---|---|---|
| Host manifest | `xmlhttprequest` | `origin, ua` | manifest |
| CDN "ảnh" | **`image`** | **chỉ `ua`** | **segment ngụy trang PNG** |
| CDN tên ngẫu nhiên | `xmlhttprequest` | `origin, ua` | shard phục vụ byte |
| **Host của chính trang** | `xmlhttprequest` | **`cookie`, origin, ua** | API nội bộ của trang |
| Analytics bên thứ ba | `xmlhttprequest` | `origin, ua` | nhiễu |

**Kết luận: mọi host phục vụ byte media đều không nhận cookie.**

Host duy nhất có cookie là host của chính trang — XHR **same-origin**, tức trang
gọi API của nó, và trình duyệt luôn kèm cookie cho same-origin. Đó không phải
request tải media. Đây là chỗ dễ đọc nhầm nhất của phép đo.

Nghĩa là **giải thích (1) đúng: cookie là thừa** đối với việc tải. Cookie mà
Plugin C thu nhiều khả năng cần cho chính lời gọi API lộ ra URL stream — mà trong
mô hình extension, **extension không phải gọi lại lời gọi đó**: trang đã gọi rồi,
extension chỉ quan sát kết quả. Nó thừa hưởng phiên đã xác thực thay vì phát lại.

#### Hệ quả cho B1

- **Không cần permission `cookies` trong `manifest.json`**, không cần
  `chrome.cookies` API. Bề mặt quyền hẹp hơn hẳn — đáng kể vì Chrome Web Store
  soi permission rất kỹ.
- Hợp đồng dữ liệu của B1 gọn lại: `m3u8_url`, `referer`, `origin`, `user_agent`
  là đủ. `VideoInfo.cookies` để `None` cho đường extension.
- `VideoInfo` **không cần đổi** — trường `cookies` vẫn còn cho đường headless
  (CLI/Desktop) dùng.

#### Giới hạn của phép đo này

Probe đo **thứ trình duyệt gửi đi**, không đo **thứ máy chủ bắt buộc**. Máy chủ
vẫn có thể từ chối client ngoài trình duyệt vì lý do khác (URL ký có hạn, kiểm
`Referer` chỉ với request lạ). Kết luận "không cần cookie" đúng ở mức: **cấp đúng
những gì trình duyệt cấp là đủ để tái hiện**, chứ không phải "máy chủ không quan
tâm gì".

Phép thử thật nằm ở B1: gửi `VideoInfo` không cookie xuống `yt-dlp` và xem có tải
được không. Rẻ, và lúc đó đã có sẵn hạ tầng.

### 7.4. Hệ quả

| | |
|---|---|
| ADR này | **Proposed → Accepted** |
| ADR 0006 (tech stack) | **Proposed → Accepted** — WXT đã dựng được probe chạy thật, không còn là lựa chọn trên giấy |
| B12 | Giữ, hạ ưu tiên (§7.2) |
| **B14** | ✅ **Đóng** — đã đo, cookie không cần cho việc tải (§7.3). B1 bỏ được đường cookie |

---

## 8. Consequences

**Tích cực**

- Xóa được khối code auto-click Cloudflare ở Plugin A — cùng cả một lớp lỗi.
- Bỏ được `_browser_lock`: không còn Chromium tạm nào để mà tranh nhau, extract
  chạy song song được.
- Đáp ứng R5 (one-click capture) — feature gap #1 theo brainstorm.
- Kích hoạt đúng thiết kế R4/ADR 0004 vốn đã có sẵn nhưng chưa có client.
- Hết phụ thuộc DrissionPage cho luồng extension (vẫn giữ cho CLI/Desktop chạy độc lập).

**Tiêu cực**

- Phải xây và bảo trì thêm một thành phần (extension), với vòng đời MV3 và quy
  trình review của Chrome Web Store.
- App local phải đang chạy thì extension mới tải được → cần xử lý trạng thái
  "không kết nối được backend" cho tử tế.
- ADR 0004 yêu cầu `chrome-extension://<EXTENSION_ID>` trong CORS allowlist, mà
  ID chỉ cố định khi đã publish hoặc khi pin key trong manifest → cần giải quyết.
- Việc trao `API_KEY` cho extension chưa có cơ chế (ADR 0004 đã ghi nhận đây là
  điểm mở).
- **Không xóa bỏ được các private plugin.** Chúng vẫn cần cho CLI và Desktop mode,
  vốn không có trình duyệt của user để dựa vào.

**Trung tính**

- Sau khi có extension, phần extract của 3 plugin gần như trùng lặp với extension.
  Chấp nhận trùng lặp — đó là cái giá của R1 (ba mode độc lập).

---

## 9. Cần xác nhận trước khi chốt

1. ~~**Extension có thay thế hoàn toàn headless browser không?**~~ **Đã trả lời
   bởi B9 (§6.3):** bổ sung, và extension chủ động fallback về đường headless khi
   không bắt được manifest. Nghĩa là 3 private plugin không chỉ sống vì CLI/Desktop
   — chúng còn là lưới an toàn cho chính extension.
2. **Giả định về Cốc Cốc (§2.2) chưa được kiểm chứng** từ nguồn chính thức. Nếu
   quyết định nào phụ thuộc vào nó thì cần xác minh trước.
3. ~~**Chưa đo thực tế**: `chrome.webRequest` có bắt được manifest của cả 3 site
   không?~~ **ĐÃ ĐO — 3/3, xem §7.** Probe nằm ở `apps/extension/`.
4. **Phân phối:** app local đã đóng gói `.app` được (`build_app.sh`). Extension đi
   kèm thế nào — Chrome Web Store, hay load unpacked cho cá nhân dùng?
5. **Có áp dụng ý tưởng lai ở §2.5b không** (handshake qua Native Messaging, phần
   còn lại giữ HTTP+SSE)? Nó giải được hai điểm treo của ADR 0004 — phân phối
   `API_KEY` và ghim `chrome-extension://<ID>` — nhưng thêm một bước cài đặt: phải
   ghi manifest vào thư mục `NativeMessagingHosts/` của Chrome.
6. **Menu bar (§5.2, §6.5): chốt có làm không?** Nếu có thì `apps/desktop/main.py`
   phải đổi vòng đời process (§5.1) — bắt buộc của Phương án 2, cần quyết trước khi
   bắt tay vào extension.
7. **Vẫn còn giá trị thật không?** Nếu Cốc Cốc/IDM đã tải được 2/3 site kia rồi thì
   phần còn lại của dự án chỉ là site có nội dung ngụy trang. Đáng làm hay không là
   quyết định của bạn, nhưng nên trả lời thẳng trước khi đầu tư tiếp.
8. **Tech stack cho extension** — xem [ADR 0006](0006-extension-tech-stack.md).
9. **ADR 0004 cần cập nhật** sau khi B13 xong: ngoại lệ "trừ SSE stream" trong
   phần Decision không còn đúng nữa.
10. ~~**B14 (§7.3): request segment có mang cookie không?**~~ **ĐÃ ĐO — không.**
    Mọi host phục vụ byte đều không nhận cookie; host duy nhất có cookie là XHR
    same-origin của chính trang. B1 bỏ được đường cookie và bỏ luôn permission
    `cookies`. Phép thử cuối nằm ở chính B1 (§7.3, "Giới hạn").
