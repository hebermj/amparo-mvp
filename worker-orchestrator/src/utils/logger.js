'use strict';

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

const currentLevel = (() => {
  const env = process.env.NODE_ENV || 'development';
  if (env === 'production') return levels.info;
  return levels.debug;
})();

function formatTimestamp() {
  return new Date().toISOString();
}

function log(level, message, meta = {}) {
  if (levels[level] === undefined || levels[level] > currentLevel) return;

  const entry = {
    timestamp: formatTimestamp(),
    level,
    service: 'worker-orchestrator',
    message,
    ...meta,
  };

  const output = JSON.stringify(entry);

  if (level === 'error' || level === 'warn') {
    process.stderr.write(output + '\n');
  } else {
    process.stdout.write(output + '\n');
  }
}

const logger = {
  error(message, meta) { log('error', message, meta); },
  warn(message, meta) { log('warn', message, meta); },
  info(message, meta) { log('info', message, meta); },
  http(message, meta) { log('http', message, meta); },
  debug(message, meta) { log('debug', message, meta); },
};

module.exports = logger;
