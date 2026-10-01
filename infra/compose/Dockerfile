FROM node:22-bookworm@sha256:0557ac14e0d45d02ed563067b82856ca5e7aa3437fa28d98d4350ea9c3d9494a
# The runtime user is `node` (HOME=/home/node), so a cache under /root/.cache/node/corepack
# would make corepack re-download the package manager on every container start — and hang on
# a flaky DNS (getaddrinfo EAI_AGAIN). Bake it where every user can read it, and prepare the
# exact `packageManager` pin so the /usr/local/bin/pnpm shim never re-resolves a version.
ENV COREPACK_HOME=/opt/corepack
RUN corepack enable \
  && corepack prepare pnpm@9.15.0 --activate \
  && chmod -R a+rX /opt/corepack
WORKDIR /app
# Normalize modes: a restrictive host umask (e.g. 077 on hardened hosts) would otherwise
# leave the copied tree unreadable to USER node at runtime.
COPY --chmod=755 . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @rakazo/db generate
RUN RAKAZO_ALLOW_DEV_SECRETS=1 pnpm --filter @rakazo/web build
RUN install -d -m 750 -o node -g node /data /app/apps/web/node_modules/.vite-temp
ARG GIT_SHA
ENV NODE_ENV=production
ENV GIT_SHA=$GIT_SHA
# Container start must never wait on a DNS answer for the package manager. With the cache baked
# above this is a no-op; a miss fails immediately with a corepack error instead of a network hop.
ENV COREPACK_ENABLE_NETWORK=0
EXPOSE 3100 5173 7091
USER node
CMD ["pnpm", "--filter", "@rakazo/api", "start"]
