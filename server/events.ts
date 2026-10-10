import { EventEmitter } from 'node:events';
import type { ServerEvent } from './shared/api-types.js';

class Bus extends EventEmitter {
  publish(event: ServerEvent): void {
    this.emit('event', event);
  }
  subscribe(fn: (event: ServerEvent) => void): () => void {
    this.on('event', fn);
    return () => this.off('event', fn);
  }
}

export const bus = new Bus();
bus.setMaxListeners(100);
