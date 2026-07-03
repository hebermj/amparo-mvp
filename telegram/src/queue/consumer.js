'use strict';

const amqp = require('amqplib');
const config = require('../config');
const logger = require('../utils/logger');
const { rabbitmqConsumed, rabbitmqConnected } = require('../utils/metrics');
const { fromAmparoButtons } = require('../bot/keyboard');

/**
 * Cria um delay.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Normaliza mensagem do formato do orchestrator para o formato do Telegram.
 *
 * Orchestrator envia (formato plano):
 *   { type, to, content: { text, buttons, link, caption, url }, traceId }
 *   // ou formato anti go: { type, whatsappPhone, message, buttons, link, traceId }
 *
 * @param {object} raw
 * @returns {{ chatId: string, type: string, text: string, extra: object }}
 */
function normalizeMessage(raw) {
  const chatId = raw.to || raw.whatsappPhone || raw.from;
  let content = raw.content || {};
  let text = content.text || content.body || raw.message || '';

  // Interactive: construir texto com header + body
  if (raw.type === 'interactive' && !text) {
    const parts = [];
    if (content.header) parts.push(`*${content.header}*`);
    if (content.body) parts.push(content.body);
    text = parts.join('\n\n');
  }

  // Link: formatar como texto com URL
  if (raw.type === 'link') {
    const url = content.url || (raw.link && raw.link.url) || '';
    const label = (raw.link && raw.link.label) || '';
    if (url) {
      text = text ? `${text}\n\n🔗 [${label || 'Acessar'}](${url})` : `🔗 [${label || 'Link'}](${url})`;
    }
    // Link vira mensagem de texto com Markdown
    return { chatId, type: 'text', text, extra: { parse_mode: 'Markdown' } };
  }

  // Image -> mandar como texto com legenda (não baixamos imagem)
  if (raw.type === 'image') {
    text = content.caption || text;
    return { chatId, type: 'text', text: text || '🖼️ Imagem recebida', extra: {} };
  }

  // Buttons: extrair do content ou do raw
  const buttons = content.buttons || raw.buttons || [];

  const extra = {};
  if (buttons.length > 0) {
    const tgKeyboard = fromAmparoButtons(buttons);
    if (tgKeyboard) {
      extra.reply_markup = tgKeyboard.reply_markup;
    }
  }

  return { chatId, type: raw.type, text, extra };
}

/**
 * Inicia o consumidor RabbitMQ que escuta a fila 'envio' e envia mensagens via bot Telegram.
 *
 * @param {object} bot - Instância do Telegraf
 * @returns {Promise<{channel: object, connection: object}>}
 */
async function startConsumer(bot) {
  const { url, prefetch } = config.rabbitmq;
  const queue = config.rabbitmq.queues.envio;
  const dlq = `${queue}_dlq`;

  logger.info('Conectando ao RabbitMQ (consumer)', {
    url: url.replace(/\/\/.*@/, '//***@'),
  });

  const connection = await amqp.connect(url);

  connection.on('error', (err) => {
    logger.error('Erro na conexão RabbitMQ (consumer)', { error: err.message });
  });

  connection.on('close', () => {
    logger.warn('Conexão RabbitMQ (consumer) fechada');
    rabbitmqConnected.set(0);
  });

  const channel = await connection.createChannel();
  await channel.prefetch(prefetch);

  // Garantir que as filas existem
  await channel.assertQueue(queue, { durable: true });
  await channel.assertQueue(dlq, { durable: true });

  rabbitmqConnected.set(1);
  logger.info('Consumidor RabbitMQ iniciado', { queue, dlq, prefetch });

  channel.consume(queue, async (msg) => {
    if (!msg) {
      logger.warn('Mensagem nula recebida do RabbitMQ');
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(msg.content.toString());
    } catch (err) {
      logger.error('Erro ao fazer parse da mensagem', { error: err.message });
      // Envia para DLQ
      await channel.sendToQueue(
        dlq,
        Buffer.from(JSON.stringify({
          originalContent: msg.content.toString(),
          failureReason: 'parse_error',
          failureDetail: err.message,
        })),
        { persistent: true }
      );
      channel.ack(msg);
      return;
    }

    const { chatId, type, text, extra } = normalizeMessage(parsed);

    if (!chatId) {
      logger.warn('Mensagem sem chatId — ignorando', { raw: parsed });
      channel.ack(msg);
      return;
    }

    // Tenta enviar com retry
    const maxRetries = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (text) {
          await bot.telegram.sendMessage(chatId, text, {
            parse_mode: extra.parse_mode || 'Markdown',
            ...(extra.reply_markup ? { reply_markup: extra.reply_markup } : {}),
            disable_web_page_preview: false,
          });
        } else {
          // Mensagem vazia: envia um placeholder
          await bot.telegram.sendMessage(chatId, '✅');
        }

        rabbitmqConsumed.inc({ queue, status: 'success' });
        logger.info('Mensagem enviada via Telegram', {
          chatId,
          messageType: type,
          textLength: text.length,
          hasButtons: !!extra.reply_markup,
          attempt,
        });

        channel.ack(msg);
        return;
      } catch (err) {
        lastError = err;
        logger.warn('Falha ao enviar mensagem via Telegram', {
          chatId,
          messageType: type,
          attempt,
          error: err.message,
        });

        if (attempt < maxRetries) {
          const backoff = 2000 * Math.pow(2, attempt - 1);
          await sleep(backoff);
        }
      }
    }

    // Todas as tentativas falharam → DLQ
    logger.error('Todas as tentativas de envio falharam — DLQ', {
      chatId,
      messageType: type,
      error: lastError ? lastError.message : 'unknown',
    });

    await channel.sendToQueue(
      dlq,
      Buffer.from(JSON.stringify({
        originalMessage: parsed,
        failureReason: 'max_retries_exceeded',
        failureDetail: lastError ? lastError.message : 'Unknown error',
        retryCount: maxRetries,
      })),
      { persistent: true }
    );

    rabbitmqConsumed.inc({ queue, status: 'dlq' });
    channel.ack(msg);
  });

  return { channel, connection };
}

module.exports = { startConsumer };
