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
 * Send a text message with link preview via the WhatsApp Business API.
 *
 * This uses the text message type but with preview_url enabled so that
 * WhatsApp renders a link preview card below the message.
 *
 * @param {string} to - Recipient phone number
 * @param {string} url - The URL to share (will be included in the body text)
 * @param {string} body - The accompanying message text
 * @returns {Promise<{success: boolean, messageId: string|null, timestamp: string|null, error?: string}>}
 */
async function sendLink(to, url, body) {
  const startTime = Date.now();
  const traceInfo = { to };

  try {
    if (!to) {
      throw new Error('Recipient phone number (to) is required');
    }
    if (!url) {
      throw new Error('URL is required');
    }
    if (!body) {
      throw new Error('Message body text is required');
    }

    // Validate the URL
    try {
      new URL(url);
    } catch (_) {
      throw new Error('Must provide a valid URL');
    }

    const sanitizedTo = String(to).replace(/[^0-9]/g, '');

    // WhatsApp requires the URL to be present in the body text for preview to work
    // If the URL isn't already in the body, append it
    let messageBody = body;
    if (!body.includes(url)) {
      messageBody = `${body}\n\n${url}`;
    }

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: sanitizedTo,
      type: 'text',
      text: {
        body: messageBody,
        preview_url: true,
      },
    };

    logger.debug('Sending WhatsApp link message', {
      ...traceInfo,
      hasUrlInBody: body.includes(url),
    });

    const response = await fetch(getApiUrl(), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(payload),
      timeout: config.whatsapp.requestTimeoutMs,
    });

    const latency = (Date.now() - startTime) / 1000;
    sendLatencySeconds.observe({ type: 'link' }, latency);

    const data = await response.json();

    if (!response.ok) {
      const errorMsg = data.error
        ? `WhatsApp API error ${data.error.code}: ${data.error.message}`
        : `HTTP ${response.status}: ${response.statusText}`;

      messagesSentTotal.inc({ type: 'link', status: 'error' });

      logger.error('WhatsApp link send failed', {
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

    messagesSentTotal.inc({ type: 'link', status: 'success' });

    logger.info('WhatsApp link message sent', {
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

    messagesSentTotal.inc({ type: 'link', status: 'error' });

    logger.error('WhatsApp link send error', {
      ...traceInfo,
      err,
      latency,
    });

    return {
      success: false,
      messageId: null,
      timestamp: null,
      error: err.message || 'Unknown error sending link message',
    };
  }
}

module.exports = { sendLink };
