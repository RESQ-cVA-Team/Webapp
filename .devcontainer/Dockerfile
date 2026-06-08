FROM mcr.microsoft.com/devcontainers/typescript-node:1-22-bookworm

RUN corepack enable && corepack prepare pnpm@latest --activate

ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /workspace

COPY package.json pnpm-lock.yaml* ./

RUN pnpm install

SHELL ["/bin/bash", "-c"]
CMD ["sleep", "infinity"]