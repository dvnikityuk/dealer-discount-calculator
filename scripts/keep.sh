#!/bin/bash
cd /home/z/my-project
while true; do
  if ! pgrep -f "standalone/server.js" > /dev/null 2>&1; then
    node .next/standalone/server.js > /tmp/next.log 2>&1 &
    disown
  fi
  sleep 2
done
