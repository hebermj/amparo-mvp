'use strict';

const logger = require('../utils/logger');

/**
 * RabbitMQ message producer.
 * Publishes messages to the appropriate queues.
 */
class Producer {
  /**
   * @param {Object} channel - RabbitMQ channel
   * @param {Object} queues - Queue name mappings
   */
  constructor(channel, queues) {
    this.channel = channel;
    this.queues = queues;
  }

  /**
   * Publish a search request to the 'busca_lojas' queue.
   *
   * @param {Object} payload - { correlationId, query, limit, sessionId, timestamp }
   */
  async publishToSearch(payload) {
    try {
      await this._publish(this.queues.buscaLojas, payload);
      logger.debug('Published search request', {
        queue: this.queues.buscaLojas,
        correlationId: payload.correlationId,
        query: payload.query,
      });
    } catch (err) {
      logger.error('Failed to publish search request', {
        error: err.message,
        queue: this.queues.buscaLojas,
      });
      throw err;
    }
  }

  /**
   * Publish a response to the 'envio' queue to be sent to the user via WhatsApp.
   *
   * @param {Object} payload - { type, whatsappPhone, message, ... }
   */
  async publishToSend(payload) {
    try {
      await this._publish(this.queues.envio, payload);
      logger.debug('Published message to send', {
        queue: this.queues.envio,
        type: payload.type,
        whatsappPhone: payload.whatsappPhone,
      });
    } catch (err) {
      logger.error('Failed to publish send message', {
        error: err.message,
        queue: this.queues.envio,
      });
      throw err;
    }
  }

  /**
   * Publish a message to the 'processamento' queue (for re-processing with search results).
   *
   * @param {Object} payload
   */
  async publishToProcess(payload) {
    try {
      await this._publish(this.queues.processamento, payload);
      logger.debug('Published message to process', {
        queue: this.queues.processamento,
        type: payload.type,
      });
    } catch (err) {
      logger.error('Failed to publish process message', {
        error: err.message,
        queue: this.queues.processamento,
      });
      throw err;
    }
  }

  /**
   * Internal publish method.
   *
   * @param {string} queue - Queue name
   * @param {Object} payload - Message payload (will be JSON serialized)
   */
  async _publish(queue, payload) {
    const buffer = Buffer.from(JSON.stringify(payload));

    this.channel.sendToQueue(queue, buffer, {
      persistent: true,
      contentType: 'application/json',
    });
  }
}

module.exports = Producer;
