'use strict';

const logger = require('../utils/logger');

/**
 * Simple string similarity using bigram overlap.
 * Returns a value between 0 (completely different) and 1 (identical).
 */
function stringSimilarity(a, b) {
  if (!a || !b) return 0;
  const s1 = a.toLowerCase().trim();
  const s2 = b.toLowerCase().trim();
  if (s1 === s2) return 1;

  // Bigram intersection
  const bigrams1 = new Set();
  for (let i = 0; i < s1.length - 1; i++) {
    bigrams1.add(s1.slice(i, i + 2));
  }
  const bigrams2 = new Set();
  for (let i = 0; i < s2.length - 1; i++) {
    bigrams2.add(s2.slice(i, i + 2));
  }

  let intersection = 0;
  for (const bg of bigrams1) {
    if (bigrams2.has(bg)) intersection++;
  }

  const union = bigrams1.size + bigrams2.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Normalize a product title by stripping common noise words and special chars.
 */
function normalizeTitle(title) {
  if (!title) return '';
  return title
    .toLowerCase()
    .replace(/[^a-z0-9áéíóúãõâêîôûçàèìòùäëïöüñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Compare ranked results and group by product name similarity.
 *
 * For MVP: uses bigram similarity to group similar product titles.
 * Returns an array of product groups with store-level details.
 *
 * @param {Array<{title: string, url: string, price: number|null, store: string|null, snippet: string, score: number}>} rankedResults
 * @returns {Array<{product: string, stores: Array<{name: string, price: number|null, url: string, deliveryEstimate?: string}>, lowestPrice: number|null}>}
 */
function compare(rankedResults) {
  if (!Array.isArray(rankedResults) || rankedResults.length === 0) {
    logger.debug('No ranked results to compare');
    return [];
  }

  // Group by similarity
  const groups = [];

  for (const item of rankedResults) {
    const normalized = normalizeTitle(item.title);
    let added = false;

    for (const group of groups) {
      const groupNormalized = normalizeTitle(group.product);
      const sim = stringSimilarity(normalized, groupNormalized);

      if (sim >= 0.5) {
        // Add to this group
        group.stores.push({
          name: item.store || 'loja desconhecida',
          price: item.price,
          url: item.url,
          deliveryEstimate: null, // MVP: no delivery estimate data from SearXNG
        });

        // Update lowest price
        const prices = group.stores
          .map((s) => s.price)
          .filter((p) => p !== null);
        group.lowestPrice = prices.length > 0 ? Math.min(...prices) : null;

        added = true;
        break;
      }
    }

    if (!added) {
      // Start a new group
      const storeEntry = {
        name: item.store || 'loja desconhecida',
        price: item.price,
        url: item.url,
        deliveryEstimate: null,
      };

      groups.push({
        product: item.title,
        stores: [storeEntry],
        lowestPrice: item.price,
      });
    }
  }

  // Sort groups by lowest price ascending (cheapest first)
  groups.sort((a, b) => {
    if (a.lowestPrice === null && b.lowestPrice === null) return 0;
    if (a.lowestPrice === null) return 1;
    if (b.lowestPrice === null) return -1;
    return a.lowestPrice - b.lowestPrice;
  });

  logger.info('Comparison completed', {
    groupsCount: groups.length,
    totalItems: rankedResults.length,
  });

  return groups;
}

module.exports = { compare, stringSimilarity, normalizeTitle };
