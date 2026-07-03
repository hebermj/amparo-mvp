'use strict';

const logger = require('../utils/logger');
const metrics = require('../utils/metrics');

/**
 * Redis-based LLM response cache.
 * Only caches simple Q&A responses (no tool calls).
 */
class LLMCache {
  /**
   * @param {Object} redisClient - ioredis client instance
   * @param {number} ttlSeconds - Time-to-live in seconds
   */
  constructor(redisClient, ttlSeconds = 3600) {
    this.redis = redisClient;
    this.ttl = ttlSeconds;
  }

  /**
   * Build a cache key from a session identifier and message content.
   *
   * @param {string} sessionKey - e.g., the WhatsApp phone number or session ID
   * @param {string} messageContent - The user's message text
   * @returns {string} Redis key
   */
  _buildKey(sessionKey, messageContent) {
    // Normalise the message to improve cache hits
    const normalised = messageContent.toLowerCase().trim().replace(/\s+/g, ' ');
    return `llm:${sessionKey}:${normalised}`;
  }

  /**
   * Get a cached response.
   *
   * @param {string} sessionKey - Session identifier
   * @param {string} messageContent - User message
   * @returns {Promise<Object|null>} Cached response or null
   */
  async get(sessionKey, messageContent) {
    try {
      const key = this._buildKey(sessionKey, messageContent);
      const cached = await this.redis.get(key);

      if (cached) {
        metrics.llmCacheHitsTotal.inc();
        logger.debug('LLM cache hit', { sessionKey, key });
        return JSON.parse(cached);
      }

      metrics.llmCacheMissesTotal.inc();
      return null;
    } catch (err) {
      logger.warn('LLM cache get error', { error: err.message, sessionKey });
      return null;
    }
  }

  /**
   * Cache a response (only if no tool calls are present).
   *
   * @param {string} sessionKey - Session identifier
   * @param {string} messageContent - Original user message
   * @param {Object} responseData - The response to cache {response, toolCalls, usage}
   * @returns {Promise<boolean>} Whether the response was cached
   */
  async set(sessionKey, messageContent, responseData) {
    // Only cache simple Q&A responses, not tool calls
    if (responseData.toolCalls && responseData.toolCalls.length > 0) {
      return false;
    }

    try {
      const key = this._buildKey(sessionKey, messageContent);
      const value = JSON.stringify({
        response: responseData.response,
        usage: responseData.usage || { promptTokens: 0, completionTokens: 0 },
        cachedAt: new Date().toISOString(),
      });

      await this.redis.setex(key, this.ttl, value);
      logger.debug('LLM cache set', { sessionKey, key, ttl: this.ttl });
      return true;
    } catch (err) {
      logger.warn('LLM cache set error', { error: err.message, sessionKey });
      return false;
    }
  }

  /**
   * Invalidate a cached response.
   *
   * @param {string} sessionKey - Session identifier
   * @param {string} messageContent - Original user message
   * @returns {Promise<boolean>}
   */
  async invalidate(sessionKey, messageContent) {
    try {
      const key = this._buildKey(sessionKey, messageContent);
      await this.redis.del(key);
      logger.debug('LLM cache invalidated', { sessionKey, key });
      return true;
    } catch (err) {
      logger.warn('LLM cache invalidate error', { error: err.message, sessionKey });
      return false;
    }
  }
}

module.exports = LLMCache;
