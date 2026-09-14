# StockSense, single container: Express serves the API and the built frontend.
# GitHub Actions builds it (.github/workflows/container.yml) and AWS Lightsail
# runs it.
#
# Two things break naive versions of this image, and both are handled below.
#
# 1. better-sqlite3 is a NATIVE module. It is compiled against a specific Node
#    ABI and libc, so the builder stage and the runtime stage must share the
#    same base image. They do: both are node:22-bookworm-slim. Debian is chosen
#    over Alpine deliberately, because musl has no prebuilt binary for this
#    package and falls back to a source build that needs a toolchain the slim
#    Alpine image does not carry.
#
# 2. backend/src/index.js resolves the frontend as
#    path.join(__dirname, "../../frontend/dist"), so backend/ and frontend/dist
#    have to stay SIBLINGS inside the image. Flattening everything into one
#    directory produces a container that serves the API correctly and answers
#    every page request with a 404, which is a confusing failure to debug.

# ── Stage 1: build ───────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder

# Toolchain for compiling better-sqlite3 if no prebuilt binary matches. Present
# only in this stage, so none of it reaches the final image.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Manifests first, so a source-only change does not invalidate the dependency
# layer and force a recompile of the native module on every build.
COPY backend/package.json backend/package-lock.json ./backend/
RUN npm ci --prefix backend --omit=dev

COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN npm ci --prefix frontend

# Vite needs its config, entry HTML and source tree to produce a build.
COPY frontend/ ./frontend/
RUN npm run build --prefix frontend

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8080

WORKDIR /app

# Compiled backend dependencies, carried over rather than reinstalled. Same base
# image, so the native binary is ABI compatible.
COPY --from=builder /app/backend/node_modules ./backend/node_modules
COPY backend/package.json ./backend/package.json
COPY backend/src ./backend/src

# The built frontend, as a sibling of backend/. See note 2 at the top.
COPY --from=builder /app/frontend/dist ./frontend/dist

# SQLite lives here. Declared as a volume so a host can mount real storage over
# it; without a mount the database is ephemeral and reseeds itself on boot,
# which is a supported mode rather than a failure.
RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]

# The base image ships an unprivileged `node` user. Nothing here needs root.
USER node

EXPOSE 8080

# Direct node rather than `npm start`, so the process is PID 1 and receives
# SIGTERM on shutdown instead of npm swallowing it.
CMD ["node", "backend/src/index.js"]
