import express from 'express';
import prometheus from 'prom-client';
import config from './config/index.js';
import logger from './utils/logger.js';
import webhookRouter from './webhook/router.js';
import { connect as connectQueue, close as closeQueue } from './queue/producer.js';

// ── Prometheus metrics ────────────────────────────────────────────────────
const httpRequestsTotal = new prometheus.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'path', 'status'],
});

const httpRequestDurationSeconds = new prometheus.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'path', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

// ── Express app setup ─────────────────────────────────────────────────────
const app = express();

// Expose the WhatsApp token so the validator can access it
app.locals.whatsappToken = config.whatsappToken;

// Raw body parser — needed for HMAC signature validation.
// We store the raw body on req.rawBody before the JSON parser consumes it.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString('utf8');
    },
  })
);

// HTTP metrics middleware
app.use((req, res, next) => {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationNs = Number(process.hrtime.bigint() - start);
    const durationSec = durationNs / 1e9;

    httpRequestsTotal.inc({
      method: req.method,
      path: req.route?.path || req.path,
      status: res.statusCode,
    });

    httpRequestDurationSeconds.observe(
      {
        method: req.method,
        path: req.route?.path || req.path,
        status: res.statusCode,
      },
      durationSec
    );
  });

  next();
});

// ── Routes ────────────────────────────────────────────────────────────────

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: config.serviceName,
    timestamp: new Date().toISOString(),
  });
});

// Prometheus metrics endpoint
app.get('/metrics', async (_req, res) => {
  try {
    res.set('Content-Type', prometheus.register.contentType);
    const metrics = await prometheus.register.metrics();
    res.end(metrics);
  } catch (err) {
    logger.error('Failed to generate metrics', { error: err.message });
    res.status(500).end();
  }
});

// Webhook router at /webhook/whatsapp
app.use('/webhook', webhookRouter);

// ── Startup ───────────────────────────────────────────────────────────────
async function start() {
  // Connect to RabbitMQ
  try {
    await connectQueue(config.rabbitmqUrl);
  } catch (err) {
    logger.error('Initial RabbitMQ connection failed — starting without queue', {
      error: err.message,
    });
    // The server can still start; messages will fail to publish until
    // the queue becomes available.
  }

  app.listen(config.port, () => {
    logger.info(`Gateway started`, {
      port: config.port,
      service: config.serviceName,
      env: config.nodeEnv,
    });
  });
}

// ── Graceful shutdown ─────────────────────────────────────────────────────
async function shutdown(signal) {
  logger.info(`Received ${signal} — shutting down gracefully`);

  // Give in-flight requests up to 10 seconds to finish
  const shutdownTimer = setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000);

  shutdownTimer.unref();

  try {
    await closeQueue();
    logger.info('Queue connection closed');
  } catch (err) {
    logger.error('Error closing queue connection', { error: err.message });
  }

  // Allow the process to exit naturally
  clearTimeout(shutdownTimer);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ── Unhandled rejections / exceptions ─────────────────────────────────────
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', {
    error: reason instanceof Error ? reason.message : String(reason),
  });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

// ── Start the server ──────────────────────────────────────────────────────
start();
