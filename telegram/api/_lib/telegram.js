/**
 * Telegram API helpers — enviam mensagens para o usuário via Bot API.
 *
 * Usa fetch nativo (Node 18+) — sem dependências extras.
 */

const BOT_TOKEN = () => process.env.TELEGRAM_BOT_TOKEN;
const API_BASE = () => `https://api.telegram.org/bot${BOT_TOKEN()}`;

/**
 * Envia uma mensagem de texto para um chat do Telegram.
 *
 * @param {number|string} chatId
 * @param {string} text
 * @param {object} opts  { parse_mode, reply_markup, disable_web_page_preview }
 * @returns {Promise<object>}
 */
async function sendMessage(chatId, text, opts = {}) {
  if (!BOT_TOKEN()) {
    throw new Error('TELEGRAM_BOT_TOKEN não configurado');
  }

  const body = {
    chat_id: String(chatId),
    text,
    ...(opts.parse_mode && { parse_mode: opts.parse_mode }),
    ...(opts.disable_web_page_preview !== undefined && {
      disable_web_page_preview: opts.disable_web_page_preview,
    }),
    ...(opts.reply_markup && { reply_markup: opts.reply_markup }),
  };

  const res = await fetch(`${API_BASE()}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (!data.ok) {
    console.error('[TELEGRAM API ERROR] sendMessage:', data.description);
    throw new Error(`Telegram API: ${data.description}`);
  }

  return data.result;
}

/**
 * Envia ação de "digitando..." para o chat.
 *
 * @param {number|string} chatId
 */
async function sendTypingAction(chatId) {
  if (!BOT_TOKEN()) return;

  await fetch(`${API_BASE()}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: String(chatId),
      action: 'typing',
    }),
  }).catch(() => {}); // ignora erro — é só um "bonitinho"
}

module.exports = { sendMessage, sendTypingAction };
