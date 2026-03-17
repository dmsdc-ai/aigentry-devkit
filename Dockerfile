FROM node:20-bookworm-slim

ARG AIGENTRY_DEVKIT_VERSION=0.0.5

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl git jq tmux \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g "@dmsdc-ai/aigentry-devkit@${AIGENTRY_DEVKIT_VERSION}"

ENV HOME=/root
WORKDIR /workspace

ENTRYPOINT ["aigentry-devkit"]
CMD ["--help"]
