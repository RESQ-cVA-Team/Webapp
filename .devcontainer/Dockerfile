FROM mcr.microsoft.com/devcontainers/typescript-node:1-22-bookworm

RUN corepack enable && corepack prepare pnpm@10.10.0 --activate

ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /workspace

RUN mkdir -p /workspace/node_modules /workspace/.pnpm-store \
	&& chown -R node:node /workspace

SHELL ["/bin/bash", "-c"]
CMD ["sleep", "infinity"]