'use strict';

const path = require('path');

// Carrega .env da raiz do monorepo, depois da pasta telegram/
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const config = {
  env: process.env.NODE_ENV || 'development',

  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    pollingTimeout: parseInt(process.env.TELEGRAM_POLLING_TIMEOUT || '30', 10),
    webhookUrl: process.env.TELEGRAM_WEBHOOK_URL || '',
    webhookPort: parseInt(process.env.PORT || '3005', 10),
    useWebhook: process.env.TELEGRAM_USE_WEBHOOK === 'true',
    allowedChatIds: (process.env.TELEGRAM_ALLOWED_CHAT_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },

  rabbitmq: {
    url: process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672',
    prefetch: parseInt(process.env.RABBITMQ_PREFETCH || '5', 10),
    queues: {
      transcricao: process.env.RABBITMQ_QUEUE_TRANSCRICAO || 'transcricao',
      processamento: process.env.RABBITMQ_QUEUE_PROCESSAMENTO || 'processamento',
      envio: process.env.RABBITMQ_QUEUE_ENVIO || 'envio',
    },
  },

  server: {
    port: parseInt(process.env.METRICS_PORT_TELEGRAM || '9095', 10),
  },
};

module.exports = config;
