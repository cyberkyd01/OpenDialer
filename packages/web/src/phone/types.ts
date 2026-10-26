import type { SipCredentials } from '@opendialer/shared';

/** Registration / connection status of the softphone (shown in the console header). */
export type PhoneStatus = 'disconnected' | 'connecting' | 'registered' | 'connected' | 'error' | 'simulated';

/** State of the (single) call the softphone handles. */
export type PhoneCallState = 'idle' | 'ringing' | 'talking' | 'incoming';

export interface PhoneEvents {
  registered: void;
  unregistered: void;
  ringing: void;
  answered: { providerCallId?: string };
  /** cause understood by the server: normal | busy | no-answer | cancelled | failed */
  ended: { cause: string; providerCallId?: string };
  error: { message: string };
  incoming: { from: string; displayName?: string };
}

export type PhoneEventName = keyof PhoneEvents;
export type PhoneListener<K extends PhoneEventName> = (payload: PhoneEvents[K]) => void;

export interface Phone {
  readonly kind: 'sip' | 'sim';
  readonly status: PhoneStatus;
  readonly callState: PhoneCallState;
  /** microphone stream of the current call (null in sim mode) */
  readonly localStream: MediaStream | null;
  /** remote party audio of the current call (null in sim mode) */
  readonly remoteStream: MediaStream | null;
  connect(creds: SipCredentials): Promise<void>;
  disconnect(): void;
  dial(number: string): Promise<void>;
  hangup(): void;
  answer?(): Promise<void>;
  reject?(): void;
  mute(on: boolean): void;
  hold(on: boolean): Promise<void>;
  sendDtmf(digits: string): void;
  transfer(target: string): Promise<void>;
  on<K extends PhoneEventName>(event: K, cb: PhoneListener<K>): () => void;
}

/** Tiny typed event emitter shared by the phone implementations. */
export class Emitter {
  private listeners = new Map<string, Set<(p: unknown) => void>>();

  on<K extends PhoneEventName>(event: K, cb: PhoneListener<K>): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(cb as (p: unknown) => void);
    this.listeners.set(event, set);
    return () => set.delete(cb as (p: unknown) => void);
  }

  emit<K extends PhoneEventName>(event: K, ...payload: PhoneEvents[K] extends void ? [] : [PhoneEvents[K]]) {
    for (const cb of [...(this.listeners.get(event) ?? [])]) {
      try {
        cb(payload[0]);
      } catch (err) {
        console.error('phone listener failed', err);
      }
    }
  }
}

/** Map a final SIP response code to the hang-up cause the server understands. */
export function causeFromSipCode(code: number | undefined | null): string {
  if (!code) return 'failed';
  if (code === 486 || code === 600) return 'busy';
  if (code === 480 || code === 408) return 'no-answer';
  if (code === 487) return 'cancelled';
  if (code >= 400) return 'failed';
  return 'normal';
}
