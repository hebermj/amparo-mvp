'use strict';

const logger = require('../utils/logger');
const metrics = require('../utils/metrics');

/**
 * Circuit breaker state machine for LLM providers.
 *
 * State machine: CLOSED → OPEN → HALF_OPEN → CLOSED (or back to OPEN)
 *
 * CLOSED:   Normal operation. Requests pass through.
 * OPEN:     Circuit is tripped. Requests are rejected immediately.
 * HALF_OPEN: Waiting for a successful request to reset the circuit.
 */
class CircuitBreaker {
  /**
   * @param {string} providerName - Name of the LLM provider
   * @param {Object} options
   * @param {number} [options.threshold=5] - Consecutive failures before opening circuit
   * @param {number} [options.windowMs=60000] - Time window for counting failures (ms)
   * @param {number} [options.autoResetMs=30000] - Time before moving from OPEN to HALF_OPEN (ms)
   */
  constructor(providerName, options = {}) {
    this.provider = providerName;
    this.threshold = options.threshold || 5;
    this.windowMs = options.windowMs || 60000;
    this.autoResetMs = options.autoResetMs || 30000;

    // State
    this.state = 'CLOSED'; // CLOSED | OPEN | HALF_OPEN
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
    this.lastStateChangeTime = Date.now();

    // For sliding window: track failure timestamps
    this.failureTimestamps = [];

    this._updateMetrics();

    logger.info('Circuit breaker initialized', {
      provider: this.provider,
      threshold: this.threshold,
      windowMs: this.windowMs,
      autoResetMs: this.autoResetMs,
    });
  }

  /**
   * Check if the circuit is open (i.e., requests should not be sent).
   *
   * @returns {boolean} true if the circuit is open
   */
  shouldCircuitBreak() {
    this._pruneFailures();

    if (this.state === 'CLOSED') {
      return false;
    }

    if (this.state === 'OPEN') {
      // Check if enough time has passed to auto-reset to HALF_OPEN
      if (Date.now() - this.lastStateChangeTime >= this.autoResetMs) {
        this._transitionTo('HALF_OPEN');
        return false; // Allow one test request
      }
      return true; // Circuit is open, reject
    }

    // HALF_OPEN — allow one request through as a test
    return false;
  }

  /**
   * Record a successful LLM call.
   */
  recordSuccess() {
    this.successCount++;
    this._pruneFailures();

    if (this.state === 'HALF_OPEN') {
      // One successful call in HALF_OPEN resets the circuit
      this.failureCount = 0;
      this.failureTimestamps = [];
      this._transitionTo('CLOSED');
    }
  }

  /**
   * Record a failed LLM call.
   */
  recordFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    this.failureTimestamps.push(this.lastFailureTime);
    this._pruneFailures();

    if (this.state === 'CLOSED') {
      // Check if we've hit the threshold within the window
      if (this.failureTimestamps.length >= this.threshold) {
        this._transitionTo('OPEN');
      }
    } else if (this.state === 'HALF_OPEN') {
      // A failure in HALF_OPEN means the provider is still down
      this._transitionTo('OPEN');
    }
    // In OPEN state, we just count failures
  }

  /**
   * Get current circuit breaker state.
   *
   * @returns {{state: string, provider: string, failureCount: number, successCount: number}}
   */
  getState() {
    return {
      provider: this.provider,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      lastStateChangeTime: this.lastStateChangeTime,
    };
  }

  /**
   * Transition to a new state.
   */
  _transitionTo(newState) {
    const oldState = this.state;
    this.state = newState;
    this.lastStateChangeTime = Date.now();
    this._updateMetrics();

    logger.warn('Circuit breaker state transition', {
      provider: this.provider,
      from: oldState,
      to: newState,
      failureCount: this.failureCount,
      successCount: this.successCount,
    });
  }

  /**
   * Remove failure timestamps outside the window.
   */
  _pruneFailures() {
    const cutoff = Date.now() - this.windowMs;
    this.failureTimestamps = this.failureTimestamps.filter((t) => t >= cutoff);
  }

  /**
   * Update Prometheus metrics for circuit breaker state.
   * 0 = CLOSED, 1 = OPEN, 2 = HALF_OPEN
   */
  _updateMetrics() {
    let value;
    switch (this.state) {
      case 'CLOSED': value = 0; break;
      case 'OPEN': value = 1; break;
      case 'HALF_OPEN': value = 2; break;
      default: value = 0;
    }
    metrics.llmCircuitBreakerState.set({ provider: this.provider }, value);
  }
}

module.exports = CircuitBreaker;
