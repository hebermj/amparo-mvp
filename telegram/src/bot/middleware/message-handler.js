'use strict';

const { v4: uuidv4 } = require('uuid');
const logger = require('../../utils/logger');
const { messagesReceived, processingLatency } = require('../../utils/metrics');
const producer = require('../../queue/producer');

/**
 * Processa uma mensagem de texto do Telegram e publica no RabbitMQ.
 */
async function handleText(ctx, producerChannel) {
  const startTime = Date.now();
  const chatId = String(ctx.chat.id);
  const text = ctx.message.text.trim();
  const messageId = ctx.message.message_id.toString();

  // Ignora comandos (são tratados separadamente)
  if (text.startsWith('/')) return;

  messagesReceived.inc({ type: 'text', chat_type: ctx.chat.type });

  logger.info('Mensagem de texto recebida', {
    chatId,
    messageId,
    textLength: text.length,
    chatType: ctx.chat.type,
  });

  const traceId = uuidv4();

  const payload = {
    type: 'text',
    from: chatId,
    messageId,
    timestamp: new Date().toISOString(),
    content: { text },
    traceId,
  };

  const published = await producer.publishMessage(producerChannel, payload, 'processamento');

  processingLatency.observe({ operation: 'handle_text' }, (Date.now() - startTime) / 1000);

  if (!published) {
    logger.error('Falha ao publicar mensagem de texto no RabbitMQ', { chatId, traceId });
  }
}

/**
 * Processa uma mensagem de áudio/voz do Telegram e publica na fila de transcrição.
 */
async function handleAudio(ctx, producerChannel) {
  const startTime = Date.now();
  const chatId = String(ctx.chat.id);
  const messageId = ctx.message.message_id.toString();

  // Telegram pode enviar voice, audio, ou document(ogg)
  const voice = ctx.message.voice;
  const audio = ctx.message.audio;
  const doc = ctx.message.document;

  const fileId = (voice && voice.file_id) || (audio && audio.file_id) || (doc && doc.file_id);
  const mimeType = (voice && voice.mime_type) || (audio && audio.mime_type) || (doc && doc.mime_type) || 'audio/ogg';

  if (!fileId) {
    logger.warn('Mensagem de áudio sem file_id', { chatId });
    return;
  }

  messagesReceived.inc({ type: 'audio', chat_type: ctx.chat.type });

  logger.info('Áudio recebido do Telegram', {
    chatId,
    messageId,
    fileId,
    mimeType,
    duration: voice ? voice.duration : null,
  });

  const traceId = uuidv4();

  const payload = {
    type: 'audio',
    from: chatId,
    messageId,
    timestamp: new Date().toISOString(),
    content: {
      fileId,
      mimeType,
      duration: voice ? voice.duration : audio ? audio.duration : null,
      fileSize: (voice && voice.file_size) || (audio && audio.file_size) || (doc && doc.file_size) || 0,
    },
    traceId,
  };

  const published = await producer.publishMessage(producerChannel, payload, 'transcricao');

  processingLatency.observe({ operation: 'handle_audio' }, (Date.now() - startTime) / 1000);

  if (!published) {
    logger.error('Falha ao publicar áudio no RabbitMQ', { chatId, traceId });
  }
}

/**
 * Roteia a mensagem para o handler apropriado baseado no tipo.
 */
async function routeMessage(ctx, producerChannel) {
  if (!ctx.message) return;

  // Texto puro (inclui comandos, que ignoramos)
  if (ctx.message.text) {
    return handleText(ctx, producerChannel);
  }

  // Voz / Áudio
  if (ctx.message.voice || ctx.message.audio) {
    return handleAudio(ctx, producerChannel);
  }

  // Documento de áudio (ex: .ogg enviado como arquivo)
  if (ctx.message.document && ctx.message.document.mime_type && ctx.message.document.mime_type.startsWith('audio/')) {
    return handleAudio(ctx, producerChannel);
  }

  // Outros tipos (foto, video, sticker) — avisar que não suportamos
  logger.info('Tipo de mensagem não suportado', {
    chatId: String(ctx.chat.id),
    messageType: Object.keys(ctx.message).join(','),
  });
}

module.exports = { routeMessage, handleText, handleAudio };
