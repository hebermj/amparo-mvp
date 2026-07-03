'use strict';

const http = require('http');
const config = require('./config');
const logger = require('./utils/logger');
const metrics = require('./utils/metrics');
const Consumer = require('./queue/consumer');

// ==================================================================
// Amparo MVP v2 — Worker STT
//
// Entry-point principal:
//   1. Conecta ao RabbitMQ e inicia o consumer da fila 'transcricao'
//   2. Expõe servidor HTTP com /metrics e /health na porta 9091
//   3. Graceful shutdown com captura de sinais
// ==================================================================

const consumer = new Consumer();

// ── Servidor HTTP de métricas e health check ─────────────────────
const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        service: 'worker-stt',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        consuming: consumer.started,
      }));
    } else if (req.url === '/metrics') {
      const metricsData = await metrics.getMetrics();
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(metricsData);
    } else {
      res.writeHead(404);
      res.end('Not Found');
    }
  } catch (err) {
    logger.error('Erro no servidor HTTP', { error: err.message, url: req.url });
    res.writeHead(500);
    res.end('Internal Server Error');
  }
});

// ── Inicialização ────────────────────────────────────────────────
async function main() {
  logger.info('Iniciando Worker STT', {
    env: config.env,
    sttProvider: config.stt.provider,
    whisperModel: config.stt.whisperModel,
    nodeVersion: process.version,
  });

  // Inicia servidor HTTP primeiro
  server.listen(config.metrics.port, () => {
    logger.info('Servidor HTTP de métricas iniciado', {
      port: config.metrics.port,
      endpoints: ['/health', '/metrics'],
    });
  });

  server.on('error', (err) => {
    logger.fatal('Erro no servidor HTTP', { error: err.message });
    process.exit(1);
  });

  // Conecta ao RabbitMQ e inicia consumer
  try {
    await consumer.start();
    logger.info('Worker STT pronto para processar');
  } catch (err) {
    logger.fatal('Falha ao iniciar consumer RabbitMQ', { error: err.message });
    process.exit(1);
  }
}

// ── Graceful Shutdown ─────────────────────────────────────────────
async function shutdown(signal) {
  logger.info(`Sinal ${signal} recebido — iniciando shutdown gracioso`);

  // Para de aceitar novas conexões
  server.close(() => {
    logger.debug('Servidor HTTP fechado');
  });

  // Para o consumer RabbitMQ
  try {
    await consumer.stop();
  } catch (err) {
    logger.error('Erro ao parar consumer', { error: err.message });
  }

  // Aguarda um momento para drenar operações pendentes
  await new Promise((resolve) => setTimeout(resolve, 1000));

  logger.info('Shutdown completo');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGQUIT', () => shutdown('SIGQUIT'));

// Captura exceções não tratadas
process.on('uncaughtException', (err) => {
  logger.fatal('Exceção não tratada', { error: err.message, stack: err.stack });
  shutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason) => {
  logger.error('Promise rejection não tratada', {
    error: reason instanceof Error ? reason.message : String(reason),
  });
});

// ── Executa ───────────────────────────────────────────────────────
main().catch((err) => {
  logger.fatal('Erro fatal na inicialização', { error: err.message, stack: err.stack });
  process.exit(1);
});
