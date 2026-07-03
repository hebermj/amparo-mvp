'use strict';

const metrics = require('../utils/metrics');
const logger = require('../utils/logger');

/**
 * Simple token counter for LLM requests.
 * Uses approximate estimation: ~4 characters per token for Portuguese.
 * This is a rough estimate — real tokenizers vary by provider/model.
 */
class TokenCounter {
  constructor() {
    this.trackedUsage = {
      deepseek: { promptTokens: 0, completionTokens: 0 },
      claude: { promptTokens: 0, completionTokens: 0 },
      openai: { promptTokens: 0, completionTokens: 0 },
    };
  }

  /**
   * Estimate the number of tokens in a text string.
   * For Portuguese/English text, ~4 characters per token is a reasonable approximation.
   *
   * @param {string} text - Text to estimate
   * @returns {number} Estimated token count
   */
  estimateTokens(text) {
    if (!text || typeof text !== 'string') return 0;

    // Count characters (including spaces)
    const charCount = text.length;

    // For Portuguese, ~4 chars per token is a reasonable estimate
    // Special characters and punctuation add tokens, but this is good enough for monitoring
    const estimatedTokens = Math.ceil(charCount / 4);

    // Ensure at least 1 token for non-empty text
    return Math.max(estimatedTokens, text.trim().length > 0 ? 1 : 0);
  }

  /**
   * Estimate tokens for a conversation history.
   *
   * @param {Array<{role: string, content: string}>} messages
   * @returns {number} Total estimated tokens
   */
  estimateConversationTokens(messages) {
    if (!Array.isArray(messages)) return 0;

    return messages.reduce((total, msg) => {
      let count = this.estimateTokens(msg.content || '');
      // Add overhead for role markers (~4 tokens per message)
      count += 4;
      return total + count;
    }, 0);
  }

  /**
   * Track usage for a provider and update Prometheus metrics.
   *
   * @param {string} provider - Provider name
   * @param {number} promptTokens - Prompt tokens
   * @param {number} completionTokens - Completion tokens
   */
  trackUsage(provider, promptTokens, completionTokens) {
    if (!this.trackedUsage[provider]) {
      this.trackedUsage[provider] = { promptTokens: 0, completionTokens: 0 };
    }

    this.trackedUsage[provider].promptTokens += promptTokens;
    this.trackedUsage[provider].completionTokens += completionTokens;

    // Update Prometheus metrics
    metrics.llmTokensTotal.inc({ provider, type: 'prompt' }, promptTokens);
    metrics.llmTokensTotal.inc({ provider, type: 'completion' }, completionTokens);

    logger.debug('Token usage tracked', {
      provider,
      promptTokens,
      completionTokens,
      totalTracked: this.trackedUsage[provider],
    });
  }

  /**
   * Get total tracked usage across all providers.
   *
   * @returns {Object}
   */
  getTotalUsage() {
    return {
      ...this.trackedUsage,
      total: Object.values(this.trackedUsage).reduce(
        (acc, curr) => ({
          promptTokens: acc.promptTokens + curr.promptTokens,
          completionTokens: acc.completionTokens + curr.completionTokens,
        }),
        { promptTokens: 0, completionTokens: 0 }
      ),
    };
  }

  /**
   * Reset tracked usage counters.
   */
  reset() {
    Object.keys(this.trackedUsage).forEach((key) => {
      this.trackedUsage[key] = { promptTokens: 0, completionTokens: 0 };
    });
  }
}

module.exports = TokenCounter;
