'use strict';

const logger = require('../utils/logger');

/**
 * Session management for user conversations via Redis.
 * Each session stores conversation history and context.
 */
class SessionManager {
  /**
   * @param {Object} redisClient - ioredis client
   */
  constructor(redisClient) {
    this.redis = redisClient;
  }

  /**
   * Build the Redis key for a session.
   * @param {string} whatsappPhone - User's WhatsApp phone number
   * @returns {string}
   */
  _buildKey(whatsappPhone) {
    return `session:${whatsappPhone}`;
  }

  /**
   * Get or create a session for a WhatsApp user.
   *
   * @param {string} whatsappPhone - User's WhatsApp phone number
   * @returns {Promise<{sessionId: string, context: Object, history: Array}>}
   */
  async getOrCreateSession(whatsappPhone) {
    const key = this._buildKey(whatsappPhone);

    try {
      const raw = await this.redis.get(key);
      if (raw) {
        const session = JSON.parse(raw);
        logger.debug('Session found', { whatsappPhone, historyLength: session.history ? session.history.length : 0 });
        return session;
      }
    } catch (err) {
      logger.warn('Error reading session from Redis', { error: err.message, whatsappPhone });
    }

    // Create new session
    const session = {
      sessionId: `${whatsappPhone}_${Date.now()}`,
      whatsappPhone,
      context: {
        currentStep: 'greeting', // greeting | searching | choosing | confirming_address | confirming_checkout | completed
        pendingData: {},
        consent: {
          address: false,
        },
      },
      history: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      await this.redis.setex(key, 86400, JSON.stringify(session)); // 24h TTL
      logger.info('New session created', { whatsappPhone, sessionId: session.sessionId });
    } catch (err) {
      logger.warn('Error saving new session to Redis', { error: err.message, whatsappPhone });
    }

    return session;
  }

  /**
   * Update a session.
   *
   * Accepts either:
   *   (sessionObject) — full session with .whatsappPhone, .context, .history
   *   (whatsappPhone, context, history) — individual fields
   *
   * @param {string|Object} sessionOrPhone - Session object OR whatsapp phone
   * @param {Object} [context] - Updated context (merged)
   * @param {Array} [history] - Updated conversation history array
   * @returns {Promise<boolean>} Success
   */
  async updateSession(sessionOrPhone, context, history) {
    let whatsappPhone, mergedContext, mergedHistory;

    if (typeof sessionOrPhone === 'object' && sessionOrPhone !== null) {
      // Called as: updateSession(sessionObject)
      whatsappPhone = sessionOrPhone.whatsappPhone;
      // Build context: if session.context has nested structure, merge the whole thing
      mergedContext = sessionOrPhone.context;
      mergedHistory = sessionOrPhone.history;
    } else {
      // Called as: updateSession(whatsappPhone, context, history)
      whatsappPhone = sessionOrPhone;
      mergedContext = context;
      mergedHistory = history;
    }

    if (!whatsappPhone) {
      logger.warn('Cannot update session: no whatsappPhone provided');
      return false;
    }

    const key = this._buildKey(whatsappPhone);

    try {
      const raw = await this.redis.get(key);
      if (!raw) {
        logger.warn('Cannot update non-existent session', { whatsappPhone });
        return false;
      }

      const session = JSON.parse(raw);

      if (mergedContext) {
        session.context = { ...session.context, ...mergedContext };
      }

      if (mergedHistory) {
        // Keep only last 6 messages
        session.history = mergedHistory.slice(-6);
      }

      session.updatedAt = new Date().toISOString();

      await this.redis.setex(key, 86400, JSON.stringify(session)); // Reset 24h TTL
      return true;
    } catch (err) {
      logger.warn('Error updating session', { error: err.message, whatsappPhone });
      return false;
    }
  }

  /**
   * Get session data without creating one.
   *
   * @param {string} whatsappPhone
   * @returns {Promise<Object|null>}
   */
  async getSession(whatsappPhone) {
    const key = this._buildKey(whatsappPhone);

    try {
      const raw = await this.redis.get(key);
      if (raw) {
        return JSON.parse(raw);
      }
      return null;
    } catch (err) {
      logger.warn('Error reading session', { error: err.message, whatsappPhone });
      return null;
    }
  }

  /**
   * Close / mark a session as inactive.
   *
   * @param {string} whatsappPhone
   * @returns {Promise<boolean>}
   */
  async closeSession(whatsappPhone) {
    const key = this._buildKey(whatsappPhone);

    try {
      const raw = await this.redis.get(key);
      if (raw) {
        const session = JSON.parse(raw);
        session.context.currentStep = 'closed';
        session.updatedAt = new Date().toISOString();
        // Keep in Redis but mark as inactive (TTL will expire)
        await this.redis.setex(key, 3600, JSON.stringify(session)); // 1h TTL for closed sessions
        logger.info('Session closed', { whatsappPhone });
      }
      return true;
    } catch (err) {
      logger.warn('Error closing session', { error: err.message, whatsappPhone });
      return false;
    }
  }

  /**
   * Delete a session entirely (right to be forgotten / LGPD).
   *
   * @param {string} whatsappPhone
   * @returns {Promise<boolean>}
   */
  async deleteSession(whatsappPhone) {
    const key = this._buildKey(whatsappPhone);

    try {
      await this.redis.del(key);
      logger.info('Session deleted', { whatsappPhone });
      return true;
    } catch (err) {
      logger.warn('Error deleting session', { error: err.message, whatsappPhone });
      return false;
    }
  }
}

module.exports = SessionManager;
