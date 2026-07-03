# Stage 1: Install dependencies
FROM node:20-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# Stage 2: Runtime image
FROM node:20-alpine

RUN apk add --no-cache tini

WORKDIR /app

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN chown -R appuser:appgroup /app

USER appuser

EXPOSE 9094

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:9094/health', r => { process.exit(r.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/index.js"]
