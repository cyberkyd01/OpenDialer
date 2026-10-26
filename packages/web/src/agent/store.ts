import { create } from 'zustand';
import type { AgentStatePayload, Campaign, Lead, LeadAssignedPayload, Script } from '@opendialer/shared';
import type { PhoneStatus } from '../phone/types';

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'replaced' | 'closed';

export interface CallInfo {
  callId: number;
  /** number shown to the agent (E.164 or what was typed) */
  phone: string;
  leadId: number | null;
  manual: boolean;
  phase: 'dialing' | 'ringing' | 'talking' | 'ended';
  startedAt: number;
  answeredAt: number | null;
  endedAt: number | null;
  cause: string | null;
  muted: boolean;
  held: boolean;
  recording: boolean;
}

export type JoinedCampaign = Campaign & { script: Script | null; agentIds?: number[] };

export interface AgentView {
  connection: ConnectionState;
  phoneKind: 'sip' | 'sim' | null;
  phoneStatus: PhoneStatus;
  phoneError: string | null;
  agent: AgentStatePayload | null;
  /** campaign the agent joined (null = not joined / joined without campaign) */
  joined: boolean;
  campaign: JoinedCampaign | null;
  assignment: LeadAssignedPayload | null;
  /** lead of a manual dial (or the assignment's lead) – the lead card shows `lead` */
  lead: Lead | null;
  call: CallInfo | null;
  /** pause requested while busy – applied by the server after wrap-up */
  pendingPause: string | null;
  /** disposition chosen while the call was still up */
  disposedEarly: boolean;
  recordToggle: boolean;
  previewDeadline: number | null;
  wrapupDeadline: number | null;
  incoming: { from: string; displayName?: string } | null;
  /** an action is in flight (disable buttons) */
  busy: boolean;
  /** bumped to make panels refetch */
  callbacksVersion: number;
  callsVersion: number;
}

export const initialAgentView = (): AgentView => ({
  connection: 'idle',
  phoneKind: null,
  phoneStatus: 'disconnected',
  phoneError: null,
  agent: null,
  joined: false,
  campaign: null,
  assignment: null,
  lead: null,
  call: null,
  pendingPause: null,
  disposedEarly: false,
  recordToggle: false,
  previewDeadline: null,
  wrapupDeadline: null,
  incoming: null,
  busy: false,
  callbacksVersion: 0,
  callsVersion: 0,
});

export const useAgent = create<AgentView>(() => initialAgentView());

/** Which recording policy applies right now and whether the call should be recorded. */
export function shouldRecord(view: Pick<AgentView, 'assignment' | 'campaign' | 'recordToggle'>): boolean {
  const policy = view.assignment?.campaign.recording ?? view.campaign?.recording ?? 'off';
  return policy === 'always' || (policy === 'agent' && view.recordToggle);
}

export function recordingPolicy(view: Pick<AgentView, 'assignment' | 'campaign'>) {
  return view.assignment?.campaign.recording ?? view.campaign?.recording ?? 'off';
}

export const BUSY_STATES = ['assigned', 'dialing', 'talking', 'wrapup'] as const;
export const isBusyState = (s: string | undefined | null) => Boolean(s && (BUSY_STATES as readonly string[]).includes(s));
