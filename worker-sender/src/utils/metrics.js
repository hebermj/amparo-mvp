'use strict';

const promClient = require('prom-client');

// Collect default metrics (event loop lag, memory, etc.)
promClient.collectDefaultMetrics({ prefix: 'worker_sender_' });

// Counter for messages sent via WhatsApp API
const messagesSentTotal = new promClient.Counter({
  name: 'worker_sender_messages_sent_total',
  help: 'Total number of WhatsApp messages sent',
  labelNames: ['type', 'status'],
});

// Histogram for send latency
const sendLatencySeconds = new promClient.Histogram({
  name: 'worker_sender_send_latency_seconds',
  help: 'Latency of WhatsApp API send requests',
  labelNames: ['type'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

// Counter for messages routed to DLQ
const dlqMessagesTotal = new promClient.Counter({
  name: 'worker_sender_dlq_messages_total',
  help: 'Total number of messages sent to the dead-letter queue',
  labelNames: ['reason'],
});

// Counter for retry attempts
const retryAttemptsTotal = new promClient.Counter({
  name: 'worker_sender_retry_attempts_total',
  help: 'Total number of retry attempts for failed sends',
  labelNames: ['type'],
});

// Gauge for RabbitMQ connection status
const rabbitmqConnected = new promClient.Gauge({
  name: 'worker_sender_rabbitmq_connected',
  help: 'RabbitMQ connection status (1 = connected, 0 = disconnected)',
});

module.exports = {
  promClient,
  messagesSentTotal,
  sendLatencySeconds,
  dlqMessagesTotal,
  retryAttemptsTotal,
  rabbitmqConnected,
};
