'use strict';

const logger = require('./logger');

/**
 * Generic retry utility with exponential backoff.
 * Only retries on network errors and 5xx server errors.
 *
 * @param {Function} fn - Async function to retry
 * @param {number} [maxAttempts=3] - Maximum number of attempts
 * @param {number} [baseDelay=1000] - Base delay in ms (doubles each attempt)
 * @returns {Promise<{result: *, attempts: number, totalTime: number}>}
 */
async function retry(fn, maxAttempts = 3, baseDelay = 1000) {
  const startTime = Date.now();
  let lastError;
  let attempts = 0;

  for (attempts = 1; attempts <= maxAttempts; attempts++) {
    try {
      const result = await fn();
      return {
        result,
        attempts,
        totalTime: Date.now() - startTime,
      };
    } catch (err) {
      lastError = err;

      // Determine if we should retry based on error type
      const shouldRetry = isRetryableError(err);

      if (!shouldRetry || attempts >= maxAttempts) {
        break;
      }

      const delay = baseDelay * Math.pow(2, attempts - 1);
      logger.warn(`Retry attempt ${attempts}/${maxAttempts} after ${delay}ms`, {
        error: err.message,
        attemptsRemaining: maxAttempts - attempts,
      });

      await sleep(delay);
    }
  }

  throw Object.assign(lastError, {
    attempts,
    totalTime: Date.now() - startTime,
    maxAttempts,
  });
}

/**
 * Determine if an error is retryable.
 * Retry on: network errors (no status), 5xx, rate limiting (429).
 * Do NOT retry on: 4xx client errors (except 429).
 */
function isRetryableError(err) {
  // Network / connection errors have no status code
  if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET' ||
      err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND' ||
      err.code === 'EPIPE' || err.type === 'system' || err.code === 'EAI_AGAIN') {
    return true;
  }

  // HTTP status codes
  const status = err.status || err.statusCode;
  if (!status) {
    // Unknown error type — retry if it looks like a network issue
    return err.message && (
      err.message.includes('timeout') ||
      err.message.includes('ECONNREFUSED') ||
      err.message.includes('network') ||
      err.message.includes('fetch failed')
    );
  }

  // 429 Too Many Requests — retry
  if (status === 429) return true;

  // 5xx server errors — retry
  if (status >= 500 && status < 600) return true;

  // 4xx client errors — do NOT retry
  return false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { retry, isRetryableError };
