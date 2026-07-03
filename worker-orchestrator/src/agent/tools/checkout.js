'use strict';

const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

/**
 * CheckoutTool — gera link de checkout para pagamento na loja.
 */
class CheckoutTool {
  constructor(pgClient) {
    this.pg = pgClient;
    this.definition = {
      name: 'gerar_checkout',
      description: 'Gera link de checkout para a loja. Chame APÓS o usuário confirmar a compra.',
      parameters: {
        type: 'object',
        required: ['produto', 'loja', 'preco'],
        properties: {
          produto: { type: 'string', description: 'Nome do produto' },
          loja: { type: 'string', description: 'Nome da loja' },
          preco: { type: 'number', description: 'Preço final em reais' },
        },
      },
    };
  }

  async execute(toolName, args, session, context) {
    const { produto, loja, preco } = args;
    const traceId = context?.traceId;
    const pedidoId = `AMP-${Date.now().toString(36).toUpperCase()}-${uuidv4().slice(0, 6).toUpperCase()}`;

    logger.info('Tool: gerar_checkout', { produto, loja, preco, pedidoId, traceId });

    // Link simbólico (MVP — em produção viria via webhook da loja)
    const link = `https://${loja.toLowerCase().replace(/\s+/g, '')}.com/checkout/${pedidoId}`;

    session.context = {
      ...session.context,
      lastCheckout: {
        pedidoId,
        produto,
        loja,
        preco,
        link,
        gerado_em: new Date().toISOString(),
      },
    };

    const precoFmt = `R$ ${preco.toFixed(2).replace('.', ',')}`;

    return {
      sendToUser: {
        type: 'link',
        whatsappPhone: session.whatsappPhone,
        message: `🛒 *Checkout Gerado!*\n\nPedido: *${pedidoId}*\nProduto: ${produto}\nLoja: ${loja}\nValor: ${precoFmt}\n\nClique no link abaixo para finalizar o pagamento na loja:`,
        link: { url: link, label: `Finalizar Compra — ${produto}` },
        buttons: [{ id: 'nova_compra', title: '🛍️ Nova Compra' }],
        traceId,
      },
    };
  }
}

module.exports = CheckoutTool;
