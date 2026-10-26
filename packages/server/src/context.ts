import { EventEmitter } from 'node:events';
import type { DB } from './db.js';
import type { Config } from './config.js';
import type { Logger } from './logger.js';

/**
 * Internal event bus. Services emit domain events here; the webhook dispatcher,
 * the wallboard broadcaster and the dialer engine subscribe. Keeps services
 * free of socket.io / HTTP concerns.
 */
export interface DomainEvents {
  'call.started': { callId: number };
  'call.ended': { callId: number };
  'call.disposed': { callId: number; dispositionId: number };
  'lead.dnc': { leadId: number | null; phone: string };
  'callback.created': { callbackId: number };
  'campaign.status': { campaignId: number; status: string };
  'agent.state': { userId: number; state: string; campaignId: number | null };
  /** something changed that may make leads available (import, activation, callback due …) */
  'leads.available': { campaignId: number | null };
  'settings.changed': Record<string, never>;
}

export class Bus extends EventEmitter {
  emitDomain<K extends keyof DomainEvents>(event: K, payload: DomainEvents[K]) {
    this.emit(event, payload);
  }
  onDomain<K extends keyof DomainEvents>(event: K, handler: (p: DomainEvents[K]) => void) {
    this.on(event, handler);
    return () => this.off(event, handler);
  }
}

export interface Ctx {
  db: DB;
  config: Config;
  log: Logger;
  bus: Bus;
}
