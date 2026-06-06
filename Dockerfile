# HushPod — single-stage image. whisper.cpp is compiled at runtime by
# nodejs-whisper, so the build toolchain (cmake/make/g++) must be present in the
# final image, not just at install time. ffmpeg is required for all audio work.
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      cmake \
      make \
      g++ \
      python3 \
      git \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN corepack enable

# Install deps first for better layer caching. python3/g++ are needed to build
# better-sqlite3's native binding.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Build client (Vite -> dist/client) and server (tsup -> dist/server).
COPY . .
RUN pnpm build && pnpm prune --prod

ENV NODE_ENV=production
ENV HUSHPOD_DATA_DIR=/app/data
ENV PORT=3000
EXPOSE 3000
VOLUME /app/data

CMD ["node", "dist/server/index.js"]
