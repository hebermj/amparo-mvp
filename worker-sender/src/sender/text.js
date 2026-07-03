'use strict';

const fetch = require('node-fetch');
const config = require('../config');
const logger = require('../utils/logger');
const { messagesSentTotal, sendLatencySeconds } = require('../utils/metrics');

/**
 * Build the WhatsApp API URL for sending messages.
 */
function getApiUrl() {
  const { apiUrl, apiVersion, phoneNumberId } = config.whatsapp;
  return `${apiUrl}/${apiVersion}/${phoneNumberId}/messages`;
}

/**
 * Build common headers for WhatsApp API requests.
 */
function getHeaders() {
  return {
    'Authorization': `Bearer ${config.whatsapp.token}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Send a text message via the WhatsApp Business API.
 *
 * @param {string} to - Recipient phone number (in international format, no +)
 * @param {string} text - Message body text
 * @param {boolean} [previewUrl=false] - Whether to enable URL preview
 * @returns {Promise<{success: boolean, messageId: string|null, timestamp: string|null, error?: string}>}
 */
async function sendText(to, text, previewUrl = false) {
  const startTime = Date.now();
  const traceInfo = { to };

  try {
    if (!to) {
      throw new Error('Recipient phone number (to) is required');
    }
    if (!text) {
      throw new Error('Message text is required');
    }

    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: String(to).replace(/[^0-9]/g, ''),
      type: 'text',
      text: {
        body: text,
        preview_url: previewUrl,
      },
    };

    logger.debug('Sending WhatsApp text message', {
      ...traceInfo,
      previewUrl,
      textLength: text.length,
    });

    const response = await fetch(getApiUrl(), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(body),
      timeout: config.whatsapp.requestTimeoutMs,
    });

    const latency = (Date.now() - startTime) / 1000;
    sendLatencySeconds.observe({ type: 'text' }, latency);

    const data = await response.json();

    if (!response.ok) {
      const errorMsg = data.error
        ? `WhatsApp API error ${data.error.code}: ${data.error.message}`
        : `HTTP ${response.status}: ${response.statusText}`;

      messagesSentTotal.inc({ type: 'text', status: 'error' });

      logger.error('WhatsApp text send failed', {
        ...traceInfo,
        statusCode: response.status,
        error: errorMsg,
        latency,
      });

      return {
        success: false,
        messageId: null,
        timestamp: null,
        error: errorMsg,
      };
    }

    const messageId = data.messages && data.messages[0] ? data.messages[0].id : null;
    const timestamp = data.messages && data.messages[0] ? data.messages[0].timestamp : new Date().toISOString();

    messagesSentTotal.inc({ type: 'text', status: 'success' });

    logger.info('WhatsApp text message sent', {
      ...traceInfo,
      messageId,
      latency,
    });

    return {
      success: true,
      messageId,
      timestamp,
    };
  } catch (err) {
    const latency = (Date.now() - startTime) / 1000;

    messagesSentTotal.inc({ type: 'text', status: 'error' });

    logger.error('WhatsApp text send error', {
      ...traceInfo,
      err,
      latency,
    });

    return {
      success: false,
      messageId: null,
      timestamp: null,
      error: err.message || 'Unknown error sending text message',
    };
  }
}

module.exports = { sendText };
