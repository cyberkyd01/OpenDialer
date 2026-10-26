import type { SipCredentials } from '@opendialer/shared';
import { KEYS, storage } from '../lib/storage';
import { startRingback } from './tones';
import { Emitter, type Phone, type PhoneCallState, type PhoneStatus } from './types';

export type SimOutcome = 'answer' | 'busy' | 'no-answer' | 'failed';
export interface SimStep {
  outcome: SimOutcome;
  /** ms before the outcome happens (default: random 1–3 s; no-answer waits the ring timeout capped at 6 s) */
  delayMs?: number;
}

const OUTCOMES: SimOutcome[] = ['answer', 'busy', 'no-answer', 'failed'];
const toStep = (x: unknown): SimStep | null => {
  if (typeof x === 'string' && OUTCOMES.includes(x as SimOutcome)) return { outcome: x as SimOutcome };
  if (x && typeof x === 'object' && OUTCOMES.includes((x as SimStep).outcome)) {
    const d = Number((x as SimStep).delayMs);
    return { outcome: (x as SimStep).outcome, delayMs: Number.isFinite(d) ? d : undefined };
  }
  return null;
};

/**
 * Simulated softphone – no network, no audio path. Used when the server's
 * telephony mode is "sim" (demo, training, tests).
 *
 * Deterministic outcomes: `SimPhone.setOutcomes([...])` or localStorage
 * `opendialer.simOutcomes` = JSON array, e.g. `["answer", {"outcome":"busy","delayMs":0}]`.
 * Each dial consumes one entry; with none queued the outcome is random
 * (70 % answer, 10 % busy, 20 % no answer).
 */
export class SimPhone extends Emitter implements Phone {
  readonly kind = 'sim' as const;
  status: PhoneStatus = 'disconnected';
  callState: PhoneCallState = 'idle';
  readonly localStream: MediaStream | null = null;
  readonly remoteStream: MediaStream | null = null;
  muted = false;
  held = false;
  /** digits "sent" during the current call (for tests / UI echo) */
  dtmfSent = '';
  lastDialed: string | null = null;
  ringTimeoutSec = 45;
  random: () => number = Math.random;
  ringback = true;

  private static queue: SimStep[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopTone: (() => void) | null = null;
  private seq = 0;
  private providerCallId: string | undefined;

  /** Queue outcomes for the next dials (deterministic tests). */
  static setOutcomes(list: (SimOutcome | SimStep)[]) {
    SimPhone.queue = list.map(toStep).filter((x): x is SimStep => Boolean(x));
  }

  static pendingOutcomes(): SimStep[] {
    return [...SimPhone.queue];
  }

  async connect(creds: SipCredentials): Promise<void> {
    this.ringTimeoutSec = creds.ringTimeoutSec || 45;
    this.status = 'simulated';
    this.emit('registered');
  }

  disconnect(): void {
    if (this.callState !== 'idle') this.finish('cancelled');
    this.status = 'disconnected';
    this.emit('unregistered');
  }

  private nextStep(): SimStep {
    const queued = SimPhone.queue.shift();
    if (queued) return queued;
    const raw = storage.get(KEYS.simOutcomes);
    if (raw) {
      try {
        const arr = JSON.parse(raw) as unknown[];
        if (Array.isArray(arr) && arr.length) {
          const step = toStep(arr.shift());
          storage.set(KEYS.simOutcomes, arr.length ? JSON.stringify(arr) : null);
          if (step) return step;
        }
      } catch {
        storage.set(KEYS.simOutcomes, null);
      }
    }
    const r = this.random();
    return { outcome: r < 0.7 ? 'answer' : r < 0.8 ? 'busy' : 'no-answer' };
  }

  async dial(number: string): Promise<void> {
    if (this.callState !== 'idle') throw new Error('A call is already in progress');
    this.lastDialed = number;
    this.muted = false;
    this.held = false;
    this.dtmfSent = '';
    this.providerCallId = `sim-${Date.now()}-${++this.seq}`;
    this.callState = 'ringing';
    this.emit('ringing');
    if (this.ringback) this.stopTone = startRingback();
    const step = this.nextStep();
    const ringCap = Math.min(this.ringTimeoutSec, 6) * 1000;
    const delay =
      step.delayMs ?? (step.outcome === 'no-answer' ? ringCap : 1000 + Math.floor(this.random() * 2000));
    this.timer = setTimeout(() => {
      this.timer = null;
      this.toneOff();
      if (step.outcome === 'answer') {
        this.callState = 'talking';
        this.emit('answered', { providerCallId: this.providerCallId });
      } else {
        this.finish(step.outcome === 'busy' ? 'busy' : step.outcome === 'no-answer' ? 'no-answer' : 'failed');
      }
    }, delay);
  }

  hangup(): void {
    if (this.callState === 'idle') return;
    this.finish(this.callState === 'talking' ? 'normal' : 'cancelled');
  }

  async answer(): Promise<void> {
    /* sim mode has no inbound calls */
  }

  reject(): void {
    /* sim mode has no inbound calls */
  }

  mute(on: boolean): void {
    this.muted = on;
  }

  async hold(on: boolean): Promise<void> {
    if (this.callState !== 'talking') throw new Error('No active call');
    this.held = on;
  }

  sendDtmf(digits: string): void {
    if (this.callState !== 'talking') return;
    this.dtmfSent += digits;
  }

  async transfer(target: string): Promise<void> {
    if (this.callState !== 'talking') throw new Error('No active call');
    if (!target.trim()) throw new Error('No transfer target');
    // a blind transfer hands the call off – for us the call is over
    this.finish('normal');
  }

  private toneOff() {
    this.stopTone?.();
    this.stopTone = null;
  }

  private finish(cause: string) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.toneOff();
    this.callState = 'idle';
    this.muted = false;
    this.held = false;
    this.emit('ended', { cause, providerCallId: this.providerCallId });
  }
}
