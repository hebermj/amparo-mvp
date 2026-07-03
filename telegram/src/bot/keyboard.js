'use strict';

const { Markup } = require('telegraf');

/**
 * Constrói um teclado inline com botões de confirmação de compra.
 * @param {string} produto - Nome do produto
 * @param {string} preco - Preço formatado
 * @returns {object} Markup inline keyboard
 */
function confirmarCompraKeyboard(produto, preco) {
  return Markup.inlineKeyboard([
    Markup.button.callback('✅ Sim, quero comprar', 'confirmar_compra'),
    Markup.button.callback('❌ Não, quero ver outros', 'recusar_compra'),
  ]);
}

/**
 * Botões de consentimento LGPD.
 * @returns {object} Markup inline keyboard
 */
function consentimentoKeyboard() {
  return Markup.inlineKeyboard([
    Markup.button.callback('✅ Aceito', 'consentir'),
    Markup.button.callback('❌ Recuso', 'recusar_consentimento'),
  ]);
}

/**
 * Botões pós-finalização (nova compra ou encerrar).
 * @returns {object} Markup inline keyboard
 */
function finalizacaoKeyboard() {
  return Markup.inlineKeyboard([
    Markup.button.callback('🛍️ Nova Compra', 'nova_compra'),
    Markup.button.callback('🚪 Encerrar', 'encerrar'),
  ]);
}

/**
 * Converte botões do formato interno do Amparo para teclado Telegram.
 * @param {Array<{id: string, title: string}>} buttons
 * @returns {object} Markup inline keyboard
 */
function fromAmparoButtons(buttons) {
  if (!buttons || buttons.length === 0) return undefined;

  const tgButtons = buttons.map((b) =>
    Markup.button.callback(b.title || b.label, b.id || b.callback_data || 'action')
  );

  return Markup.inlineKeyboard(tgButtons);
}

module.exports = {
  confirmarCompraKeyboard,
  consentimentoKeyboard,
  finalizacaoKeyboard,
  fromAmparoButtons,
};
