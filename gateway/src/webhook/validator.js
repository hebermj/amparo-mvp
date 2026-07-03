import crypto from 'crypto';
import logger from '../utils/logger.js';

/**
 * Validates that the X-Hub-Signature-256 header matches a SHA256 HMAC
 * of the raw request body signed with the WhatsApp token.
 *
 * WhatsApp Meta platform expects the signature to be computed over the
 * raw JSON body using your App Secret as the HMAC key.
 *
 * @param {object} req - Express request object (needs rawBody or body)
 * @returns {boolean}
 */
export function validateSignature(req) {
  const signature = req.headers['x-hub-signature-256'];
  if (!signature) {
    return false;
  }

  const token = req.app?.locals?.whatsappToken || '';
  if (!token) {
    logger.warn('validateSignature called but no whatsappToken configured');
    return false;
  }

  // The raw body is needed for HMAC. Express JSON parser consumes it,
  // so we fall back to JSON.stringify(req.body) if rawBody not available.
  const rawBody = req.rawBody || JSON.stringify(req.body) || '';

  const expected = crypto
    .createHmac('sha256', token)
    .update(rawBody, 'utf8')
    .digest('hex');

  // Meta sends "sha256=hexvalue"
  const provided = signature.startsWith('sha256=')
    ? signature.slice(7)
    : signature;

  // Use timing-safe comparison
  if (expected.length !== provided.length) {
    return false;
  }

  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

/**
 * Validates that the incoming WhatsApp payload has the required fields
 * and at least one supported message type.
 *
 * Expected shape:
 * {
 *   object: 'whatsapp_business_account',
 *   entry: [{
 *     changes: [{
 *       value: {
 *         messages: [{ from, id, timestamp, type, text?, audio?, interactive? }]
 *       }
 *     }]
 *   }]
 * }
 *
 * @param {object} body - Parsed request body
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validatePayload(body) {
  const errors = [];

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['Payload must be a non-null object'] };
  }

  if (!body.object || body.object !== 'whatsapp_business_account') {
    errors.push('Missing or invalid "object" field — expected "whatsapp_business_account"');
  }

  if (!Array.isArray(body.entry) || body.entry.length === 0) {
    errors.push('Payload must contain a non-empty "entry" array');
    return { valid: errors.length === 0, errors };
  }

  const entry = body.entry[0];
  if (!entry.changes || !Array.isArray(entry.changes) || entry.changes.length === 0) {
    errors.push('Entry must contain a non-empty "changes" array');
    return { valid: errors.length === 0, errors };
  }

  const change = entry.changes[0];
  if (!change.value) {
    errors.push('Change must contain a "value" object');
    return { valid: errors.length === 0, errors };
  }

  const messages = change.value.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    errors.push('Value must contain a non-empty "messages" array');
    return { valid: errors.length === 0, errors };
  }

  const message = messages[0];
  if (!message.from || !message.id || !message.timestamp) {
    errors.push('Each message must have "from", "id", and "timestamp" fields');
  }

  if (message.type && !['text', 'audio', 'interactive'].includes(message.type)) {
    errors.push(`Unsupported message type "${message.type}". Supported: text, audio, interactive`);
  }

  return { valid: errors.length === 0, errors };
}

export default { validateSignature, validatePayload };
