'use strict';

require('dotenv').config();

const config = {
  serviceName: process.env.SERVICE_NAME || 'worker-sender',

  rabbitmq: {
    url: process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672',
    prefetch: parseInt(process.env.RABBITMQ_PREFETCH, 10) || 5,
    retryDelayMs: parseInt(process.env.RABBITMQ_RETRY_DELAY_MS, 10) || 5000,
    maxRetries: parseInt(process.env.RABBITMQ_MAX_RETRIES, 10) || 10,
    queue: process.env.QUEUE_ENVIO || 'envio',
    dlq: process.env.QUEUE_ENVIO_DLQ || 'envio_dlq',
  },

  whatsapp: {
    token: process.env.WHATSAPP_TOKEN || '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    apiUrl: process.env.WHATSAPP_API_URL || 'https://graph.facebook.com',
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v18.0',
    requestTimeoutMs: parseInt(process.env.WHATSAPP_REQUEST_TIMEOUT_MS, 10) || 15000,
  },

  server: {
    port: parseInt(process.env.PORT, 10) || 9094,
  },

  sender: {
    maxRetries: parseInt(process.env.SENDER_MAX_RETRIES, 10) || 3,
    retryBackoffBaseMs: parseInt(process.env.SENDER_RETRY_BACKOFF_BASE_MS, 10) || 2000,
  },
};

module.exports = config;
