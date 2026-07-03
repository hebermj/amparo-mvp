/**
 * Amparo Telegram Bot — Webhook para Vercel (serverless)
 *
 * Este endpoint recebe as atualizações do Telegram via webhook
 * e processa a mensagem chamando a LLM diretamente (sem RabbitMQ).
 *
 * Rota: POST /api/webhook
 */
const { sendMessage, sendTypingAction } = require('./_lib/telegram');
const { processWithLLM } = require('./_lib/llm');

// Cache simples de sessão por chatId (enquanto a função está quente)
const sessions = new Map();

module.exports = async (req, res) => {
  // ── GET: Verificação do webhook (Telegram exige) ──────────────
  if (req.method === 'GET') {
    // O Telegram não envia GET para webhooks, mas deixamos para debug
    return res.status(200).json({ status: 'ok', service: 'amparo-telegram-webhook' });
  }

  // ── POST: Recebe atualização do Telegram ──────────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const update = req.body;

    // Ignora atualizações sem mensagem (edições, reações, etc.)
    if (!update.message) {
      return res.status(200).json({ status: 'ignored' });
    }

    const chatId = update.message.chat.id;
    const message = update.message;
    const text = message.text || '';
    const firstName = message.from?.first_name || 'usuário';

    // ── Comandos ────────────────────────────────────────────────
    if (text === '/start') {
      await sendMessage(
        chatId,
        `👋 Olá, *${firstName}*!\n\n` +
        `Eu sou o *Amparo* — seu assistente de compras inteligente. 🛒\n\n` +
        `Me mande o nome de um produto que eu ajudo a encontrar!\n\n` +
        `Exemplos:\n` +
        `» "iPhone 15"\n` +
        `» "smart TV 55 4K"\n` +
        `» "fone Bluetooth"\n\n` +
        `Comandos:\n` +
        `/start — Ver esta mensagem\n` +
        `/ajuda — Instruções\n` +
        `/cancelar — Cancelar`,
        { parse_mode: 'Markdown' }
      );
      return res.status(200).json({ status: 'start' });
    }

    if (text === '/ajuda' || text === '/help') {
      await sendMessage(
        chatId,
        `📖 *Ajuda — Amparo*\n\n` +
        `1️⃣ Me envie o nome do produto\n` +
        `2️⃣ Pesquiso e comparo preços\n` +
        `3️⃣ Mostro as melhores opções\n` +
        `4️⃣ Gero link de checkout\n\n` +
        `*Dica:* Seja específico para melhores resultados.`,
        { parse_mode: 'Markdown' }
      );
      return res.status(200).json({ status: 'help' });
    }

    if (text === '/cancelar') {
      sessions.delete(chatId);
      await sendMessage(chatId, '✅ Compra cancelada. Se precisar, é só chamar!');
      return res.status(200).json({ status: 'canceled' });
    }

    // ── Mensagem de áudio ───────────────────────────────────────
    if (message.voice || message.audio) {
      await sendMessage(
        chatId,
        '🎤 Recebi seu áudio! Infelizmente a transcrição de áudio ' +
        'está disponível apenas na versão completa (com RabbitMQ + Whisper). ' +
        'Por favor, mande a mensagem por *texto*.',
        { parse_mode: 'Markdown' }
      );
      return res.status(200).json({ status: 'audio_not_supported' });
    }

    // ── Mensagem de texto ───────────────────────────────────────
    if (!text) {
      await sendMessage(chatId, 'Envie um texto ou comando.');
      return res.status(200).json({ status: 'empty' });
    }

    // Avisa que está digitando
    await sendTypingAction(chatId);

    // Pega ou cria sessão
    if (!sessions.has(chatId)) {
      sessions.set(chatId, { history: [], context: {} });
    }
    const session = sessions.get(chatId);

    // Processa com a LLM
    const reply = await processWithLLM(text, session, chatId);

    // Envia resposta
    await sendMessage(chatId, reply, { parse_mode: 'Markdown' });

    return res.status(200).json({ status: 'ok' });

  } catch (err) {
    console.error('[WEBHOOK ERROR]', err);
    // Tenta avisar o usuário
    try {
      const chatId = req.body?.message?.chat?.id;
      if (chatId) {
        await sendMessage(chatId, '❌ Ocorreu um erro ao processar sua mensagem. Tente novamente!');
      }
    } catch (_) {}

    return res.status(200).json({ status: 'error', error: err.message });
  }
};
