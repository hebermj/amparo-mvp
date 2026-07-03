'use strict';

const logger = require('../utils/logger');

/**
 * ConsentTool — gerencia consentimento LGPD.
 */
class ConsentTool {
  constructor(redisClient) {
    this.redis = redisClient;

    this.definitions = [
      {
        name: 'solicitar_consentimento',
        description: 'Solicita consentimento LGPD para armazenar dados. Envia botões Sim/Não.',
        parameters: {
          type: 'object',
          required: ['tipo', 'descricao'],
          properties: {
            tipo: { type: 'string', description: 'Tipo (ex: "armazenar_endereco")' },
            descricao: { type: 'string', description: 'Descrição amigável' },
          },
        },
      },
      {
        name: 'verificar_consentimento',
        description: 'Verifica se o usuário já concedeu consentimento para um tipo.',
        parameters: {
          type: 'object',
          required: ['tipo'],
          properties: {
            tipo: { type: 'string', description: 'Tipo de consentimento' },
          },
        },
      },
      {
        name: 'revogar_consentimento',
        description: 'Revoga um consentimento (direito LGPD de revogação).',
        parameters: {
          type: 'object',
          required: ['tipo'],
          properties: {
            tipo: { type: 'string', description: 'Tipo a revogar' },
          },
        },
      },
    ];

    this.definition = this.definitions[0];
  }

  async execute(toolName, args, session, context) {
    const traceId = context?.traceId;
    const { tipo, descricao } = args;

    switch (toolName) {
      case 'solicitar_consentimento': {
        logger.info('Tool: solicitar_consentimento', { tipo, descricao, traceId });

        const jaTem = session.context?.consentimentos?.some(c => c.tipo === tipo && c.concedido);
        if (jaTem) {
          return {
            sendToUser: {
              type: 'text',
              whatsappPhone: session.whatsappPhone,
              message: `Você já autorizou "${descricao}". Se quiser revogar é só avisar.`,
              traceId,
            },
          };
        }

        return {
          sendToUser: {
            type: 'interactive',
            whatsappPhone: session.whatsappPhone,
            message: `Para prosseguir, preciso da sua autorização: ${descricao}. Você autoriza?`,
            buttons: [
              { id: `consent_${tipo}_sim`, title: 'Sim, autorizo' },
              { id: `consent_${tipo}_nao`, title: 'Não autorizo' },
            ],
            traceId,
          },
        };
      }

      case 'verificar_consentimento': {
        const concedido = session.context?.consentimentos?.some(c => c.tipo === tipo && c.concedido) || false;
        return { concedido, tipo };
      }

      case 'revogar_consentimento': {
        logger.info('Tool: revogar_consentimento', { tipo, traceId });

        const consentimentos = session.context?.consentimentos || [];
        const existe = consentimentos.some(c => c.tipo === tipo);
        if (!existe) {
          return {
            sendToUser: {
              type: 'text',
              whatsappPhone: session.whatsappPhone,
              message: 'Você ainda não concedeu esse tipo de consentimento.',
              traceId,
            },
          };
        }

        session.context = {
          ...session.context,
          consentimentos: [
            ...consentimentos,
            { tipo, concedido: false, revogado_em: new Date().toISOString(), metodo: 'whatsapp_interactive' },
          ],
        };

        return {
          sendToUser: {
            type: 'text',
            whatsappPhone: session.whatsappPhone,
            message: `Seu consentimento para "${tipo}" foi revogado. Seus dados serão removidos em até 30 dias conforme a LGPD.`,
            traceId,
          },
        };
      }

      default:
        return { error: `Tool desconhecida: ${toolName}` };
    }
  }

  async handleConsentResponse(session, tipo, granted, context) {
    const traceId = context?.traceId;
    logger.info('Consent response handler', { tipo, granted, traceId });

    const consentimentos = session.context?.consentimentos || [];
    session.context = {
      ...session.context,
      consentimentos: [
        ...consentimentos,
        { tipo, concedido: granted, criado_em: new Date().toISOString(), metodo: 'whatsapp_interactive' },
      ],
    };

    return { success: true, granted, tipo };
  }
}

module.exports = ConsentTool;
