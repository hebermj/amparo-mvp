# ====================================================================
# Amparo MVP v2 — Worker STT (Speech-to-Text)
# node:20-alpine base com suporte a whisper.cpp nativo
# ====================================================================

FROM node:20-alpine AS builder

WORKDIR /app

# Dependências do sistema para compilação nativa (whisper.cpp)
RUN apk add --no-cache \
    python3 \
    build-base \
    cmake \
    git \
    curl \
    && rm -rf /var/cache/apk/*

# Copiar manifests e instalar dependências
COPY package.json ./
RUN npm install --production && \
    npm cache clean --force

# ── Estágio de produção ────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Apenas as libs runtime necessárias (sem toolchain de build)
RUN apk add --no-cache \
    python3 \
    curl \
    ca-certificates \
    && rm -rf /var/cache/apk/*

# Copiar node_modules do estágio builder
COPY --from=builder /app/node_modules ./node_modules

# Copiar código fonte
COPY package.json ./
COPY src/ ./src/

# Porta de métricas / health check
EXPOSE 9091

# Criar diretório temporário para áudios baixados
RUN mkdir -p /tmp/audio && chmod 777 /tmp/audio

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:9091/health || exit 1

USER node

CMD ["node", "src/index.js"]
