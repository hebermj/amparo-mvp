'use strict';

const amqp = require('amqplib');
const config = require('../config');
const logger = require('../utils/logger');
const { sendLatencySeconds } = require('../utils/metrics');
const { sendText } = require('../sender/text');
const { sendButtons } = require('../sender/interactive');
const { sendImage } = require('../sender/image');
const { sendLink } = require('../sender/link');

/**
 * Create a delay promise.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Normalize incoming message to the sender's internal format.
 *
 * The orchestrator and tools may send messages in a flat format:
 *   { type, whatsappPhone, message, buttons, link, caption, imageLink, traceId }
 *
 * The sender functions expect:
 *   { type, to, content: { text/previewUrl/link/header/body/buttons } }
 *
 * @param {object} msg - Raw message from queue
 * @returns {object} Normalized message
 */
function normalizeMessage(msg) {
  const { type, traceId } = msg;

  // Extract destination: 'to' or 'whatsappPhone' or 'from'
  const to = msg.to || msg.whatsappPhone || msg.from;

  let content = msg.content;

  // If content is not already structured, build from flat fields
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    content = {};
  }

  // If flat message (orchestrator format), build content wrapper
  if (msg.message && !content.text) {
    content.text = msg.message;
  }
  if (msg.previewUrl !== undefined && content.previewUrl === undefined) {
    content.previewUrl = msg.previewUrl;
  }
  if (msg.buttons && !content.buttons) {
    content.buttons = msg.buttons;
  }
  if (msg.link && !content.url) {
    content.url = msg.link.url || msg.link;
    content.body = content.body || content.text;
  }
  if (msg.caption && !content.caption) {
    content.caption = msg.caption;
  }
  if (msg.imageLink && !content.link) {
    content.link = msg.imageLink;
  }
  if (msg.header && !content.header) {
    content.header = msg.header;
  }

  return { type, to, content, traceId };
}

/**
 * Route an incoming message to the appropriate sender based on its type.
 *
 * @param {object} msg - Parsed/normalized message from the queue
 * @returns {Promise<{success: boolean, messageId: string|null, timestamp: string|null, error?: string}>}
 */
async function routeMessage(rawMsg) {
  const msg = normalizeMessage(rawMsg);
  const { type, to, content } = msg;

  switch (type) {
    case 'text': {
      const text = content.text || content.body || '';
      const previewUrl = content.previewUrl || false;
      return sendText(to, text, previewUrl);
    }

    case 'interactive': {
      const header = content.header || '';
      const body = content.body || content.text || '';
      const buttons = content.buttons || [];
      return sendButtons(to, header, body, buttons);
    }

    case 'image': {
      const link = content.link || '';
      const caption = content.caption || '';
      return sendImage(to, link, caption);
    }

    case 'link': {
      const url = content.url || '';
      const body = content.body || content.text || '';
      return sendLink(to, url, body);
    }

    default:
      return {
        success: false,
        messageId: null,
        timestamp: null,
        error: `Unknown message type: ${type}`,
      };
  }
}

/**
 * Start consuming messages from the 'envio' queue.
 *
 * @returns {Promise<{channel: object, connection: object}>}
 */
async function startConsumer() {
  const { url, prefetch, queue } = config.rabbitmq;

  logger.info('Connecting to RabbitMQ', { url: url.replace(/\/\/.*@/, '//***@') });

  const connection = await amqp.connect(url);

  connection.on('error', (err) => {
    logger.error('RabbitMQ connection error', { err });
  });

  connection.on('close', () => {
    logger.warn('RabbitMQ connection closed');
  });

  const channel = await connection.createChannel();

  // Set prefetch for fair dispatch
  await channel.prefetch(prefetch);

  // Assert the main queue (should already exist, but idempotent)
  await channel.assertQueue(queue, {
    durable: true,
    deadLetterExchange: '', // Default exchange
    deadLetterRoutingKey: config.rabbitmq.dlq,
  });

  // Assert the DLQ
  await channel.assertQueue(config.rabbitmq.dlq, {
    durable: true,
  });

  logger.info('Starting consumer on queue', { queue, prefetch });

  channel.consume(queue, async (msg) => {
    if (!msg) {
      logger.warn('Received null message from queue');
      return;
    }

    let parsed;
    const traceId = msg.properties?.correlationId || msg.properties?.messageId || 'unknown';
    let retryCount = 0;

    try {
      parsed = JSON.parse(msg.content.toString());
    } catch (parseErr) {
      logger.error('Failed to parse queue message', {
        traceId,
        err: parseErr,
        rawContent: msg.content.toString().substring(0, 500),
      });
      // Cannot process; send to DLQ using sendToQueue
      const dlqPayload = {
        originalContent: msg.content.toString(),
        failureReason: 'parse_error',
        failureDetail: parseErr.message,
        originalTraceId: traceId,
      };
      await channel.sendToQueue(config.rabbitmq.dlq, Buffer.from(JSON.stringify(dlqPayload)), {
        persistent: true,
      });
      channel.ack(msg);
      return;
    }

    parsed.traceId = parsed.traceId || traceId;

    // Retry loop with exponential backoff
    for (let attempt = 1; attempt <= config.sender.maxRetries; attempt++) {
      const result = await routeMessage(parsed);

      if (result.success) {
        // Success — ack and log
        logger.info('Message sent successfully', {
          traceId: parsed.traceId,
          messageType: parsed.type,
          messageId: result.messageId,
          attempt,
        });

        channel.ack(msg);
        return;
      }

      // Failure — decide next step
      const isFinalAttempt = attempt >= config.sender.maxRetries;

      logger.warn('Message send failed', {
        traceId: parsed.traceId,
        messageType: parsed.type,
        attempt,
        maxRetries: config.sender.maxRetries,
        isFinalAttempt,
        error: result.error,
      });

      if (isFinalAttempt) {
        // All retries exhausted — publish to DLQ
        logger.error('All retries exhausted, sending to DLQ', {
          traceId: parsed.traceId,
          messageType: parsed.type,
          error: result.error,
        });

        const dlqPayload = {
          originalMessage: parsed,
          failureReason: 'max_retries_exceeded',
          failureDetail: result.error || 'Unknown error',
          retryCount: attempt,
          originalTraceId: parsed.traceId,
        };

        await channel.sendToQueue(config.rabbitmq.dlq, Buffer.from(JSON.stringify(dlqPayload)), {
          persistent: true,
        });

        // Track DLQ metric
        const { dlqMessagesTotal, retryAttemptsTotal } = require('../utils/metrics');
        dlqMessagesTotal.inc({ reason: 'max_retries_exceeded' });
        retryAttemptsTotal.inc({ type: parsed.type });

        channel.ack(msg);
        return;
      }

      // Exponential backoff before next retry
      const backoffMs = config.sender.retryBackoffBaseMs * Math.pow(2, attempt - 1);
      logger.debug('Waiting before retry', {
        traceId: parsed.traceId,
        attempt,
        backoffMs,
      });

      await sleep(backoffMs);
    }
  });

  logger.info('Consumer started successfully', { queue });

  return { channel, connection };
}

module.exports = { startConsumer };
