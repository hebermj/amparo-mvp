'use strict';

const logger = require('../utils/logger');
const metrics = require('../utils/metrics');
const { retry } = require('../utils/retry');

/**
 * LLM Gateway — Main orchestrator for LLM requests with:
 * - Caching (simple Q&A only)
 * - Circuit breaker
 * - Multi-provider fallback (primary → fallback → secondary fallback)
 * - Retry logic
 * - Token usage and latency tracking
 */
class LLMGateway {
  /**
   * @param {Object} deps
   * @param {Object} deps.primaryProvider - Primary LLM provider instance
   * @param {Object} deps.fallbackProvider - First fallback LLM provider instance
   * @param {Object} deps.secondaryFallbackProvider - Second fallback LLM provider instance
   * @param {Object} deps.cache - LLMCache instance
   * @param {Object} deps.circuitBreakerPrimary - CircuitBreaker for primary provider
   * @param {Object} deps.circuitBreakerFallback - CircuitBreaker for fallback provider
   * @param {Object} deps.circuitBreakerSecondary - CircuitBreaker for secondary fallback
   * @param {Object} deps.tokenCounter - TokenCounter instance
   */
  constructor(deps) {
    this.primaryProvider = deps.primaryProvider;
    this.fallbackProvider = deps.fallbackProvider;
    this.secondaryFallbackProvider = deps.secondaryFallbackProvider;
    this.cache = deps.cache;
    this.circuitBreakerPrimary = deps.circuitBreakerPrimary;
    this.circuitBreakerFallback = deps.circuitBreakerFallback;
    this.circuitBreakerSecondary = deps.circuitBreakerSecondary;
    this.tokenCounter = deps.tokenCounter;
  }

  /**
   * Process a user message through the LLM pipeline.
   *
   * @param {string} userMessage - The user's message text
   * @param {Array<{role: string, content: string}>} conversationHistory - Previous messages
   * @param {string} systemPrompt - System prompt
   * @param {Array<Object>} [availableTools] - Tool definitions
   * @param {string} [sessionKey] - Session key for caching
   * @returns {Promise<{response: string, toolCalls: Array|null, usage: Object, provider: string, cached: boolean}>}
   */
  async complete(userMessage, conversationHistory, systemPrompt, availableTools = [], sessionKey = null) {
    const startTime = Date.now();

    // 1. Check cache (only for simple Q&A without tools)
    if (sessionKey && this.cache && (!availableTools || availableTools.length === 0)) {
      const cached = await this.cache.get(sessionKey, userMessage);
      if (cached) {
        logger.info('LLM response served from cache', { sessionKey });
        return {
          ...cached,
          provider: 'cache',
          cached: true,
          latencyMs: Date.now() - startTime,
        };
      }
    }

    // 2. Try providers in order with circuit breaker support
    let result;
    let providerUsed;

    // Build messages array
    const messages = [
      ...conversationHistory,
      { role: 'user', content: userMessage },
    ];

    // Try primary provider
    if (!this.circuitBreakerPrimary.shouldCircuitBreak()) {
      try {
        result = await this._callProvider(this.primaryProvider, this.circuitBreakerPrimary, systemPrompt, messages, availableTools);
        providerUsed = this.primaryProvider.name;
      } catch (err) {
        logger.warn('Primary LLM provider failed', {
          provider: this.primaryProvider.name,
          error: err.message,
        });
        this.circuitBreakerPrimary.recordFailure();
      }
    } else {
      logger.warn('Circuit breaker open for primary provider', {
        provider: this.primaryProvider.name,
      });
    }

    // Try fallback provider if primary failed
    if (!result && this.fallbackProvider) {
      if (!this.circuitBreakerFallback.shouldCircuitBreak()) {
        try {
          result = await this._callProvider(this.fallbackProvider, this.circuitBreakerFallback, systemPrompt, messages, availableTools);
          providerUsed = this.fallbackProvider.name;
        } catch (err) {
          logger.warn('Fallback LLM provider failed', {
            provider: this.fallbackProvider.name,
            error: err.message,
          });
          this.circuitBreakerFallback.recordFailure();
        }
      } else {
        logger.warn('Circuit breaker open for fallback provider', {
          provider: this.fallbackProvider.name,
        });
      }
    }

    // Try secondary fallback if both primary and fallback failed
    if (!result && this.secondaryFallbackProvider) {
      if (!this.circuitBreakerSecondary.shouldCircuitBreak()) {
        try {
          result = await this._callProvider(this.secondaryFallbackProvider, this.circuitBreakerSecondary, systemPrompt, messages, availableTools);
          providerUsed = this.secondaryFallbackProvider.name;
        } catch (err) {
          logger.warn('Secondary fallback LLM provider failed', {
            provider: this.secondaryFallbackProvider.name,
            error: err.message,
          });
          this.circuitBreakerSecondary.recordFailure();
        }
      } else {
        logger.warn('Circuit breaker open for secondary fallback provider', {
          provider: this.secondaryFallbackProvider.name,
        });
      }
    }

    // 5. If all providers failed, return a fallback message
    if (!result) {
      logger.error('All LLM providers failed', {
        primary: this.primaryProvider.name,
        fallback: this.fallbackProvider ? this.fallbackProvider.name : 'none',
        secondaryFallback: this.secondaryFallbackProvider ? this.secondaryFallbackProvider.name : 'none',
      });

      metrics.messagesProcessedTotal.inc({ status: 'error' });

      return {
        response: 'Desculpe, tive um problema ao processar sua mensagem. Pode tentar novamente?',
        toolCalls: null,
        usage: { promptTokens: 0, completionTokens: 0 },
        provider: 'fallback',
        cached: false,
        latencyMs: Date.now() - startTime,
      };
    }

    // 6. Cache response if no tool calls
    if (sessionKey && this.cache && !result.toolCalls) {
      await this.cache.set(sessionKey, userMessage, result);
    }

    // 7. Track token usage
    if (result.usage) {
      this.tokenCounter.trackUsage(providerUsed, result.usage.promptTokens, result.usage.completionTokens);
    }

    // Track latency
    const latencySeconds = (Date.now() - startTime) / 1000;
    metrics.llmLatencySeconds.observe({ provider: providerUsed }, latencySeconds);
    metrics.messagesProcessedTotal.inc({ status: 'success' });

    logger.info('LLM response completed', {
      provider: providerUsed,
      hasToolCalls: !!(result.toolCalls && result.toolCalls.length > 0),
      toolCallsCount: result.toolCalls ? result.toolCalls.length : 0,
      promptTokens: result.usage ? result.usage.promptTokens : 0,
      completionTokens: result.usage ? result.usage.completionTokens : 0,
      latencyMs: Date.now() - startTime,
    });

    return {
      ...result,
      provider: providerUsed,
      cached: false,
      latencyMs: Date.now() - startTime,
    };
  }

  /**
   * Call a provider with retry logic.
   *
   * @param {Object} provider - Provider instance
   * @param {Object} circuitBreaker - Circuit breaker for this provider
   * @param {string} systemPrompt
   * @param {Array} messages
   * @param {Array} tools
   * @returns {Promise<Object>} Provider response
   */
  async _callProvider(provider, circuitBreaker, systemPrompt, messages, tools) {
    const result = await retry(
      () => provider.complete(systemPrompt, messages, tools),
      2, // max 2 attempts per provider
      1000 // base delay 1s
    );

    circuitBreaker.recordSuccess();
    return result.result;
  }

  /**
   * Get all circuit breaker states.
   * @returns {Object}
   */
  getCircuitBreakerStates() {
    return {
      primary: this.circuitBreakerPrimary.getState(),
      fallback: this.circuitBreakerFallback ? this.circuitBreakerFallback.getState() : null,
      secondaryFallback: this.circuitBreakerSecondary ? this.circuitBreakerSecondary.getState() : null,
    };
  }
}

module.exports = LLMGateway;
