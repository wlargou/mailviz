# syntax=docker/dockerfile:1

# ---- Mailviz: the app image and the migrator image -------------------------
# Two targets, both for linux/amd64 (the OKE nodes), built by
# .github/workflows/images.yml (called from build.yml) on a GitHub-hosted
# runner. The build context is the repo root, so build from there and name
# this file:
#
#   docker buildx build --platform linux/amd64 -f docker/Dockerfile --target app .
#   docker buildx build --platform linux/amd64 -f docker/Dockerfile --target migrator .
#
# This file is in docker/ and not at the root on purpose. Railway builds with
# any Dockerfile it finds at the root, whatever railway.json says, so a root
# Dockerfile would replace Nixpacks (nixpacks.toml) in production. Railway
# keeps building with Nixpacks until the move.
#
# What is left out of the context is in Dockerfile.dockerignore, beside this
# file: BuildKit reads <Dockerfile>.dockerignore next to the Dockerfile it is
# given, with patterns relative to the context root. Nor is there a root
# .dockerignore: the root is what Railway builds from, and nothing added for
# the images should change that build.
#
# The base is pinned by its multi-arch index digest, so a rebuild cannot pull a
# re-tagged upstream; the tag is informational and matches .nvmrc. Refresh with
#   docker buildx imagetools inspect node:22.19.0-bookworm-slim
# (linux/amd64 manifest at the time: sha256:cff78eb5aa1cf27dc2b6aeea9d31366415a43e9a9ea0ddec00d780b2b66fad0f)

FROM node:22.19.0-bookworm-slim@sha256:4a4884e8a44826194dff92ba316264f392056cbe243dcc9fd3551e71cea02b90 AS base
# No telemetry from the build or the images: Prisma's CLI phones
# checkpoint.prisma.io, and Carbon's and IBM Plex's postinstalls report to IBM.
ENV CHECKPOINT_DISABLE=1 \
    IBM_TELEMETRY_DISABLED=true \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false
WORKDIR /app

# --- deps: every dependency, dev included, as the lockfile pins them --------
FROM base AS deps
# openssl is how Prisma tells openssl 3 from 1.1. @prisma/engines' postinstall
# downloads the schema engine for the platform it detects, and without openssl
# it guesses 1.1 and fetches an engine that cannot load on bookworm.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci --include=dev

# --- build: the client bundle, the Prisma client, the server ---------------
FROM deps AS build
COPY VERSION tsconfig.base.json ./
COPY client client
COPY server server
# prisma.config.ts throws when DATABASE_URL is unset, even for `generate`,
# which never connects. A dummy for this one command, in this stage only: no
# image built from here carries it.
RUN npm run build --workspace=client \
    && DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build npm run prisma:generate --workspace=server \
    && npm run build --workspace=server

# --- prod-deps: what the server imports at runtime, nothing else ------------
FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
# --omit=optional matters as much as --omit=dev. @prisma/client declares the
# prisma CLI and TypeScript as optional peers, so the lockfile flags them
# devOptional and --omit=dev alone installs both: 600 MB instead of 370. Nothing
# the server loads is an optional dependency today; one that is (a native module
# shipping its binary that way) fails the image's smoke test at boot.
# No install scripts: no server dependency has one.
# Only what server/package.json declares is the server's to rely on: the
# workspace filter does not hoist the client's packages in for it (it still
# leaves a few, React and Sass among them, about 20 MB never loaded).
RUN npm ci --omit=dev --omit=optional --workspace=server --ignore-scripts \
    && npm cache clean --force

# --- migrator-deps: the Prisma CLI and what it loads, nothing else ---------
FROM deps AS migrator-deps
# Prune the full install down to `prisma` and `dotenv` (prisma.config.ts imports
# dotenv/config), keeping the versions the lockfile resolved and the schema
# engine @prisma/engines downloaded. Peers are dropped: React and TypeScript are
# there for Prisma Studio and for `prisma init`, not for `migrate deploy`.
RUN node -e ' \
      const fs = require("fs"); \
      const pkgs = require("./package-lock.json").packages; \
      const v = (n) => pkgs["node_modules/" + n].version; \
      fs.writeFileSync("package.json", JSON.stringify({ name: "migrator", private: true, \
        dependencies: { prisma: v("prisma"), dotenv: v("dotenv") } })); \
    ' \
    && npm prune --omit=dev --omit=peer \
    && ls node_modules/@prisma/engines/schema-engine-*-openssl-3.0.x

# --- migrator: `prisma migrate deploy`, run once before each rollout --------
FROM base AS migrator
# The schema engine is a native binary linked against libssl 3, and verifies
# the database's certificate against the system store when the URL asks for TLS.
RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 app \
    && useradd --uid 10001 --gid 10001 --no-create-home --home-dir /tmp --shell /usr/sbin/nologin app
COPY --from=migrator-deps /app/node_modules ./node_modules
COPY server/package.json server/prisma.config.ts ./server/
COPY server/src/config/secretFiles.ts ./server/src/config/
COPY server/src/prisma/schema.prisma ./server/src/prisma/
COPY server/src/prisma/migrations ./server/src/prisma/migrations
# HOME on the writable /tmp: the root filesystem is read-only on the cluster.
ENV NODE_ENV=production HOME=/tmp
USER 10001:10001
WORKDIR /app/server
# The cluster runs `node /app/node_modules/prisma/build/index.js migrate deploy`
# with DATABASE_URL_FILE set; the same, by default, here. `docker run <image>
# migrate status` and `<image> --version` work too.
ENTRYPOINT ["node", "/app/node_modules/prisma/build/index.js"]
CMD ["migrate", "deploy"]

# --- app: the server, which also serves the client --------------------------
FROM base AS app
# tini is PID 1, so SIGTERM reaches node and its graceful shutdown, and exited
# children are reaped.
RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 app \
    && useradd --uid 10001 --gid 10001 --no-create-home --home-dir /tmp --shell /usr/sbin/nologin app
# The layout the server resolves at runtime: config/version.ts reads
# ../../../VERSION from dist/config, app.ts serves ../../client/dist from dist,
# lib/prismaClient.ts imports ../../generated. server/package.json is what
# makes dist/*.js ES modules. Workspace dependencies npm could not hoist live in
# server/node_modules (cookie 2, beside express's cookie 0.7).
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/server/node_modules ./server/node_modules
COPY --from=build /app/VERSION ./
COPY --from=build /app/server/package.json ./server/
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/generated ./server/generated
COPY --from=build /app/client/dist ./client/dist
# NODE_ENV=production is not a detail: it turns on serving the client, Secure
# cookies, the CSP, and the boot check that refuses missing secrets. Nixpacks
# set it implicitly; nothing else does here.
ENV NODE_ENV=production PORT=3002 HOME=/tmp
USER 10001:10001
WORKDIR /app/server
EXPOSE 3002
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
