FROM mcr.microsoft.com/devcontainers/typescript-node:1-22-bookworm@sha256:7c2e711a4f7b02f32d2da16192d5e05aa7c95279be4ce889cff5df316f251c1d

RUN corepack enable && corepack prepare pnpm@10.10.0 --activate

ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /workspace

RUN mkdir -p /workspace/node_modules /workspace/.pnpm-store \
	&& chown -R node:node /workspace

EXPOSE 3000

SHELL ["/bin/bash", "-c"]
CMD ["sleep", "infinity"]