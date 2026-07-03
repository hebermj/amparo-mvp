'use strict';

const logger = require('../utils/logger');

/**
 * ConfirmTool — envia resumo da compra para confirmação do usuário.
 */
class ConfirmTool {
  constructor(producer) {
    this.producer = producer;
    this.definition = {
      name: 'confirmar_compra',
      description: 'Envia resumo da compra para o usuário confirmar. Use APÓS ter produto, loja, preço e endereço.',
      parameters: {
        type: 'object',
        required: ['produto', 'loja', 'preco', 'endereco'],
        properties: {
          produto: { type: 'string', description: 'Nome do produto' },
          loja: { type: 'string', description: 'Nome da loja' },
          preco: { type: 'number', description: 'Preço em reais' },
          endereco: { type: 'string', description: 'Endereço de entrega' },
        },
      },
    };
  }

  async execute(toolName, args, session, context) {
    const { produto, loja, preco, endereco } = args;
    const traceId = context?.traceId;

    logger.info('Tool: confirmar_compra', { produto, loja, preco, traceId });

    session.context = {
      ...session.context,
      pendingPurchase: { produto, loja, preco, endereco },
    };

    const precoFmt = `R$ ${preco.toFixed(2).replace('.', ',')}`;

    return {
      sendToUser: {
        type: 'interactive',
        whatsappPhone: session.whatsappPhone,
        message: `📋 *Resumo da Compra*\n\nProduto: ${produto}\nLoja: ${loja}\nPreço: ${precoFmt}\nEndereço: ${endereco}\n\nConfirma a compra?`,
        buttons: [
          { id: 'confirmar_compra', title: '✅ Confirmar' },
          { id: 'recusar_compra', title: '❌ Recusar' },
        ],
        traceId,
      },
    };
  }

  async handleConfirmResponse(session, context) {
    const purchase = session.context?.pendingPurchase;
    const traceId = context?.traceId;

    if (!purchase) {
      return {
        sendToUser: {
          type: 'text',
          whatsappPhone: session.whatsappPhone,
          message: 'Não encontrei uma compra pendente. Vamos começar de novo?',
          traceId,
        },
      };
    }

    logger.info('Purchase confirmed', { produto: purchase.produto, traceId });

    const precoFmt = `R$ ${purchase.preco.toFixed(2).replace('.', ',')}`;

    session.context = {
      ...session.context,
      pendingPurchase: { ...purchase, confirmado_em: new Date().toISOString() },
    };

    return {
      sendToUser: {
        type: 'interactive',
        whatsappPhone: session.whatsappPhone,
        message: `✅ *Compra confirmada!*\n\n${purchase.produto} — ${purchase.loja}\nPreço: ${precoFmt}\nEndereço: ${purchase.endereco}\n\nAgora vou gerar o link de checkout para você finalizar o pagamento na loja.`,
        buttons: [{ id: 'gerar_checkout_auto', title: '🔗 Gerar Link de Pagamento' }],
        traceId,
      },
    };
  }
}

module.exports = ConfirmTool;
