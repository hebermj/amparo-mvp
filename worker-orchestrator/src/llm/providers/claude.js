'use strict';

const fetch = require('node-fetch');
const BaseProvider = require('./base');
const logger = require('../../utils/logger');

/**
 * Claude (Anthropic) LLM Provider.
 * Uses Anthropic's Messages API.
 * Converts between OpenAI-style tool format and Anthropic-style tool format.
 */
class ClaudeProvider extends BaseProvider {
  constructor(config) {
    super('claude', config);
    this.apiUrl = config.apiUrl;
    this.apiKey = config.apiKey;
    this.model = config.model;
  }

  /**
   * Complete a chat conversation via Claude API.
   */
  async complete(systemPrompt, messages, tools = []) {
    const body = this.buildRequestBody(systemPrompt, messages, tools);

    const response = await this._makeRequest(body);
    return this.parseResponse(response);
  }

  /**
   * Build the request body for Claude's Messages API.
   */
  buildRequestBody(systemPrompt, messages, tools) {
    // Convert OpenAI-format messages to Anthropic format
    const claudeMessages = messages.map((msg) => {
      if (msg.role === 'system') {
        // System messages are handled separately
        return null;
      }
      return {
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content || '',
      };
    }).filter(Boolean);

    const body = {
      model: this.model,
      system: systemPrompt,
      messages: claudeMessages,
      max_tokens: 2000,
      temperature: 0.7,
    };

    if (tools && tools.length > 0) {
      body.tools = this._convertToolsToAnthropic(tools);
    }

    return body;
  }

  /**
   * Convert OpenAI function-calling tool format to Anthropic tool format.
   *
   * OpenAI: { type: 'function', function: { name, description, parameters } }
   * Anthropic: { name, description, input_schema }
   */
  _convertToolsToAnthropic(openaiTools) {
    return openaiTools.map((tool) => {
      const fn = tool.function || tool;
      return {
        name: fn.name,
        description: fn.description || '',
        input_schema: fn.parameters || { type: 'object', properties: {} },
      };
    });
  }

  /**
   * Parse Claude response into standardised format.
   */
  parseResponse(rawResponse) {
    if (!rawResponse.content || rawResponse.content.length === 0) {
      throw new Error('Empty response from Claude: no content returned');
    }

    let response = '';
    let toolCalls = null;

    // Claude may return multiple content blocks (text + tool_use)
    for (const block of rawResponse.content) {
      if (block.type === 'text') {
        response += block.text || '';
      } else if (block.type === 'tool_use') {
        if (!toolCalls) toolCalls = [];
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input),
          },
        });
      }
    }

    const usage = this.extractUsage(rawResponse.usage);

    return { response: response.trim(), toolCalls, usage };
  }

  /**
   * Extract Claude-specific usage data.
   */
  extractUsage(usage) {
    if (!usage) return { promptTokens: 0, completionTokens: 0 };
    return {
      promptTokens: usage.input_tokens || 0,
      completionTokens: usage.output_tokens || 0,
    };
  }

  /**
   * Make the actual HTTP request to Anthropic API.
   */
  async _makeRequest(body) {
    const url = `${this.apiUrl}/messages`;

    logger.debug('Claude request', {
      model: this.model,
      messagesCount: body.messages ? body.messages.length : 0,
      hasTools: !!(body.tools && body.tools.length > 0),
      url,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      const err = new Error(`Claude API error: ${response.status} ${response.statusText}`);
      err.status = response.status;
      err.statusCode = response.status;
      err.body = errorBody;
      throw err;
    }

    const data = await response.json();
    return data;
  }
}

module.exports = ClaudeProvider;
