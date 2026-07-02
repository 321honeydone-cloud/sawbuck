# Sawbuck AI - production image for a single always-on host (Render, Railway, Fly,
# or any VPS with Docker). Keeps SQLite + file uploads on a mounted volume.
#
# Optional Tailscale: when TS_AUTHKEY is set, the container joins your private
# tailnet in userspace mode (Render cannot grant a TUN device) and exposes a
# local outbound HTTP proxy that the app uses to reach your shop Ollama. When
# TS_AUTHKEY is empty, Tailscale is skipped and the app runs on Claude as before.
FROM node:20-slim

WORKDIR /app

# ffmpeg pulls still frames from inspection videos. openssl is for Prisma.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Tailscale binaries, copied from the official image (no TUN device required).
COPY --from=docker.io/tailscale/tailscale:stable /usr/local/bin/tailscaled /usr/local/bin/tailscaled
COPY --from=docker.io/tailscale/tailscale:stable /usr/local/bin/tailscale /usr/local/bin/tailscale

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx prisma generate && npm run build

COPY docker-start.sh /app/docker-start.sh
RUN chmod +x /app/docker-start.sh

ENV NODE_ENV=production
ENV PORT=3000
# Point these at a mounted volume so data survives redeploys:
#   DATABASE_URL=file:/data/sawbuck.db
#   UPLOAD_DIR=/data/uploads
EXPOSE 3000

CMD ["/app/docker-start.sh"]
