'use strict';

const http = require('http');
const config = require('./config');
const logger = require('./utils/logger');
const { promClient, rabbitmqConnected } = require('./utils/metrics');
const { startConsumer } = require('./queue/consumer');
const { getDeadLetterStats, startDlqMonitor } = require('./queue/dead-letter');

let server = null;
let consumerChannel = null;
let consumerConnection = null;

/**
 * Parse the request body as JSON.
 * @param {http.IncomingMessage} req
 * @returns {Promise<object>}
 */
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Send a JSON response.
 * @param {http.ServerResponse} res
 * @param {number} statusCode
 * @param {object} data
 */
function jsonResponse(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data) + '\n');
}

/**
 * Create and start the HTTP server for health checks and metrics.
 * @returns {http.Server}
 */
function createServer() {
  const srv = http.createServer(async (req, res) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    try {
      // ---- Health check ----
      if (url.pathname === '/health' && req.method === 'GET') {
        const healthStatus = {
          status: 'ok',
          service: config.serviceName,
          timestamp: new Date().toISOString(),
          rabbitmq: consumerConnection ? 'connected' : 'disconnected',
        };

        const statusCode = consumerConnection ? 200 : 503;
        return jsonResponse(res, statusCode, healthStatus);
      }

      // ---- Metrics ----
      if (url.pathname === '/metrics' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': promClient.register.contentType });
        res.end(await promClient.register.metrics());
        return;
      }

      // ---- DLQ stats ----
      if (url.pathname === '/dlq/stats' && req.method === 'GET') {
        const stats = await getDeadLetterStats();
        return jsonResponse(res, 200, stats);
      }

      // ---- 404 for everything else ----
      jsonResponse(res, 404, { error: 'Not found' });
    } catch (err) {
      logger.error('HTTP server error', { err, path: url.pathname });
      jsonResponse(res, 500, { error: 'Internal server error' });
    }
  });

  return srv;
}

/**
 * Gracefully shut down the service.
 */
async function shutdown(signal) {
  logger.info('Shutdown signal received', { signal });

  // Stop accepting new HTTP requests
  if (server) {
    server.close(() => {
      logger.info('HTTP server closed');
    });
  }

  // Close RabbitMQ consumer
  if (consumerChannel) {
    try {
      await consumerChannel.close();
      logger.info('RabbitMQ consumer channel closed');
    } catch (err) {
      logger.error('Error closing consumer channel', { err });
    }
  }

  if (consumerConnection) {
    try {
      await consumerConnection.close();
      logger.info('RabbitMQ connection closed');
    } catch (err) {
      logger.error('Error closing RabbitMQ connection', { err });
    }
  }

  rabbitmqConnected.set(0);

  logger.info('Shutdown complete');
  process.exit(0);
}

/**
 * Main entry point.
 */
async function main() {
  logger.info('Starting Worker-Sender service', {
    service: config.serviceName,
    port: config.server.port,
    rabbitmqQueue: config.rabbitmq.queue,
    rabbitmqDlq: config.rabbitmq.dlq,
  });

  // Validate required WhatsApp configuration
  if (!config.whatsapp.token) {
    logger.warn('WHATSAPP_TOKEN not configured — WhatsApp API calls will fail');
  }
  if (!config.whatsapp.phoneNumberId) {
    logger.warn('WHATSAPP_PHONE_NUMBER_ID not configured — WhatsApp API calls will fail');
  }

  try {
    // Start RabbitMQ consumer
    const { channel, connection } = await startConsumer();
    consumerChannel = channel;
    consumerConnection = connection;

    rabbitmqConnected.set(1);

    // Start DLQ monitor for observability
    await startDlqMonitor();
  } catch (err) {
    logger.error('Failed to start RabbitMQ consumer', { err });
    logger.warn('Service will start without RabbitMQ — health checks will reflect disconnected state');
    rabbitmqConnected.set(0);
  }

  // Start HTTP server
  server = createServer();

  server.listen(config.server.port, () => {
    logger.info('HTTP server listening', {
      port: config.server.port,
      endpoints: ['/health', '/metrics', '/dlq/stats'],
    });
  });

  // Register shutdown handlers
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Handle uncaught exceptions
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { err });
    // Give logger time to flush, then exit
    setTimeout(() => process.exit(1), 1000);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { err: reason instanceof Error ? reason : new Error(String(reason)) });
  });
}

main().catch((err) => {
  logger.error('Fatal startup error', { err });
  process.exit(1);
});
