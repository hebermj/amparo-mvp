'use strict';

const logger = require('../utils/logger');
const { rabbitmqPublished } = require('../utils/metrics');

/**
 * Publica uma mensagem na fila RabbitMQ apropriada.
 *
 * @param {object} channel - Canal RabbitMQ
 * @param {object} payload - Payload da mensagem (type, from, content, traceId)
 * @param {string} routingKey - Nome da fila de destino (processamento|transcricao)
 * @returns {Promise<boolean>}
 */
async function publishMessage(channel, payload, routingKey) {
  if (!channel) {
    logger.error('publishMessage: canal RabbitMQ não disponível');
    return false;
  }

  const buffer = Buffer.from(JSON.stringify(payload));

  try {
    const published = channel.sendToQueue(routingKey, buffer, {
      persistent: true,
      contentType: 'application/json',
    });

    if (published) {
      rabbitmqPublished.inc({ queue: routingKey });
      logger.debug('Mensagem publicada no RabbitMQ', {
        queue: routingKey,
        messageType: payload.type,
        traceId: payload.traceId,
        from: payload.from,
      });
    } else {
      logger.warn('Mensagem não enfileirada (buffer cheio?)', {
        queue: routingKey,
        traceId: payload.traceId,
      });
    }

    return published;
  } catch (err) {
    logger.error('Erro ao publicar mensagem no RabbitMQ', {
      error: err.message,
      queue: routingKey,
      traceId: payload.traceId,
    });
    return false;
  }
}

module.exports = { publishMessage };
