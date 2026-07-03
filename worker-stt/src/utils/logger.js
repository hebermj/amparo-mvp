'use strict';

/**
 * Structured JSON Logger
 * Same pattern as the gateway — outputs structured logs to stdout.
 */

const LEVELS = {
  fatal: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
  trace: 5,
};

const DEFAULT_LEVEL = 'info';

class Logger {
  constructor(name, level) {
    this.name = name || 'worker-stt';
    this.level = LEVELS[level] !== undefined ? level : DEFAULT_LEVEL;
  }

  _log(level, msg, meta) {
    if (LEVELS[level] > LEVELS[this.level]) return;

    const entry = {
      timestamp: new Date().toISOString(),
      level,
      logger: this.name,
      message: msg,
    };

    if (meta && typeof meta === 'object' && Object.keys(meta).length > 0) {
      // Sanitize — never log tokens or keys
      const sanitized = { ...meta };
      for (const key of Object.keys(sanitized)) {
        if (/token|key|password|secret|authorization/i.test(key)) {
          sanitized[key] = '[REDACTED]';
        }
      }
      entry.meta = sanitized;
    }

    if (level === 'fatal' || level === 'error') {
      process.stderr.write(JSON.stringify(entry) + '\n');
    } else {
      process.stdout.write(JSON.stringify(entry) + '\n');
    }
  }

  fatal(msg, meta) { this._log('fatal', msg, meta); }
  error(msg, meta) { this._log('error', msg, meta); }
  warn(msg, meta)  { this._log('warn', msg, meta); }
  info(msg, meta)  { this._log('info', msg, meta); }
  debug(msg, meta) { this._log('debug', msg, meta); }
  trace(msg, meta) { this._log('trace', msg, meta); }

  child(name) {
    return new Logger(`${this.name}:${name}`, this.level);
  }
}

// Singleton
const rootLogger = new Logger('worker-stt', process.env.LOG_LEVEL);

module.exports = rootLogger;
module.exports.Logger = Logger;
