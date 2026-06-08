FROM node:26-alpine@sha256:144769ec3f32e8ee36b3cfde91e82bee25d9367b20f31a151f3f7eea3a2a8541 AS builder

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml VERSION ./

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm build

FROM node:26-alpine@sha256:144769ec3f32e8ee36b3cfde91e82bee25d9367b20f31a151f3f7eea3a2a8541 AS runner

WORKDIR /app

ARG WEBAPP_VERSION=""
ARG WEBAPP_COMMIT_SHA=""
ARG WEBAPP_IMAGE_TAG=""
ARG WEBAPP_BUILD_DATE=""

RUN mkdir -p /app/.data && chown -R node:node /app

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

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
