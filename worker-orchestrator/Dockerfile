# ====================================================================
# Amparo MVP v2 — Worker-Orchestrator (LLM Gateway + Agent)
# node:20-alpine multi-stage build
# ====================================================================

FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache \
    python3 \
    build-base \
    curl \
    ca-certificates \
    && rm -rf /var/cache/apk/*

COPY package.json ./
RUN npm install --production && \
    npm cache clean --force

# ── Production stage ────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache \
    curl \
    ca-certificates \
    && rm -rf /var/cache/apk/*

COPY --from=builder /app/node_modules ./node_modules

COPY package.json ./
COPY src/ ./src/

# Metrics / health check port
EXPOSE 9092

HEALTHCHECK --interval=15s --timeout=5s --start-period=45s --retries=3 \
    CMD curl -f http://localhost:9092/health || exit 1

USER node

CMD ["node", "src/index.js"]
