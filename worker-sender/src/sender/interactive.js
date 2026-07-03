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
 * Send an interactive buttons message (quick replies) via WhatsApp Business API.
 *
 * WhatsApp limits interactive button messages to 3 buttons maximum.
 *
 * @param {string} to - Recipient phone number
 * @param {string} [header] - Optional header text (rendered as bold)
 * @param {string} body - Main body text
 * @param {Array<{id: string, title: string}>} buttons - Array of button objects (max 3)
 * @returns {Promise<{success: boolean, messageId: string|null, timestamp: string|null, error?: string}>}
 */
async function sendButtons(to, header, body, buttons) {
  const startTime = Date.now();
  const traceInfo = { to };

  try {
    if (!to) {
      throw new Error('Recipient phone number (to) is required');
    }
    if (!body) {
      throw new Error('Button message body text is required');
    }
    if (!buttons || !Array.isArray(buttons) || buttons.length === 0) {
      throw new Error('At least one button is required');
    }

    // Enforce WhatsApp limit of 3 buttons
    const validButtons = buttons.slice(0, 3);

    // Validate each button
    for (const btn of validButtons) {
      if (!btn.id || !btn.title) {
        throw new Error('Each button must have an id and title');
      }
      if (btn.title.length > 20) {
        throw new Error('Button title must be 20 characters or fewer');
      }
    }

    if (body.length > 1024) {
      throw new Error('Button body text must be 1024 characters or fewer');
    }
    if (header && header.length > 60) {
      throw new Error('Button header text must be 60 characters or fewer');
    }

    // Build the interactive payload
    const interactive = {
      type: 'button',
      body: {
        text: body,
      },
      action: {
        buttons: validButtons.map((btn) => ({
          type: 'reply',
          reply: {
            id: btn.id,
            title: btn.title,
          },
        })),
      },
    };

    // Add optional header
    if (header) {
      interactive.header = {
        type: 'text',
        text: header,
      };
    }

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: String(to).replace(/[^0-9]/g, ''),
      type: 'interactive',
      interactive,
    };

    logger.debug('Sending WhatsApp interactive buttons', {
      ...traceInfo,
      buttonCount: validButtons.length,
    });

    const response = await fetch(getApiUrl(), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(payload),
      timeout: config.whatsapp.requestTimeoutMs,
    });

    const latency = (Date.now() - startTime) / 1000;
    sendLatencySeconds.observe({ type: 'interactive' }, latency);

    const data = await response.json();

    if (!response.ok) {
      const errorMsg = data.error
        ? `WhatsApp API error ${data.error.code}: ${data.error.message}`
        : `HTTP ${response.status}: ${response.statusText}`;

      messagesSentTotal.inc({ type: 'interactive', status: 'error' });

      logger.error('WhatsApp interactive send failed', {
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

    messagesSentTotal.inc({ type: 'interactive', status: 'success' });

    logger.info('WhatsApp interactive message sent', {
      ...traceInfo,
      messageId,
      buttonCount: validButtons.length,
      latency,
    });

    return {
      success: true,
      messageId,
      timestamp,
    };
  } catch (err) {
    const latency = (Date.now() - startTime) / 1000;

    messagesSentTotal.inc({ type: 'interactive', status: 'error' });

    logger.error('WhatsApp interactive send error', {
      ...traceInfo,
      err,
      latency,
    });

    return {
      success: false,
      messageId: null,
      timestamp: null,
      error: err.message || 'Unknown error sending interactive message',
    };
  }
}

module.exports = { sendButtons };
