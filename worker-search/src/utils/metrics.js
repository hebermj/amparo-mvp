'use strict';

const promClient = require('prom-client');

// Collect default metrics (event loop lag, memory, etc.)
promClient.collectDefaultMetrics({ prefix: 'worker_search_' });

const httpRequestDuration = new promClient.Histogram({
  name: 'worker_search_http_request_duration_seconds',
  help: 'Duration of HTTP requests made by the service (internal server)',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

const searchLatency = new promClient.Histogram({
  name: 'worker_search_latency_seconds',
  help: 'Latency of SearXNG search queries',
  labelNames: ['query'],
  buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10],
});

const searchResultsCount = new promClient.Gauge({
  name: 'worker_search_results_count',
  help: 'Number of raw results returned by SearXNG',
  labelNames: ['query'],
});

const searchErrorsTotal = new promClient.Counter({
  name: 'worker_search_errors_total',
  help: 'Total number of search errors',
  labelNames: ['type'],
});

const searchesTotal = new promClient.Counter({
  name: 'worker_searches_total',
  help: 'Total number of search queries processed',
  labelNames: ['status'],
});

const rabbitmqMessagesTotal = new promClient.Counter({
  name: 'worker_search_rabbitmq_messages_total',
  help: 'Total RabbitMQ messages consumed',
  labelNames: ['queue', 'action'],
});

module.exports = {
  promClient,
  httpRequestDuration,
  searchLatency,
  searchResultsCount,
  searchErrorsTotal,
  searchesTotal,
  rabbitmqMessagesTotal,
};
