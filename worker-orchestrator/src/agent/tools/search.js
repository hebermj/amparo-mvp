'use strict';

const logger = require('../utils/logger');

/**
 * SearchTool — busca produtos via worker-search.
 */
class SearchTool {
  constructor(producer) {
    this.producer = producer;
    this.definition = {
      name: 'buscar_produtos',
      description: 'Busca produtos em lojas online. Use quando o usuário perguntar por um produto específico.',
      parameters: {
        type: 'object',
        required: ['produto'],
        properties: {
          produto: {
            type: 'string',
            description: 'Nome do produto a buscar (ex: "Geladeira Brastemp Frost Free 420L")',
          },
        },
      },
    };
  }

  async execute(toolName, args, session, context) {
    const { produto } = args;
    const traceId = context?.traceId;

    logger.info('Tool: buscar_produtos', { produto, traceId });

    if (!produto) {
      return {
        sendToUser: {
          type: 'text',
          whatsappPhone: session.whatsappPhone,
          message: 'Por favor, me diga qual produto você quer buscar.',
          traceId,
        },
      };
    }

    session.context = {
      ...session.context,
      lastSearchQuery: produto,
    };

    return {
      requiresSearch: true,
      query: produto,
      sendToUser: {
        type: 'text',
        whatsappPhone: session.whatsappPhone,
        message: `Vou buscar "${produto}" para você. Só um instante...`,
        traceId,
      },
    };
  }
}

module.exports = SearchTool;
