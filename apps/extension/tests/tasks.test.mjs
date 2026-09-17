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
