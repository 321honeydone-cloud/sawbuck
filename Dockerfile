# Sawbuck AI - production image for a single always-on host (Render, Railway, Fly,
# or any VPS with Docker). Keeps SQLite + file uploads on a mounted volume.
FROM node:20-slim

WORKDIR /app

# ffmpeg pulls still frames from inspection videos. openssl is for Prisma.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx prisma generate && npm run build

ENV NODE_ENV=production
ENV PORT=3000
# Point these at a mounted volume so data survives redeploys:
#   DATABASE_URL=file:/data/sawbuck.db
#   UPLOAD_DIR=/data/uploads
EXPOSE 3000

# Apply the schema (creates the email + feedback columns) then start.
CMD ["sh", "-c", "npx prisma db push --skip-generate && npm run start"]
