// core/eventBus.js
// Tiny synchronous pub/sub. Modules never import each other; they speak
// through named events. The bus is intentionally dependency-free so it can
// be reused server-side if we ever mirror events over WebSocket.
//
// Event naming convention: <domain>:<action>   e.g. node:moved, health:tick

export class EventBus {
  constructor() {
    this._handlers = new Map();
    this._lateSubs = 0; // debug counter
  }

  on(type, handler) {
    if (typeof type !== "string" || typeof handler !== "function") {
      throw new TypeError("eventBus.on(type, handler): bad args");
    }
    let set = this._handlers.get(type);
    if (!set) {
      set = new Set();
      this._handlers.set(type, set);
    }
    set.add(handler);
    return () => this.off(type, handler);
  }

  once(type, handler) {
    const wrap = (...args) => {
      this.off(type, wrap);
      handler(...args);
    };
    return this.on(type, wrap);
  }

  off(type, handler) {
    const set = this._handlers.get(type);
    if (set) set.delete(handler);
  }

  emit(type, ...args) {
    const set = this._handlers.get(type);
    if (!set || set.size === 0) {
      this._lateSubs++; // useful when debugging "why did nothing happen"
      return;
    }
    // Clone to allow handlers to unsubscribe during emit
    for (const h of [...set]) {
      try {
        h(...args);
      } catch (err) {
        // Never let one handler break the bus
        console.error(`[eventBus] handler for "${type}" threw:`, err);
      }
    }
  }

  /* For tests / debugging. */
  get listenerCount() {
    let n = 0;
    for (const s of this._handlers.values()) n += s.size;
    return n;
  }
}

// Shared singleton. Imported everywhere via `import { bus } from "./eventBus.js"`.
export const bus = new EventBus();