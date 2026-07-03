'use strict';

const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');
const metrics = require('../utils/metrics');

/**
 * HTTP client for SearXNG.
 * Makes a POST request to the SearXNG instance and returns parsed results.
 *
 * @param {string} query - The product search query
 * @param {string[]} [categories] - Optional SearXNG categories (e.g., ['science', 'it', 'shopping'])
 * @returns {Promise<{results: object[], infoboxes: object[], suggestions: string[], unresponsive: string[]}>}
 */
async function search(query, categories) {
  const startTime = Date.now();

  const params = {
    q: query,
    format: 'json',
  };

  if (Array.isArray(categories) && categories.length > 0) {
    params.categories = categories.join(',');
  }

  const url = `${config.searxng.url}/search`;
  let lastError;

  for (let attempt = 1; attempt <= config.searxng.maxRetries; attempt++) {
    try {
      logger.debug('SearXNG search attempt', {
        attempt,
        query,
        url,
        params,
      });

      const response = await axios.post(url, null, {
        params,
        timeout: config.searxng.timeoutMs,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        validateStatus: (status) => status < 500,
      });

      const responseTime = (Date.now() - startTime) / 1000;
      metrics.searchLatency.observe({ query }, responseTime);

      if (response.status !== 200) {
        logger.warn('SearXNG returned non-200', {
          status: response.status,
          query,
          attempt,
        });

        if (attempt < config.searxng.maxRetries) {
          await sleep(config.searxng.retryBackoffMs);
          continue;
        }

        metrics.searchErrorsTotal.inc({ type: 'non_200' });
        return { results: [], infoboxes: [], suggestions: [], unresponsive: [] };
      }

      const body = response.data;

      const results = body.results || [];
      const infoboxes = body.infoboxes || [];
      const suggestions = body.suggestions || [];
      const unresponsive = body.unresponsive_engines || [];

      metrics.searchResultsCount.set({ query }, results.length);
      metrics.searchesTotal.inc({ status: 'success' });

      logger.info('SearXNG search completed', {
        query,
        resultsCount: results.length,
        responseTime: responseTime.toFixed(3) + 's',
      });

      return { results, infoboxes, suggestions, unresponsive };
    } catch (err) {
      lastError = err;
      metrics.searchErrorsTotal.inc({ type: err.code || 'unknown' });

      logger.warn('SearXNG search attempt failed', {
        attempt,
        query,
        error: err.message,
        code: err.code,
      });

      if (attempt < config.searxng.maxRetries) {
        await sleep(config.searxng.retryBackoffMs);
      }
    }
  }

  metrics.searchesTotal.inc({ status: 'error' });
  logger.error('SearXNG search exhausted retries', {
    query,
    error: lastError ? lastError.message : 'Unknown error',
  });

  return { results: [], infoboxes: [], suggestions: [], unresponsive: [] };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { search };
