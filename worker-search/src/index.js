'use strict';

const express = require('express');
const config = require('./config');
const logger = require('./utils/logger');
const metrics = require('./utils/metrics');
const { startConsumer, stopConsumer } = require('./queue/consumer');

let server = null;

/**
 * Create and start the HTTP health/metrics server.
 */
function startHttpServer() {
  const app = express();

  // Health endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      service: config.serviceName,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // Prometheus metrics endpoint
  app.get('/metrics', async (req, res) => {
    try {
      res.set('Content-Type', metrics.promClient.register.contentType);
      res.end(await metrics.promClient.register.metrics());
    } catch (err) {
      logger.error('Failed to generate metrics', { error: err.message });
      res.status(500).json({ error: 'Failed to generate metrics' });
    }
  });

  // Readiness endpoint
  app.get('/ready', (req, res) => {
    res.json({
      status: 'ok',
      service: config.serviceName,
      ready: true,
    });
  });

  return new Promise((resolve, reject) => {
    server = app.listen(config.server.port, () => {
      logger.info('HTTP server started', {
        port: config.server.port,
        service: config.serviceName,
      });
      resolve(server);
    });

    server.on('error', (err) => {
      logger.error('Failed to start HTTP server', { error: err.message });
      reject(err);
    });
  });
}

/**
 * Graceful shutdown handler.
 */
async function shutdown(signal) {
  logger.info(`Received ${signal}, starting graceful shutdown`);

  // Stop HTTP server
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    logger.info('HTTP server stopped');
  }

  // Stop RabbitMQ consumer
  await stopConsumer();

  logger.info('Graceful shutdown complete');
  process.exit(0);
}

/**
 * Main entry point.
 */
async function main() {
  logger.info('Starting Worker-Search service', {
    service: config.serviceName,
    version: '1.0.0',
  });

  try {
    // Start HTTP server first (for health checks)
    await startHttpServer();

    // Start RabbitMQ consumer
    await startConsumer();

    logger.info('Worker-Search service started successfully', {
      port: config.server.port,
      rabbitmqUrl: config.rabbitmq.url.replace(/\/\/.*@/, '//***@'),
      searxngUrl: config.searxng.url,
    });
  } catch (err) {
    logger.error('Failed to start Worker-Search service', {
      error: err.message,
      stack: err.stack,
    });
    process.exit(1);
  }

  // Register shutdown handlers
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { error: err.message, stack: err.stack });
    shutdown('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { error: reason && reason.message ? reason.message : String(reason) });
  });
}

main();
