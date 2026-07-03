'use strict';

const crypto = require('crypto');
const logger = require('../utils/logger');

/**
 * ProfileTool — gerencia endereço do usuário com criptografia AES-256.
 */
class ProfileTool {
  constructor(pgClient, encryptionKey) {
    this.pg = pgClient;
    this.encryptionKey = encryptionKey || 'chave-dev-32bytes-trocada-em-prod';

    this.definitions = [
      {
        name: 'salvar_endereco',
        description: 'Salva o endereço de entrega do usuário. REQUER consentimento LGPD.',
        parameters: {
          type: 'object',
          required: ['endereco'],
          properties: {
            endereco: { type: 'string', description: 'Endereço completo (rua, número, bairro, cidade, CEP)' },
          },
        },
      },
      {
        name: 'ler_endereco',
        description: 'Lê o endereço salvo do usuário (com consentimento).',
        parameters: { type: 'object', required: [], properties: {} },
      },
    ];

    // Primary definition for tool listing
    this.definition = this.definitions[0];
  }

  _encrypt(text) {
    const iv = crypto.randomBytes(16);
    const key = Buffer.from(this.encryptionKey.padEnd(32, 'x').slice(0, 32));
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + enc;
  }

  _decrypt(text) {
    const parts = text.split(':');
    const iv = Buffer.from(parts.shift(), 'hex');
    const authTag = Buffer.from(parts.shift(), 'hex');
    const enc = parts.join(':');
    const key = Buffer.from(this.encryptionKey.padEnd(32, 'x').slice(0, 32));
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    let dec = decipher.update(enc, 'hex', 'utf8');
    dec += decipher.final('utf8');
    return dec;
  }

  _hasConsent(session) {
    return session.context?.consentimentos?.some(c => c.tipo === 'armazenar_endereco' && c.concedido);
  }

  async execute(toolName, args, session, context) {
    const traceId = context?.traceId;

    if (toolName === 'salvar_endereco') {
      const { endereco } = args;
      logger.info('Tool: salvar_endereco', { traceId });

      if (!this._hasConsent(session)) {
        return {
          sendToUser: {
            type: 'interactive',
            whatsappPhone: session.whatsappPhone,
            message: 'Para salvar seu endereço, preciso da sua autorização conforme a LGPD. Você autoriza?',
            buttons: [
              { id: 'consent_armazenar_endereco_sim', title: 'Sim, pode salvar' },
              { id: 'consent_armazenar_endereco_nao', title: 'Não, usar só agora' },
            ],
            traceId,
          },
        };
      }

      const token = this._encrypt(endereco);
      session.context = { ...session.context, enderecoToken: token, enderecoAtual: endereco };

      return {
        sendToUser: {
          type: 'text',
          whatsappPhone: session.whatsappPhone,
          message: 'Endereço salvo com sucesso! Fica guardado com segurança (criptografado) para suas próximas compras.',
          traceId,
        },
      };
    }

    if (toolName === 'ler_endereco') {
      logger.info('Tool: ler_endereco', { traceId });

      if (!this._hasConsent(session) || !session.context?.enderecoToken) {
        return {
          sendToUser: {
            type: 'text',
            whatsappPhone: session.whatsappPhone,
            message: 'Você ainda não salvou um endereço ou não autorizou o armazenamento.',
            traceId,
          },
        };
      }

      try {
        const endereco = this._decrypt(session.context.enderecoToken);
        return {
          endereco,
          sendToUser: {
            type: 'text',
            whatsappPhone: session.whatsappPhone,
            message: `Seu endereço salvo é: ${endereco}`,
            traceId,
          },
        };
      } catch (err) {
        logger.error('Falha ao descriptografar endereço', { error: err.message, traceId });
        return { error: 'Erro ao recuperar endereço' };
      }
    }

    return { error: `Tool desconhecida: ${toolName}` };
  }
}

module.exports = ProfileTool;
