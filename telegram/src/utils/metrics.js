'use strict';

const prometheus = require('prom-client');

// Coletas padrão
prometheus.collectDefaultMetrics({ prefix: 'amparo_telegram_' });

// Mensagens recebidas do Telegram (por tipo)
const messagesReceived = new prometheus.Counter({
  name: 'amparo_telegram_messages_received_total',
  help: 'Total de mensagens recebidas do Telegram',
  labelNames: ['type', 'chat_type'],
});

// Mensagens enviadas para o Telegram (por tipo + status)
const messagesSent = new prometheus.Counter({
  name: 'amparo_telegram_messages_sent_total',
  help: 'Total de mensagens enviadas para o Telegram',
  labelNames: ['type', 'status'],
});

// Mensagens publicadas no RabbitMQ (por fila)
const rabbitmqPublished = new prometheus.Counter({
  name: 'amparo_telegram_rabbitmq_published_total',
  help: 'Total de mensagens publicadas no RabbitMQ',
  labelNames: ['queue'],
});

// Mensagens consumidas do RabbitMQ (por fila + status)
const rabbitmqConsumed = new prometheus.Counter({
  name: 'amparo_telegram_rabbitmq_consumed_total',
  help: 'Total de mensagens consumidas do RabbitMQ',
  labelNames: ['queue', 'status'],
});

// Latência de processamento
const processingLatency = new prometheus.Histogram({
  name: 'amparo_telegram_processing_latency_seconds',
  help: 'Latência de processamento de mensagens',
  labelNames: ['operation'],
  buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10],
});

// Conexão RabbitMQ
const rabbitmqConnected = new prometheus.Gauge({
  name: 'amparo_telegram_rabbitmq_connected',
  help: '1 se conectado ao RabbitMQ, 0 se não',
});

module.exports = {
  messagesReceived,
  messagesSent,
  rabbitmqPublished,
  rabbitmqConsumed,
  processingLatency,
  rabbitmqConnected,
};
