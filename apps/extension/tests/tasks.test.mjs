import { pickRingTask, quantize5, badgeFor, nextPollMs, iconKey, relativeTime, BADGE_BLUE, BADGE_GRAY }
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
t('hoà created_at thì phá bằng task_id, không phụ thứ tự mảng',
  pickRingTask([
    mk('a', 'downloading', 10, '2026-09-17 10:00:00'),
    mk('z', 'downloading', 20, '2026-09-17 10:00:00'),
  ])?.task_id ===
  pickRingTask([
    mk('z', 'downloading', 20, '2026-09-17 10:00:00'),
    mk('a', 'downloading', 10, '2026-09-17 10:00:00'),
  ])?.task_id, true);

// --- quantize5: chặn vẽ thừa, tối đa 20 lần vẽ mỗi download ---
t('làm tròn xuống bội số 5', quantize5(37), 35);
t('đúng bội số thì giữ nguyên', quantize5(40), 40);
t('kẹp dưới về 0', quantize5(-3), 0);
t('kẹp trên về 100', quantize5(140), 100);
t('đúng 100 giữ nguyên', quantize5(100), 100);
t('NaN về 0', quantize5(NaN), 0);
t('Infinity về 0', quantize5(Infinity), 0);
t('-Infinity về 0', quantize5(-Infinity), 0);

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
t('BADGE_BLUE đúng mã spec', BADGE_BLUE, '#2563eb');
t('BADGE_GRAY đúng mã spec', BADGE_GRAY, '#71717a');
t('hơn 1 download: hiện số, nền xanh',
  badgeFor([mk('a', 'downloading', 1, '1'), mk('b', 'downloading', 2, '2')], 0),
  { text: '2', color: BADGE_BLUE, perTab: false });
t('đúng 1 download: badge TRỐNG vì vòng đã nói rồi',
  badgeFor([mk('a', 'downloading', 1, '1')], 3), { text: '', color: BADGE_BLUE, perTab: false });
t('không tải nhưng có stream bắt được: hiện số, nền xám',
  badgeFor([], 2), { text: '2', color: BADGE_GRAY, perTab: true });
t('không có gì: trống', badgeFor([], 0), { text: '', color: BADGE_GRAY, perTab: false });
// --- perTab: số download là toàn cục (D2), số stream là theo tab ---
t('hơn 1 download => perTab false (toàn cục)',
  badgeFor([mk('a', 'downloading', 1, '1'), mk('b', 'downloading', 2, '2')], 0).perTab, false);
t('đúng 1 download => perTab false (toàn cục)',
  badgeFor([mk('a', 'downloading', 1, '1')], 0).perTab, false);
t('có capture, không download => perTab true (theo tab)',
  badgeFor([], 5).perTab, true);
t('rỗng hoàn toàn => perTab false để xoá badge toàn cục cũ',
  badgeFor([], 0).perTab, false);

// --- nextPollMs (spec §4.2) ---
t('có người xem thì 1s', nextPollMs({ viewersOpen: true, hasActive: true }), 1000);
t('không ai xem mà còn task thì 60s', nextPollMs({ viewersOpen: false, hasActive: true }), 60000);
t('hết task thì DỪNG hẳn', nextPollMs({ viewersOpen: false, hasActive: false }), null);
t('không có task thì dừng kể cả khi popup mở',
  nextPollMs({ viewersOpen: true, hasActive: false }), null);

// --- relativeTime (spec §5.2) ---
const NOW = Date.parse('2026-09-17T10:00:00Z');
t('vài giây trước => vừa xong',
  relativeTime('2026-09-17 09:59:50', NOW), 'vừa xong');
t('vài phút trước',
  relativeTime('2026-09-17 09:55:00', NOW), '5 phút trước');
t('vài giờ trước',
  relativeTime('2026-09-17 07:00:00', NOW), '3 giờ trước');
t('đúng hôm qua (~24h)',
  relativeTime('2026-09-16 10:00:00', NOW), 'hôm qua');
t('vài ngày trước',
  relativeTime('2026-09-10 10:00:00', NOW), '7 ngày trước');
t('chuỗi rỗng không ném lỗi, trả rỗng', relativeTime('', NOW), '');
t('null không ném lỗi, trả rỗng', relativeTime(null, NOW), '');
t('undefined không ném lỗi, trả rỗng', relativeTime(undefined, NOW), '');
t('chuỗi hỏng không ném lỗi, trả rỗng', relativeTime('không phải ngày giờ', NOW), '');

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
