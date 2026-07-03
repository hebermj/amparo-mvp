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
 * Send an image message via the WhatsApp Business API.
 *
 * @param {string} to - Recipient phone number
 * @param {string} link - Publicly accessible URL of the image
 * @param {string} [caption] - Optional caption text for the image
 * @returns {Promise<{success: boolean, messageId: string|null, timestamp: string|null, error?: string}>}
 */
async function sendImage(to, link, caption) {
  const startTime = Date.now();
  const traceInfo = { to };

  try {
    if (!to) {
      throw new Error('Recipient phone number (to) is required');
    }
    if (!link) {
      throw new Error('Image link URL is required');
    }

    // Validate the link is a proper URL
    try {
      new URL(link);
    } catch (_) {
      throw new Error('Image link must be a valid URL');
    }

    const image = { link };

    if (caption) {
      if (caption.length > 1024) {
        throw new Error('Image caption must be 1024 characters or fewer');
      }
      image.caption = caption;
    }

    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: String(to).replace(/[^0-9]/g, ''),
      type: 'image',
      image,
    };

    logger.debug('Sending WhatsApp image message', {
      ...traceInfo,
      hasCaption: !!caption,
    });

    const response = await fetch(getApiUrl(), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(body),
      timeout: config.whatsapp.requestTimeoutMs,
    });

    const latency = (Date.now() - startTime) / 1000;
    sendLatencySeconds.observe({ type: 'image' }, latency);

    const data = await response.json();

    if (!response.ok) {
      const errorMsg = data.error
        ? `WhatsApp API error ${data.error.code}: ${data.error.message}`
        : `HTTP ${response.status}: ${response.statusText}`;

      messagesSentTotal.inc({ type: 'image', status: 'error' });

      logger.error('WhatsApp image send failed', {
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

    messagesSentTotal.inc({ type: 'image', status: 'success' });

    logger.info('WhatsApp image message sent', {
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

    messagesSentTotal.inc({ type: 'image', status: 'error' });

    logger.error('WhatsApp image send error', {
      ...traceInfo,
      err,
      latency,
    });

    return {
      success: false,
      messageId: null,
      timestamp: null,
      error: err.message || 'Unknown error sending image message',
    };
  }
}

module.exports = { sendImage };
