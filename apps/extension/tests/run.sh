#!/usr/bin/env bash
# Chạy thử phần chọn stream. Repo không có framework test cho extension (ADR
# 0006), nên dùng đúng thứ có sẵn: esbuild gói module thật rồi node chạy nó.
# Quan trọng là test chạy trên CHÍNH file panel import, không phải bản chép lại.
set -euo pipefail
cd "$(dirname "$0")/.."
npx esbuild lib/pick.ts --bundle --format=esm --outfile=.tmp-pick.mjs --log-level=error
node tests/pick.test.mjs
rm -f .tmp-pick.mjs
