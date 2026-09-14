FROM node:22-alpine@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920 AS builder

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml VERSION ./

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm build

FROM node:22-alpine@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920 AS runner

WORKDIR /app

# OS packages get security patches independently of the pinned image tag.
RUN apk --no-cache upgrade

ARG WEBAPP_VERSION=""
ARG WEBAPP_COMMIT_SHA=""
ARG WEBAPP_IMAGE_TAG=""
ARG WEBAPP_BUILD_DATE=""

RUN mkdir -p /app/.data && chown -R node:node /app && chmod 700 /app/.data

# The runtime entrypoint below is just `node server.js` -- npm/npx/corepack
# (bundled into the node:22-alpine base image for the builder stage's own
# use) are never invoked here, but their vendored dependencies (tar, pacote,
# sigstore, and others) still ship in the final image and accumulate CVEs
# nothing can ever reach.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/src/shared/SSOT ./src/shared/SSOT

ENV WEBAPP_VERSION=${WEBAPP_VERSION}
ENV WEBAPP_COMMIT_SHA=${WEBAPP_COMMIT_SHA}
ENV WEBAPP_IMAGE_TAG=${WEBAPP_IMAGE_TAG}
ENV WEBAPP_BUILD_DATE=${WEBAPP_BUILD_DATE}

LABEL org.opencontainers.image.version=${WEBAPP_VERSION}
LABEL org.opencontainers.image.revision=${WEBAPP_COMMIT_SHA}
LABEL org.opencontainers.image.created=${WEBAPP_BUILD_DATE}

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV FEEDBACK_LOCAL_STORE_PATH=/app/.data/feedback-store.json

ENV HOSTNAME=0.0.0.0
EXPOSE 3000

USER node

CMD ["node", "server.js"]
