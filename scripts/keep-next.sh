#!/bin/bash
cd /home/z/my-project
while true; do
  if ! pgrep -f "next-server" > /dev/null; then
    echo "[$(date)] Starting Next.js..." >> /tmp/keep-next.log
    bun next start -H 0.0.0.0 -p 3000 >> /tmp/next-prod.log 2>&1 &
    NEXT_PID=$!
    echo "[$(date)] Started PID $NEXT_PID" >> /tmp/keep-next.log
    sleep 5
  fi
  sleep 5
done
