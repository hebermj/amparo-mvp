'use strict';

require('dotenv').config();

const config = {
  serviceName: process.env.SERVICE_NAME || 'worker-search',

  rabbitmq: {
    url: process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672',
    prefetch: parseInt(process.env.RABBITMQ_PREFETCH, 10) || 5,
    retryDelayMs: parseInt(process.env.RABBITMQ_RETRY_DELAY_MS, 10) || 5000,
    maxRetries: parseInt(process.env.RABBITMQ_MAX_RETRIES, 10) || 10,
  },

  searxng: {
    url: process.env.SEARXNG_URL || 'http://localhost:8888',
    timeoutMs: parseInt(process.env.SEARXNG_TIMEOUT_MS, 10) || 5000,
    maxRetries: parseInt(process.env.SEARXNG_MAX_RETRIES, 10) || 2,
    retryBackoffMs: parseInt(process.env.SEARXNG_RETRY_BACKOFF_MS, 10) || 1000,
  },

  server: {
    port: parseInt(process.env.PORT, 10) || 9093,
  },

  queues: {
    search: process.env.QUEUE_SEARCH || 'busca_lojas',
    processing: process.env.QUEUE_PROCESSING || 'processamento',
    dlx: process.env.QUEUE_DLX || 'busca_lojas_dlx',
  },

  ranking: {
    topN: parseInt(process.env.RANKING_TOP_N, 10) || 3,
  },
};

module.exports = config;
