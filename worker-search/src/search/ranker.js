'use strict';

const logger = require('../utils/logger');
const config = require('../config');

/**
 * Price regex: matches Brazilian Real amounts like R$ 1.234,56 or R$ 1.234,56 or R$1234,56
 */
const PRICE_REGEX = /R\$\s*([0-9]{1,3}(?:\.[0-9]{3})*(?:,[0-9]{2})?)/gi;

/**
 * Normalize a Brazilian price string to a float.
 * "R$ 1.234,56" -> 1234.56
 */
function parsePrice(text) {
  if (!text) return null;
  const match = PRICE_REGEX.exec(text);
  PRICE_REGEX.lastIndex = 0;
  if (!match) return null;

  let raw = match[1];
  // Remove thousand separators
  raw = raw.replace(/\./g, '');
  // Replace decimal comma with dot
  raw = raw.replace(',', '.');
  const value = parseFloat(raw);
  return isNaN(value) ? null : value;
}

/**
 * Score a single search result based on how well it matches the query.
 *
 * Scoring strategy:
 *  - +50 if the query term appears in the title (case-insensitive)
 *  - +30 if the query term appears in the snippet/content (case-insensitive)
 *  - +20 if the title contains multiple query words
 *  - +10 if snippet contains multiple query words
 *  - Up to +15 based on SearXNG's own `score` field (normalised)
 *  - -50 if the result title/snippet mentions unrelated categories
 *    (e.g., query "geladeira", result mentions "carro" or "pneu")
 *
 * @param {object} result - A single SearXNG result object
 * @param {string[]} queryTerms - Lowercased, trimmed query words
 * @returns {number} Score
 */
function scoreResult(result, queryTerms) {
  if (!result || !queryTerms || queryTerms.length === 0) return 0;

  const title = (result.title || '').toLowerCase();
  const snippet = (result.content || result.snippet || '').toLowerCase();
  const resultScore = typeof result.score === 'number' ? result.score : 0;

  let score = 0;

  // Title matches
  let titleMatchCount = 0;
  for (const term of queryTerms) {
    if (title.includes(term)) {
      titleMatchCount++;
    }
  }
  score += titleMatchCount * 50;

  // Snippet matches
  let snippetMatchCount = 0;
  for (const term of queryTerms) {
    if (snippet.includes(term)) {
      snippetMatchCount++;
    }
  }
  score += snippetMatchCount * 30;

  // Bonus for multi-word matches in title
  if (titleMatchCount > 1) {
    score += 20;
  }
  // Bonus for multi-word matches in snippet
  if (snippetMatchCount > 1) {
    score += 10;
  }

  // SearXNG score contribution (normalised, typical scores are 1-100)
  if (resultScore > 0) {
    score += Math.min(resultScore / 10, 15);
  }

  // Penalty: if query has specific terms and result seems unrelated
  // This is a basic check — if the result mentions terms clearly outside the query's domain
  const unrelatedTerms = detectUnrelatedTerms(queryTerms, title, snippet);
  score -= unrelatedTerms * 50;

  return Math.max(score, 0);
}

/**
 * Heuristic: if the query is about a specific domain and the result
 * mentions terms from a very different domain, penalise it.
 */
const DOMAIN_KEYWORDS = {
  eletro: ['geladeira', 'refrigerador', 'freezer', 'fogão', 'microondas', 'lavadora', 'secadora'],
  carro: ['carro', 'automóvel', 'veículo', 'pneu', 'roda', 'motor'],
  informatica: ['computador', 'notebook', 'mouse', 'teclado', 'monitor', 'hd', 'ssd', 'placa'],
  movel: ['sofá', 'cadeira', 'mesa', 'armário', 'cama', 'estante'],
};

function detectUnrelatedTerms(queryTerms, title, snippet) {
  // Determine query domain by checking which domain has most overlap
  let queryDomain = null;
  let maxOverlap = 0;

  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    const overlap = keywords.filter((kw) =>
      queryTerms.some((qt) => kw.includes(qt) || qt.includes(kw))
    ).length;
    if (overlap > maxOverlap) {
      maxOverlap = overlap;
      queryDomain = domain;
    }
  }

  if (!queryDomain) return 0;

  // Now check if result mentions other domain keywords
  let unrelatedCount = 0;
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    if (domain === queryDomain) continue;
    const found = keywords.some(
      (kw) => title.includes(kw) || snippet.includes(kw)
    );
    if (found) unrelatedCount++;
  }

  return unrelatedCount;
}

/**
 * Rank and filter search results.
 *
 * @param {object[]} results - Raw SearXNG results
 * @param {string} query - The original search query
 * @returns {Array<{title: string, url: string, price: number|null, store: string|null, snippet: string, score: number}>}
 */
function rank(results, query) {
  if (!Array.isArray(results) || results.length === 0) {
    logger.debug('No results to rank');
    return [];
  }

  const queryTerms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1);

  if (queryTerms.length === 0) {
    logger.debug('Query has no meaningful terms after filtering');
    return [];
  }

  const scored = results.map((result) => {
    const score = scoreResult(result, queryTerms);
    const price = parsePrice(result.content || result.snippet || '') || parsePrice(result.title);

    // Extract store/engine from result metadata
    const store = result.engine || result.source || null;

    return {
      title: result.title || 'Sem título',
      url: result.url || '',
      price,
      store,
      snippet: result.content || result.snippet || '',
      score,
    };
  });

  // Filter out zero-score results (completely irrelevant)
  const relevant = scored.filter((item) => item.score > 0);

  // Sort by score descending
  relevant.sort((a, b) => b.score - a.score);

  const topN = relevant.slice(0, config.ranking.topN);

  logger.info('Ranking completed', {
    totalResults: results.length,
    relevantCount: relevant.length,
    topN: topN.length,
    query,
  });

  return topN;
}

module.exports = { rank, parsePrice, scoreResult };
