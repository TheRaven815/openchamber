# syntax=docker/dockerfile:1
FROM oven/bun:1.4.4 AS base
WORKDIR /app

FROM base AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY bun-patches ./bun-patches
COPY packages/ui/package.json ./packages/ui/
COPY packages/web/package.json ./packages/web/
COPY packages/electron/package.json ./packages/electron/
COPY packages/vscode/package.json ./packages/vscode/
COPY packages/mobile/package.json ./packages/mobile/
COPY packages/sdk/package.json ./packages/sdk/
RUN bun install --frozen-lockfile --ignore-scripts

FROM deps AS builder
WORKDIR /app
COPY . .
# The server imports @openchamber/sdk at runtime, and deps installed with
# --ignore-scripts, so the root postinstall never built it. Build it here
# so the runtime stage can copy the output.
RUN bun run --cwd packages/sdk build
RUN bun run build:web

# Runtime install. The builder tree above holds every workspace (Electron,
# VS Code, mobile, UI) plus their devDependencies: electron (~370 MB),
# electron-builder, onnxruntime, and the rest. A Pi image that copies that
# tree lands around 3.8 GB.
#
# Install the full frozen lockfile, then prune. --filter plus --frozen-lockfile
# re-hoists and can put a different version in a root slot than bun.lock saved,
# so the prune path is the one that keeps the lockfile layout. --ignore-scripts
# skips the root postinstall, which would download Electron and rebuild
# extensions. SDK dist is copied from the builder, not built here.
# Every workspace package.json has to be present: a missing one fails the
# frozen install when another workspace depends on it.
FROM base AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
COPY bun-patches ./bun-patches
COPY packages/ui/package.json ./packages/ui/
COPY packages/web/package.json ./packages/web/
COPY packages/electron/package.json ./packages/electron/
COPY packages/vscode/package.json ./packages/vscode/
COPY packages/mobile/package.json ./packages/mobile/
COPY packages/sdk/package.json ./packages/sdk/
RUN bun install --frozen-lockfile --ignore-scripts \
  && bun prune --production

FROM oven/bun:1.4.4 AS runtime
WORKDIR /home/openchamber

RUN apt-get update && apt-get install -y --no-install-recommends \
  bash \
  bzip2 \
  ca-certificates \
  git \
  less \
  nodejs \
  npm \
  openssh-client \
  python3 \
  && rm -rf /var/lib/apt/lists/*

# Replace the base image's 'bun' user (UID 1000) with 'openchamber'
# so mounted volumes with 1000:1000 ownership work correctly.
RUN userdel bun \
  && groupadd -g 1000 openchamber \
  && useradd -u 1000 -g 1000 -m -s /bin/bash openchamber \
  && chown -R openchamber:openchamber /home/openchamber

# Switch to openchamber user
USER openchamber

ENV NPM_CONFIG_PREFIX=/home/openchamber/.npm-global
ENV PATH=${NPM_CONFIG_PREFIX}/bin:${PATH}

RUN npm config set prefix /home/openchamber/.npm-global && mkdir -p /home/openchamber/.npm-global && \
  mkdir -p /home/openchamber/.local /home/openchamber/.config /home/openchamber/.ssh && \
  npm install -g @opencode/cli@2.1.4

# cloudflared 2026.3.0 - update digest explicitly when upgrading
COPY --from=cloudflare/cloudflared@sha256:6d91c121b803126f7a5344005d17a9324788fc09d305b6e2560ec6040a7ae283 /usr/local/bin/cloudflared /usr/local/bin/cloudflared

ENV NODE_ENV=production
# The base image ships with the POSIX locale, which makes bash readline treat
# every byte of a multibyte character separately in the built-in terminal.
ENV LANG=C.UTF-8

COPY scripts/docker-entrypoint.sh /home/openchamber/openchamber-entrypoint.sh

COPY --from=prod-deps --chown=openchamber:openchamber /app/node_modules ./node_modules
COPY --from=prod-deps --chown=openchamber:openchamber /app/packages/web/node_modules ./packages/web/node_modules
COPY --from=prod-deps --chown=openchamber:openchamber /app/package.json ./package.json
COPY --from=prod-deps --chown=openchamber:openchamber /app/packages/web/package.json ./packages/web/package.json
COPY --from=prod-deps --chown=openchamber:openchamber /app/packages/sdk/package.json ./packages/sdk/package.json
COPY --from=builder --chown=openchamber:openchamber /app/packages/sdk/dist ./packages/sdk/dist
COPY --from=builder --chown=openchamber:openchamber /app/packages/web/bin ./packages/web/bin
COPY --from=builder --chown=openchamber:openchamber /app/packages/web/server ./packages/web/server
COPY --from=builder --chown=openchamber:openchamber /app/packages/web/dist ./packages/web/dist

EXPOSE 3000

ENTRYPOINT ["sh", "/home/openchamber/openchamber-entrypoint.sh"]
