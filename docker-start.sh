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

npx prisma db push --skip-generate
exec npm run start
