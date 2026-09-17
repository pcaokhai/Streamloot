# Plan 2 — Giao diện extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extension có bề mặt quản lý thật — popup hai tab (Tải / Lịch sử) với
pause/resume/stop, và icon mang vòng tiến trình phản ánh việc đang tải.

**Architecture:** Backend đã sở hữu toàn bộ trạng thái (Plan 1); phần này chỉ
**phản chiếu**. Service worker giữ một bộ nhớ trạng thái mỏng, poll theo nhịp
thích ứng (1s khi có người xem, 60s qua `chrome.alarms` khi không, dừng hẳn khi
hết task), và vẽ lại icon **khi dữ liệu đổi** chứ không theo bộ đếm. Mọi logic
quyết định (chọn task cho vòng, chữ badge, nhịp poll) nằm trong module thuần
`lib/tasks.ts` để chạy thử được bằng node; phần chạm `OffscreenCanvas` và DOM
giữ mỏng nhất có thể.

**Tech Stack:** WXT + TypeScript, MV3 service worker, `OffscreenCanvas`,
`chrome.alarms`, backend FastAPI đã có sẵn từ Plan 1.

**Spec:** `docs/superpowers/specs/2026-09-16-extension-download-manager-design.md`
(D3, D7, §4.2, §5.2, §5.3)

## Global Constraints

- Extension **không bao giờ là nguồn sự thật** cho trạng thái download — chỉ phản chiếu. Service worker chết lúc nào cũng không mất gì, hồi phục bằng một lần gọi `/downloads/active` (spec §4.1).
- **Không tăng nhịp poll chỉ để vòng mượt hơn** (spec §5.3). Nhịp đúng theo bảng §4.2: panel mở 1s, popup mở 1s, không mở gì mà có task 60s qua `chrome.alarms`, không có task thì **không poll**.
- Chỉ gọi `setIcon` khi **phần trăm làm tròn tới bội số 5 thay đổi** (spec §5.3). Một download tốn tối đa 20 lần vẽ.
- Vòng tiến trình bám **task khởi động gần nhất**, không lấy trung bình (spec §5.3 — trung bình làm vòng chạy ngược khi thêm task mới).
- Panel trong trang web **CHỈ chọn format**, mọi thứ quản lý nằm ở popup (D3). Không thêm tab/nút điều khiển vào panel.
- Xác thực backend bằng header `X-Streamloot-Extension-Id` (ADR 0005 §7.5). **Không** dùng `Origin` — đường đó đã bị bỏ ở Plan 1.
- Content script **không bao giờ** `fetch` thẳng backend; mọi lời gọi đi qua service worker. Popup là extension page nên `fetch` thẳng được (spec §4.2).
- `TERMINAL_STATUSES` đã có sẵn trong `apps/extension/lib/types.ts`: `new Set(['completed', 'failed', 'cancelled'])`.
- Giá trị `source` hợp lệ: `cli`, `desktop`, `extension`, `unknown`.
- **Không có tên miền site thật** trong bất kỳ file được git theo dõi nào. Kiểm trước khi commit: `git ls-files | xargs grep -lif .privacy-patterns` phải không in ra gì.
- Test extension chạy bằng `apps/extension/tests/run.sh` (esbuild gói module THẬT rồi node chạy — repo cố ý không có framework test cho extension, xem ADR 0006). Test Python chạy bằng `uv run python -m unittest discover -s tests -p "test_*.py"` và phải xanh toàn bộ (hiện 154).
- Commit message tiếng Việt, conventional-commits, kết thúc bằng dòng `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

## Cấu trúc file

| File | Trách nhiệm |
|---|---|
| `apps/extension/lib/types.ts` (sửa) | Thêm `TaskRecord`, `HistoryRow` — hợp đồng với hai bảng DB |
| `apps/extension/lib/api.ts` (sửa) | Thêm `get<T>()`, `getActiveTasks`, `getHistory`, `pauseTask`, `resumeTask`, `cancelTask` |
| `apps/extension/lib/tasks.ts` (mới) | **Thuần, chạy thử được**: chọn task cho vòng, chữ + màu badge, nhịp poll, chặn vẽ thừa |
| `apps/extension/lib/icon.ts` (mới) | Vẽ vòng tiến trình bằng `OffscreenCanvas`. Mỏng nhất có thể, mọi quyết định lấy từ `tasks.ts` |
| `packaging/make_icons.py` (mới) | Sinh 4 PNG icon nền bằng stdlib (không có PIL trong môi trường này) |
| `apps/extension/public/icon/*.png` (mới) | Asset icon 16/32/48/128 |
| `apps/extension/wxt.config.ts` (sửa) | Khai báo `icons`, thêm quyền `alarms` |
| `apps/extension/entrypoints/background.ts` (sửa) | Vòng poll thích ứng + gọi vẽ icon |
| `apps/extension/entrypoints/popup/index.html` (sửa) | Khung hai tab |
| `apps/extension/entrypoints/popup/main.ts` (sửa) | Hai tab, danh sách tải, nút điều khiển, lịch sử |
| `apps/extension/tests/tasks.test.mjs` (mới) | Test cho `lib/tasks.ts` |
| `apps/extension/tests/run.sh` (sửa) | Chạy thêm bộ test mới |
| `tests/test_api_contract.py` (mới) | Test Python: endpoint trả đúng hình dạng mà TS khai báo |

---

## Task 1: Hợp đồng dữ liệu và lời gọi API

**Files:**
- Modify: `apps/extension/lib/types.ts`
- Modify: `apps/extension/lib/api.ts`
- Test: `tests/test_api_contract.py` (tạo mới)

**Interfaces:**
- Consumes: backend Plan 1 — `GET /api/v1/downloads/active`, `GET /api/v1/history?source=`, `POST /api/v1/downloads/{id}/pause|resume|cancel`
- Produces:
  - `TaskRecord`, `HistoryRow` (types.ts)
  - `getActiveTasks(): Promise<{ tasks: TaskRecord[] }>`
  - `getHistory(source?: string): Promise<HistoryRow[]>`
  - `pauseTask(taskId: string): Promise<void>`
  - `resumeTask(taskId: string): Promise<void>`
  - `cancelTask(taskId: string): Promise<void>`

- [ ] **Step 1: Viết test hợp đồng thất bại**

Tạo `tests/test_api_contract.py`. Test này tồn tại vì hợp đồng giữa hai ngôn ngữ
là chỗ dễ lệch nhất (ADR 0006 §4.1): thêm cột bên Python mà quên bên TS thì lỗi
chỉ lộ lúc chạy.

```python
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

os.environ.setdefault("API_KEY", "test-key")

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from apps.api import main as api_main
from services.history_service import HistoryService

#: Field mà apps/extension/lib/types.ts khai báo. Đổi một bên phải đổi bên kia.
TASK_RECORD_FIELDS = {
    "task_id", "url", "title", "status", "progress", "output_path",
    "error_msg", "created_at", "updated_at", "avg_speed", "source",
}
HISTORY_ROW_FIELDS = {
    "id", "title", "url", "m3u8_url", "format_id", "status",
    "output_path", "playlist_name", "created_at", "source",
}


class TestApiContract(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.svc = HistoryService(db_path=self.tmp.name)

    def tearDown(self):
        os.unlink(self.tmp.name)

    def test_active_task_shape_matches_typescript(self):
        self.svc.create_task("t1", "https://example.test/v", source="extension")
        with patch.object(api_main, "history", self.svc):
            out = api_main.get_active_downloads()
        self.assertEqual(set(out["tasks"][0]), TASK_RECORD_FIELDS)

    def test_history_row_shape_matches_typescript(self):
        self.svc.save_record(title="T", url="https://example.test/v", m3u8_url=None,
                             format_id=None, status="SUCCESS", output_path="/tmp/a.mp4",
                             source="extension")
        with patch.object(api_main, "history", self.svc):
            rows = api_main.get_history(source="extension")
        self.assertEqual(set(rows[0]), HISTORY_ROW_FIELDS)

    def test_history_filters_to_extension_only(self):
        self.svc.save_record(title="A", url="https://example.test/a", m3u8_url=None,
                             format_id=None, status="SUCCESS", output_path=None,
                             source="extension")
        self.svc.save_record(title="B", url="https://example.test/b", m3u8_url=None,
                             format_id=None, status="SUCCESS", output_path=None,
                             source="cli")
        with patch.object(api_main, "history", self.svc):
            rows = api_main.get_history(source="extension")
        self.assertEqual([r["title"] for r in rows], ["A"])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Chạy test, xác nhận nó ĐỎ vì lý do đúng**

Run: `uv run python -m unittest tests.test_api_contract -v`

Nếu đỏ vì thiếu field: ghi lại field nào. Nếu xanh ngay: hợp đồng backend đã
đúng, giữ test làm lưới an toàn và đi tiếp Step 3. **Đừng sửa test cho vừa
code** — nếu backend trả field lạ thì đó là phát hiện, báo lại.

- [ ] **Step 3: Thêm kiểu dữ liệu**

Thêm vào cuối `apps/extension/lib/types.ts`:

```ts
/**
 * Một task trong bảng `download_tasks` — nguồn sự thật cho "đang tải gì".
 *
 * Trùng cột với backend; `tests/test_api_contract.py` giữ hai bên không lệch.
 * `progress` là phần trăm 0-100.
 */
export interface TaskRecord {
  task_id: string;
  url: string;
  title: string | null;
  status: string;
  progress: number;
  output_path: string | null;
  error_msg: string | null;
  created_at: string;
  updated_at: string | null;
  avg_speed: string | null;
  source: string;
}

/** Một dòng trong bảng `download_history` — file đã tải xong. */
export interface HistoryRow {
  id: number;
  title: string;
  url: string;
  m3u8_url: string | null;
  format_id: string | null;
  status: string;
  output_path: string | null;
  playlist_name: string | null;
  created_at: string;
  source: string;
}
```

- [ ] **Step 4: Thêm lời gọi API**

Trong `apps/extension/lib/api.ts`, thêm `get` bên cạnh `post` đã có, rồi thêm 5
hàm. Import thêm `TaskRecord, HistoryRow` vào dòng import type sẵn có.

```ts
async function get<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${await baseUrl()}${path}`, { headers: jsonHeaders() });
  } catch {
    throw new BackendError('Không kết nối được Streamloot. App đã chạy chưa?');
  }
  if (res.status === 401 || res.status === 403) {
    throw new BackendError('App từ chối extension này. ID có khớp không?', res.status);
  }
  if (!res.ok) throw new BackendError(`Backend trả ${res.status}`, res.status);
  return (await res.json()) as T;
}

/** Mọi task chưa kết thúc, bất kể nguồn nào khởi động (D2 — danh sách là toàn cục). */
export function getActiveTasks(): Promise<{ tasks: TaskRecord[] }> {
  return get<{ tasks: TaskRecord[] }>('/downloads/active');
}

/** Lịch sử. Mặc định chỉ lấy phần do extension tải (tab Lịch sử, spec §5.2). */
export function getHistory(source = 'extension'): Promise<HistoryRow[]> {
  return get<HistoryRow[]>(`/history?source=${encodeURIComponent(source)}`);
}

export async function pauseTask(taskId: string): Promise<void> {
  await post(`/downloads/${taskId}/pause`, {});
}

export async function resumeTask(taskId: string): Promise<void> {
  await post(`/downloads/${taskId}/resume`, {});
}

export async function cancelTask(taskId: string): Promise<void> {
  await post(`/downloads/${taskId}/cancel`, {});
}
```

- [ ] **Step 5: Chạy lại test và kiểm kiểu**

Run: `uv run python -m unittest tests.test_api_contract -v`
Expected: PASS (3 test)

Run: `cd apps/extension && npx tsc --noEmit`
Expected: không lỗi

- [ ] **Step 6: Chạy toàn bộ test và kiểm riêng tư**

```bash
uv run python -m unittest discover -s tests -p "test_*.py"
git ls-files | xargs grep -lif .privacy-patterns
```
Expected: OK (157 test), lệnh thứ hai không in gì.

- [ ] **Step 7: Commit**

```bash
git add apps/extension/lib/types.ts apps/extension/lib/api.ts tests/test_api_contract.py
git commit -m "$(cat <<'EOF'
feat(extension): kiểu dữ liệu và lời gọi API cho bề mặt quản lý

TaskRecord/HistoryRow trùng cột với hai bảng DB; thêm getActiveTasks,
getHistory, pauseTask, resumeTask, cancelTask.

Kèm test hợp đồng bên Python so field trả về với field TS khai báo — hợp đồng
giữa hai ngôn ngữ là chỗ dễ lệch nhất và lỗi chỉ lộ lúc chạy (ADR 0006 §4.1).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Logic quyết định thuần (`lib/tasks.ts`)

Mọi quyết định của icon và vòng poll nằm ở đây để **chạy thử được bằng node**.
Phần chạm `OffscreenCanvas`/DOM ở task sau chỉ thi hành.

**Files:**
- Create: `apps/extension/lib/tasks.ts`
- Create: `apps/extension/tests/tasks.test.mjs`
- Modify: `apps/extension/tests/run.sh`

**Interfaces:**
- Consumes: `TaskRecord`, `TERMINAL_STATUSES` từ `lib/types.ts`
- Produces:
  - `pickRingTask(tasks: TaskRecord[]): TaskRecord | undefined`
  - `quantize5(pct: number): number`
  - `badgeFor(tasks: TaskRecord[], tabCaptureCount: number): { text: string; color: string }`
  - `nextPollMs(o: { viewersOpen: boolean; hasActive: boolean }): number | null`
  - `iconKey(t: TaskRecord | undefined): string` — khoá chặn vẽ thừa
  - hằng `BADGE_BLUE = '#2563eb'`, `BADGE_GRAY = '#71717a'`

- [ ] **Step 1: Viết test thất bại**

Tạo `apps/extension/tests/tasks.test.mjs`:

```js
import { pickRingTask, quantize5, badgeFor, nextPollMs, iconKey, BADGE_BLUE, BADGE_GRAY }
  from '../.tmp-tasks.mjs';

let pass = 0, fail = 0;
const t = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
};
const mk = (id, status, progress, created) =>
  ({ task_id: id, url: 'https://example.test/v', title: id, status, progress,
     output_path: null, error_msg: null, created_at: created, updated_at: null,
     avg_speed: null, source: 'extension' });

// --- pickRingTask: bám task KHỞI ĐỘNG GẦN NHẤT (spec §5.3) ---
t('không có task thì không có vòng', pickRingTask([]), undefined);
t('một task thì bám nó',
  pickRingTask([mk('a', 'downloading', 10, '2026-09-17 10:00:00')])?.task_id, 'a');
t('nhiều task thì bám cái mới nhất, KHÔNG lấy trung bình',
  pickRingTask([
    mk('cu', 'downloading', 90, '2026-09-17 10:00:00'),
    mk('moi', 'downloading', 5, '2026-09-17 10:05:00'),
  ])?.task_id, 'moi');

// --- quantize5: chặn vẽ thừa, tối đa 20 lần vẽ mỗi download ---
t('làm tròn xuống bội số 5', quantize5(37), 35);
t('đúng bội số thì giữ nguyên', quantize5(40), 40);
t('kẹp dưới về 0', quantize5(-3), 0);
t('kẹp trên về 100', quantize5(140), 100);

// --- iconKey: đổi khoá mới vẽ lại ---
const a35 = mk('a', 'downloading', 37, '2026-09-17 10:00:00');
const a39 = mk('a', 'downloading', 39, '2026-09-17 10:00:00');
const a41 = mk('a', 'downloading', 41, '2026-09-17 10:00:00');
t('37% và 39% cùng khoá nên không vẽ lại', iconKey(a35) === iconKey(a39), true);
t('41% sang bội số khác nên phải vẽ lại', iconKey(a39) === iconKey(a41), false);
t('đổi trạng thái sang tạm dừng thì phải vẽ lại',
  iconKey(a35) === iconKey({ ...a35, status: 'paused' }), false);
t('không có task thì khoá rỗng', iconKey(undefined), 'idle');

// --- badgeFor (spec §5.3) ---
t('hơn 1 download: hiện số, nền xanh',
  badgeFor([mk('a', 'downloading', 1, '1'), mk('b', 'downloading', 2, '2')], 0),
  { text: '2', color: BADGE_BLUE });
t('đúng 1 download: badge TRỐNG vì vòng đã nói rồi',
  badgeFor([mk('a', 'downloading', 1, '1')], 3), { text: '', color: BADGE_BLUE });
t('không tải nhưng có stream bắt được: hiện số, nền xám',
  badgeFor([], 2), { text: '2', color: BADGE_GRAY });
t('không có gì: trống', badgeFor([], 0), { text: '', color: BADGE_GRAY });

// --- nextPollMs (spec §4.2) ---
t('có người xem thì 1s', nextPollMs({ viewersOpen: true, hasActive: true }), 1000);
t('không ai xem mà còn task thì 60s', nextPollMs({ viewersOpen: false, hasActive: true }), 60000);
t('hết task thì DỪNG hẳn', nextPollMs({ viewersOpen: false, hasActive: false }), null);
t('không có task thì dừng kể cả khi popup mở',
  nextPollMs({ viewersOpen: true, hasActive: false }), null);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
```

- [ ] **Step 2: Nối vào runner và chạy để thấy ĐỎ**

Sửa `apps/extension/tests/run.sh`, thêm trước dòng `rm -f`:

```bash
npx esbuild lib/tasks.ts --bundle --format=esm --outfile=.tmp-tasks.mjs --log-level=error
node tests/tasks.test.mjs
```

và thêm `.tmp-tasks.mjs` vào dòng `rm -f` cuối.

Run: `./apps/extension/tests/run.sh`
Expected: FAIL — esbuild báo không tìm thấy `lib/tasks.ts`

- [ ] **Step 3: Viết `lib/tasks.ts`**

```ts
/**
 * Mọi quyết định của icon và vòng poll — tách khỏi phần chạm trình duyệt.
 *
 * Để ở đây vì chạy thử được bằng node (`tests/run.sh`). Service worker không
 * có DOM và `OffscreenCanvas` không có trong node, nên nếu trộn quyết định vào
 * phần vẽ thì không test được gì cả — mà đây đúng là loại logic dễ sai âm thầm.
 */
import type { TaskRecord } from './types';
import { TERMINAL_STATUSES } from './types';

export const BADGE_BLUE = '#2563eb';
export const BADGE_GRAY = '#71717a';

/** Bước làm tròn phần trăm. 5 => tối đa 20 lần vẽ mỗi download (spec §5.3). */
const STEP = 5;

/**
 * Task mà vòng tiến trình bám: cái KHỞI ĐỘNG GẦN NHẤT.
 *
 * Cố ý KHÔNG lấy trung bình mọi task: thêm một download mới sẽ kéo tổng phần
 * trăm tụt xuống, vòng chạy ngược, trông như hỏng. Con số của một task thì luôn
 * tăng (spec §5.3).
 */
export function pickRingTask(tasks: TaskRecord[]): TaskRecord | undefined {
  const live = tasks.filter((t) => !TERMINAL_STATUSES.has(t.status));
  if (!live.length) return undefined;
  return live.reduce((a, b) => (b.created_at > a.created_at ? b : a));
}

/** Làm tròn xuống bội số 5, kẹp trong [0, 100]. */
export function quantize5(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  const clamped = Math.min(100, Math.max(0, pct));
  return Math.floor(clamped / STEP) * STEP;
}

/**
 * Khoá quyết định "có cần vẽ lại icon không".
 *
 * Chỉ vẽ khi khoá đổi. Poll 1s cho video 10 phút là 600 lần poll nhưng tối đa
 * 20 lần vẽ (spec §5.3).
 */
export function iconKey(t: TaskRecord | undefined): string {
  if (!t) return 'idle';
  return `${t.status}:${quantize5(t.progress)}`;
}

/**
 * Badge BỔ SUNG cho vòng chứ không lặp lại nó (spec §5.3).
 *
 * Đúng một download thì badge để trống — vòng đã nói rồi. Số stream là theo
 * tab, số download là toàn cục (D2).
 */
export function badgeFor(
  tasks: TaskRecord[],
  tabCaptureCount: number,
): { text: string; color: string } {
  const live = tasks.filter((t) => !TERMINAL_STATUSES.has(t.status));
  if (live.length > 1) return { text: String(live.length), color: BADGE_BLUE };
  if (live.length === 1) return { text: '', color: BADGE_BLUE };
  if (tabCaptureCount > 0) return { text: String(tabCaptureCount), color: BADGE_GRAY };
  return { text: '', color: BADGE_GRAY };
}

/**
 * Nhịp poll kế tiếp, `null` nghĩa là DỪNG hẳn (spec §4.2).
 *
 * Không có task thì không poll, kể cả khi popup đang mở: gọi API extension theo
 * chu kỳ chính là cách giữ service worker sống, và đó là thứ D4 loại bỏ.
 */
export function nextPollMs(o: { viewersOpen: boolean; hasActive: boolean }): number | null {
  if (!o.hasActive) return null;
  return o.viewersOpen ? 1000 : 60000;
}
```

- [ ] **Step 4: Chạy test, phải XANH**

Run: `./apps/extension/tests/run.sh`
Expected: 9 pass (pick.test) + 18 pass (tasks.test), 0 fail

- [ ] **Step 5: Kiểm ngược — bỏ chặn vẽ thừa thì test phải ĐỎ**

Tạm đổi `iconKey` thành `return t ? `${t.status}:${t.progress}` : 'idle';`
Run: `./apps/extension/tests/run.sh`
Expected: FAIL ở "37% và 39% cùng khoá nên không vẽ lại"
Rồi khôi phục lại bản đúng và chạy lại cho xanh.

- [ ] **Step 6: Commit**

```bash
git add apps/extension/lib/tasks.ts apps/extension/tests/tasks.test.mjs apps/extension/tests/run.sh
git commit -m "$(cat <<'EOF'
feat(extension): tách logic quyết định của icon và nhịp poll ra module thuần

pickRingTask, quantize5, iconKey, badgeFor, nextPollMs — mọi quyết định nằm ở
đây để chạy thử được bằng node. Service worker không có DOM và node không có
OffscreenCanvas, nên trộn quyết định vào phần vẽ là mất luôn khả năng test.

18 kịch bản, gồm: vòng bám task mới nhất chứ không lấy trung bình (trung bình
làm vòng chạy ngược khi thêm task), badge để trống khi đúng một download, và
poll DỪNG hẳn khi hết task kể cả lúc popup đang mở.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Asset icon nền

Extension hiện chưa có icon — Chrome đang hiện mảnh ghép mặc định (spec §5.3).
Môi trường này **không có PIL**, nên sinh PNG bằng stdlib.

**Files:**
- Create: `packaging/make_icons.py`
- Create: `apps/extension/public/icon/16.png`, `32.png`, `48.png`, `128.png`
- Modify: `apps/extension/wxt.config.ts`
- Test: `tests/test_make_icons.py` (tạo mới)

**Interfaces:**
- Produces: `packaging/make_icons.py` với `write_png(path, size)` và `render(size) -> list[list[tuple[int,int,int,int]]]`

- [ ] **Step 1: Viết test thất bại**

Tạo `tests/test_make_icons.py`:

```python
import struct
import sys
import tempfile
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "packaging"))

from make_icons import render, write_png

PNG_SIG = b"\x89PNG\r\n\x1a\n"


class TestMakeIcons(unittest.TestCase):
    def test_render_gives_a_square_rgba_grid(self):
        px = render(16)
        self.assertEqual(len(px), 16)
        self.assertEqual(len(px[0]), 16)
        self.assertEqual(len(px[0][0]), 4)

    def test_icon_has_visible_pixels(self):
        """Icon toàn trong suốt là icon không tồn tại — Chrome hiện mảnh ghép."""
        px = render(32)
        opaque = sum(1 for row in px for p in row if p[3] > 0)
        self.assertGreater(opaque, 32 * 32 * 0.15)

    def test_writes_a_valid_png_with_right_dimensions(self):
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            path = Path(f.name)
        write_png(path, 48)
        raw = path.read_bytes()
        self.assertTrue(raw.startswith(PNG_SIG))
        # IHDR: 8 byte chữ ký + 4 byte độ dài + 4 byte 'IHDR' + rộng + cao
        width, height = struct.unpack(">II", raw[16:24])
        self.assertEqual((width, height), (48, 48))
        path.unlink()


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Chạy test, xác nhận thất bại**

Run: `uv run python -m unittest tests.test_make_icons -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'make_icons'`

- [ ] **Step 3: Viết `packaging/make_icons.py`**

```python
"""
Sinh icon PNG cho extension bằng THƯ VIỆN CHUẨN.

Môi trường này không có PIL, và thêm một phụ thuộc chỉ để vẽ bốn hình vuông là
không đáng. PNG không nén (mức deflate 0 vẫn là PNG hợp lệ) đủ dùng cho ảnh
128x128.

Hình: nền bo tròn + mũi tên chỉ xuống một vạch ngang, đúng nghĩa "tải xuống"
và khớp ký hiệu ⤓ mà menu bar macOS đang dùng.
"""
import struct
import zlib
from pathlib import Path
from typing import List, Tuple

Pixel = Tuple[int, int, int, int]

#: Xanh dương trùng BADGE_BLUE bên lib/tasks.ts.
BLUE = (37, 99, 235, 255)
WHITE = (255, 255, 255, 255)
CLEAR = (0, 0, 0, 0)


def render(size: int) -> List[List[Pixel]]:
    """Lưới RGBA của icon ở cỡ `size`."""
    px = [[CLEAR for _ in range(size)] for _ in range(size)]
    radius = size * 0.22
    for y in range(size):
        for x in range(size):
            if _inside_rounded_square(x, y, size, radius):
                px[y][x] = BLUE
    _draw_arrow(px, size)
    return px


def _inside_rounded_square(x: int, y: int, size: int, radius: float) -> bool:
    cx = min(max(x + 0.5, radius), size - radius)
    cy = min(max(y + 0.5, radius), size - radius)
    return (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= radius ** 2


def _draw_arrow(px: List[List[Pixel]], size: int) -> None:
    """Mũi tên trắng chỉ xuống, đứng trên một vạch ngang."""
    mid = size // 2
    stem_w = max(1, size // 10)
    top = int(size * 0.24)
    head_y = int(size * 0.56)
    for y in range(top, head_y):
        for x in range(mid - stem_w // 2, mid - stem_w // 2 + stem_w):
            _put(px, x, y, size)
    half = int(size * 0.20)
    for i in range(half + 1):
        y = head_y + i
        for x in range(mid - half + i, mid + half - i + 1):
            _put(px, x, y, size)
    bar_y = int(size * 0.82)
    for y in range(bar_y, bar_y + max(1, size // 12)):
        for x in range(int(size * 0.26), int(size * 0.74)):
            _put(px, x, y, size)


def _put(px: List[List[Pixel]], x: int, y: int, size: int) -> None:
    if 0 <= x < size and 0 <= y < size:
        px[y][x] = WHITE


def write_png(path: Path, size: int) -> None:
    """Ghi icon ra PNG. Không phụ thuộc gói ngoài."""
    px = render(size)
    raw = b"".join(
        b"\x00" + b"".join(struct.pack("4B", *p) for p in row) for row in px
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + _chunk(b"IDAT", zlib.compress(raw, 9))
        + _chunk(b"IEND", b"")
    )


def _chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


if __name__ == "__main__":
    out = Path(__file__).resolve().parent.parent / "apps/extension/public/icon"
    for s in (16, 32, 48, 128):
        write_png(out / f"{s}.png", s)
        print(f"viết {out / f'{s}.png'}")
```

- [ ] **Step 4: Chạy test và sinh asset**

```bash
uv run python -m unittest tests.test_make_icons -v
uv run python packaging/make_icons.py
```
Expected: 3 test PASS; in ra 4 đường dẫn.

- [ ] **Step 5: Khai báo icon và quyền `alarms` trong manifest**

Trong `apps/extension/wxt.config.ts`, sửa `permissions` và thêm `icons`:

```ts
    // `alarms`: nhịp 60s khi không có bề mặt nào mở (spec §4.2). Không dùng
    // setInterval trong service worker — MV3 thu hồi worker và bộ đếm chết theo.
    permissions: ['webRequest', 'storage', 'tabs', 'alarms'],

    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
```

- [ ] **Step 6: Build và xác minh manifest**

```bash
cd apps/extension && npm run build
python3 -c "import json;m=json.load(open('.output/chrome-mv3/manifest.json'));print('icons:',m.get('icons'));print('alarms:', 'alarms' in m.get('permissions',[]));print('key giữ nguyên:', 'key' in m)"
ls -la .output/chrome-mv3/icon/
```
Expected: `icons` có 4 cỡ, `alarms: True`, `key giữ nguyên: True`, thư mục icon có 4 file.

- [ ] **Step 7: Commit**

```bash
git add packaging/make_icons.py apps/extension/public/icon apps/extension/wxt.config.ts tests/test_make_icons.py
git commit -m "$(cat <<'EOF'
feat(extension): icon nền và quyền alarms

Extension chưa có icon nên Chrome hiện mảnh ghép mặc định. Sinh 4 cỡ PNG bằng
thư viện chuẩn — môi trường không có PIL, và thêm phụ thuộc chỉ để vẽ bốn hình
vuông là không đáng.

Thêm quyền `alarms` cho nhịp 60s khi không có bề mặt nào mở. Không dùng
setInterval trong service worker: MV3 thu hồi worker và bộ đếm chết theo.

Test kiểm PNG thật sự hợp lệ (chữ ký + IHDR đúng kích thước) và icon có pixel
nhìn thấy được — icon toàn trong suốt là icon không tồn tại.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Vẽ vòng tiến trình quanh icon

**Files:**
- Create: `apps/extension/lib/icon.ts`
- Modify: `apps/extension/entrypoints/background.ts`

**Interfaces:**
- Consumes: `pickRingTask`, `quantize5`, `iconKey`, `badgeFor` từ `lib/tasks.ts`; `TaskRecord` từ `lib/types.ts`
- Produces: `applyIconState(tasks: TaskRecord[], tabCaptureCount: number, tabId?: number): Promise<void>`

- [ ] **Step 1: Viết `lib/icon.ts`**

Không có test tự động cho phần này: `OffscreenCanvas` không tồn tại trong node
và repo cố ý không có trình duyệt headless (ADR 0006). Mọi thứ **quyết định
được** đã nằm ở `lib/tasks.ts` và đã có test; file này chỉ thi hành. Kiểm bằng
tay ở Step 4.

```ts
/**
 * Vẽ vòng tiến trình quanh icon extension.
 *
 * Service worker MV3 không có DOM nhưng CÓ `OffscreenCanvas`, nên vẽ được icon
 * rồi đẩy thẳng qua `action.setIcon({imageData})` — không cần offscreen
 * document, không cần thư viện (spec §5.3).
 *
 * File này cố ý không chứa quyết định nào: chọn task nào, vẽ bao nhiêu phần
 * trăm, badge ra sao đều lấy từ `lib/tasks.ts` (có test). Ở đây chỉ có nét vẽ.
 */
import { badgeFor, iconKey, pickRingTask, quantize5 } from './tasks';
import type { TaskRecord } from './types';

const SIZE = 32;
const RING_W = 4;
const RING_BLUE = '#2563eb';
const RING_GRAY = '#a1a1aa';

/** Khoá lần vẽ gần nhất. Trùng khoá thì bỏ qua — đây là chốt chặn vẽ thừa. */
let lastKey: string | null = null;

async function baseBitmap(): Promise<ImageBitmap> {
  const res = await fetch(browser.runtime.getURL('icon/128.png'));
  return createImageBitmap(await res.blob());
}

export async function applyIconState(
  tasks: TaskRecord[],
  tabCaptureCount: number,
  tabId?: number,
): Promise<void> {
  const task = pickRingTask(tasks);
  const key = iconKey(task);

  const badge = badgeFor(tasks, tabCaptureCount);
  await browser.action.setBadgeText({ text: badge.text, ...(tabId ? { tabId } : {}) }).catch(() => {});
  await browser.action.setBadgeBackgroundColor({ color: badge.color }).catch(() => {});

  if (key === lastKey) return; // không đổi thì không vẽ
  lastKey = key;

  try {
    const canvas = new OffscreenCanvas(SIZE, SIZE);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const bmp = await baseBitmap();

    if (!task) {
      // Rảnh: icon trần, vòng biến mất hẳn (spec §5.3).
      ctx.drawImage(bmp, 0, 0, SIZE, SIZE);
    } else {
      const inset = RING_W + 1;
      ctx.drawImage(bmp, inset, inset, SIZE - inset * 2, SIZE - inset * 2);
      const pct = quantize5(task.progress);
      ctx.lineWidth = RING_W;
      ctx.strokeStyle = task.status === 'paused' ? RING_GRAY : RING_BLUE;
      ctx.lineCap = 'round';
      ctx.beginPath();
      // Bắt đầu từ 12 giờ (-90°) cho giống mọi vòng tiến trình khác.
      ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2 - RING_W / 2,
              -Math.PI / 2, -Math.PI / 2 + (pct / 100) * 2 * Math.PI);
      ctx.stroke();
    }

    await browser.action.setIcon({ imageData: ctx.getImageData(0, 0, SIZE, SIZE) });
  } catch (err) {
    // Vẽ icon hỏng thì icon xấu, không phải tải hỏng. Ghi lại rồi đi tiếp.
    console.warn('[Streamloot] vẽ icon hỏng:', err);
    lastKey = null; // cho thử lại lần sau
  }
}
```

- [ ] **Step 2: Kiểm kiểu**

Run: `cd apps/extension && npx tsc --noEmit`
Expected: không lỗi. Nếu báo thiếu `OffscreenCanvas`/`ImageBitmap`, thêm
`"lib": ["ES2022", "DOM", "WebWorker"]` vào `compilerOptions` trong
`apps/extension/tsconfig.json`, rồi chạy lại.

- [ ] **Step 3: Gọi từ background sau mỗi lần bắt được stream**

Trong `apps/extension/entrypoints/background.ts`, thêm import và gọi trong
`addCapture` ngay sau chỗ đặt badge hiện tại — thay hai dòng `setBadgeText` /
`setBadgeBackgroundColor` đang có bằng:

```ts
import { applyIconState } from '../lib/icon';
```

```ts
  // Badge và vòng do applyIconState quyết (lib/tasks.ts), không đặt tay ở đây
  // nữa — hai chỗ cùng đặt badge là hai chỗ sẽ lệch nhau.
  await applyIconState(lastKnownTasks, next.length, tabId);
```

và khai báo bộ nhớ trạng thái ở đầu file, cạnh `keyFor`:

```ts
/**
 * Ảnh chụp task gần nhất từ backend.
 *
 * Extension không phải nguồn sự thật (spec §4.1) — biến này chỉ để vẽ icon mà
 * không phải gọi mạng. Service worker chết thì nó về rỗng, và lần poll kế tiếp
 * dựng lại đầy đủ.
 */
let lastKnownTasks: TaskRecord[] = [];

export function setLastKnownTasks(tasks: TaskRecord[]): void {
  lastKnownTasks = tasks;
}
```

Thêm `TaskRecord` vào dòng import type sẵn có từ `../lib/types`.

- [ ] **Step 4: Build rồi kiểm bằng tay**

```bash
cd apps/extension && npm run build
```

Rồi trong Chrome: `chrome://extensions` → Reload Streamloot → mở một trang có
video → xác nhận **icon Streamloot hiện ra thay cho mảnh ghép**, và badge hiện
số stream bắt được với nền xám.

Ghi lại kết quả quan sát vào báo cáo. Vòng tiến trình chưa chạy ở bước này vì
chưa có vòng poll — đó là Task 5.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/lib/icon.ts apps/extension/entrypoints/background.ts
git commit -m "$(cat <<'EOF'
feat(extension): vẽ vòng tiến trình quanh icon bằng OffscreenCanvas

Service worker MV3 không có DOM nhưng có OffscreenCanvas, nên vẽ được icon rồi
đẩy thẳng qua action.setIcon — không cần offscreen document, không thư viện.

File này cố ý không chứa quyết định nào: chọn task nào, bao nhiêu phần trăm,
badge ra sao đều lấy từ lib/tasks.ts vốn đã có test. Ở đây chỉ có nét vẽ, vì
OffscreenCanvas không tồn tại trong node nên phần này không test tự động được.

Chốt chặn vẽ thừa nằm ở khoá iconKey: trùng khoá thì không vẽ.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Vòng poll thích ứng

**Files:**
- Modify: `apps/extension/entrypoints/background.ts`

**Interfaces:**
- Consumes: `nextPollMs` từ `lib/tasks.ts`; `getActiveTasks` từ `lib/api.ts`; `applyIconState` từ `lib/icon.ts`; `setLastKnownTasks` từ Task 4
- Produces: xử lý tin nhắn `{ type: 'viewerOpen' }` / `{ type: 'viewerClosed' }` / `{ type: 'getTasks' }`

- [ ] **Step 1: Thêm vòng poll vào `background.ts`**

Đặt trong `defineBackground()`, sau các listener hiện có:

```ts
const ALARM = 'streamloot-poll';
/** Số bề mặt đang mở (popup, panel). Quyết định nhịp 1s hay 60s (spec §4.2). */
let viewers = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

async function refreshTasks(): Promise<TaskRecord[]> {
  try {
    const { tasks } = await api.getActiveTasks();
    setLastKnownTasks(tasks);
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const caps = tab?.id !== undefined ? await getCaptures(tab.id) : [];
    await applyIconState(tasks, caps.length, tab?.id);
    return tasks;
  } catch {
    // App tắt giữa chừng là chuyện bình thường. Giữ nhịp, lần sau gọi lại.
    return [];
  }
}

/**
 * Đặt lịch lần poll kế tiếp.
 *
 * Hai cơ chế, cố ý: `setTimeout` cho nhịp 1s khi có người xem (chính xác, và
 * lúc đó đã có tin nhắn giữ service worker sống), `chrome.alarms` cho nhịp 60s
 * (setTimeout dài không sống nổi qua lần MV3 thu hồi worker). Hết task thì
 * DỪNG cả hai — poll rỗng chính là cách giữ worker sống mà D4 loại bỏ.
 */
function schedule(tasks: TaskRecord[]): void {
  if (timer) { clearTimeout(timer); timer = null; }
  const ms = nextPollMs({ viewersOpen: viewers > 0, hasActive: tasks.length > 0 });
  if (ms === null) {
    void browser.alarms.clear(ALARM);
    return;
  }
  if (ms <= 5000) {
    void browser.alarms.clear(ALARM);
    timer = setTimeout(() => void tick(), ms);
  } else {
    void browser.alarms.create(ALARM, { periodInMinutes: ms / 60000 });
  }
}

async function tick(): Promise<void> {
  schedule(await refreshTasks());
}

browser.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) void tick();
});

// Task có thể đã chạy từ trước lần khởi động này (do app hoặc CLI bắt đầu, hoặc
// service worker vừa bị thu hồi) — hỏi backend một phát để dựng lại.
void tick();
```

- [ ] **Step 2: Thêm ba tin nhắn vào listener `onMessage` sẵn có**

```ts
  if (m?.type === 'viewerOpen') {
    viewers += 1;
    void tick(); // đổi sang nhịp 1s ngay, đừng đợi hết chu kỳ 60s
    return Promise.resolve({ ok: true });
  }
  if (m?.type === 'viewerClosed') {
    viewers = Math.max(0, viewers - 1);
    return Promise.resolve({ ok: true });
  }
  if (m?.type === 'getTasks') {
    return refreshTasks().then((tasks) => ({ ok: true, tasks }));
  }
```

- [ ] **Step 3: Kiểm kiểu và build**

```bash
cd apps/extension && npx tsc --noEmit && npm run build
```
Expected: không lỗi.

- [ ] **Step 4: Kiểm bằng tay — đây là phần duy nhất chứng minh được nhịp poll**

1. Mở `chrome://extensions` → Reload → bấm "service worker" để mở console.
2. Bắt đầu một download từ panel.
3. Xác nhận **vòng tiến trình chạy quanh icon** và tiến dần.
4. Đóng popup, đợi ~2 phút, xác nhận vòng **vẫn nhích** (nhịp 60s).
5. Đợi download xong, xác nhận **vòng biến mất**, về icon trần.
6. Trong console chạy `await chrome.alarms.getAll()` — sau khi hết task phải trả
   về mảng rỗng. Còn alarm nghĩa là poll không dừng, tức đang đốt tài nguyên và
   phạm D4.

Ghi lại từng bước quan sát được vào báo cáo. Bước 6 là bước quan trọng nhất.

- [ ] **Step 5: Commit**

```bash
git add apps/extension/entrypoints/background.ts
git commit -m "$(cat <<'EOF'
feat(extension): vòng poll thích ứng, dừng hẳn khi không còn task

1s khi có bề mặt đang mở, 60s qua chrome.alarms khi không, và DỪNG hẳn khi hết
task (spec §4.2). Poll rỗng chính là cách giữ service worker sống mãi — đúng
thứ D4 loại bỏ.

Hai cơ chế đặt lịch là cố ý: setTimeout cho nhịp ngắn (chính xác, và lúc đó đã
có tin nhắn giữ worker sống), chrome.alarms cho nhịp dài (setTimeout dài không
sống nổi qua một lần MV3 thu hồi worker).

Gọi một lần lúc khởi động để dựng lại trạng thái: task có thể đã chạy từ trước
do app hoặc CLI bắt đầu.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Popup hai tab với nút điều khiển

**Files:**
- Modify: `apps/extension/entrypoints/popup/index.html`
- Modify: `apps/extension/entrypoints/popup/main.ts`

**Interfaces:**
- Consumes: `getActiveTasks`, `getHistory`, `pauseTask`, `resumeTask`, `cancelTask`, `health` từ `lib/api.ts`; tin nhắn `viewerOpen`/`viewerClosed` từ Task 5

- [ ] **Step 1: Khung HTML hai tab**

Thay phần `<body>` của `apps/extension/entrypoints/popup/index.html` bằng:

```html
  <body>
    <div class="head">
      <h1>Streamloot</h1>
      <div class="tabs">
        <button id="tab-dl" class="tab on">Tải</button>
        <button id="tab-hist" class="tab">Lịch sử</button>
      </div>
    </div>
    <div class="row" id="status"><span class="dot wait"></span>Đang kiểm tra…</div>
    <div id="hint" class="hint"></div>

    <section id="pane-dl">
      <div id="tasks"></div>
      <div id="caps"></div>
    </section>

    <section id="pane-hist" hidden>
      <div id="history"></div>
    </section>

    <button id="opts">Cài đặt</button>
    <script type="module" src="./main.ts"></script>
  </body>
```

và thêm vào `<style>` sẵn có:

```css
      .head { display: flex; align-items: center; justify-content: space-between; }
      .tabs { display: flex; gap: 4px; }
      .tab { font: inherit; padding: 3px 9px; margin: 0; border-radius: 6px;
             border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
             background: transparent; cursor: pointer; }
      .tab.on { background: #2563eb; color: #fff; border-color: #2563eb; }
      .task { margin: 10px 0; }
      .task .t { display: flex; justify-content: space-between; gap: 8px; }
      .task .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .bar { height: 5px; border-radius: 3px; margin: 4px 0;
             background: color-mix(in srgb, currentColor 14%, transparent); }
      .bar i { display: block; height: 100%; border-radius: 3px; background: #2563eb; }
      .bar.paused i { background: #a1a1aa; }
      .ctl { display: flex; gap: 6px; }
      .ctl button { font: inherit; padding: 2px 9px; margin: 0; cursor: pointer; }
      .sep { font-size: 11px; opacity: .6; margin: 12px 0 4px; }
      .empty { font-size: 12px; opacity: .6; padding: 6px 0; }
```

- [ ] **Step 2: Viết lại `popup/main.ts`**

```ts
import * as api from '../../lib/api';
import { loadSettings } from '../../lib/settings';
import type { Capture, HistoryRow, TaskRecord } from '../../lib/types';
import { TERMINAL_STATUSES } from '../../lib/types';

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

const el = (id: string) => document.getElementById(id)!;
const nameOf = (t: TaskRecord) => t.title || t.url;

/**
 * Popup gọi thẳng backend, không qua service worker.
 *
 * Popup là extension page nên `fetch` mang đúng quyền host (spec §4.2); đi vòng
 * qua service worker chỉ thêm một chặng có thể chết giữa chừng.
 */
async function renderTasks(): Promise<void> {
  const box = el('tasks');
  let tasks: TaskRecord[];
  try {
    tasks = (await api.getActiveTasks()).tasks;
  } catch {
    box.innerHTML = '<div class="empty">Không đọc được danh sách tải.</div>';
    return;
  }
  const live = tasks.filter((t) => !TERMINAL_STATUSES.has(t.status));
  if (!live.length) {
    box.innerHTML = '<div class="empty">Không có gì đang tải.</div>';
    return;
  }
  box.innerHTML = live.map((t) => {
    const paused = t.status === 'paused';
    const pct = Math.round(t.progress);
    const right = paused ? 'Tạm dừng' : `${pct}%`;
    return `<div class="task" data-id="${esc(t.task_id)}">
      <div class="t"><span class="name">${esc(nameOf(t))}</span><span>${right}</span></div>
      <div class="bar${paused ? ' paused' : ''}"><i style="width:${pct}%"></i></div>
      <div class="t">
        <span class="hint">${esc(t.avg_speed ?? '')}</span>
        <span class="ctl">
          <button data-act="${paused ? 'resume' : 'pause'}">${paused ? '▶' : '⏸'}</button>
          <button data-act="cancel">✕</button>
        </span>
      </div>
    </div>`;
  }).join('');
}

async function renderHistory(): Promise<void> {
  const box = el('history');
  let rows: HistoryRow[];
  try {
    rows = await api.getHistory('extension');
  } catch {
    box.innerHTML = '<div class="empty">Không đọc được lịch sử.</div>';
    return;
  }
  if (!rows.length) {
    box.innerHTML = '<div class="empty">Chưa tải file nào qua extension.</div>';
    return;
  }
  box.innerHTML = '<table>' + rows.map((r) => {
    const ok = r.status === 'SUCCESS';
    return `<tr><td>${esc(r.title)}</td><td style="text-align:right">${ok ? '✓' : '✗'}</td></tr>`;
  }).join('') + '</table>';
}

async function renderCaptures(): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) return;
  const list = (await browser.runtime.sendMessage({ type: 'getCaptures', tabId: tab.id })) as Capture[];
  el('caps').innerHTML = list?.length
    ? `<div class="sep">Bắt được trên tab này: ${list.length}</div>`
      + '<table>' + list.map((c) => `<tr><td class="h">${esc(c.host)}</td></tr>`).join('') + '</table>'
    : '<div class="sep">Chưa bắt được stream nào trên tab này.</div>';
}

async function renderStatus(): Promise<void> {
  const { port } = await loadSettings();
  const t0 = performance.now();
  const state = await api.health();
  const ms = Math.round(performance.now() - t0);
  if (state === 'ok') {
    el('status').innerHTML = '<span class="dot on"></span>Đã kết nối';
    el('hint').textContent = `Backend 127.0.0.1:${port} · ${ms}ms`;
  } else if (state === 'unreachable') {
    el('status').innerHTML = '<span class="dot off"></span>App chưa chạy';
    el('hint').textContent = `Không gọi được 127.0.0.1:${port}. Mở app Streamloot — kiểm tra icon ⤓ trên menu bar.`;
  } else {
    el('status').innerHTML = '<span class="dot off"></span>App từ chối extension này';
    el('hint').textContent =
      'App đang chạy nhưng không nhận diện được extension. Thường là do bản build thiếu `key` trong manifest nên ID không khớp. Build lại rồi Reload extension.';
  }
}

function showTab(which: 'dl' | 'hist'): void {
  el('tab-dl').classList.toggle('on', which === 'dl');
  el('tab-hist').classList.toggle('on', which === 'hist');
  (el('pane-dl') as HTMLElement).hidden = which !== 'dl';
  (el('pane-hist') as HTMLElement).hidden = which === 'dl';
  if (which === 'hist') void renderHistory();
}

el('tab-dl').addEventListener('click', () => showTab('dl'));
el('tab-hist').addEventListener('click', () => showTab('hist'));
el('opts').addEventListener('click', () => void browser.runtime.openOptionsPage());

// Uỷ quyền sự kiện: danh sách vẽ lại mỗi giây nên gắn listener lên từng nút sẽ
// mất ngay ở lần vẽ kế tiếp.
el('tasks').addEventListener('click', (ev) => {
  const btn = (ev.target as HTMLElement).closest('button');
  const id = (ev.target as HTMLElement).closest('.task')?.getAttribute('data-id');
  if (!btn || !id) return;
  const act = btn.getAttribute('data-act');
  const call = act === 'pause' ? api.pauseTask : act === 'resume' ? api.resumeTask : api.cancelTask;
  btn.disabled = true;
  void call(id)
    .catch((err) => { el('hint').textContent = String(err?.message ?? err); })
    .finally(() => void renderTasks());
});

// Báo service worker là có người đang xem => nó chuyển sang nhịp 1s (spec §4.2).
void browser.runtime.sendMessage({ type: 'viewerOpen' }).catch(() => {});
window.addEventListener('pagehide', () => {
  void browser.runtime.sendMessage({ type: 'viewerClosed' }).catch(() => {});
});

const POLL_MS = 1000;
const timer = setInterval(() => void renderTasks(), POLL_MS);
window.addEventListener('pagehide', () => clearInterval(timer));

void (async () => {
  await renderStatus();
  await renderTasks();
  await renderCaptures();
})().catch((err) => {
  el('status').innerHTML = '<span class="dot off"></span>Popup lỗi';
  el('hint').textContent = String(err?.message ?? err);
  console.error('Streamloot popup:', err);
});
```

- [ ] **Step 3: Kiểm kiểu và build**

```bash
cd apps/extension && npx tsc --noEmit && npm run build
```
Expected: không lỗi.

- [ ] **Step 4: Kiểm bằng tay**

Reload extension, rồi lần lượt:

1. Mở popup khi **không có gì tải** → tab Tải hiện "Không có gì đang tải."
2. Bắt đầu một download → popup hiện tên, thanh tiến trình **nhích mỗi giây**, tốc độ.
3. Bấm **⏸** → thanh chuyển xám, chữ đổi thành "Tạm dừng", nút thành **▶**.
   Kiểm thật: `ls -la` file đang tải, kích thước **phải ngừng tăng**.
4. Bấm **▶** → tải tiếp từ đúng chỗ.
5. Bấm **✕** → task biến mất khỏi danh sách.
6. Chuyển sang tab **Lịch sử** → thấy file vừa tải, dấu ✓.
7. Đóng popup, mở lại → trạng thái vẫn đúng (dựng lại từ backend, không nhớ gì ở client).

Bước 3 là bước quan trọng nhất: "menu báo tạm dừng mà file vẫn phình" đúng là
lỗi đã gặp ở vòng trước (docs/impl/2026-09-17-manual-test-bug-log.md §12).

- [ ] **Step 5: Chạy toàn bộ test và kiểm riêng tư**

```bash
uv run python -m unittest discover -s tests -p "test_*.py"
./apps/extension/tests/run.sh
git ls-files | xargs grep -lif .privacy-patterns
```
Expected: Python OK, extension 27 pass, lệnh cuối không in gì.

- [ ] **Step 6: Commit**

```bash
git add apps/extension/entrypoints/popup/
git commit -m "$(cat <<'EOF'
feat(extension): popup hai tab với pause/resume/stop

Tab Tải: download đang chạy (toàn cục, D2) + nút điều khiển + stream bắt được
trên tab hiện tại. Tab Lịch sử: file đã tải qua extension, lấy từ
/history?source=extension (D1 — backend sở hữu lịch sử).

Popup gọi thẳng backend chứ không qua service worker: nó là extension page nên
fetch mang đúng quyền host, đi vòng chỉ thêm một chặng có thể chết giữa chừng.

Uỷ quyền sự kiện cho nút điều khiển vì danh sách vẽ lại mỗi giây — gắn listener
lên từng nút sẽ mất ngay ở lần vẽ kế tiếp.

Báo viewerOpen/viewerClosed để service worker đổi nhịp poll 1s/60s (spec §4.2).

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

## Tự rà lại (đã chạy khi viết plan)

**1. Phủ spec.**

| Yêu cầu spec | Task |
|---|---|
| D3 — popup hai tab, panel chỉ chọn format | Task 6 (panel không đụng tới) |
| D7 — vòng tiến trình `OffscreenCanvas`, ẩn khi rảnh | Task 4 |
| §5.2 — tab Tải: task toàn cục + điều khiển + stream theo tab | Task 6 |
| §5.2 — tab Lịch sử: file đã tải qua extension | Task 6 |
| §5.3 — vòng đổi màu xám khi tạm dừng | Task 4 |
| §5.3 — chỉ vẽ khi bội số 5 đổi | Task 2 (`iconKey`) + Task 4 |
| §5.3 — vòng bám task mới nhất | Task 2 (`pickRingTask`) |
| §5.3 — badge bổ sung, trống khi đúng 1 download | Task 2 (`badgeFor`) |
| §5.3 — asset icon 4 cỡ | Task 3 |
| §4.2 — nhịp 1s / 60s / dừng | Task 2 (`nextPollMs`) + Task 5 |
| Popup có pause/resume/cancel | Task 1 (API) + Task 6 (UI) |

Không có yêu cầu nào trong phạm vi Plan 2 mà thiếu task.

**2. Chỗ kiểm được bằng máy và chỗ phải kiểm bằng tay.** Repo cố ý không có
framework test cho extension (ADR 0006), nên plan này đẩy **mọi quyết định** vào
`lib/tasks.ts` — có 18 test node — và để phần chạm trình duyệt mỏng nhất có thể.
`OffscreenCanvas` (Task 4) và DOM popup (Task 6) kiểm bằng tay, với các bước cụ
thể đã viết sẵn. Task 5 bước 6 (`chrome.alarms.getAll()` phải rỗng) là bước
chứng minh poll thật sự dừng.

**3. Nhất quán kiểu.** `TaskRecord`/`HistoryRow` định nghĩa ở Task 1 và dùng
nguyên vẹn ở Task 2, 4, 5, 6. `pickRingTask`/`quantize5`/`iconKey`/`badgeFor`/
`nextPollMs` định nghĩa ở Task 2, dùng ở Task 4 và 5 đúng tên và đúng chữ ký.
`setLastKnownTasks` định nghĩa ở Task 4, dùng ở Task 5.

**Rủi ro đã biết:** Task 4 bước 2 có thể phải thêm `"WebWorker"` vào `lib` trong
`tsconfig.json` — đã ghi sẵn cách xử lý ngay trong bước đó thay vì để người thực
thi tự đoán.
