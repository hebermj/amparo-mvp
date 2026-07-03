'use strict';

const path = require('path');

// Carrega .env da raiz do monorepo se existir
require('dotenv').config({
  path: path.resolve(__dirname, '..', '..', '..', '.env'),
});

const config = {
  env: process.env.NODE_ENV || 'development',

  // ── RabbitMQ ──────────────────────────────────────────────────
  rabbitmq: {
    url: process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672',
    queue: {
      transcricao: process.env.RABBITMQ_QUEUE_TRANSCRICAO || 'transcricao',
      processamento: process.env.RABBITMQ_QUEUE_PROCESSAMENTO || 'processamento',
    },
    prefetch: parseInt(process.env.RABBITMQ_PREFETCH || '1', 10),
    maxRetries: parseInt(process.env.STT_MAX_RETRIES || '3', 10),
  },

  // ── WhatsApp Business API ─────────────────────────────────────
  whatsapp: {
    token: process.env.WHATSAPP_TOKEN || '',
    apiUrl: process.env.WHATSAPP_API_URL || 'https://graph.facebook.com',
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v21.0',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
  },

  // ── STT Provider ──────────────────────────────────────────────
  stt: {
    provider: process.env.STT_PROVIDER || 'whisper',       // 'whisper' | 'google'
    whisperModel: process.env.WHISPER_MODEL || 'base',
    googleApiKey: process.env.GOOGLE_STT_API_KEY || '',
    language: process.env.STT_LANGUAGE || 'pt-BR',
  },

  // ── Servidor de Métricas ──────────────────────────────────────
  metrics: {
    port: parseInt(process.env.METRICS_PORT_STT || '9091', 10),
  },

  // ── Audio ─────────────────────────────────────────────────────
  audio: {
    tempDir: '/tmp/audio',
    maxSizeBytes: parseInt(process.env.STT_MAX_AUDIO_SIZE || '16777216', 10), // 16 MB
    downloadTimeout: parseInt(process.env.STT_DOWNLOAD_TIMEOUT || '30000', 10),
    retryDelayMs: parseInt(process.env.STT_RETRY_DELAY || '2000', 10),
  },
};

module.exports = config;
