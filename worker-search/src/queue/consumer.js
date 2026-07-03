'use strict';

const amqp = require('amqplib');
const config = require('../config');
const logger = require('../utils/logger');
const metrics = require('../utils/metrics');
const { search } = require('../search/client');
const { rank } = require('../search/ranker');
const { compare } = require('../search/comparator');
const { checkPriceSuspect } = require('../search/price-alert');
const { publishResult } = require('./producer');

let connection = null;
let channel = null;

/**
 * Process a single search message from the queue.
 */
async function processMessage(msg) {
  let parsed;
  try {
    parsed = JSON.parse(msg.content.toString());
  } catch (err) {
    logger.error('Failed to parse message JSON', {
      error: err.message,
      content: msg.content.toString().slice(0, 200),
    });
    // Dead-letter unparseable messages
    if (channel) {
      channel.nack(msg, false, false);
    }
    return;
  }

  const { query, traceId, userId, whatsappPhone = userId } = parsed;

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    logger.warn('Received message without valid query', { traceId, userId });
    if (channel) {
      channel.ack(msg);
    }
    return;
  }

  const extra = { traceId, userId };
  logger.info('Processing search query', { ...extra, query });

  const startTime = Date.now();

  try {
    // 1. Search via SearXNG
    const searchResult = await search(query, ['science', 'it', 'shopping']);

    // 2. Rank results
    const ranked = rank(searchResult.results, query);

    // 3. Compare products across stores
    const compared = compare(ranked);

    // 4. Flag suspicious prices
    const enrichedProducts = compared.map((group) => {
      const prices = group.stores
        .map((s) => s.price)
        .filter((p) => p !== null);

      const averagePrice =
        prices.length > 0
          ? prices.reduce((sum, p) => sum + p, 0) / prices.length
          : 0;

      const storesWithAlerts = group.stores.map((store) => {
        const alert = checkPriceSuspect(group.product, store.price, averagePrice);
        return { ...store, priceAlert: alert };
      });

      return {
        ...group,
        stores: storesWithAlerts,
        averagePrice,
      };
    });

    const processingTime = (Date.now() - startTime) / 1000;

    // 5. Publish enriched result back to orchestrator via 'processamento' queue
    //    Format: { type, results, query, traceId, whatsappPhone }
    const resultPayload = {
      type: 'search_result',
      traceId,
      userId,
      whatsappPhone,
      query,
      results: enrichedProducts.map((p) => ({
        title: p.product || p.title || 'Produto',
        price: p.averagePrice || 0,
        store: p.stores && p.stores[0] ? p.stores[0].name : 'Loja',
        source: 'searxng',
        stores: p.stores || [],
        averagePrice: p.averagePrice || 0,
        priceAlert: p.stores && p.stores[0] ? p.stores[0].priceAlert : null,
      })),
      rawResultCount: searchResult.results.length,
      rankedCount: ranked.length,
      processingTime: processingTime.toFixed(3) + 's',
      timestamp: new Date().toISOString(),
    };

    await publishResult(channel, resultPayload);
    metrics.rabbitmqMessagesTotal.inc({ queue: config.queues.processing, action: 'published' });

    // Ack the original message
    if (channel) {
      channel.ack(msg);
    }

    logger.info('Search query processed successfully', {
      ...extra,
      query,
      rawResultCount: searchResult.results.length,
      rankedCount: ranked.length,
      productGroups: enrichedProducts.length,
      processingTime: processingTime.toFixed(3) + 's',
    });
  } catch (err) {
    logger.error('Error processing search query', {
      ...extra,
      query,
      error: err.message,
      stack: err.stack,
    });

    metrics.searchErrorsTotal.inc({ type: 'processing_error' });

    // Nack without requeue → send to DLX/DLQ
    if (channel) {
      channel.nack(msg, false, false);
    }
  }
}

/**
 * Start consuming from the 'busca_lojas' queue.
 */
async function startConsumer() {
  const queue = config.queues.search;
  const dlxQueue = config.queues.dlx;

  connection = await amqp.connect(config.rabbitmq.url);
  channel = await connection.createChannel();

  // Set prefetch
  channel.prefetch(config.rabbitmq.prefetch);

  // Assert main queue (with DLX)
  await channel.assertQueue(queue, {
    durable: true,
    deadLetterExchange: `${queue}_dlx`,
    deadLetterRoutingKey: dlxQueue,
  });

  // Assert DLX and DLQ
  await channel.assertExchange(`${queue}_dlx`, 'direct', { durable: true });
  await channel.assertQueue(dlxQueue, { durable: true });
  await channel.bindQueue(dlxQueue, `${queue}_dlx`, dlxQueue);

  // Assert processing queue (where we publish results)
  await channel.assertQueue(config.queues.processing, { durable: true });

  // Start consuming
  await channel.consume(queue, processMessage, { noAck: false });

  logger.info('RabbitMQ consumer started', {
    queue,
    dlxQueue,
    processingQueue: config.queues.processing,
    prefetch: config.rabbitmq.prefetch,
  });

  // Handle connection close
  connection.on('close', () => {
    logger.error('RabbitMQ connection closed unexpectedly');
  });

  connection.on('error', (err) => {
    logger.error('RabbitMQ connection error', { error: err.message });
  });

  return { connection, channel };
}

/**
 * Stop the consumer and close connections.
 */
async function stopConsumer() {
  try {
    if (channel) {
      await channel.close();
      channel = null;
    }
    if (connection) {
      await connection.close();
      connection = null;
    }
    logger.info('RabbitMQ consumer stopped');
  } catch (err) {
    logger.error('Error stopping RabbitMQ consumer', { error: err.message });
  }
}

module.exports = { startConsumer, stopConsumer };
