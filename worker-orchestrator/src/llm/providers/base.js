'use strict';

/**
 * Abstract base class for LLM providers.
 * Subclasses must implement _makeRequest().
 */
class BaseProvider {
  /**
   * @param {string} name - Provider name (e.g., 'deepseek', 'claude', 'openai')
   * @param {Object} config - Provider-specific configuration
   */
  constructor(name, config) {
    if (new.target === BaseProvider) {
      throw new Error('Cannot instantiate abstract class BaseProvider');
    }
    this.name = name;
    this.config = config;
  }

  /**
   * Complete a chat conversation.
   *
   * @param {string} systemPrompt - System-level instruction
   * @param {Array<{role: string, content: string}>} messages - Conversation history + new message
   * @param {Array<Object>} [tools] - Tool definitions (OpenAI function calling format)
   * @returns {Promise<{response: string, toolCalls: Array|null, usage: {promptTokens: number, completionTokens: number}}>}
   */
  async complete(systemPrompt, messages, tools = []) {
    throw new Error('Subclasses must implement complete()');
  }

  /**
   * Parse the raw provider response into a standardised format.
   *
   * @param {Object} rawResponse - Raw response from the provider API
   * @returns {{response: string, toolCalls: Array|null, usage: {promptTokens: number, completionTokens: number}}}
   */
  parseResponse(rawResponse) {
    throw new Error('Subclasses must implement parseResponse()');
  }

  /**
   * Build the request body for the provider API.
   *
   * @param {string} systemPrompt
   * @param {Array} messages
   * @param {Array} tools
   * @returns {Object}
   */
  buildRequestBody(systemPrompt, messages, tools) {
    throw new Error('Subclasses must implement buildRequestBody()');
  }

  /**
   * Extract total tokens from a usage object.
   * @param {Object} usage - Provider-specific usage data
   * @returns {{promptTokens: number, completionTokens: number}}
   */
  extractUsage(usage) {
    return {
      promptTokens: (usage && usage.prompt_tokens) || 0,
      completionTokens: (usage && usage.completion_tokens) || 0,
    };
  }
}

module.exports = BaseProvider;
