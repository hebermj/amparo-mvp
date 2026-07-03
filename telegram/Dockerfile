# syntax = docker/dockerfile:1.4
FROM node:20-alpine AS builder

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

FROM node:20-alpine
RUN apk add --no-cache tini
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY . .

RUN addgroup -S app && adduser -S app -G app
USER app

EXPOSE 9095
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:9095/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/index.js"]
