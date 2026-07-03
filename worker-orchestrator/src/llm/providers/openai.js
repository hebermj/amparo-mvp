'use strict';

const fetch = require('node-fetch');
const BaseProvider = require('./base');
const logger = require('../../utils/logger');

/**
 * OpenAI LLM Provider.
 * Uses OpenAI-compatible chat completions API (same shape as DeepSeek).
 */
class OpenAIProvider extends BaseProvider {
  constructor(config) {
    super('openai', config);
    this.apiUrl = config.apiUrl;
    this.apiKey = config.apiKey;
    this.model = config.model;
  }

  /**
   * Complete a chat conversation via OpenAI API.
   */
  async complete(systemPrompt, messages, tools = []) {
    const body = this.buildRequestBody(systemPrompt, messages, tools);

    const response = await this._makeRequest(body);
    return this.parseResponse(response);
  }

  /**
   * Build the request body for OpenAI (same format as DeepSeek).
   */
  buildRequestBody(systemPrompt, messages, tools) {
    const fullMessages = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ];

    const body = {
      model: this.model,
      messages: fullMessages,
      temperature: 0.7,
      max_tokens: 2000,
    };

    if (tools && tools.length > 0) {
      body.tools = tools;
    }

    return body;
  }

  /**
   * Parse OpenAI response into standardised format.
   */
  parseResponse(rawResponse) {
    const choice = rawResponse.choices && rawResponse.choices[0];
    if (!choice) {
      throw new Error('Empty response from OpenAI: no choices returned');
    }

    const message = choice.message || {};
    const response = message.content || '';
    const toolCalls = message.tool_calls || null;

    const usage = this.extractUsage(rawResponse.usage);

    return { response, toolCalls, usage };
  }

  /**
   * Make the actual HTTP request.
   */
  async _makeRequest(body) {
    const url = `${this.apiUrl}/chat/completions`;

    logger.debug('OpenAI request', {
      model: this.model,
      messagesCount: body.messages.length,
      hasTools: !!(body.tools && body.tools.length > 0),
      url,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      const err = new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
      err.status = response.status;
      err.statusCode = response.status;
      err.body = errorBody;
      throw err;
    }

    const data = await response.json();
    return data;
  }
}

module.exports = OpenAIProvider;
