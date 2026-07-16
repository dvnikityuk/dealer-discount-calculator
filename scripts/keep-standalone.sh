#!/bin/bash
cd /home/z/my-project
while true; do
  if ! pgrep -f "node.*standalone/server.js" > /dev/null; then
    echo "[$(date)] Starting standalone..." >> /tmp/keep-standalone.log
    node .next/standalone/server.js >> /tmp/next-standalone.log 2>&1 &
    echo "[$(date)] Started PID $!" >> /tmp/keep-standalone.log
    sleep 3
  fi
  sleep 3
done
