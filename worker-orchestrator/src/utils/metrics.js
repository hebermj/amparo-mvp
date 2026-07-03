'use strict';

const promClient = require('prom-client');

// Collect default metrics (event loop lag, memory, etc.)
promClient.collectDefaultMetrics({ prefix: 'amparo_orchestrator_' });

// ── LLM Latency Histogram ────────────────────────────────────────────
const llmLatencySeconds = new promClient.Histogram({
  name: 'amparo_orchestrator_llm_latency_seconds',
  help: 'Latency of LLM provider requests',
  labelNames: ['provider'],
  buckets: [0.1, 0.5, 1.0, 2.0, 4.0, 8.0, 15.0, 30.0, 60.0],
});

// ── LLM Token Counters ───────────────────────────────────────────────
const llmTokensTotal = new promClient.Counter({
  name: 'amparo_orchestrator_llm_tokens_total',
  help: 'Total tokens used by LLM providers',
  labelNames: ['provider', 'type'], // type = prompt or completion
});

// ── LLM Cache Metrics ────────────────────────────────────────────────
const llmCacheHitsTotal = new promClient.Counter({
  name: 'amparo_orchestrator_llm_cache_hits_total',
  help: 'Total number of LLM cache hits',
});

const llmCacheMissesTotal = new promClient.Counter({
  name: 'amparo_orchestrator_llm_cache_misses_total',
  help: 'Total number of LLM cache misses',
});

// ── Circuit Breaker State ────────────────────────────────────────────
const llmCircuitBreakerState = new promClient.Gauge({
  name: 'amparo_orchestrator_llm_circuit_breaker_state',
  help: 'Circuit breaker state: 0=closed, 1=open, 2=half-open',
  labelNames: ['provider'],
});

// ── Messages Processed ───────────────────────────────────────────────
const messagesProcessedTotal = new promClient.Counter({
  name: 'amparo_orchestrator_messages_processed_total',
  help: 'Total messages processed',
  labelNames: ['status'], // status = success or error
});

// ── Tool Calls ───────────────────────────────────────────────────────
const toolCallsTotal = new promClient.Counter({
  name: 'amparo_orchestrator_tool_calls_total',
  help: 'Total tool calls executed',
  labelNames: ['tool'], // tool = search, profile, consent, confirm, checkout
});

module.exports = {
  promClient,
  llmLatencySeconds,
  llmTokensTotal,
  llmCacheHitsTotal,
  llmCacheMissesTotal,
  llmCircuitBreakerState,
  messagesProcessedTotal,
  toolCallsTotal,
};
