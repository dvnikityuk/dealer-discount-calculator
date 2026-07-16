#!/bin/bash
# Persistent production launcher for the dealer-discount-calculator.
#
# Why this exists:
#   In this sandbox, processes started with plain `nohup ... &` get killed when
#   the parent bash shell exits. The doubly-detached pattern
#   `( setsid bash -c '...' & )` is the only reliable way to keep Next.js
#   running across shell sessions.
#
# Usage:
#   bash scripts/start-prod.sh         # start (or restart) on port 3000
#   bash scripts/start-prod.sh status  # check if running
#   bash scripts/start-prod.sh stop    # kill running server

set -e
cd "$(dirname "$0")/.."

PORT="${PORT:-3000}"
LOG="/tmp/next-prod.log"
PIDFILE="/tmp/next-prod.pid"

case "${1:-start}" in
  status)
    # Primary check: does the port respond?
    if curl -s -o /dev/null --max-time 3 "http://localhost:$PORT/" 2>/dev/null; then
      PID="$(pgrep -f 'node .next/standalone/server.js' | head -1 || true)"
      [ -n "$PID" ] && echo "$PID" > "$PIDFILE"
      echo "RUNNING pid=${PID:-unknown} port=$PORT log=$LOG"
      curl -s -o /dev/null -w "  HTTP %{http_code}\n" --max-time 3 "http://localhost:$PORT/" || true
      exit 0
    else
      echo "NOT RUNNING (port $PORT not responding)"
      exit 1
    fi
    ;;

  stop)
    if [ -f "$PIDFILE" ]; then
      PID="$(cat "$PIDFILE")"
      if kill -0 "$PID" 2>/dev/null; then
        echo "Stopping pid=$PID"
        kill -9 "$PID" 2>/dev/null || true
      fi
      rm -f "$PIDFILE"
    fi
    # Also kill any stray next-server processes
    pkill -9 -f "node server.js" 2>/dev/null || true
    pkill -9 -f "next-server" 2>/dev/null || true
    sleep 1
    echo "Stopped."
    ;;

  start|"")
    # Build if standalone server.js is missing
    if [ ! -f ".next/standalone/server.js" ]; then
      echo "Building (no standalone server found)..."
      bun run build
    fi
    # Copy static assets (idempotent)
    mkdir -p .next/standalone/.next
    cp -r .next/static .next/standalone/.next/ 2>/dev/null || true
    [ -d public ] && cp -r public .next/standalone/ 2>/dev/null || true

    # Kill any existing server first
    pkill -9 -f "node .next/standalone/server.js" 2>/dev/null || true
    pkill -9 -f "next-server" 2>/dev/null || true
    sleep 1

    # Doubly-detached launch: subshell + setsid + redirect all stdio
    # This is the ONLY pattern that survives across bash sessions in this sandbox.
    (
      setsid bash -c "
        cd /home/z/my-project/.next/standalone
        PORT=$PORT HOSTNAME=0.0.0.0 exec node server.js
      " </dev/null >"$LOG" 2>&1 &
    )

    # Wait for the server to come up
    echo "Waiting for server..."
    for i in $(seq 1 20); do
      if curl -s -o /dev/null --max-time 1 "http://localhost:$PORT/" 2>/dev/null; then
        PID=$(pgrep -f "node .next/standalone/server.js" | head -1)
        [ -n "$PID" ] && echo "$PID" > "$PIDFILE"
        echo "STARTED pid=$PID port=$PORT log=$LOG"
        curl -s -o /dev/null -w "HTTP %{http_code}, size=%{size_download}\n" "http://localhost:$PORT/"
        exit 0
      fi
      sleep 0.5
    done
    echo "ERROR: server did not become ready"
    tail -20 "$LOG"
    exit 1
    ;;

  *)
    echo "Usage: $0 {start|stop|status}" >&2
    exit 2
    ;;
esac
