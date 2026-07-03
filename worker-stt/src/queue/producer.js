'use strict';

const logger = require('../utils/logger').child('producer');
const metrics = require('../utils/metrics');
const config = require('../config');

/**
 * Producer — publica mensagens no exchange 'amparo' (topic) com
 * routing key 'transcricao.concluida' para a fila 'processamento'.
 *
 * A mensagem original é enriquecida com os dados da transcrição.
 */

/**
 * Publica o resultado da transcrição na fila de processamento.
 *
 * @param {object} channel  — Canal AMQP já conectado
 * @param {object} originalMsg — Mensagem original recebida da fila 'transcricao'
 * @param {object} transcriptionResult — { transcribedText, confidence, sttLatency }
 * @returns {Promise<boolean>} — true se publicado com sucesso
 */
async function publishTranscription(channel, originalMsg, transcriptionResult) {
  const { transcribedText, confidence, sttLatency } = transcriptionResult;

  // Mensagem enriquecida
  const enriched = {
    ...originalMsg,
    transcribedText,
    confidence,
    sttLatency,
    sttCompletedAt: new Date().toISOString(),
    sttProvider: config.stt.provider,
  };

  const payload = Buffer.from(JSON.stringify(enriched));

  try {
    const published = channel.publish(
      'amparo',                        // exchange
      'transcricao.concluida',         // routing key
      payload,
      {
        persistent: true,
        contentType: 'application/json',
        timestamp: Math.floor(Date.now() / 1000),
        messageId: `stt-${originalMsg.messageId || Date.now()}-${Date.now()}`,
      }
    );

    if (!published) {
      // channel buffer cheio — aguarda dreno
      await new Promise((resolve) => channel.once('drain', resolve));
    }

    logger.info('Transcrição publicada na fila processamento', {
      messageId: originalMsg.messageId,
      textLength: transcribedText.length,
      confidence,
      sttLatency,
      routingKey: 'transcricao.concluida',
    });

    return true;
  } catch (err) {
    logger.error('Erro ao publicar transcrição', {
      messageId: originalMsg.messageId,
      error: err.message,
    });
    throw err;
  }
}

module.exports = { publishTranscription };
