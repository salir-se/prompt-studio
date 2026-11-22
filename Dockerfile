# syntax=docker/dockerfile:1.7
# Prompt Studio container image: the standalone server plus the built editor, as a single bundle.
#
#   docker run --rm -p 127.0.0.1:5273:5273 \
#     -v "$PWD":/repo -v prompt-studio-data:/home/bun \
#     ghcr.io/salir-se/prompt-studio
#
# Then open http://127.0.0.1:5273 and choose Open project with the path /repo.

FROM oven/bun:1.4.4 AS builder
WORKDIR /src
COPY package.json bun.lock bunfig.toml ./
COPY packages ./packages
RUN bun install --frozen-lockfile --ignore-scripts
COPY . .
RUN bun run build \
 && bun build server/main.ts --target=bun --format=esm --outfile /out/server/main.js \
 && bun build cli/main.ts --target=bun --format=esm --outfile /out/cli/main.js \
 && bun build packages/mcp-server/src/index.ts --target=bun --format=esm --outfile /out/mcp/main.js \
 && cp -r dist /out/dist \
 && mkdir -p /manifest \
 && cp src/manifest/default.manifest.json /manifest/manifest.json \
 && cp LICENSE NOTICE /out/

FROM oven/bun:1.4.4-alpine AS runtime
WORKDIR /app
COPY --from=builder --chown=bun:bun /out/ ./
# The server's baked-manifest location (src/manifest/resolve-manifest.ts BAKED_MANIFEST_PATH).
COPY --from=builder /manifest/manifest.json /studio-manifest/manifest.json

# Inside the container the server must listen on all interfaces so Docker can forward the port.
# Publish it on loopback only (`-p 127.0.0.1:5273:5273`): the page embeds the per-launch token,
# so a port published on every interface exposes the open project to the network.
ENV STUDIO_REPO_ROOT=/repo \
    STUDIO_HOST=0.0.0.0 \
    STUDIO_PORT=5273 \
    STUDIO_STATIC_DIR=./dist \
    STUDIO_ALLOWED_ORIGINS=http://127.0.0.1:5273,http://localhost:5273

LABEL org.opencontainers.image.title="Prompt Studio" \
      org.opencontainers.image.description="A local editor for prompt projects: write, run, evaluate, version, and open GitHub pull requests." \
      org.opencontainers.image.source="https://github.com/salir-se/prompt-studio" \
      org.opencontainers.image.documentation="https://github.com/salir-se/prompt-studio#run-with-docker" \
      org.opencontainers.image.licenses="Apache-2.0"

# 5274: the optional MCP server (`docker exec … bun mcp/main.js`, or a second container with CMD overridden).
EXPOSE 5273 5274
USER bun
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5273/health > /dev/null || exit 1
CMD ["bun", "server/main.js"]
