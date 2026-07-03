'use strict';

const config = require('../config');
const logger = require('../utils/logger');

/**
 * Publish search results to the 'processamento' queue.
 *
 * @param {object} channel - AMQP channel
 * @param {object} payload - The enriched result payload
 * @returns {Promise<boolean>} Whether the publish succeeded
 */
async function publishResult(channel, payload) {
  if (!channel) {
    logger.error('Cannot publish result: no RabbitMQ channel available');
    return false;
  }

  try {
    const buffer = Buffer.from(JSON.stringify(payload));

    const published = channel.sendToQueue(config.queues.processing, buffer, {
      persistent: true,
      contentType: 'application/json',
      headers: {
        traceId: payload.traceId || '',
        userId: payload.userId || '',
      },
    });

    if (!published) {
      // Channel buffer is full — backpressure
      logger.warn('RabbitMQ channel backpressure detected while publishing', {
        queue: config.queues.processing,
        traceId: payload.traceId,
      });
    }

    logger.debug('Published result to processing queue', {
      queue: config.queues.processing,
      traceId: payload.traceId,
      productsCount: payload.products ? payload.products.length : 0,
    });

    return published;
  } catch (err) {
    logger.error('Failed to publish result to processing queue', {
      error: err.message,
      queue: config.queues.processing,
      traceId: payload.traceId,
    });
    return false;
  }
}

module.exports = { publishResult };
