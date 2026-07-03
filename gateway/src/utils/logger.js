import config from '../config/index.js';

const LEVELS = {
  fatal: 60,
  error: 50,
  warn: 40,
  info: 30,
  debug: 20,
  trace: 10,
};

const currentLevel = LEVELS[config.nodeEnv === 'production' ? 'info' : 'debug'];

/**
 * Format a log entry as a single-line JSON string.
 */
function formatEntry(level, message, extra = {}) {
  const entry = {
    level,
    timestamp: new Date().toISOString(),
    service: config.serviceName,
    message,
    ...extra,
  };
  return JSON.stringify(entry);
}

/**
 * Write a structured JSON log line to stdout.
 */
function log(level, message, extra = {}) {
  if (LEVELS[level] < currentLevel) return;
  process.stdout.write(formatEntry(level, message, extra) + '\n');
}

const logger = {
  fatal: (msg, extra) => log('fatal', msg, extra),
  error: (msg, extra) => log('error', msg, extra),
  warn: (msg, extra) => log('warn', msg, extra),
  info: (msg, extra) => log('info', msg, extra),
  debug: (msg, extra) => log('debug', msg, extra),
  trace: (msg, extra) => log('trace', msg, extra),

  /**
   * Create a child logger with bound extra fields.
   * The returned object has all the same methods but every log line
   * will include the provided bindings.
   */
  child(bindings = {}) {
    const childLogger = {};
    for (const method of Object.keys(LEVELS)) {
      childLogger[method] = (msg, extra = {}) => {
        log(method, msg, { ...bindings, ...extra });
      };
    }
    return childLogger;
  },
};

export default logger;
