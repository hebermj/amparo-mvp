import { Router } from 'express';
import crypto from 'crypto';
import config from '../config/index.js';
import logger from '../utils/logger.js';
import { validateSignature, validatePayload } from './validator.js';
import { parseMessage } from './parser.js';
import { publishTextMessage, publishAudioMessage } from '../queue/producer.js';

const router = Router();

// ── GET /webhook/whatsapp — Verification Challenge ────────────────────────
// Meta/WhatsApp sends a GET to verify the webhook endpoint.
router.get('/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const challenge = req.query['hub.challenge'];
  const verifyToken = req.query['hub.verify_token'];

  logger.debug('Webhook verification request received', {
    mode,
    verifyToken: verifyToken ? `${verifyToken.slice(0, 3)}...` : '(none)',
  });

  if (mode === 'subscribe' && verifyToken === config.whatsappVerifyToken) {
    logger.info('Webhook verified successfully');
    return res.status(200).send(challenge);
  }

  logger.warn('Webhook verification failed', {
    mode,
    expectedToken: config.whatsappVerifyToken,
  });
  return res.status(403).send('Forbidden');
});

// ── POST /webhook/whatsapp — Incoming Messages ────────────────────────────
router.post('/whatsapp', async (req, res) => {
  const traceId = crypto.randomUUID();
  const log = logger.child({ traceId });

  log.info('Incoming webhook message received');

  // 1. Validate Authorization header
  const authHeader = req.headers.authorization || '';
  const expectedToken = config.whatsappToken;

  if (expectedToken) {
    // Support "Bearer <token>" and bare token
    const provided = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : authHeader;

    if (!provided || provided !== expectedToken) {
      log.warn('Invalid or missing Authorization header', {
        headerPresent: !!authHeader,
      });
      return res.status(401).json({ error: 'Unauthorized' });
    }
  } else {
    log.warn('No WHATSAPP_TOKEN configured — skipping auth validation');
  }

  // 2. Validate payload structure
  const { valid, errors } = validatePayload(req.body);
  if (!valid) {
    log.warn('Invalid webhook payload', { errors });
    return res.status(400).json({ error: 'Invalid payload', details: errors });
  }

  // 3. Parse message into internal format
  const parsed = parseMessage(req.body);
  if (!parsed) {
    log.warn('Could not parse message payload');
    return res.status(200).end(); // Still return 200 so Meta doesn't retry
  }

  // 4. Publish to the appropriate queue based on message type
  try {
    switch (parsed.type) {
      case 'text':
      case 'interactive': {
        const ok = await publishTextMessage(parsed, traceId);
        if (!ok) {
          log.error('Failed to publish text/interactive message to queue');
        }
        break;
      }
      case 'audio': {
        const ok = await publishAudioMessage(parsed, traceId);
        if (!ok) {
          log.error('Failed to publish audio message to queue');
        }
        break;
      }
      default: {
        log.warn(`Unhandled message type "${parsed.type}" — no queue publish`);
        break;
      }
    }
  } catch (err) {
    log.error('Error publishing message to queue', { error: err.message });
    // Still return 200 — we acknowledged receipt; the message is lost but
    // returning an error would cause Meta to retry and potentially duplicate.
  }

  // 5. Always return 200 quickly (< 100ms expected)
  log.info('Message processed and acknowledged', {
    messageId: parsed.messageId,
    type: parsed.type,
    from: parsed.from,
  });

  return res.status(200).end();
});

export default router;
