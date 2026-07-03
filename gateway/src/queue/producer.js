import amqplib from 'amqplib';
import logger from '../utils/logger.js';

// Queue names — usando sendToQueue (direct) em vez de exchange publish
// para consistência com o resto do sistema
const QUEUE_PROCESSAMENTO = 'processamento';
const QUEUE_TRANSCRICAO = 'transcricao';

let connection = null;
let channel = null;

/**
 * Connect to RabbitMQ, create a channel, and assert queues.
 *
 * @param {string} url - RabbitMQ connection URL
 */
export async function connect(url) {
  try {
    connection = await amqplib.connect(url);
    channel = await connection.createChannel();

    // Assert queues (must exist before publishing)
    await channel.assertQueue(QUEUE_TRANSCRICAO, { durable: true });
    await channel.assertQueue(QUEUE_PROCESSAMENTO, { durable: true });

    logger.info('Connected to RabbitMQ and queues asserted', {
      queues: [QUEUE_TRANSCRICAO, QUEUE_PROCESSAMENTO],
    });

    // When the connection drops unexpectedly try to reconnect
    connection.on('close', () => {
      logger.warn('RabbitMQ connection closed');
      connection = null;
      channel = null;
    });

    connection.on('error', (err) => {
      logger.error('RabbitMQ connection error', { error: err.message });
    });
  } catch (err) {
    logger.error('Failed to connect to RabbitMQ', { error: err.message });
    throw err;
  }
}

/**
 * Publish a parsed text-style message to the 'processamento' queue via sendToQueue.
 *
 * @param {object} parsedMsg - Parsed message from parser.parseMessage()
 * @param {string} [traceId] - Optional trace ID for observability
 * @returns {boolean} true if published successfully
 */
export async function publishTextMessage(parsedMsg, traceId = '') {
  if (!channel) {
    logger.error('publishTextMessage: no RabbitMQ channel available');
    return false;
  }

  const payload = {
    type: parsedMsg.type,
    from: parsedMsg.from,
    messageId: parsedMsg.messageId,
    timestamp: parsedMsg.timestamp,
    content: parsedMsg.content,
    traceId: traceId || undefined,
  };

  try {
    const buffer = Buffer.from(JSON.stringify(payload));
    const published = channel.sendToQueue(QUEUE_PROCESSAMENTO, buffer, {
      persistent: true,
      contentType: 'application/json',
    });

    if (published) {
      logger.debug('Published message to processamento', {
        messageId: payload.messageId,
        from: payload.from,
        traceId: payload.traceId,
      });
    } else {
      logger.warn('Message not queued (channel write buffer full?)', {
        messageId: payload.messageId,
      });
    }

    return published;
  } catch (err) {
    logger.error('Failed to publish text message', {
      error: err.message,
      messageId: parsedMsg.messageId,
    });
    return false;
  }
}

/**
 * Publish a parsed audio-style message to the 'transcricao' queue via sendToQueue.
 *
 * @param {object} parsedMsg - Parsed message from parser.parseMessage()
 * @param {string} [traceId] - Optional trace ID for observability
 * @returns {boolean} true if published successfully
 */
export async function publishAudioMessage(parsedMsg, traceId = '') {
  if (!channel) {
    logger.error('publishAudioMessage: no RabbitMQ channel available');
    return false;
  }

  const payload = {
    type: parsedMsg.type,
    from: parsedMsg.from,
    messageId: parsedMsg.messageId,
    timestamp: parsedMsg.timestamp,
    content: parsedMsg.content,
    traceId: traceId || undefined,
  };

  try {
    const buffer = Buffer.from(JSON.stringify(payload));
    const published = channel.sendToQueue(QUEUE_TRANSCRICAO, buffer, {
      persistent: true,
      contentType: 'application/json',
    });

    if (published) {
      logger.debug('Published message to transcricao', {
        messageId: payload.messageId,
        from: payload.from,
        traceId: payload.traceId,
      });
    } else {
      logger.warn('Message not queued (channel write buffer full?)', {
        messageId: payload.messageId,
      });
    }

    return published;
  } catch (err) {
    logger.error('Failed to publish audio message', {
      error: err.message,
      messageId: parsedMsg.messageId,
    });
    return false;
  }
}

/**
 * Close the RabbitMQ connection gracefully.
 */
export async function close() {
  try {
    if (channel) {
      await channel.close();
      channel = null;
    }
    if (connection) {
      await connection.close();
      connection = null;
    }
    logger.info('RabbitMQ connection closed');
  } catch (err) {
    logger.error('Error closing RabbitMQ connection', { error: err.message });
  }
}

export default { connect, publishTextMessage, publishAudioMessage, close };
