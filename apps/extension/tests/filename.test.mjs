import { sanitize, downloadName } from '../.tmp-filename.mjs';

let pass = 0, fail = 0;
const t = (name, fn, want) => {
  let got;
  try { got = typeof fn === 'function' ? fn() : fn; }
  catch (err) { got = `THREW: ${err instanceof Error ? err.message : String(err)}`; }
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
};

t('bo ky tu cam', () => sanitize('a/b\\c:d*e?f"g<h>i|j'), 'a_b_c_d_e_f_g_h_i_j');
t('ky tu dieu khien cung bi thay', () => sanitize('a' + String.fromCharCode(9) + 'b'), 'a_b');
t('gop khoang trang', () => sanitize('a   b'), 'a b');
t('bo dau cham cuoi - Windows cat no va sinh ten trung', () => sanitize('ten.'), 'ten');
t('chan di len thu muc cha', () => sanitize('../../etc/passwd'), '.._.._etc_passwd');
t('cat ten qua dai', () => sanitize('x'.repeat(300)).length, 120);
t('giu duoc tieng Viet co dau', () => sanitize('Me toi ke chuyen'), 'Me toi ke chuyen');

t('ten day du co muc chat luong',
  () => downloadName({ title: 'Clip vui', id: '123', quality: 'HD' }), 'Clip vui (HD).mp4');
t('khong co muc thi bo ngoac', () => downloadName({ title: 'Clip vui', id: '123' }), 'Clip vui.mp4');
t('tieu de rong thi lui ve id', () => downloadName({ title: '', id: '123', quality: 'SD' }), '123 (SD).mp4');
t('tieu de toan ky tu cam van ra ten dung duoc',
  () => downloadName({ title: '///', id: '123' }), '___.mp4');
t('khong co ca tieu de lan id thi van KHONG rong - rong la mat ca luot tai',
  () => downloadName({ title: null, id: '' }), 'video.mp4');
t('duoi la bi lam sach', () => downloadName({ title: 'a', id: '1', ext: 'm p4!' }), 'a.mp4');
t('duoi webm giu nguyen', () => downloadName({ title: 'a', id: '1', ext: 'webm' }), 'a.webm');

// --- thư mục theo site: không còn đổ chung một chỗ ---
t('co folder thi them tien to thu muc',
  () => downloadName({ title: 'a', id: '1', folder: 'vidu' }), 'vidu/a.mp4');
t('khong co folder thi giu nguyen ten tran',
  () => downloadName({ title: 'a', id: '1' }), 'a.mp4');
t('folder rong khong tao dau gach thua',
  () => downloadName({ title: 'a', id: '1', folder: '' }), 'a.mp4');
t('doan `..` bi bo han - downloads.download tu choi ca luot tai neu thay no',
  () => downloadName({ title: 'a', id: '1', folder: '../ke/xau' }), 'ke/xau/a.mp4');
t('dau gach duy nhat la dau ngan thu muc, ten file khong tu tao thu muc con',
  () => downloadName({ title: 'a/b', id: '1', folder: 'vidu' }), 'vidu/a_b.mp4');
t('folder nhieu tang cho bai nhieu anh',
  () => downloadName({ title: '01', id: '1', folder: 'vidu/Ten bai', ext: 'jpg' }), 'vidu/Ten bai/01.jpg');
t('doan folder rong bi bo, khong sinh // trong duong dan',
  () => downloadName({ title: 'a', id: '1', folder: 'vidu//' }), 'vidu/a.mp4');

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
