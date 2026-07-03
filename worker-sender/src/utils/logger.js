'use strict';

const config = require('../config');

/**
 * Structured JSON logger.
 * Output format: { level, timestamp, service, message, traceId?, userId?, ...extra }
 */
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

function log(level, message, extra = {}) {
  if (LEVELS[level] === undefined) level = 'info';

  const entry = {
    level,
    timestamp: new Date().toISOString(),
    service: config.serviceName,
    message,
  };

  // Copy traceId, userId if present
  if (extra.traceId) {
    entry.traceId = extra.traceId;
  }
  if (extra.userId) {
    entry.userId = extra.userId;
  }

  // Handle error objects specially
  if (extra.err) {
    entry.error = extra.err.message || String(extra.err);
    if (extra.err.stack) {
      entry.errorStack = extra.err.stack.split('\n').slice(0, 4).join(' ');
    }
  }

  // Spread remaining extra fields (excluding reserved keys)
  for (const [key, value] of Object.entries(extra)) {
    if (key !== 'traceId' && key !== 'userId' && key !== 'err') {
      entry[key] = value;
    }
  }

  const output = JSON.stringify(entry);

  if (level === 'error') {
    process.stderr.write(output + '\n');
  } else {
    process.stdout.write(output + '\n');
  }
}

const logger = {
  error: (message, extra) => log('error', message, extra),
  warn: (message, extra) => log('warn', message, extra),
  info: (message, extra) => log('info', message, extra),
  debug: (message, extra) => log('debug', message, extra),
};

module.exports = logger;
