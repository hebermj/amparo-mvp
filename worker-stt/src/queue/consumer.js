'use strict';

const amqp = require('amqplib');
const config = require('../config');
const logger = require('../utils/logger').child('consumer');
const metrics = require('../utils/metrics');
const { downloadAudio } = require('../audio/downloader');
const { transcribe } = require('../audio/transcriber');
const { publishTranscription } = require('./producer');

/**
 * Consumer — conecta ao RabbitMQ e consome mensagens da fila 'transcricao'.
 *
 * Fluxo por mensagem:
 *   1. Ack → libera a fila imediatamente
 *   2. Valida payload JSON
 *   3. Baixa áudio da WhatsApp Media API
 *   4. Transcreve (whisper ou Google)
 *   5. Publica resultado no exchange 'amparo' (routing: transcricao.concluida)
 *   6. Atualiza métricas Prometheus
 *
 * Erros de parsing → nack sem requeue
 * Erros de processamento → nack com requeue até maxRetries
 */

class Consumer {
  constructor() {
    this.connection = null;
    this.channel = null;
    this.started = false;
    this.consumerTag = null;
  }

  /**
   * Conecta ao RabbitMQ, cria canal e começa a consumir.
   */
  async start() {
    if (this.started) {
      logger.warn('Consumer já está em execução');
      return;
    }

    const rabbitUrl = config.rabbitmq.url;
    logger.info('Conectando ao RabbitMQ', { url: rabbitUrl.replace(/\/\/.*@/, '//***@') });

    try {
      this.connection = await amqp.connect(rabbitUrl, {
        heartbeat: 60,
        timeout: 10000,
      });

      this.connection.on('error', (err) => {
        logger.error('Conexão RabbitMQ — erro', { error: err.message });
      });

      this.connection.on('close', () => {
        logger.warn('Conexão RabbitMQ — fechada');
        this.started = false;
        // Em produção: implementar reconexão com backoff
      });

      this.channel = await this.connection.createChannel();

      // Prefetch: processa uma mensagem por vez
      await this.channel.prefetch(config.rabbitmq.prefetch);

      // Garante que o exchange 'amparo' existe
      await this.channel.assertExchange('amparo', 'topic', {
        durable: true,
      });

      // Garante que a fila 'processamento' existe (onde vamos publicar)
      await this.channel.assertQueue(config.rabbitmq.queue.processamento, {
        durable: true,
      });

      // Vincula a fila 'processamento' ao exchange 'amparo'
      await this.channel.bindQueue(
        config.rabbitmq.queue.processamento,
        'amparo',
        'transcricao.concluida'
      );

      // Garante que a fila 'transcricao' existe (de onde vamos consumir)
      await this.channel.assertQueue(config.rabbitmq.queue.transcricao, {
        durable: true,
      });

      // Inicia consumo
      const consumeResult = await this.channel.consume(
        config.rabbitmq.queue.transcricao,
        this._handleMessage.bind(this),
        { noAck: false }  // manual ack/nack
      );

      this.consumerTag = consumeResult.consumerTag;
      this.started = true;

      logger.info('Consumer iniciado', {
        queue: config.rabbitmq.queue.transcricao,
        consumerTag: this.consumerTag,
        prefetch: config.rabbitmq.prefetch,
      });
    } catch (err) {
      logger.fatal('Falha ao iniciar consumer RabbitMQ', { error: err.message });
      throw err;
    }
  }

  /**
   * Handler principal para cada mensagem da fila 'transcricao'.
   */
  async _handleMessage(msg) {
    if (!msg || !msg.content) {
      logger.warn('Mensagem vazia recebida — ignorando');
      // Can't nack a null message; just return
      return;
    }

    const startTime = Date.now();
    let parsedMessage;

    // ── Parse ───────────────────────────────────────────────────
    try {
      parsedMessage = JSON.parse(msg.content.toString());
    } catch (parseErr) {
      logger.error('Erro ao fazer parse da mensagem — nack sem requeue', {
        error: parseErr.message,
        contentPreview: msg.content.toString().substring(0, 200),
      });
      // Erro de parsing: descarta sem requeue
      if (this.channel) {
        this.channel.nack(msg, false, false);
      }
      return;
    }

    const { messageId, mediaId } = parsedMessage;

    if (!messageId || !mediaId) {
      logger.error('Mensagem sem messageId ou mediaId — nack sem requeue', {
        parsedMessage,
      });
      if (this.channel) {
        this.channel.nack(msg, false, false);
      }
      return;
    }

    logger.info('Processando mensagem', { messageId, mediaId });

    try {
      // ── Download ──────────────────────────────────────────────
      const audioFilePath = await downloadAudio(mediaId, messageId);

      // ── Transcrição ───────────────────────────────────────────
      const { text, confidence } = await transcribe(audioFilePath);

      // ── Latência total (download + STT) ───────────────────────
      const totalLatency = (Date.now() - startTime) / 1000;

      // ── Publica resultado ─────────────────────────────────────
      await publishTranscription(this.channel, parsedMessage, {
        transcribedText: text,
        confidence,
        sttLatency: totalLatency,
      });

      // ── Ack (libera a fila) ───────────────────────────────────
      if (this.channel) {
        this.channel.ack(msg);
      }

      // ── Métricas ──────────────────────────────────────────────
      metrics.incrementMessagesProcessed();
      metrics.recordTranscription('success', config.stt.provider);
      metrics.recordLatency(totalLatency, config.stt.provider);
      metrics.recordConfidence(confidence, config.stt.provider);

      logger.info('Mensagem processada com sucesso', {
        messageId,
        textLength: text.length,
        confidence,
        totalLatency: `${totalLatency.toFixed(2)}s`,
      });
    } catch (err) {
      // ── Controle de retry via cabeçalho x-death ───────────────
      const deathHeaders = msg.properties.headers || {};
      const deaths = deathHeaders['x-death'] || [];
      const transcricaoDeaths = deaths.find(
        (d) => d.queue && d.queue.includes('transcricao')
      );
      const retryCount = transcricaoDeaths ? transcricaoDeaths.count : 0;
      const maxRetries = config.rabbitmq.maxRetries;

      logger.error('Erro no processamento da mensagem', {
        messageId,
        mediaId,
        error: err.message,
        retryCount,
        maxRetries,
      });

      metrics.recordTranscription('failure', config.stt.provider);

      if (retryCount < maxRetries) {
        // Requeue para nova tentativa
        logger.warn(`Reenfileirando mensagem (tentativa ${retryCount + 1}/${maxRetries})`, {
          messageId,
        });
        if (this.channel) {
          this.channel.nack(msg, false, true); // requeue = true
        }
      } else {
        // Esgotou retries → envia para DLQ
        logger.warn(`Mensagem excedeu retries (${maxRetries}) — enviando para DLQ`, {
          messageId,
        });
        if (this.channel) {
          this.channel.nack(msg, false, false); // requeue = false → vai para DLQ
        }
      }
    }
  }

  /**
   * Para o consumer graciosamente.
   */
  async stop() {
    logger.info('Parando consumer...');

    try {
      if (this.channel && this.consumerTag) {
        await this.channel.cancel(this.consumerTag);
        logger.debug('Consumer cancelado');
      }
      if (this.channel) {
        await this.channel.close();
        logger.debug('Canal AMQP fechado');
      }
      if (this.connection) {
        await this.connection.close();
        logger.debug('Conexão AMQP fechada');
      }
    } catch (err) {
      logger.error('Erro ao parar consumer', { error: err.message });
    }

    this.started = false;
    this.consumerTag = null;
    this.channel = null;
    this.connection = null;
  }
}

module.exports = Consumer;
