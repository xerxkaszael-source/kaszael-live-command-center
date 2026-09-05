#!/usr/bin/env bash
# KASZAEL Live Command Center — startup script
# Pure stdlib Python. No external deps. Bind 127.0.0.1 only.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/backend"

# Pick a port: prefer 9119, fall back to 9130-9180 if busy
PORTS_TO_TRY=(9119 9130 9140 9150 9160 9170 9180)
PORT=""
for p in "${PORTS_TO_TRY[@]}"; do
  if ! (echo > "/dev/tcp/127.0.0.1/$p") 2>/dev/null; then
    PORT="$p"
    break
  fi
done
if [ -z "$PORT" ]; then
  echo "❌ No available port in ${PORTS_TO_TRY[*]}" >&2
  exit 1
fi

cd "$BACKEND"
echo "🚀 Starting LCC on port $PORT"
exec env LCC_PORT="$PORT" python3 -u server.py