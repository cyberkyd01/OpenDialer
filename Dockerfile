# syntax=docker/dockerfile:1
#
# OpenDialer server image (API + realtime + built web console).
#
#   docker build -t opendialer .
#   docker run -d -p 8080:8080 -p 8443:8443 -v ./data:/data --name opendialer opendialer
#
# Base image choice: node:22-bookworm-slim (Debian, glibc) rather than alpine (musl).
# better-sqlite3 is a native module; on glibc it installs from its prebuilt binaries, while on
# musl it often has to compile from source. The build stages still carry python3/make/g++ so a
# source build works as a fallback (e.g. on unusual CPU architectures). The runtime stage has no
# compilers.

ARG NODE_IMAGE=node:22-bookworm-slim

# ---------------------------------------------------------------------------
# 1. build: install everything (incl. dev deps) and compile shared + web + server
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
# The desktop (Electron) workspace is not needed in the image: skip its 100 MB binary download.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    npm_config_fund=false \
    npm_config_audit=false
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
COPY packages/desktop/package.json packages/desktop/
RUN npm ci
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/server packages/server
COPY packages/web packages/web
RUN npm run build

# ---------------------------------------------------------------------------
# 2. deps: production node_modules for the server workspace only
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS deps
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 \
    npm_config_fund=false \
    npm_config_audit=false
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
COPY packages/desktop/package.json packages/desktop/
RUN npm ci --omit=dev --workspace @opendialer/server \
 && npm cache clean --force

# ---------------------------------------------------------------------------
# 3. runtime
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8080 \
    HTTPS_PORT=8443 \
    TLS=auto \
    HOST=0.0.0.0
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY --from=build /src/packages/shared/package.json packages/shared/package.json
COPY --from=build /src/packages/shared/dist packages/shared/dist
COPY --from=build /src/packages/server/package.json packages/server/package.json
COPY --from=build /src/packages/server/dist packages/server/dist
COPY --from=build /src/packages/web/dist packages/web/dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080 8443
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "packages/server/dist/index.js"]
