'use strict';

const amqp = require('amqplib');
const config = require('../config');
const logger = require('../utils/logger');
const { dlqMessagesTotal } = require('../utils/metrics');

/**
 * DLQ handler for the Worker-Sender service.
 * Provides methods to inspect, log, and replay dead-letter messages.
 */

let dlqChannel = null;
let dlqConnection = null;
let dlqMessageCount = 0;

/**
 * Ensure the DLQ channel is connected.
 * Reuses existing connection if available.
 *
 * @returns {Promise<object>} - The channel object
 */
async function ensureConnection() {
  if (dlqChannel && dlqConnection) {
    return dlqChannel;
  }

  const connection = await amqp.connect(config.rabbitmq.url);
  connection.on('error', (err) => {
    logger.error('DLQ consumer connection error', { err });
  });
  connection.on('close', () => {
    logger.warn('DLQ consumer connection closed');
    dlqChannel = null;
    dlqConnection = null;
  });

  const channel = await connection.createChannel();
  await channel.assertQueue(config.rabbitmq.dlq, { durable: true });

  dlqConnection = connection;
  dlqChannel = channel;
  return channel;
}

/**
 * Inspect and log a dead-letter message.
 * Fetches a single message from the DLQ without acknowledging it.
 *
 * @returns {Promise<object|null>} - The parsed message info or null if no messages
 */
async function inspectDeadLetter() {
  try {
    const channel = await ensureConnection();
    const msg = await channel.get(config.rabbitmq.dlq, { noAck: false });

    if (!msg) {
      return null;
    }

    const parsedContent = JSON.parse(msg.content.toString());
    const headers = msg.properties?.headers || {};

    const messageInfo = {
      content: parsedContent,
      headers,
      fields: msg.fields,
      redelivered: msg.properties?.redelivered || false,
      timestamp: new Date().toISOString(),
    };

    // Don't ack — leave it in the queue for inspection
    channel.nack(msg, false, true);

    logger.warn('Inspected dead-letter message', {
      traceId: parsedContent.traceId || headers['x-original-trace-id'] || 'unknown',
      failureReason: headers['x-failure-reason'] || 'unknown',
      failureDetail: headers['x-failure-detail'] || 'none',
      messageType: parsedContent.type,
    });

    return messageInfo;
  } catch (err) {
    logger.error('Failed to inspect dead-letter message', { err });
    return null;
  }
}

/**
 * Get statistics about the DLQ.
 *
 * @returns {Promise<{queue: string, messageCount: number, consumerCount: number}>}
 */
async function getDeadLetterStats() {
  try {
    const channel = await ensureConnection();
    const queueInfo = await channel.checkQueue(config.rabbitmq.dlq);

    dlqMessageCount = queueInfo.messageCount;

    return {
      queue: config.rabbitmq.dlq,
      messageCount: queueInfo.messageCount,
      consumerCount: queueInfo.consumerCount,
    };
  } catch (err) {
    logger.error('Failed to get DLQ stats', { err });
    return {
      queue: config.rabbitmq.dlq,
      messageCount: dlqMessageCount,
      consumerCount: 0,
      error: err.message,
    };
  }
}

/**
 * Replay a DLQ message by re-publishing it back to the original queue.
 * Fetches one message from the DLQ and publishes it to 'envio'.
 *
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function replayMessage() {
  try {
    const channel = await ensureConnection();
    const msg = await channel.get(config.rabbitmq.dlq, { noAck: false });

    if (!msg) {
      return {
        success: false,
        error: 'No messages in DLQ to replay',
      };
    }

    const headers = msg.properties?.headers || {};
    const originalQueue = headers['x-original-routing-key'] || config.rabbitmq.queue;

    // Re-publish to the original queue
    await channel.publish('', originalQueue, msg.content, {
      persistent: true,
      headers: {
        ...headers,
        'x-replayed-at': new Date().toISOString(),
      },
    });

    // Ack from DLQ
    channel.ack(msg);

    const parsedContent = JSON.parse(msg.content.toString());

    logger.info('Replayed DLQ message to original queue', {
      traceId: parsedContent.traceId || headers['x-original-trace-id'] || 'unknown',
      originalQueue,
      failureReason: headers['x-failure-reason'] || 'unknown',
    });

    return { success: true };
  } catch (err) {
    logger.error('Failed to replay DLQ message', { err });
    return {
      success: false,
      error: err.message || 'Unknown error replaying message',
    };
  }
}

/**
 * Start a consumer that logs all DLQ messages (for observability).
 *
 * @returns {Promise<void>}
 */
async function startDlqMonitor() {
  try {
    const channel = await ensureConnection();

    await channel.consume(config.rabbitmq.dlq, (msg) => {
      if (!msg) return;

      try {
        const parsedContent = JSON.parse(msg.content.toString());
        const headers = msg.properties?.headers || {};

        logger.error('Dead-letter message received', {
          traceId: parsedContent.traceId || headers['x-original-trace-id'] || 'unknown',
          messageType: parsedContent.type,
          failureReason: headers['x-failure-reason'] || 'unknown',
          failureDetail: headers['x-failure-detail'] || 'none',
        });

        dlqMessagesTotal.inc({ reason: headers['x-failure-reason'] || 'unknown' });
      } catch (parseErr) {
        logger.error('Failed to parse DLQ message', { err: parseErr });
      }

      // Nack and requeue so the message stays in DLQ
      channel.nack(msg, false, true);
    });

    logger.info('DLQ monitor started', { queue: config.rabbitmq.dlq });
  } catch (err) {
    logger.error('Failed to start DLQ monitor', { err });
  }
}

/**
 * Clean up DLQ connection.
 */
async function close() {
  if (dlqChannel) {
    try {
      await dlqChannel.close();
    } catch (_) {
      // ignore
    }
    dlqChannel = null;
  }
  if (dlqConnection) {
    try {
      await dlqConnection.close();
    } catch (_) {
      // ignore
    }
    dlqConnection = null;
  }
}

module.exports = {
  inspectDeadLetter,
  getDeadLetterStats,
  replayMessage,
  startDlqMonitor,
  close,
};
