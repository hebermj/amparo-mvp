'use strict';

/**
 * Price suspicion detection.
 * If a product's price is significantly lower than the average,
 * it may be suspicious (wrong data, placeholder price, etc.).
 */

/**
 * Threshold: if price < 50% of averagePrice, flag as suspicious.
 *
 * @param {string} product - Product name
 * @param {number|null} price - The price to check
 * @param {number} averagePrice - The reference average price
 * @returns {{ suspicious: boolean, reason: string }}
 */
function checkPriceSuspect(product, price, averagePrice) {
  if (price === null || price === undefined) {
    return {
      suspicious: false,
      reason: 'No price data available, cannot evaluate',
    };
  }

  if (averagePrice <= 0) {
    return {
      suspicious: false,
      reason: 'Invalid average price for comparison',
    };
  }

  const ratio = price / averagePrice;

  if (ratio < 0.5) {
    return {
      suspicious: true,
      reason: `Price R$${price.toFixed(2)} is ${Math.round((1 - ratio) * 100)}% below the average of R$${averagePrice.toFixed(2)} — possible data error or placeholder`,
    };
  }

  if (ratio > 3.0) {
    return {
      suspicious: true,
      reason: `Price R$${price.toFixed(2)} is ${Math.round((ratio - 1) * 100)}% above the average of R$${averagePrice.toFixed(2)} — possible premium/special item`,
    };
  }

  return {
    suspicious: false,
    reason: 'Price within normal range',
  };
}

module.exports = { checkPriceSuspect };
