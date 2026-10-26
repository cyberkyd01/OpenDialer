/**
 * Socket.IO contract between the server and agent/supervisor clients.
 * Namespace: "/rt". The JWT goes in `socket.handshake.auth.token`.
 */
import type {
  AgentState,
  CallLog,
  Callback,
  Campaign,
  Lead,
  Script,
  WallboardSnapshot,
} from './types.js';

export const RT_NAMESPACE = '/rt';

export interface Ack<T = unknown> {
  ok: boolean;
  error?: string;
  data?: T;
}

export interface LeadAssignedPayload {
  lead: Lead;
  campaign: Campaign;
  script: Script | null;
  /** true in progressive mode: the softphone should dial right away */
  autoDial: boolean;
  /** if the lead came from a scheduled callback */
  callback: Callback | null;
  /** number the softphone should actually dial (prefix applied) */
  dialString: string;
  /** seconds the agent has to press Dial before auto-dial (0 = none) */
  previewTimeoutSec: number;
}

export interface AgentStatePayload {
  state: AgentState;
  pauseCode: string | null;
  campaignId: number | null;
  since: string;
  /** set while assigned/dialing/talking/wrapup */
  leadId: number | null;
  callId: number | null;
  wrapupTimeoutSec: number;
}

export interface CallUpdatePayload {
  callId: number;
  state: 'ringing' | 'answered' | 'ended';
  /** on ended: why – e.g. "normal", "busy", "no-answer", "failed", "cancelled" */
  cause?: string;
  /** provider id (SIP Call-ID) if known */
  providerCallId?: string;
}

export interface DisposePayload {
  callId: number;
  dispositionId: number;
  notes?: string;
  callback?: {
    scheduledAt: string; // ISO
    note?: string;
    personal: boolean; // true = only this agent, false = any agent on the campaign
  };
  /** after wrap-up go to paused instead of ready */
  pauseAfter?: string | null;
}

/** Events the client emits. All take an ack callback as last argument. */
export interface ClientToServerEvents {
  'agent:join': (p: { campaignId: number | null }, ack: (r: Ack<AgentStatePayload>) => void) => void;
  'agent:ready': (p: Record<string, never>, ack: (r: Ack<AgentStatePayload>) => void) => void;
  'agent:pause': (p: { code: string }, ack: (r: Ack<AgentStatePayload>) => void) => void;
  'agent:leave': (p: Record<string, never>, ack: (r: Ack) => void) => void;
  /** Preview mode: push this lead back (it is re-queued) and get the next one. */
  'lead:skip': (p: { leadId: number; requeue: boolean }, ack: (r: Ack<AgentStatePayload>) => void) => void;
  /** Agent is dialing the assigned lead. Server creates the call log. */
  'lead:dial': (p: { leadId: number }, ack: (r: Ack<{ callId: number }>) => void) => void;
  /** Manual / click-to-dial. Server checks DNC & hours, creates a call log. */
  'manual:dial': (
    p: { phone: string; campaignId?: number | null; leadId?: number | null },
    ack: (r: Ack<{ callId: number; dialString: string; lead: Lead | null }>) => void,
  ) => void;
  'call:update': (p: CallUpdatePayload, ack: (r: Ack<AgentStatePayload>) => void) => void;
  'call:dispose': (p: DisposePayload, ack: (r: Ack<AgentStatePayload>) => void) => void;
  'wallboard:subscribe': (p: Record<string, never>, ack: (r: Ack<WallboardSnapshot>) => void) => void;
  'wallboard:unsubscribe': (p: Record<string, never>, ack: (r: Ack) => void) => void;
}

/** Events the server emits. */
export interface ServerToClientEvents {
  'agent:state': (p: AgentStatePayload) => void;
  'lead:assigned': (p: LeadAssignedPayload) => void;
  'lead:released': (p: { leadId: number; reason: string }) => void;
  'call:started': (p: { call: CallLog }) => void;
  'call:ended': (p: { call: CallLog }) => void;
  'callback:due': (p: { callback: Callback }) => void;
  'wallboard:update': (p: WallboardSnapshot) => void;
  'notice': (p: { level: 'info' | 'warning' | 'error'; message: string }) => void;
  /** another login for the same user replaced this socket */
  'session:replaced': () => void;
  /** supervisor forced the agent out of a state (e.g. ended wrap-up) */
  'campaign:changed': (p: { campaignId: number }) => void;
}

export const WEBHOOK_EVENTS = [
  'call.started',
  'call.ended',
  'call.disposed',
  'lead.dnc',
  'callback.created',
  'campaign.status',
  'agent.state',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
