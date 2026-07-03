'use strict';

const promClient = require('prom-client');

// Desabilita coleta default de métricas do Node.js para evitar
// conflito com o gateway. Ativamos seletivamente as que interessam.
promClient.collectDefaultMetrics({
  prefix: 'stt_',
  gcDurationBuckets: [0.001, 0.01, 0.1, 1, 5],
  eventLoopMonitoringPrecision: 10,
});

// ── Histograma: latência da transcrição ─────────────────────────
const sttLatencySeconds = new promClient.Histogram({
  name: 'stt_latency_seconds',
  help: 'Latência da transcrição de áudio (download + STT) em segundos',
  labelNames: ['provider'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 15, 30, 60, 120],
});

// ── Gauge: confiança da transcrição ─────────────────────────────
const sttConfidence = new promClient.Gauge({
  name: 'stt_confidence',
  help: 'Confiança (0–1) da transcrição retornada pelo STT',
  labelNames: ['provider'],
});

// ── Counter: total de transcrições (sucesso/falha) ─────────────
const sttTotal = new promClient.Counter({
  name: 'stt_total',
  help: 'Total de requisições de transcrição',
  labelNames: ['status', 'provider'],
});

// ── Counter: total de mensagens processadas pelo consumidor ────
const messagesProcessedTotal = new promClient.Counter({
  name: 'stt_messages_processed_total',
  help: 'Total de mensagens consumidas da fila transcricao',
});

// ── Utilitário para registrar latência ─────────────────────────
function recordLatency(seconds, provider) {
  sttLatencySeconds.observe({ provider }, seconds);
}

// ── Utilitário para registrar confiança ────────────────────────
function recordConfidence(value, provider) {
  sttConfidence.set({ provider }, value);
}

// ── Utilitário para registrar resultado ────────────────────────
function recordTranscription(status, provider) {
  sttTotal.inc({ status, provider });
}

// ── Utilitário para incrementar mensagens processadas ─────────
function incrementMessagesProcessed() {
  messagesProcessedTotal.inc();
}

// ── Retorna o registro do Prometheus para o endpoint /metrics ──
async function getMetrics() {
  return promClient.register.metrics();
}

module.exports = {
  promClient,
  recordLatency,
  recordConfidence,
  recordTranscription,
  incrementMessagesProcessed,
  getMetrics,
};
