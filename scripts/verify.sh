#!/usr/bin/env bash
# Fresh clone -> working site. Nothing here needs a key, an account or a network
# service beyond npm and a local browser.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-4173}"
echo "== 1/6 install"
if [ -f package-lock.json ]; then npm ci --silent; else npm install --silent; fi

echo "== 2/6 typecheck"
npm run typecheck

echo "== 3/6 unit tests"
npm test

echo "== 4/6 build"
npm run build

echo "== 5/6 serve"
npx vite preview --port "$PORT" --strictPort >/tmp/saddle-preview.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT
for i in $(seq 1 40); do
  if curl -sf -o /dev/null "http://localhost:$PORT/"; then break; fi
  sleep 0.25
done

echo "== 6/6 end-to-end + layout"
SITE_URL="http://localhost:$PORT/" node scripts/e2e.mjs
SITE_URL="http://localhost:$PORT/" node scripts/measure.mjs

echo "== all green"
