#!/bin/sh
# Boot script. If TS_AUTHKEY is provided, join the tailnet in userspace mode and
# run an outbound HTTP proxy on localhost:1055 that the app points OLLAMA_HTTP_PROXY
# at. Then apply the DB schema and start Next. If Tailscale fails, we log and keep
# going: the app's provider logic falls back to Claude when Ollama is unreachable.
set -e

if [ -n "$TS_AUTHKEY" ]; then
  echo "Starting Tailscale (userspace networking)..."
  mkdir -p /data/tailscale
  /usr/local/bin/tailscaled \
    --tun=userspace-networking \
    --state=/data/tailscale/tailscaled.state \
    --socket=/tmp/tailscaled.sock \
    --outbound-http-proxy-listen=localhost:1055 &
  sleep 3
  /usr/local/bin/tailscale --socket=/tmp/tailscaled.sock up \
    --authkey="$TS_AUTHKEY" \
    --hostname="${TS_HOSTNAME:-sawbuck-web}" \
    || echo "tailscale up failed; app will fall back to Claude"
fi

# Shared learning log lives on the persistent /data volume so every contractor's
# quotes accumulate and survive redeploys (the container filesystem is wiped on
# each deploy). On first boot, seed it from the repo copy that shipped in the
# image, then always run against the volume.
MEM_PATH="${SAWBUCK_MEMORY_PATH:-/data/SAWBUCK_MEMORY.md}"
if [ ! -f "$MEM_PATH" ]; then
  mkdir -p "$(dirname "$MEM_PATH")"
  if [ -f /app/SAWBUCK_MEMORY.md ]; then
    cp /app/SAWBUCK_MEMORY.md "$MEM_PATH"
    echo "Seeded learning log at $MEM_PATH from the repo copy."
  fi
fi
export SAWBUCK_MEMORY_PATH="$MEM_PATH"

npx prisma db push --skip-generate
exec npm run start
