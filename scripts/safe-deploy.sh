#!/usr/bin/env bash
# Safe production deploy for the dealer-discount calculator.
#
# What this script does, in order:
#   1. Snapshot the live standalone state.json back to source ./data/
#      so user-added dealers / edits survive the rebuild.
#   2. Stop the running next-server.
#   3. Rebuild with bun.
#   4. Copy static assets into .next/standalone/ WITHOUT overwriting
#      state.json or data/uploads/ (merge, not clobber).
#   5. Restart the server with setsid (survives shell exit).
#   6. Health-check with curl.
#
set -euo pipefail

PROJECT=/home/z/my-project
STANDALONE="$PROJECT/.next/standalone"
LOG=/tmp/server.log

echo "=== 1. Snapshot live state.json back to source ==="
if [ -f "$STANDALONE/data/state.json" ]; then
  cp "$STANDALONE/data/state.json" "$PROJECT/data/state.json"
  echo "  ✓ state.json copied back ($(wc -c < "$PROJECT/data/state.json") bytes)"
else
  echo "  (no live state.json yet — first deploy)"
fi

# Also snapshot uploads/ if newer
if [ -d "$STANDALONE/data/uploads" ]; then
  mkdir -p "$PROJECT/data/uploads"
  for f in facts.csv plans.xlsx; do
    if [ -f "$STANDALONE/data/uploads/$f" ]; then
      src_mtime=$(stat -c %Y "$STANDALONE/data/uploads/$f" 2>/dev/null || echo 0)
      dst_mtime=$(stat -c %Y "$PROJECT/data/uploads/$f" 2>/dev/null || echo 0)
      if [ "$src_mtime" -gt "$dst_mtime" ]; then
        cp "$STANDALONE/data/uploads/$f" "$PROJECT/data/uploads/$f"
        echo "  ✓ $f snapshotted back"
      fi
    fi
  done
fi

echo "=== 2. Stop running server ==="
pkill -f "next-server" 2>/dev/null || true
pkill -f "node server.js" 2>/dev/null || true
sleep 1

echo "=== 3. Rebuild ==="
cd "$PROJECT"
bun run build > /tmp/build.log 2>&1
BUILD_EXIT=$?
if [ $BUILD_EXIT -ne 0 ]; then
  echo "  ✗ BUILD FAILED — see /tmp/build.log"
  tail -30 /tmp/build.log
  exit 1
fi
echo "  ✓ build ok"

echo "=== 4. Copy assets to standalone (no clobber of state) ==="
# Static chunks — overwrite always (these change every build)
mkdir -p "$STANDALONE/.next"
cp -r "$PROJECT/.next/static" "$STANDALONE/.next/static"
# public/ — overwrite (logo, robots)
cp -r "$PROJECT/public/." "$STANDALONE/public/"
# data/ — merge, don't clobber state.json or uploads/
mkdir -p "$STANDALONE/data"
if [ -f "$PROJECT/data/state.json" ] && [ ! -f "$STANDALONE/data/state.json" ]; then
  cp "$PROJECT/data/state.json" "$STANDALONE/data/state.json"
fi
mkdir -p "$STANDALONE/data/uploads" "$PROJECT/data/uploads"
for f in facts.csv plans.xlsx; do
  if [ -f "$PROJECT/data/uploads/$f" ] && [ ! -f "$STANDALONE/data/uploads/$f" ]; then
    cp "$PROJECT/data/uploads/$f" "$STANDALONE/data/uploads/$f"
  fi
done
# upload/ inbound dropbox — copy fresh
mkdir -p "$STANDALONE/upload"
cp -r "$PROJECT/upload/." "$STANDALONE/upload/" 2>/dev/null || true
# db/ — copy if exists
[ -d "$PROJECT/db" ] && cp -rn "$PROJECT/db" "$STANDALONE/" 2>/dev/null || true
# .env — copy
cp "$PROJECT/.env" "$STANDALONE/.env"

echo "=== 5. Start server ==="
cd "$STANDALONE"
setsid -f bash -c 'PORT=3000 HOSTNAME=0.0.0.0 NODE_ENV=production exec node server.js > '"$LOG"' 2>&1'
sleep 3

echo "=== 6. Health check ==="
LISTENER=$(ss -tlnp 2>/dev/null | grep ":3000 " || true)
if [ -z "$LISTENER" ]; then
  echo "  ✗ No listener on :3000 — see $LOG"
  tail -20 "$LOG"
  exit 1
fi
echo "  ✓ listening: $LISTENER"

HTTP_CODE=$(curl -sS -o /dev/null -w "%{http_code}" http://localhost:3000/ || echo "000")
echo "  ✓ HTTP $HTTP_CODE on /"

# Test API endpoints
SYNC_CODE=$(curl -sS -o /dev/null -w "%{http_code}" -X POST http://localhost:3000/api/drive/sync || echo "000")
echo "  ✓ HTTP $SYNC_CODE on /api/drive/sync (POST)"

echo ""
echo "=== Deploy complete ==="
echo "  Production URL: https://preview-chat-f7765f31-b602-4e75-9168-030c1d79bc61.space-z.ai/"
echo "  Server log:     $LOG"
