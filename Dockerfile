# ---- builder ----
FROM node:20-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build
RUN npm prune --omit=dev

# ---- production ----
FROM node:20-slim AS production
WORKDIR /app

COPY --from=builder /app/dist/ ./dist/
COPY --from=builder /app/node_modules/ ./node_modules/
COPY --from=builder /app/package.json ./

ENV PORT=41242
EXPOSE 41242

# --import loads telemetry.js before the ES module graph so the OTEL SDK
# can patch Node.js internals (http, net) before any other module runs.
# This is required for ESM projects ("type":"module") where import hoisting
# would otherwise prevent SDK registration.
CMD ["node", "--import", "./dist/telemetry.js", "dist/index.js"]

# Node 20 native fetch() avoids a curl dependency and works in ESM
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||'41242')+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Drop to non-root after all COPY/RUN steps are done
USER node

LABEL org.opencontainers.image.title="coding-agent-a2a" \
      org.opencontainers.image.description="A2A + MCP server that wraps coding-agent CLIs (Cursor, Claude Code, Vibe, Codex, OpenCode)" \
      org.opencontainers.image.source="https://github.com/carstendev/coding-agent-a2a" \
      org.opencontainers.image.licenses="MIT"
