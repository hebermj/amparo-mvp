'use strict';

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

const currentLevel = LEVELS[process.env.LOG_LEVEL || 'debug'] ?? 2;

function safeStringify(obj) {
  try {
    return JSON.stringify(obj, (key, value) => {
      if (value instanceof Error) {
        return { message: value.message, stack: value.stack, ...value };
      }
      return value;
    });
  } catch {
    return String(obj);
  }
}

function log(level, message, meta = {}) {
  if (LEVELS[level] === undefined || LEVELS[level] > currentLevel) return;

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: 'amparo-telegram',
    message,
    ...meta,
  };

  const stream = level === 'error' ? process.stderr : process.stdout;
  stream.write(safeStringify(entry) + '\n');
}

const logger = {
  error: (msg, meta) => log('error', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  info: (msg, meta) => log('info', msg, meta),
  debug: (msg, meta) => log('debug', msg, meta),
};

module.exports = logger;
