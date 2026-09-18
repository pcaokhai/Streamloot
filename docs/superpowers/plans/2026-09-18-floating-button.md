# Plan 3 — Nút nổi trên video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nút nổi nhỏ neo vào video đang phát; bấm nút mở panel chọn format dạng
danh sách, bấm một dòng là tải luôn rồi panel đóng.

**Architecture:** Content script chạy trong **mọi khung** (`all_frames`) nhưng
thoát ngay nếu khung không có `<video>` — phép kiểm gần như miễn phí và loại bỏ
tuyệt đại đa số iframe quảng cáo. Khung nào còn lại thì neo một nút vào video lớn
nhất đang phát, theo dõi bằng `ResizeObserver`/`IntersectionObserver`/
`MutationObserver` thay vì poll. Mọi **quyết định** (chọn video nào, nhóm format,
nhãn hiển thị) nằm trong module thuần chạy thử được bằng node; phần chạm DOM giữ
mỏng nhất có thể — đúng khuôn đã dùng cho `lib/tasks.ts` và `lib/pick.ts`.

**Tech Stack:** WXT + TypeScript, content script MV3, Shadow DOM qua
`createShadowRootUi`, backend FastAPI đã có sẵn.

**Spec:** `docs/superpowers/specs/2026-09-16-extension-download-manager-design.md`
(§5.1, §5.1.1, §8)

## Global Constraints

- **B7 — không đọc `<video>.src`.** Cấm lấy URL từ thẻ video (blob URL của MSE vô dụng). Đọc **vị trí** (`getBoundingClientRect`) và **thời lượng** (`.duration`) là việc khác và hợp lệ.
- Panel **chỉ chọn format**. Không tab, không tiến trình, không lịch sử. Bấm một dòng → gửi lệnh tải → **panel đóng**. Panel **không theo dõi gì** sau khi bàn giao.
- Content script **không bao giờ** `fetch` thẳng backend; mọi lời gọi đi qua service worker.
- `all_frames: true`, nhưng **thoát ngay** nếu khung không có `<video>` nào.
- Mỗi khung chỉ dựng nút cho video **trong chính nó**. Trang có nhiều video thật thì nhiều nút là đúng.
- Không tìm thấy video nào thì **lùi về góc trên phải cửa sổ**, không được biến mất.
- Neo vào **video lớn nhất đang phát**; không có cái nào đang phát thì **lớn nhất trong khung nhìn**.
- Theo dõi bằng observer, **không dùng `setInterval`** để bám vị trí.
- Test extension chạy bằng `./apps/extension/tests/run.sh` từ gốc repo (esbuild gói module THẬT rồi node chạy — repo cố ý không có framework test cho extension, ADR 0006).
- Test Python: `uv run python -m unittest discover -s tests -p "test_*.py"`, phải xanh toàn bộ (hiện 173).
- `cd apps/extension && npx tsc --noEmit` sạch và `npm run build` chạy được.
- Không có tên miền site thật trong file được git theo dõi: `git ls-files | xargs grep -lif .privacy-patterns` không in gì. Dữ liệu mẫu dùng `example.test`.
- Commit tiếng Việt, conventional-commits, kết thúc bằng `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## Cấu trúc file

| File | Trách nhiệm |
|---|---|
| `apps/extension/lib/types.ts` (sửa) | Bổ sung `filesize`/`vcodec`/`acodec` vào `FormatOption` — backend đã trả sẵn ba field này |
| `apps/extension/lib/formats.ts` (mới) | **Thuần, có test**: nhóm format thành VIDEO/ÂM THANH, dựng nhãn từng dòng |
| `apps/extension/lib/anchor.ts` (mới) | **Thuần, có test**: chọn video để neo nút, tính toạ độ nút |
| `apps/extension/entrypoints/panel.content/index.ts` (viết lại) | Thoát sớm, dựng nút nổi, gắn observer, mở panel dạng danh sách |
| `apps/extension/entrypoints/panel.content/style.css` (sửa) | Kiểu cho nút nổi và danh sách dòng |
| `apps/extension/lib/api.ts` (sửa) | Bỏ `streamProgress` (§8) |
| `apps/extension/entrypoints/background.ts` (sửa) | Bỏ `pumpProgress` và tin nhắn `progress` (§8) |
| `apps/extension/tests/formats.test.mjs` (mới) | Test cho `lib/formats.ts` |
| `apps/extension/tests/anchor.test.mjs` (mới) | Test cho `lib/anchor.ts` |
| `apps/extension/tests/run.sh` (sửa) | Chạy thêm hai bộ test mới |
| `tests/test_api_contract.py` (sửa) | Ghim thêm hợp đồng `FormatOption` |

---

## Task 1: Hợp đồng format và phép nhóm VIDEO/ÂM THANH

**Files:**
- Modify: `apps/extension/lib/types.ts`
- Create: `apps/extension/lib/formats.ts`
- Create: `apps/extension/tests/formats.test.mjs`
- Modify: `apps/extension/tests/run.sh`
- Modify: `tests/test_api_contract.py`

**Interfaces:**
- Produces:
  - `FormatOption` thêm `filesize: number | null`, `vcodec: string | null`, `acodec: string | null`
  - `groupFormats(formats: FormatOption[]): { video: FormatRow[]; audio: FormatRow[] }`
  - `FormatRow = { formatId: string; label: string; detail: string; recommended: boolean }`
  - `humanSize(bytes: number | null): string`

- [ ] **Step 1: Ghim hợp đồng FormatOption bên Python**

Backend trả `filesize`, `vcodec`, `acodec` (xem `downloaders/ytdlp.py::list_formats`)
nhưng `FormatOption` bên TS chưa khai — đúng loại lệch mà test hợp đồng sinh ra để
chặn. Thêm vào `tests/test_api_contract.py`, trong `class TestApiContract`:

```python
    def test_format_option_shape_matches_typescript(self):
        """
        list_formats dựng dict này bằng tay, không lấy từ bảng DB nào, nên không
        có migration nào nhắc khi nó đổi. Ghim lại ở đây.
        """
        expected = ts_interface_fields("FormatOption")
        actual = {
            "format_id", "ext", "resolution", "height",
            "filesize", "vcodec", "acodec", "recommended",
        }
        self.assertEqual(actual, expected)
```

- [ ] **Step 2: Chạy test, xác nhận nó ĐỎ**

Run: `uv run python -m unittest tests.test_api_contract -v`
Expected: FAIL — `FormatOption` bên TS còn thiếu `filesize`, `vcodec`, `acodec`.

- [ ] **Step 3: Bổ sung ba field vào TS**

Trong `apps/extension/lib/types.ts`, sửa `FormatOption`:

```ts
export interface FormatOption {
  format_id: string;
  ext: string;
  resolution: string;
  height: number | null;
  /** Byte, hoặc `null` khi yt-dlp không biết trước (HLS thường không biết). */
  filesize: number | null;
  /** `'none'` nghĩa là luồng này KHÔNG có hình — đó là cách tách âm thanh. */
  vcodec: string | null;
  /** `'none'` nghĩa là luồng này không có tiếng. */
  acodec: string | null;
  recommended: boolean;
}
```

- [ ] **Step 4: Chạy lại test hợp đồng**

Run: `uv run python -m unittest tests.test_api_contract -v`
Expected: PASS.

- [ ] **Step 5: Viết test thất bại cho phép nhóm**

Tạo `apps/extension/tests/formats.test.mjs`:

```js
import { groupFormats, humanSize } from '../.tmp-formats.mjs';

let pass = 0, fail = 0;
const t = (name, got, want) => {
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
  groupFormats([f({ format_id: 'a', vcodec: 'none', acodec: 'mp4a' })]).audio.length, 1);
t('có vcodec là video',
  groupFormats([f({ format_id: 'v', height: 720 })]).video.length, 1);
t('luồng câm vẫn là video',
  groupFormats([f({ format_id: 'v', height: 720, acodec: 'none' })]).video.length, 1);

// --- video xếp cao xuống thấp ---
t('video sắp từ cao xuống thấp',
  groupFormats([
    f({ format_id: 'a', height: 360 }),
    f({ format_id: 'b', height: 1080 }),
    f({ format_id: 'c', height: 720 }),
  ]).video.map((r) => r.formatId), ['b', 'c', 'a']);

// --- nhãn ---
t('nhãn video là chiều cao kèm p',
  groupFormats([f({ format_id: 'v', height: 720 })]).video[0].label, '720p');
t('không biết chiều cao thì dùng resolution',
  groupFormats([f({ format_id: 'v', resolution: '1920x1080' })]).video[0].label, '1920x1080');
t('không có gì cả thì vẫn có nhãn đọc được',
  groupFormats([f({ format_id: 'v', resolution: '' })]).video[0].label, 'Chất lượng không rõ');

// --- detail: đuôi file + dung lượng ---
t('detail ghép đuôi và dung lượng',
  groupFormats([f({ format_id: 'v', height: 720, ext: 'mp4', filesize: 1048576 })]).video[0].detail,
  'mp4 · 1.0 MB');
t('không biết dung lượng thì chỉ có đuôi',
  groupFormats([f({ format_id: 'v', height: 720, ext: 'mp4' })]).video[0].detail, 'mp4');

// --- cờ recommended đi theo đúng dòng ---
t('recommended giữ nguyên',
  groupFormats([f({ format_id: 'v', height: 720, recommended: true })]).video[0].recommended, true);

// --- humanSize ---
t('byte', humanSize(512), '512 B');
t('kB', humanSize(2048), '2.0 KB');
t('MB', humanSize(5 * 1024 * 1024), '5.0 MB');
t('GB', humanSize(3 * 1024 ** 3), '3.0 GB');
t('null thì rỗng', humanSize(null), '');
t('số âm coi như không biết', humanSize(-5), '');

// --- rỗng ---
t('không có format nào', groupFormats([]), { video: [], audio: [] });

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 6: Nối vào runner và chạy để thấy ĐỎ**

Trong `apps/extension/tests/run.sh`, thêm trước dòng `rm -f`:

```bash
npx esbuild lib/formats.ts --bundle --format=esm --outfile=.tmp-formats.mjs --log-level=error
node tests/formats.test.mjs
```

và thêm `.tmp-formats.mjs` vào dòng `rm -f` cuối.

Run: `./apps/extension/tests/run.sh`
Expected: FAIL — esbuild báo không tìm thấy `lib/formats.ts`.

- [ ] **Step 7: Viết `lib/formats.ts`**

```ts
/**
 * Biến danh sách format thô của yt-dlp thành các dòng bấm được.
 *
 * Tách khỏi panel vì đây là quyết định (nhóm nào, sắp thế nào, nhãn ra sao) chứ
 * không phải nét vẽ — và quyết định thì chạy thử được bằng node, còn DOM thì
 * không (ADR 0006).
 */
import type { FormatOption } from './types';

export interface FormatRow {
  formatId: string;
  /** Dòng chính: "720p" */
  label: string;
  /** Dòng phụ: "mp4 · 12.3 MB" */
  detail: string;
  recommended: boolean;
}

/**
 * Dung lượng cho người đọc. Rỗng khi không biết.
 *
 * HLS thường không biết trước dung lượng, nên "không biết" là ca THƯỜNG chứ
 * không phải ngoại lệ — trả rỗng để panel bỏ hẳn phần đó thay vì hiện "0 B".
 */
export function humanSize(bytes: number | null): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return i === 0 ? `${Math.round(v)} ${units[i]}` : `${v.toFixed(1)} ${units[i]}`;
}

function labelFor(f: FormatOption): string {
  if (typeof f.height === 'number' && f.height > 0) return `${f.height}p`;
  if (f.resolution) return f.resolution;
  return 'Chất lượng không rõ';
}

function rowFor(f: FormatOption): FormatRow {
  const size = humanSize(f.filesize);
  return {
    formatId: f.format_id,
    label: labelFor(f),
    detail: size ? `${f.ext} · ${size}` : f.ext,
    recommended: f.recommended,
  };
}

/**
 * Tách VIDEO và ÂM THANH bằng `vcodec`, KHÔNG bằng `height`.
 *
 * yt-dlp đặt `vcodec: 'none'` cho luồng chỉ có tiếng — đó là tín hiệu tường
 * minh. Đoán theo `height` sẽ xếp nhầm mọi luồng hình mà yt-dlp không biết chiều
 * cao (HLS hay thiếu) vào nhóm âm thanh.
 *
 * Video sắp từ cao xuống thấp vì người dùng gần như luôn tìm chất lượng cao
 * nhất trước.
 */
export function groupFormats(formats: FormatOption[]): { video: FormatRow[]; audio: FormatRow[] } {
  const video: FormatOption[] = [];
  const audio: FormatOption[] = [];
  for (const f of formats) {
    if (f.vcodec === 'none') audio.push(f);
    else video.push(f);
  }
  video.sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  return { video: video.map(rowFor), audio: audio.map(rowFor) };
}
```

- [ ] **Step 8: Chạy test, phải XANH**

Run: `./apps/extension/tests/run.sh`
Expected: mọi bộ test xanh, trong đó `formats.test.mjs` 16 pass.

- [ ] **Step 9: Kiểm ngược — đổi phép tách sang `height` thì test phải ĐỎ**

Tạm sửa `groupFormats` thành `if (!f.height) audio.push(f); else video.push(f);`
Run: `./apps/extension/tests/run.sh`
Expected: FAIL ở "không biết chiều cao thì dùng resolution" hoặc "có vcodec là video".
Rồi khôi phục và chạy lại cho xanh.

- [ ] **Step 10: Chạy toàn bộ và commit**

```bash
uv run python -m unittest discover -s tests -p "test_*.py"
cd apps/extension && npx tsc --noEmit && cd ..
git ls-files | xargs grep -lif .privacy-patterns
git add apps/extension/lib/types.ts apps/extension/lib/formats.ts apps/extension/tests/ tests/test_api_contract.py
git commit -m "$(cat <<'EOF'
feat(extension): nhóm format thành VIDEO/ÂM THANH cho panel dạng danh sách

Tách bằng `vcodec === 'none'` chứ không bằng height: yt-dlp đặt cờ đó tường minh
cho luồng chỉ có tiếng, còn đoán theo height sẽ xếp nhầm mọi luồng hình mà yt-dlp
không biết chiều cao (HLS hay thiếu) vào nhóm âm thanh.

Kèm: FormatOption bên TS còn thiếu filesize/vcodec/acodec dù backend đã trả sẵn
ba field đó. Test hợp đồng giờ ghim cả FormatOption — list_formats dựng dict bằng
tay chứ không lấy từ bảng DB nào, nên không có migration nào nhắc khi nó đổi.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Chọn video để neo nút

**Files:**
- Create: `apps/extension/lib/anchor.ts`
- Create: `apps/extension/tests/anchor.test.mjs`
- Modify: `apps/extension/tests/run.sh`

**Interfaces:**
- Produces:
  - `type Rect = { top: number; left: number; width: number; height: number }`
  - `type VideoLike = { rect: Rect; playing: boolean }`
  - `pickAnchor(videos: VideoLike[], viewport: { width: number; height: number }): number`
    trả **chỉ số** video được chọn, hoặc `-1` khi không có ứng viên nào
  - `buttonPos(rect: Rect, size: number, pad: number): { top: number; left: number }`
  - `BTN_SIZE = 28`, `BTN_PAD = 8`, `MIN_VIDEO_PX = 120`

- [ ] **Step 1: Viết test thất bại**

Tạo `apps/extension/tests/anchor.test.mjs`:

```js
import { pickAnchor, buttonPos, BTN_SIZE, BTN_PAD, MIN_VIDEO_PX } from '../.tmp-anchor.mjs';

let pass = 0, fail = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
};
const v = (w, h, playing = false, top = 0, left = 0) =>
  ({ rect: { top, left, width: w, height: h }, playing });
const VIEW = { width: 1280, height: 800 };

// --- không có ứng viên ---
t('không có video nào', pickAnchor([], VIEW), -1);
t('video quá nhỏ bị bỏ qua (icon, sprite)',
  pickAnchor([v(40, 30, true)], VIEW), -1);

// --- đang phát thắng kích thước ---
t('một video thì chọn nó', pickAnchor([v(640, 360)], VIEW), 0);
t('ĐANG PHÁT thắng, dù nhỏ hơn',
  pickAnchor([v(1280, 720, false), v(320, 240, true)], VIEW), 1);
t('nhiều cái đang phát thì chọn cái LỚN NHẤT',
  pickAnchor([v(320, 240, true), v(1280, 720, true)], VIEW), 1);
t('không cái nào phát thì chọn cái lớn nhất',
  pickAnchor([v(320, 240), v(640, 480)], VIEW), 1);

// --- ngoài khung nhìn ---
t('video ngoài khung nhìn không được chọn khi có cái trong khung',
  pickAnchor([v(1280, 720, false, -2000, 0), v(320, 240, false, 10, 10)], VIEW), 1);
t('tất cả đều ngoài khung nhìn thì vẫn chọn cái lớn nhất, không trả -1',
  pickAnchor([v(320, 240, false, -2000, 0), v(1280, 720, false, -3000, 0)], VIEW), 1);

// --- vị trí nút: góc trên PHẢI, nằm trong video ---
t('nút ở góc trên phải, thụt vào trong',
  buttonPos({ top: 100, left: 200, width: 640, height: 360 }, BTN_SIZE, BTN_PAD),
  { top: 108, left: 200 + 640 - BTN_SIZE - BTN_PAD });
t('video sát mép trái vẫn tính đúng',
  buttonPos({ top: 0, left: 0, width: 300, height: 200 }, BTN_SIZE, BTN_PAD),
  { top: 8, left: 300 - BTN_SIZE - BTN_PAD });

t('hằng số có giá trị dùng được', [BTN_SIZE > 0, BTN_PAD >= 0, MIN_VIDEO_PX > 0], [true, true, true]);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Nối vào runner và chạy để thấy ĐỎ**

Trong `apps/extension/tests/run.sh`, thêm trước dòng `rm -f`:

```bash
npx esbuild lib/anchor.ts --bundle --format=esm --outfile=.tmp-anchor.mjs --log-level=error
node tests/anchor.test.mjs
```

và thêm `.tmp-anchor.mjs` vào dòng `rm -f` cuối.

Run: `./apps/extension/tests/run.sh`
Expected: FAIL — esbuild báo không tìm thấy `lib/anchor.ts`.

- [ ] **Step 3: Viết `lib/anchor.ts`**

```ts
/**
 * Chọn video nào để neo nút, và nút nằm ở đâu.
 *
 * Thuần và không chạm DOM: nhận hình chữ nhật đã đo sẵn, trả chỉ số và toạ độ.
 * Phần gọi `getBoundingClientRect` và gắn observer nằm ở content script — ở đó
 * không test được, nên phần quyết định phải ra đây (ADR 0006).
 *
 * KHÔNG vi phạm B7: B7 cấm đọc `<video>.src` để lấy URL tải, còn đọc vị trí và
 * trạng thái đang-phát là việc khác hẳn.
 */

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface VideoLike {
  rect: Rect;
  playing: boolean;
}

/** Cạnh nút, px. */
export const BTN_SIZE = 28;
/** Khoảng thụt vào từ mép video, px. */
export const BTN_PAD = 8;
/**
 * Video nhỏ hơn mức này bị bỏ qua.
 *
 * Trang thật đầy `<video>` tí hon dùng làm ảnh động, sprite hay nền — neo nút
 * vào chúng thì nút vừa vô dụng vừa che mất nội dung.
 */
export const MIN_VIDEO_PX = 120;

const area = (r: Rect) => r.width * r.height;

function inViewport(r: Rect, view: { width: number; height: number }): boolean {
  return r.top < view.height && r.top + r.height > 0 && r.left < view.width && r.left + r.width > 0;
}

/**
 * Chỉ số video để neo nút, `-1` nếu không có ứng viên.
 *
 * Thứ tự ưu tiên theo spec §5.1.1: **đang phát** trước, rồi **lớn nhất**. Ưu
 * tiên đang-phát chứ không phải lớn-nhất vì trang tin thường có một video quảng
 * cáo to đùng nằm im cạnh video người dùng bấm play.
 *
 * Lọc theo khung nhìn CHỈ KHI còn ứng viên: video cuộn khuất vẫn hơn là không
 * có nút nào.
 */
export function pickAnchor(videos: VideoLike[], viewport: { width: number; height: number }): number {
  const idx = videos
    .map((v, i) => i)
    .filter((i) => {
      const r = videos[i].rect;
      return r.width >= MIN_VIDEO_PX && r.height >= MIN_VIDEO_PX;
    });
  if (!idx.length) return -1;

  const visible = idx.filter((i) => inViewport(videos[i].rect, viewport));
  const pool = visible.length ? visible : idx;

  const playing = pool.filter((i) => videos[i].playing);
  const from = playing.length ? playing : pool;

  return from.reduce((best, i) => (area(videos[i].rect) > area(videos[best].rect) ? i : best), from[0]);
}

/** Toạ độ nút: góc trên PHẢI của video, thụt vào trong để không tràn ra ngoài. */
export function buttonPos(rect: Rect, size: number, pad: number): { top: number; left: number } {
  return {
    top: rect.top + pad,
    left: rect.left + rect.width - size - pad,
  };
}
```

- [ ] **Step 4: Chạy test, phải XANH**

Run: `./apps/extension/tests/run.sh`
Expected: `anchor.test.mjs` 11 pass, các bộ khác vẫn xanh.

- [ ] **Step 5: Kiểm ngược — bỏ ưu tiên đang-phát thì test phải ĐỎ**

Tạm đổi `const from = playing.length ? playing : pool;` thành `const from = pool;`
Run: `./apps/extension/tests/run.sh`
Expected: FAIL ở "ĐANG PHÁT thắng, dù nhỏ hơn".
Rồi khôi phục và chạy lại cho xanh.

- [ ] **Step 6: Commit**

```bash
git add apps/extension/lib/anchor.ts apps/extension/tests/anchor.test.mjs apps/extension/tests/run.sh
git commit -m "$(cat <<'EOF'
feat(extension): chọn video để neo nút, tách khỏi DOM để test được

Ưu tiên video ĐANG PHÁT rồi mới tới lớn nhất — không phải ngược lại. Trang tin
thường có một video quảng cáo to đùng nằm im cạnh video người dùng vừa bấm play;
xếp theo kích thước trước là neo nút vào quảng cáo.

Bỏ qua video nhỏ hơn 120px: trang thật đầy <video> tí hon dùng làm ảnh động hay
nền, neo nút vào đó thì nút vừa vô dụng vừa che nội dung.

Lọc theo khung nhìn chỉ khi còn ứng viên — video cuộn khuất vẫn hơn không có nút.

Kiểm ngược: bỏ ưu tiên đang-phát thì đúng một test đỏ.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Nút nổi, `all_frames`, và theo dõi bằng observer

**Files:**
- Modify: `apps/extension/entrypoints/panel.content/index.ts`
- Modify: `apps/extension/entrypoints/panel.content/style.css`

**Interfaces:**
- Consumes: `pickAnchor`, `buttonPos`, `BTN_SIZE`, `BTN_PAD` từ `lib/anchor.ts`
- Produces: nút nổi; panel chỉ mở khi bấm nút (Task 4 vẽ nội dung panel)

- [ ] **Step 1: Bật `all_frames` và thoát sớm**

Trong `apps/extension/entrypoints/panel.content/index.ts`, sửa khối
`defineContentScript`:

```ts
export default defineContentScript({
  matches: ['<all_urls>'],
  // Đo thật: 2/3 site đích phục vụ stream qua iframe player riêng (ADR 0005
  // §7.1), mà content script ở khung trên cùng không thấy <video> bên trong
  // iframe. Không bật thì nút không bao giờ neo đúng chỗ trên các site đó.
  allFrames: true,
  cssInjectionMode: 'ui',

  async main(ctx) {
    // Thoát NGAY nếu khung này không có video.
    //
    // all_frames nghĩa là script chạy trong mọi iframe, kể cả quảng cáo và
    // tracker — hàng chục khung trên một trang tin. Phép kiểm này gần như miễn
    // phí và loại bỏ tuyệt đại đa số chúng. Không thoát sớm thì `all_frames`
    // biến từ tính năng thành gánh nặng.
    //
    // Video có thể nạp sau, nên vẫn nghe sự kiện một lần trước khi bỏ hẳn.
    if (!document.querySelector('video')) {
      const wake = () => {
        document.removeEventListener('loadedmetadata', wake, true);
        document.removeEventListener('play', wake, true);
        void start(ctx);
      };
      document.addEventListener('loadedmetadata', wake, true);
      document.addEventListener('play', wake, true);
      ctx.onInvalidated(() => {
        document.removeEventListener('loadedmetadata', wake, true);
        document.removeEventListener('play', wake, true);
      });
      return;
    }
    await start(ctx);
  },
});
```

Toàn bộ thân `main` cũ chuyển vào `async function start(ctx)` khai báo ngay trên
`defineContentScript`.

- [ ] **Step 2: Dựng nút nổi và neo nó**

Thêm vào `start(ctx)`, sau khi `ui` được tạo:

```ts
    const btn = document.createElement('div');
    btn.className = 'sl-fab';
    btn.textContent = '⤓';
    btn.title = 'Tải video này bằng Streamloot';
    btn.style.width = `${BTN_SIZE}px`;
    btn.style.height = `${BTN_SIZE}px`;

    let anchored: HTMLVideoElement | null = null;

    /** Đo lại và đặt nút. Gọi từ observer, không từ bộ đếm. */
    function place(): void {
      const vids = [...document.querySelectorAll('video')] as HTMLVideoElement[];
      const shaped = vids.map((v) => ({
        rect: v.getBoundingClientRect(),
        playing: !v.paused && !v.ended && v.readyState > 2,
      }));
      const i = pickAnchor(shaped, { width: window.innerWidth, height: window.innerHeight });

      if (i < 0) {
        // Không tìm thấy video nào dùng được: lùi về góc trên phải CỬA SỔ, không
        // biến mất — spec §5.1.1 yêu cầu nút vẫn phải bấm được.
        anchored = null;
        btn.style.top = `${BTN_PAD}px`;
        btn.style.left = `${window.innerWidth - BTN_SIZE - BTN_PAD}px`;
        return;
      }
      anchored = vids[i];
      const pos = buttonPos(shaped[i].rect, BTN_SIZE, BTN_PAD);
      btn.style.top = `${pos.top}px`;
      btn.style.left = `${pos.left}px`;
    }
```

- [ ] **Step 3: Gắn observer thay vì bộ đếm**

Ngay sau `place`:

```ts
    // Theo dõi bằng observer, KHÔNG bằng setInterval: đổi kích thước, cuộn,
    // vào toàn màn hình, và SPA thay hẳn phần tử video — mỗi thứ có một sự
    // kiện riêng, poll chỉ là cách né việc nghe cho đúng.
    const ro = new ResizeObserver(() => place());
    const io = new IntersectionObserver(() => place());
    const mo = new MutationObserver(() => {
      observeAll();
      place();
    });

    function observeAll(): void {
      ro.disconnect();
      io.disconnect();
      for (const v of document.querySelectorAll('video')) {
        ro.observe(v);
        io.observe(v);
      }
    }

    mo.observe(document.documentElement, { childList: true, subtree: true });
    observeAll();
    place();

    // Cuộn và đổi cỡ cửa sổ không sinh ResizeObserver trên chính phần tử video,
    // nên vẫn phải nghe hai sự kiện này. `passive` để không cản cuộn.
    const onScroll = () => place();
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    window.addEventListener('resize', onScroll, { passive: true });
    document.addEventListener('fullscreenchange', onScroll, true);

    ctx.onInvalidated(() => {
      ro.disconnect();
      io.disconnect();
      mo.disconnect();
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      document.removeEventListener('fullscreenchange', onScroll, true);
    });
```

- [ ] **Step 4: Bấm nút mới mở panel**

Thay chỗ panel tự bung (`ui.mount()` trong `surface`) bằng:

```ts
    btn.onclick = () => {
      if (!mounted) {
        mounted = true;
        ui.mount();
      } else {
        const root = ui.shadow.querySelector('.sl-panel');
        if (root instanceof HTMLElement) render(root);
      }
    };
```

và trong `surface`, bỏ lời gọi `ui.mount()` — chỉ vẽ lại khi panel **đang mở**:

```ts
    function surface(next: Capture[]) {
      captures = next;
      if (!mounted) return; // panel chỉ mở khi người dùng bấm nút
      const root = ui.shadow.querySelector('.sl-panel');
      if (root instanceof HTMLElement) render(root);
    }
```

Nút phải nằm trong shadow root cùng panel — thêm `container.append(btn)` trong
`onMount` của `createShadowRootUi`, và đổi `position` thành `'inline'` với
`anchor: 'body'` như hiện tại.

- [ ] **Step 5: Kiểu cho nút**

Thêm vào `apps/extension/entrypoints/panel.content/style.css`:

```css
/* Nút nổi: đủ rõ để thấy trên nền video bất kỳ, đủ nhỏ để không chắn nội dung. */
.sl-fab {
  position: fixed;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(17, 17, 17, .82);
  color: #fff;
  font: 600 15px/1 -apple-system, system-ui, sans-serif;
  cursor: pointer;
  user-select: none;
  /* Viền sáng để không chìm vào cảnh tối, bóng để không chìm vào cảnh sáng. */
  border: 1px solid rgba(255, 255, 255, .35);
  box-shadow: 0 2px 8px rgba(0, 0, 0, .45);
  transition: background .15s, transform .15s;
}
.sl-fab:hover { background: #f97316; transform: scale(1.08); }
```

- [ ] **Step 6: Kiểm kiểu và build**

```bash
cd apps/extension && npx tsc --noEmit && npm run build
```
Expected: không lỗi.

- [ ] **Step 7: Kiểm bằng tay**

Không có trình duyệt trong môi trường subagent — nếu không mở được Chrome thì
ghi **NOT PERFORMED** và nói rõ, đừng mô tả thứ mình không nhìn thấy.

Nếu có Chrome: Reload extension, rồi kiểm từng mục:

1. Mở một trang có video → thấy nút ⤓ ở **góc trên phải của video**, không phải góc màn hình.
2. Cuộn trang → nút bám theo video.
3. Đổi kích thước cửa sổ → nút vẫn đúng chỗ.
4. Vào toàn màn hình → nút vẫn ở góc video.
5. Mở một trang **không có video** (ví dụ trang chủ một báo) → **không** có nút nào.
6. Mở `chrome://extensions` → service worker console → xác nhận không có lỗi mới.

- [ ] **Step 8: Commit**

```bash
git add apps/extension/entrypoints/panel.content/
git commit -m "$(cat <<'EOF'
feat(extension): nút nổi neo vào video, bật all_frames (spec §5.1.1)

Panel trước đây tự bung ra giữa trang người khác. Giờ chỉ còn một nút nhỏ neo
vào góc trên phải video, bấm mới mở panel.

all_frames: true vì đo thật cho thấy 2/3 site đích phục vụ stream qua iframe
player riêng (ADR 0005 §7.1) — content script ở khung trên cùng không thấy
<video> bên trong iframe.

Kèm thoát sớm khi khung không có video: all_frames nghĩa là script chạy trong
mọi iframe quảng cáo và tracker, hàng chục khung mỗi trang. Không thoát sớm thì
all_frames biến từ tính năng thành gánh nặng.

Theo dõi bằng ResizeObserver/IntersectionObserver/MutationObserver cộng scroll,
resize, fullscreenchange — KHÔNG dùng setInterval. Poll chỉ là cách né việc nghe
cho đúng sự kiện.

Không tìm thấy video nào thì nút lùi về góc cửa sổ chứ không biến mất: spec yêu
cầu nó vẫn phải bấm được.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Panel dạng danh sách — bấm dòng là tải

**Files:**
- Modify: `apps/extension/entrypoints/panel.content/index.ts`
- Modify: `apps/extension/entrypoints/panel.content/style.css`

**Interfaces:**
- Consumes: `groupFormats`, `FormatRow` từ `lib/formats.ts`

- [ ] **Step 1: Thay ô select + nút Tải bằng danh sách dòng**

Trong `render(root)`, bỏ khối tạo `select`/`btn`/`bar`/`fill` và thay bằng:

```ts
      const list = document.createElement('div');
      list.className = 'sl-list';

      const msg = document.createElement('div');
      msg.className = 'sl-msg';

      root.append(head, sub, list, msg);

      const say = (text: string, isError = false) => {
        msg.textContent = text;
        msg.className = isError ? 'sl-msg sl-err' : 'sl-msg';
      };

      /** Một dòng bấm được. Bấm là tải luôn — không có bước xác nhận (§5.1). */
      function addRow(row: FormatRow): void {
        const el = document.createElement('div');
        el.className = row.recommended ? 'sl-row-item sl-rec' : 'sl-row-item';
        const left = document.createElement('span');
        left.className = 'sl-row-label';
        left.textContent = row.label;
        const right = document.createElement('span');
        right.className = 'sl-row-detail';
        right.textContent = row.detail;
        el.append(left, right);
        el.onclick = () => void startDownload(row.formatId);
        list.append(el);
      }

      function addGroup(title: string, rows: FormatRow[]): void {
        if (!rows.length) return;
        const h = document.createElement('div');
        h.className = 'sl-group';
        h.textContent = title;
        list.append(h);
        for (const r of rows) addRow(r);
      }
```

- [ ] **Step 2: Bàn giao rồi đóng, không theo dõi**

Thêm trong `render(root)`:

```ts
      /**
       * Gửi lệnh tải rồi ĐÓNG panel (§5.1).
       *
       * Panel là bộ chọn format, không phải trình quản lý: nó không theo dõi gì
       * sau khi bàn giao. Muốn xem tiến trình thì mở popup, hoặc nhìn vòng trên
       * icon. Để panel ở lại là chắn mất video người dùng đang xem.
       */
      async function startDownload(formatId: string): Promise<void> {
        say('Đang bắt đầu…');
        let r: { ok: boolean; error?: string };
        try {
          r = await ask<{ ok: boolean; error?: string }>(
            byUrl
              ? { type: 'startByUrl', url: location.href, formatId }
              : { type: 'startDownload', info: payload!, formatId },
          );
        } catch (err) {
          say(err instanceof Error ? err.message : String(err), true);
          return;
        }
        if (!r.ok) {
          // Lỗi thì GIỮ panel mở: đóng lại là người dùng mất cả thông báo lẫn
          // danh sách vừa chọn.
          say(r.error ?? 'Tải thất bại', true);
          return;
        }
        mounted = false;
        ui.remove();
      }
```

- [ ] **Step 3: Đổ danh sách từ kết quả format**

Thay khối `.then((r) => { ... })` đang đổ `<option>` bằng:

```ts
      void askFormats.then((r) => {
        if (!r.ok) {
          if (byUrl) {
            say(r.error ?? 'Trang này chưa tải được', true);
            return;
          }
          // Không lấy được danh sách KHÔNG chặn việc tải (§7): vẫn cho một dòng
          // để backend tự chọn chất lượng tốt nhất.
          say(r.error ?? 'Không lấy được danh sách chất lượng');
          addGroup('🎬 VIDEO', [{
            formatId: '', label: 'Chất lượng tốt nhất', detail: 'backend tự chọn', recommended: true,
          }]);
          return;
        }
        const { video, audio } = groupFormats(r.formats ?? []);
        addGroup('🎬 VIDEO', video);
        addGroup('🎵 ÂM THANH', audio);
        if (!video.length && !audio.length) {
          say('Không có chất lượng nào để chọn', true);
        } else {
          say('Bấm một dòng để tải');
        }
      });
```

Thêm `import { groupFormats } from '../../lib/formats';` và
`import type { FormatRow } from '../../lib/formats';` ở đầu file.

- [ ] **Step 4: Kiểu cho danh sách**

Thêm vào `style.css`:

```css
.sl-list { max-height: 320px; overflow-y: auto; margin: 6px 0; }
.sl-group {
  font-size: 11px; opacity: .65; margin: 8px 0 2px; letter-spacing: .02em;
}
.sl-row-item {
  display: flex; justify-content: space-between; align-items: center; gap: 10px;
  padding: 7px 8px; border-radius: 6px; cursor: pointer;
}
.sl-row-item:hover { background: rgba(249, 115, 22, .16); }
.sl-row-label { font-weight: 600; }
.sl-row-detail { font-size: 11px; opacity: .7; white-space: nowrap; }
/* Dòng yt-dlp tự chọn: đánh dấu nhẹ, không cướp sự chú ý khỏi các dòng khác. */
.sl-rec .sl-row-label::after { content: ' ★'; color: #f97316; }
```

- [ ] **Step 5: Bỏ phần theo dõi tiến trình khỏi panel**

Xoá khỏi `panel.content/index.ts`: biến `activeTask`, biến `onProgress`, và nhánh
`if (m?.type === 'progress' ...)` trong `browser.runtime.onMessage`. Panel không
còn nhận tiến trình nữa (§5.1).

- [ ] **Step 6: Kiểm kiểu, build, chạy test**

```bash
cd apps/extension && npx tsc --noEmit && npm run build && cd ..
./apps/extension/tests/run.sh
uv run python -m unittest discover -s tests -p "test_*.py"
```
Expected: sạch và xanh hết.

- [ ] **Step 7: Kiểm bằng tay**

Nếu không có Chrome thì ghi **NOT PERFORMED**, đừng mô tả thứ không nhìn thấy.

Nếu có: 1) bấm nút ⤓ → panel mở với hai nhóm 🎬/🎵; 2) bấm một dòng → panel
**đóng ngay**; 3) mở popup → thấy download vừa tạo đang chạy; 4) thử một trang
mà backend trả lỗi format → panel **ở lại** và hiện thông báo lỗi.

- [ ] **Step 8: Commit**

```bash
git add apps/extension/entrypoints/panel.content/
git commit -m "$(cat <<'EOF'
feat(extension): panel thành danh sách chọn format, bấm dòng là tải (spec §5.1)

Trước đây panel có ô select + nút Tải (hai thao tác) và ở lại theo dõi tiến
trình. Spec nói rõ panel CHỈ chọn format: bấm một dòng là tải luôn, rồi panel
đóng, và nó không theo dõi gì sau khi bàn giao — để lại là chắn mất video.

Hai nhóm 🎬 VIDEO / 🎵 ÂM THANH dựng từ groupFormats (có test), không nhóm tay
trong DOM.

Lỗi thì GIỮ panel mở: đóng lại là người dùng mất cả thông báo lẫn danh sách vừa
chọn. Không lấy được danh sách format vẫn cho một dòng "chất lượng tốt nhất" để
backend tự chọn — §7 nói rõ chuyện này không được chặn việc tải.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Dọn `streamProgress` (§8)

**Files:**
- Modify: `apps/extension/lib/api.ts`
- Modify: `apps/extension/entrypoints/background.ts`

**Interfaces:**
- Không sinh gì mới; gỡ bỏ đường streaming khỏi extension

- [ ] **Step 1: Xác nhận không còn ai dùng**

```bash
cd apps/extension && grep -rn "streamProgress\|pumpProgress\|'progress'" lib entrypoints
```
Expected: chỉ còn `pumpProgress` trong `background.ts` và `streamProgress` trong
`lib/api.ts`. Nếu panel vẫn tham chiếu `progress` thì Task 4 chưa xong — dừng lại
và báo, đừng xoá bừa.

- [ ] **Step 2: Xoá `streamProgress` khỏi `lib/api.ts`**

Xoá toàn bộ hàm `export async function streamProgress(...)` cùng khối chú thích
của nó. Nếu `TERMINAL_STATUSES` chỉ được import cho hàm này thì xoá luôn dòng
import đó.

- [ ] **Step 3: Xoá `pumpProgress` khỏi `background.ts`**

Xoá hàm `pumpProgress` và mọi lời gọi `void pumpProgress(...)` trong các nhánh
`startDownload` và `startByUrl`.

- [ ] **Step 4: Kiểm kiểu, build, test**

```bash
cd apps/extension && npx tsc --noEmit && npm run build && cd ..
./apps/extension/tests/run.sh
uv run python -m unittest discover -s tests -p "test_*.py"
```
Expected: sạch và xanh. `tsc` sẽ bắt ngay nếu còn chỗ nào tham chiếu.

- [ ] **Step 5: Xác nhận SSE của cửa sổ app KHÔNG bị đụng**

```bash
grep -rn "EventSource\|stream-token" apps/desktop/ui/src | head -5
grep -n "stream_token\|def stream_progress" apps/api/main.py | head -5
```
Expected: cửa sổ app vẫn dùng `EventSource` và backend vẫn có endpoint stream
cùng token dùng-một-lần. Spec §8 nói rõ **không bỏ** hai thứ này — chỉ extension
thôi bỏ.

- [ ] **Step 6: Commit**

```bash
git add apps/extension/lib/api.ts apps/extension/entrypoints/background.ts
git commit -m "$(cat <<'EOF'
refactor(extension): bỏ streamProgress khỏi extension (spec §8)

D4 chốt polling thay vì streaming, vì service worker MV3 bị giết sau 5 phút mỗi
request — giữ một hàm streaming trong extension là để sẵn quả mìn hẹn giờ trong
code. Sau khi panel thôi theo dõi tiến trình (§5.1) thì không còn ai gọi nó nữa.

Chỉ bỏ ở EXTENSION. Cửa sổ app macOS vẫn dùng EventSource và backend vẫn giữ
endpoint stream cùng token dùng-một-lần — spec §8 nói rõ không bỏ hai thứ đó, vì
cửa sổ app sống lâu nên không dính giới hạn 5 phút.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Tự rà lại (đã chạy khi viết plan)

**1. Phủ spec — đối chiếu TỪNG tiểu mục của §5.1 và §5.1.1.**

Lần này liệt kê chi tiết, vì đúng chỗ này bảng phủ spec của Plan 2 đã bỏ sót cả
mục và tự nhận là đã phủ hết.

| Yêu cầu | Task |
|---|---|
| §5.1 nút nhỏ neo góc trên phải video | Task 3 |
| §5.1 bấm nút mới mở panel | Task 3 bước 4 |
| §5.1 panel không tab, không tiến trình, không lịch sử | Task 4 bước 1, 5 |
| §5.1 nhóm 🎬 VIDEO / 🎵 ÂM THANH | Task 1 + Task 4 bước 3 |
| §5.1 bấm dòng là tải, không nút xác nhận | Task 4 bước 1 |
| §5.1 đóng ngay sau khi bàn giao | Task 4 bước 2 |
| §5.1.1 không vi phạm B7 | Task 2 (chỉ đọc vị trí và trạng thái phát) |
| §5.1.1 `ResizeObserver` + `IntersectionObserver` | Task 3 bước 3 |
| §5.1.1 `MutationObserver` cho SPA | Task 3 bước 3 |
| §5.1.1 đổi cỡ, cuộn, toàn màn hình | Task 3 bước 3 |
| §5.1.1 neo video lớn nhất **đang phát** | Task 2 `pickAnchor` |
| §5.1.1 không có video → góc cửa sổ, không biến mất | Task 2 + Task 3 bước 2 |
| §5.1.1 `all_frames: true` | Task 3 bước 1 |
| §5.1.1 thoát ngay nếu khung không có video | Task 3 bước 1 |
| §5.1.1 mỗi khung một nút cho video của chính nó | Task 3 (mỗi khung chạy độc lập) |
| §5.1.1 `sender.tab.id` giống nhau mọi khung — không phải làm gì | Không cần task |
| §8 bỏ `streamProgress` | Task 5 |
| §8 **không** bỏ `/formats`, token SSE, EventSource của cửa sổ app | Task 5 bước 5 kiểm lại |

Không còn tiểu mục nào của §5.1/§5.1.1/§8 thiếu task.

**2. Quét placeholder.** Không có "TBD", "tương tự Task N", hay bước nào mô tả mà
không có mã. Hai bước kiểm tay (Task 3 bước 7, Task 4 bước 7) liệt kê từng thao
tác cụ thể và nói rõ phải ghi NOT PERFORMED nếu không có trình duyệt.

**3. Nhất quán kiểu.** `FormatRow` định nghĩa ở Task 1, dùng ở Task 4 đúng tên
trường (`formatId`, `label`, `detail`, `recommended`). `Rect`/`VideoLike`/
`pickAnchor`/`buttonPos`/`BTN_SIZE`/`BTN_PAD` định nghĩa ở Task 2, dùng ở Task 3
đúng chữ ký. `groupFormats` trả `{video, audio}` — Task 4 huỷ cấu trúc đúng hai
khoá đó.

**Rủi ro đã biết:** Task 3 và Task 4 cùng sửa một file, nên phải chạy đúng thứ
tự. Task 4 bước 5 xoá phần nhận tiến trình mà Task 3 không đụng tới, nên không
giẫm chân.
