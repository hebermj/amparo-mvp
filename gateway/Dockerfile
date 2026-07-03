# === Stage 1: Install dependencies ===
FROM node:20-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json* ./

RUN npm ci --omit=dev && \
    npm cache clean --force

# === Stage 2: Production image ===
FROM node:20-alpine AS runner

WORKDIR /app

RUN addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 appuser

COPY --from=deps /app/node_modules ./node_modules
COPY src/ ./src/
COPY package.json ./

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

USER appuser

ENV NODE_ENV=production

CMD ["node", "src/index.js"]
