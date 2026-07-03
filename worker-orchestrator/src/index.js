'use strict';

const http = require('http');
const amqp = require('amqplib');
const Redis = require('ioredis');
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const config = require('./config');
const logger = require('./utils/logger');
const metrics = require('./utils/metrics');

// LLM Infrastructure
const DeepSeekProvider = require('./llm/providers/deepseek');
const ClaudeProvider = require('./llm/providers/claude');
const OpenAIProvider = require('./llm/providers/openai');
const LLMCache = require('./llm/cache');
const CircuitBreaker = require('./llm/circuit-breaker');
const LLMGateway = require('./llm/gateway');
const TokenCounter = require('./llm/token-counter');

// Agent
const SessionManager = require('./agent/session');
const SearchTool = require('./agent/tools/search');
const ProfileTool = require('./agent/tools/profile');
const ConsentTool = require('./agent/tools/consent');
const ConfirmTool = require('./agent/tools/confirm');
const CheckoutTool = require('./agent/tools/checkout');

// Queue
const Producer = require('./queue/producer');
const Consumer = require('./queue/consumer');

// ── Main Application ─────────────────────────────────────────────────
class OrchestratorApp {
  constructor() {
    this.connections = {
      rabbitmq: null,
      redis: null,
      pg: null,
    };
    this.channels = {};
    this.httpServer = null;
    this.shuttingDown = false;
  }

  async start() {
    logger.info('Starting Worker-Orchestrator', {
      nodeEnv: config.nodeEnv,
      port: config.port,
      primaryProvider: config.llm.primaryProvider,
    });

    try {
      // 1. Connect to infrastructure
      await this._connectRedis();
      await this._connectPostgres();
      await this._connectRabbitMQ();

      // 2. Initialize LLM providers
      const providers = this._initProviders();

      // 3. Initialize LLM infrastructure
      const cache = new LLMCache(this.connections.redis, config.llm.cacheTtlSeconds);
      const tokenCounter = new TokenCounter();

      const circuitBreakerPrimary = new CircuitBreaker(config.llm.primaryProvider, {
        threshold: config.llm.circuitBreakerThreshold,
        windowMs: config.llm.circuitBreakerWindowMs,
        autoResetMs: config.llm.circuitBreakerAutoResetMs,
      });
      const circuitBreakerFallback = new CircuitBreaker(config.llm.fallbackProvider, {
        threshold: config.llm.circuitBreakerThreshold,
        windowMs: config.llm.circuitBreakerWindowMs,
        autoResetMs: config.llm.circuitBreakerAutoResetMs,
      });
      const circuitBreakerSecondary = new CircuitBreaker(config.llm.secondaryFallbackProvider, {
        threshold: config.llm.circuitBreakerThreshold,
        windowMs: config.llm.circuitBreakerWindowMs,
        autoResetMs: config.llm.circuitBreakerAutoResetMs,
      });

      // 4. Initialize LLM Gateway
      const llmGateway = new LLMGateway({
        primaryProvider: providers.primary,
        fallbackProvider: providers.fallback,
        secondaryFallbackProvider: providers.secondaryFallback,
        cache,
        circuitBreakerPrimary,
        circuitBreakerFallback,
        circuitBreakerSecondary,
        tokenCounter,
      });

      // 5. Initialize session manager
      const sessionManager = new SessionManager(this.connections.redis);

      // 6. Initialize tools
      const producer = new Producer(this.channels.main, config.rabbitmq.queues);
      const searchTool = new SearchTool(producer);
      const profileTool = new ProfileTool(this.connections.pg, config.encryptionKey);
      const consentTool = new ConsentTool(this.connections.redis);
      const confirmTool = new ConfirmTool(producer);
      const checkoutTool = new CheckoutTool(this.connections.pg);

      // 7. Read system prompt
      const systemPrompt = this._readSystemPrompt();

      // 8. Start consumer
      const consumer = new Consumer({
        channel: this.channels.main,
        queues: config.rabbitmq.queues,
        llmGateway,
        sessionManager,
        producer,
        searchTool,
        profileTool,
        consentTool,
        confirmTool,
        checkoutTool,
        systemPrompt,
        pgClient: this.connections.pg,
      });

      await consumer.start();

      // 9. Start HTTP health/metrics server
      this._startHttpServer(llmGateway);

      logger.info('Worker-Orchestrator started successfully', {
        port: config.port,
        queues: config.rabbitmq.queues,
      });
    } catch (err) {
      logger.error('Failed to start Worker-Orchestrator', { error: err.message, stack: err.stack });
      await this.shutdown(1);
    }
  }

  /**
   * Connect to Redis.
   */
  async _connectRedis() {
    logger.info('Connecting to Redis', { host: config.redis.host, port: config.redis.port });

    const redis = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      retryStrategy: (times) => {
        const delay = Math.min(times * 100, 3000);
        logger.warn('Redis reconnection attempt', { attempt: times, delay });
        return delay;
      },
      maxRetriesPerRequest: 3,
    });

    redis.on('connect', () => logger.info('Redis connected'));
    redis.on('error', (err) => logger.error('Redis error', { error: err.message }));
    redis.on('close', () => logger.warn('Redis connection closed'));

    // Wait for initial connection
    await redis.ping();
    this.connections.redis = redis;
    logger.info('Redis connection established');
  }

  /**
   * Connect to PostgreSQL.
   */
  async _connectPostgres() {
    logger.info('Connecting to PostgreSQL', { host: config.database.host });

    const pg = new Pool({
      connectionString: config.database.url,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    pg.on('error', (err) => logger.error('PostgreSQL pool error', { error: err.message }));

    // Verify connection
    const client = await pg.connect();
    await client.query('SELECT 1');
    client.release();

    this.connections.pg = pg;
    logger.info('PostgreSQL connection established');
  }

  /**
   * Connect to RabbitMQ and create channels.
   */
  async _connectRabbitMQ() {
    logger.info('Connecting to RabbitMQ');

    const connection = await amqp.connect(config.rabbitmq.url, {
      heartbeat: 60,
      retry: true,
    });

    connection.on('error', (err) => logger.error('RabbitMQ connection error', { error: err.message }));
    connection.on('close', () => logger.warn('RabbitMQ connection closed'));

    const mainChannel = await connection.createChannel();

    // Assert all queues exist
    const queues = Object.values(config.rabbitmq.queues);
    for (const queue of queues) {
      const dlqName = `${queue}_dlq`;
      await mainChannel.assertQueue(queue, {
        durable: true,
        deadLetterExchange: '',
        deadLetterRoutingKey: dlqName,
      });
      // Also assert the DLQ so it exists
      await mainChannel.assertQueue(dlqName, {
        durable: true,
      });
      logger.debug('Queue asserted', { queue });
    }

    this.connections.rabbitmq = connection;
    this.channels.main = mainChannel;
    logger.info('RabbitMQ connection established');
  }

  /**
   * Initialize LLM providers.
   */
  _initProviders() {
    const primary = this._createProvider(config.llm.primaryProvider);
    const fallback = this._createProvider(config.llm.fallbackProvider);
    const secondaryFallback = this._createProvider(config.llm.secondaryFallbackProvider);

    return { primary, fallback, secondaryFallback };
  }

  /**
   * Create a provider by name.
   */
  _createProvider(name) {
    switch (name) {
      case 'deepseek':
        return new DeepSeekProvider(config.deepseek);
      case 'claude':
        return new ClaudeProvider(config.claude);
      case 'openai':
        return new OpenAIProvider(config.openai);
      default:
        logger.warn('Unknown provider, defaulting to DeepSeek', { provider: name });
        return new DeepSeekProvider(config.deepseek);
    }
  }

  /**
   * Read the system prompt from the markdown file.
   */
  _readSystemPrompt() {
    const promptPath = path.resolve(__dirname, 'prompts', 'system.md');
    try {
      return fs.readFileSync(promptPath, 'utf8').trim();
    } catch (err) {
      logger.warn('Could not read system prompt file, using default', { error: err.message });
      return 'Você é o Amparo, um assistente de compras virtual amigável e paciente.';
    }
  }

  /**
   * Start the HTTP server for health check and metrics.
   */
  _startHttpServer(llmGateway) {
    this.httpServer = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const pathname = url.pathname;

      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'healthy',
          service: 'worker-orchestrator',
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          circuitBreakers: llmGateway.getCircuitBreakerStates(),
        }));
      } else if (pathname === '/metrics') {
        res.writeHead(200, { 'Content-Type': metrics.promClient.register.contentType });
        res.end(await metrics.promClient.register.metrics());
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    });

    this.httpServer.listen(config.port, '0.0.0.0', () => {
      logger.info('HTTP server listening', { port: config.port });
    });

    this.httpServer.on('error', (err) => {
      logger.error('HTTP server error', { error: err.message });
    });
  }

  /**
   * Graceful shutdown.
   */
  async shutdown(exitCode = 0) {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    logger.info('Shutting down Worker-Orchestrator...');

    // Close HTTP server
    if (this.httpServer) {
      await new Promise((resolve) => this.httpServer.close(resolve));
      logger.info('HTTP server closed');
    }

    // Close RabbitMQ
    if (this.connections.rabbitmq) {
      try {
        await this.connections.rabbitmq.close();
        logger.info('RabbitMQ connection closed');
      } catch (err) {
        logger.warn('Error closing RabbitMQ', { error: err.message });
      }
    }

    // Close PostgreSQL pool
    if (this.connections.pg) {
      try {
        await this.connections.pg.end();
        logger.info('PostgreSQL pool closed');
      } catch (err) {
        logger.warn('Error closing PostgreSQL', { error: err.message });
      }
    }

    // Close Redis
    if (this.connections.redis) {
      try {
        await this.connections.redis.quit();
        logger.info('Redis connection closed');
      } catch (err) {
        logger.warn('Error closing Redis', { error: err.message });
      }
    }

    logger.info('Shutdown complete');
    process.exit(exitCode);
  }
}

// ── Bootstrap ────────────────────────────────────────────────────────
const app = new OrchestratorApp();

// Handle process signals
process.on('SIGTERM', () => {
  logger.info('Received SIGTERM signal');
  app.shutdown(0);
});

process.on('SIGINT', () => {
  logger.info('Received SIGINT signal');
  app.shutdown(0);
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  app.shutdown(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason: String(reason) });
  app.shutdown(1);
});

// Start
app.start().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});

module.exports = app;
