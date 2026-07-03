import logger from '../utils/logger.js';

/**
 * Parse a raw WhatsApp Business API payload into our internal message format.
 *
 * @param {object} body - The full request body from Meta/WhatsApp
 * @returns {object|null} Parsed message object or null if unparseable
 *
 * Internal format:
 * {
 *   type: 'text' | 'audio' | 'interactive',
 *   from: '5511999999999',
 *   messageId: 'wamid.xxx',
 *   timestamp: 1719876543,
 *   content: {
 *     text: 'mensagem' |
 *     audioId: 'media_id' |
 *     buttonId: 'btn_1',
 *     buttonText: 'Sim'
 *   }
 * }
 */
export function parseMessage(body) {
  if (!body || !Array.isArray(body.entry) || body.entry.length === 0) {
    logger.warn('parseMessage: invalid payload structure (no entries)');
    return null;
  }

  const entry = body.entry[0];
  if (!entry.changes || !Array.isArray(entry.changes) || entry.changes.length === 0) {
    logger.warn('parseMessage: entry has no changes');
    return null;
  }

  const change = entry.changes[0];
  const value = change.value;
  if (!value || !Array.isArray(value.messages) || value.messages.length === 0) {
    logger.warn('parseMessage: change has no messages');
    return null;
  }

  const raw = value.messages[0];
  const messageType = raw.type;

  const base = {
    from: raw.from,
    messageId: raw.id,
    timestamp: parseInt(raw.timestamp, 10),
  };

  switch (messageType) {
    case 'text': {
      return {
        ...base,
        type: 'text',
        content: {
          text: raw.text?.body || '',
        },
      };
    }

    case 'audio': {
      return {
        ...base,
        type: 'audio',
        content: {
          audioId: raw.audio?.id || '',
        },
      };
    }

    case 'interactive': {
      const interactive = raw.interactive || {};
      let buttonId = '';
      let buttonText = '';

      if (interactive.type === 'button_reply' && interactive.button_reply) {
        buttonId = interactive.button_reply.id || '';
        buttonText = interactive.button_reply.title || '';
      } else if (interactive.type === 'list_reply' && interactive.list_reply) {
        buttonId = interactive.list_reply.id || '';
        buttonText = interactive.list_reply.title || '';
      }

      return {
        ...base,
        type: 'interactive',
        content: {
          buttonId,
          buttonText,
        },
      };
    }

    default: {
      logger.warn(`parseMessage: unsupported message type "${messageType}"`, {
        messageId: raw.id,
        from: raw.from,
      });
      return null;
    }
  }
}

export default { parseMessage };
