#!/usr/bin/env bash
# Chạy thử phần chọn stream. Repo không có framework test cho extension (ADR
# 0006), nên dùng đúng thứ có sẵn: esbuild gói module thật rồi node chạy nó.
# Quan trọng là test chạy trên CHÍNH file panel import, không phải bản chép lại.
set -euo pipefail
cd "$(dirname "$0")/.."
npx esbuild lib/pick.ts --bundle --format=esm --outfile=.tmp-pick.mjs --log-level=error
node tests/pick.test.mjs
npx esbuild lib/tasks.ts --bundle --format=esm --outfile=.tmp-tasks.mjs --log-level=error
node tests/tasks.test.mjs
npx esbuild lib/formats.ts --bundle --format=esm --outfile=.tmp-formats.mjs --log-level=error
node tests/formats.test.mjs
npx esbuild lib/anchor.ts --bundle --format=esm --outfile=.tmp-anchor.mjs --log-level=error
node tests/anchor.test.mjs

npx esbuild lib/m3u8.ts --bundle --format=esm --outfile=.tmp-m3u8.mjs --log-level=error
node tests/m3u8.test.mjs
npx esbuild lib/netcapture.ts --bundle --format=esm --outfile=.tmp-netcapture.mjs --log-level=error
node tests/netcapture.test.mjs
npx esbuild lib/filename.ts --bundle --format=esm --outfile=.tmp-filename.mjs --log-level=error
node tests/filename.test.mjs
npx esbuild lib/facebook.ts --bundle --format=esm --outfile=.tmp-facebook.mjs --log-level=error
node tests/facebook.test.mjs
npx esbuild lib/dash.ts --bundle --format=esm --outfile=.tmp-dash.mjs --log-level=error
node tests/dash.test.mjs
npx esbuild lib/youtube.ts --bundle --format=esm --outfile=.tmp-youtube.mjs --log-level=error
node tests/youtube.test.mjs
npx esbuild lib/submitGuard.ts --bundle --format=esm --outfile=.tmp-submitGuard.mjs --log-level=error
node tests/submitGuard.test.mjs
rm -f .tmp-netcapture.mjs .tmp-filename.mjs .tmp-facebook.mjs .tmp-dash.mjs .tmp-youtube.mjs .tmp-pick.mjs .tmp-tasks.mjs .tmp-formats.mjs .tmp-anchor.mjs .tmp-submitGuard.mjs .tmp-m3u8.mjs
