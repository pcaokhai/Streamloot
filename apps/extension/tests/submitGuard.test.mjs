import { canSubmit } from '../.tmp-submitGuard.mjs';

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

t('không có gì đang bay thì cho bấm', () => canSubmit(false), true);
t('đang bay thì chặn bấm tiếp', () => canSubmit(true), false);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
