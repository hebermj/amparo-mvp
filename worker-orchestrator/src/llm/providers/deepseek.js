'use strict';

const fetch = require('node-fetch');
const BaseProvider = require('./base');
const logger = require('../../utils/logger');

/**
 * DeepSeek LLM Provider.
 * Uses OpenAI-compatible chat completions API.
 */
class DeepSeekProvider extends BaseProvider {
  constructor(config) {
    super('deepseek', config);
    this.apiUrl = config.apiUrl;
    this.apiKey = config.apiKey;
    this.model = config.model;
  }

  /**
   * Complete a chat conversation via DeepSeek API.
   */
  async complete(systemPrompt, messages, tools = []) {
    const body = this.buildRequestBody(systemPrompt, messages, tools);

    const response = await this._makeRequest(body);
    return this.parseResponse(response);
  }

  /**
   * Build the request body for DeepSeek (OpenAI-compatible format).
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
   * Parse DeepSeek response into standardised format.
   */
  parseResponse(rawResponse) {
    const choice = rawResponse.choices && rawResponse.choices[0];
    if (!choice) {
      throw new Error('Empty response from DeepSeek: no choices returned');
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

    logger.debug('DeepSeek request', {
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
      const err = new Error(`DeepSeek API error: ${response.status} ${response.statusText}`);
      err.status = response.status;
      err.statusCode = response.status;
      err.body = errorBody;
      throw err;
    }

    const data = await response.json();
    return data;
  }
}

module.exports = DeepSeekProvider;
