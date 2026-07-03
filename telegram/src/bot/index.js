'use strict';

const { Telegraf } = require('telegraf');
const logger = require('../utils/logger');
const producer = require('../queue/producer');
const { routeMessage } = require('./middleware/message-handler');

/**
 * Cria e configura a instância do bot Telegram.
 *
 * @param {object} config - Configuração do Telegram (token, etc.)
 * @param {object} amqpChannel - Canal RabbitMQ para publicar mensagens
 * @returns {Promise<Telegraf>}
 */
async function createBot(config, amqpChannel) {
  const { token, allowedChatIds, useWebhook, webhookUrl } = config.telegram;

  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN não configurado. Crie um bot com @BotFather e defina a env var.');
  }

  const bot = new Telegraf(token);

  // ── Middleware global: log de erros ──────────────────────────────
  bot.catch((err, ctx) => {
    logger.error('Erro no bot Telegram', {
      error: err.message,
      updateType: ctx.updateType,
      chatId: ctx.chat ? ctx.chat.id : 'unknown',
    });
  });

  // ── Filtro de chat IDs autorizados ──────────────────────────────
  if (allowedChatIds.length > 0) {
    bot.use((ctx, next) => {
      const chatId = ctx.chat ? String(ctx.chat.id) : '';
      if (allowedChatIds.includes(chatId)) {
        return next();
      }
      // Chat não autorizado: ignora silenciosamente
      logger.warn('Chat não autorizado ignorado', { chatId });
      return;
    });
  }

  // ── Comando /start ──────────────────────────────────────────────
  bot.start(async (ctx) => {
    const name = ctx.from.first_name || 'usuário';
    await ctx.reply(
      `👋 Olá, *${name}!*\n\n` +
      `Eu sou o *Amparo* — seu assistente de compras inteligente. 🛒\n\n` +
      `Posso ajudar você a:\n` +
      `• 🔍 Buscar produtos em várias lojas\n` +
      `• 💰 Comparar preços e ofertas\n` +
      `• 📦 Gerar links de checkout\n\n` +
      `*Como usar:*\n` +
      `É só me mandar o nome do produto que você quer! ✨\n\n` +
      `Exemplos:\n` +
      `» "iPhone 15"\n` +
      `» "smart TV 55 4K"\n` +
      `» "fone de ouvido Bluetooth"\n\n` +
      `*Comandos:*\n` +
      `/start — Ver esta mensagem\n` +
      `/ajuda — Ver instruções detalhadas\n` +
      `/cancelar — Cancelar compra atual`,
      { parse_mode: 'Markdown' }
    );
    logger.info('Comando /start executado', { chatId: String(ctx.chat.id) });
  });

  // ── Comando /ajuda ──────────────────────────────────────────────
  bot.help(async (ctx) => {
    await ctx.reply(
      `📖 *Ajuda — Amparo*\n\n` +
      `*O que eu faço:*\n` +
      `Busco produtos, comparo preços e ajudo na compra.\n\n` +
      `*Passo a passo:*\n` +
      `1️⃣ Me envie o nome do produto\n` +
      `2️⃣ Veja as opções disponíveis\n` +
      `3️⃣ Escolha o melhor para você\n` +
      `4️⃣ Confirme o endereço de entrega\n` +
      `5️⃣ Receba o link de checkout!\n\n` +
      `*Dica:* Envie o nome do produto de forma clara para melhores resultados.`,
      { parse_mode: 'Markdown' }
    );
  });

  // ── Comando /cancelar ──────────────────────────────────────────
  bot.command('cancelar', async (ctx) => {
    await ctx.reply('✅ Compra atual cancelada. Se precisar de algo, é só chamar!');
    logger.info('Comando /cancelar executado', { chatId: String(ctx.chat.id) });
  });

  // ── Callback Query Handler (botões inline) ──────────────────────
  bot.on('callback_query', async (ctx) => {
    const chatId = String(ctx.chat.id);
    const data = ctx.callbackQuery.data;
    const messageId = ctx.callbackQuery.message?.message_id;

    logger.info('Callback recebido', { chatId, data, messageId });

    // Remove o loading do botão
    await ctx.answerCbQuery().catch(() => {});

    // Publica a ação como mensagem no RabbitMQ (orquestrador entende)
    const traceId = `cb_${chatId}_${Date.now()}`;
    const payload = {
      type: 'text',
      from: chatId,
      messageId: messageId ? String(messageId) : 'callback',
      timestamp: new Date().toISOString(),
      content: {
        text: '',
        buttonId: data,
        buttonText: data,
        callbackData: data,
      },
      traceId,
    };

    // Publica na fila de processamento
    await producer.publishMessage(amqpChannel, payload, 'processamento');
  });

  // ── Handler principal de mensagens ──────────────────────────────
  bot.on('message', (ctx) => routeMessage(ctx, amqpChannel));

  // ── Inicialização ────────────────────────────────────────────────
  if (useWebhook && webhookUrl) {
    await bot.launch({
      webhook: {
        domain: webhookUrl,
        port: config.telegram.webhookPort,
      },
    });
    logger.info('Bot Telegram iniciado com webhook', { webhookUrl });
  } else {
    // Polling (padrão) — funciona localmente, sem deploy
    await bot.launch({
      polling: {
        timeout: config.telegram.pollingTimeout,
        limit: 100,
      },
    });
    logger.info('Bot Telegram iniciado em modo polling (sem webhook)');
  }

  return bot;
}

module.exports = { createBot };
