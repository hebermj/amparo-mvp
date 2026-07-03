'use strict';

const http = require('http');
const amqp = require('amqplib');
const config = require('./config');
const logger = require('./utils/logger');
const metrics = require('./utils/metrics');
const { createBot } = require('./bot');
const { startConsumer } = require('./queue/consumer');

let botInstance = null;
let consumerChannel = null;
let consumerConnection = null;
let httpServer = null;

/**
 * Inicializa conexão RabbitMQ para o producer (publicar mensagens do Telegram para as filas).
 */
async function connectProducer() {
  const conn = await amqp.connect(config.rabbitmq.url);
  const ch = await conn.createChannel();

  // Garantir que as filas de destino existem
  await ch.assertQueue(config.rabbitmq.queues.processamento, { durable: true });
  await ch.assertQueue(config.rabbitmq.queues.transcricao, { durable: true });

  conn.on('error', (err) => {
    logger.error('Erro na conexão RabbitMQ (producer)', { error: err.message });
  });
  conn.on('close', () => {
    logger.warn('Conexão RabbitMQ (producer) fechada');
    metrics.rabbitmqConnected.set(0);
  });

  metrics.rabbitmqConnected.set(1);
  logger.info('Conexão RabbitMQ (producer) estabelecida');
  metrics.rabbitmqConnected.set(1);

  return { connection: conn, channel: ch };
}

/**
 * Cria servidor HTTP para health check e métricas.
 */
function createHttpServer() {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');

    if (req.url === '/health' || req.url === '/') {
      res.writeHead(200);
      res.end(JSON.stringify({
        status: 'ok',
        service: 'amparo-telegram',
        uptime: process.uptime(),
        rabbitmq: consumerChannel ? 'connected' : 'disconnected',
        bot: botInstance ? 'running' : 'stopped',
      }));
    } else if (req.url === '/metrics') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(await metrics.register.metrics());
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  });

  return server;
}

/**
 * Handler de desligamento gracioso.
 */
async function shutdown(signal) {
  logger.info(`Sinal ${signal} recebido — desligando graciosamente...`);

  // Para o bot Telegram
  if (botInstance) {
    botInstance.stop(signal);
    logger.info('Bot Telegram parado');
  }

  // Fecha consumer RabbitMQ
  if (consumerChannel) {
    await consumerChannel.close().catch(() => {});
  }
  if (consumerConnection) {
    await consumerConnection.close().catch(() => {});
    logger.info('Consumer RabbitMQ desconectado');
  }

  // Fecha servidor HTTP
  if (httpServer) {
    await new Promise((resolve) => httpServer.close(resolve));
    logger.info('Servidor HTTP encerrado');
  }

  logger.info('Desligamento completo');
  process.exit(0);
}

/**
 * Ponto de entrada principal.
 */
async function main() {
  logger.info('=== Amparo Telegram Bot — Iniciando ===', {
    nodeVersion: process.version,
    env: config.env,
  });

  // 1. Conecta RabbitMQ (producer — para enviar mensagens recebidas)
  const producer = await connectProducer();

  // 2. Cria e inicia o bot Telegram
  botInstance = await createBot(config, producer.channel);

  // 3. Inicia consumer RabbitMQ (consome da fila 'envio' e envia via bot)
  const consumer = await startConsumer(botInstance);
  consumerChannel = consumer.channel;
  consumerConnection = consumer.connection;

  // 4. Servidor HTTP (health + metrics)
  httpServer = createHttpServer();
  httpServer.listen(config.server.port, () => {
    logger.info('Servidor HTTP ouvindo', { port: config.server.port });
  });

  // 5. Handlers de desligamento
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    logger.error('Exceção não tratada', { error: err.message, stack: err.stack });
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('Rejeição não tratada', { error: reason && reason.message ? reason.message : String(reason) });
  });

  logger.info('=== Amparo Telegram Bot — Iniciado com sucesso ===');

  // Mantém o processo vivo
  await new Promise(() => {});
}

main().catch((err) => {
  logger.error('Erro fatal na inicialização', { error: err.message, stack: err.stack });
  process.exit(1);
});
