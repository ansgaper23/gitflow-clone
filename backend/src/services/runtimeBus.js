import { EventEmitter } from 'events';

const ERROR_TTL_MS = 10 * 60 * 1000; // 10 minutos de vigencia para el último error

class RuntimeBus extends EventEmitter {
  constructor() {
    super();
    this.lastErrors = new Map();
  }

  notifyError(key, errorPayload) {
    if (!key) return;
    const stringKey = String(key);
    const entry = {
      ...errorPayload,
      timestamp: Date.now(),
      key: stringKey
    };
    this.lastErrors.set(stringKey, entry);
    // Si viene projectId o sessionId adicional en el payload, indexar también por ellos
    if (errorPayload?.projectId && String(errorPayload.projectId) !== stringKey) {
      this.lastErrors.set(String(errorPayload.projectId), entry);
      this.lastErrors.set(`project:${errorPayload.projectId}`, entry);
    }
    if (errorPayload?.sessionId && String(errorPayload.sessionId) !== stringKey) {
      this.lastErrors.set(String(errorPayload.sessionId), entry);
    }
    this.emit(`runtime-error:${stringKey}`, entry);
  }

  getLastError(key) {
    if (!key) return null;
    const stringKey = String(key);
    const entry = this.lastErrors.get(stringKey);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > ERROR_TTL_MS) {
      this.lastErrors.delete(stringKey);
      return null;
    }
    return entry;
  }

  clearLastError(key) {
    if (!key) return;
    const stringKey = String(key);
    this.lastErrors.delete(stringKey);
    this.lastErrors.delete(`project:${stringKey}`);
  }
}

export const runtimeBus = new RuntimeBus();

