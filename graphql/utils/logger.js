/**
 * Logger Utility for GraphQL System
 */

export class Logger {
  constructor(module) {
    this.module = module;
  }

  info(message, data = {}) {
    console.log(`[${this.module}] INFO: ${message}`, data);
  }

  warn(message, data = {}) {
    console.warn(`[${this.module}] WARN: ${message}`, data);
  }

  error(message, data = {}) {
    console.error(`[${this.module}] ERROR: ${message}`, data);
  }

  debug(message, data = {}) {
    if (process.env.DEBUG) {
      console.log(`[${this.module}] DEBUG: ${message}`, data);
    }
  }
}

export default Logger;
