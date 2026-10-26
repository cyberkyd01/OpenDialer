/**
 * Core domain types shared by the server, the web client and the desktop shell.
 * Keep this file free of runtime dependencies – it is types only.
 */

export type Role = 'admin' | 'supervisor' | 'agent';

export type CampaignStatus = 'draft' | 'active' | 'paused' | 'completed';

/**
 * manual      – agent dials numbers / leads by hand (click-to-dial).
 * preview     – server hands the agent the next lead, agent reviews and clicks Dial (or Skip).
 * progressive – server hands the agent the next lead and the softphone dials immediately
 *               (one call per ready agent – "power dialing").
 */
export type DialMode = 'manual' | 'preview' | 'progressive';

export type RecordingPolicy = 'off' | 'always' | 'agent';

export type LeadStatus =
  | 'new'
  | 'in_progress'
  | 'callback'
  | 'done'
  | 'dnc'
  | 'invalid';

export type DispositionCategory =
  | 'contact'
  | 'no_contact'
  | 'callback'
  | 'dnc'
  | 'invalid';

export type CallResult =
  | 'answered'
  | 'no_answer'
  | 'busy'
  | 'failed'
  | 'cancelled'
  | 'unknown';

export type CallbackStatus = 'pending' | 'done' | 'cancelled';

/** Agent state machine. */
export type AgentState =
  | 'offline'
  | 'ready'
  | 'assigned'
  | 'dialing'
  | 'talking'
  | 'wrapup'
  | 'paused';

export type TelephonyMode = 'sip' | 'sim';

export interface User {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  active: boolean;
  /** SIP credentials used by the agent's softphone (never returned to other agents). */
  sipUsername: string | null;
  sipAuthUsername: string | null;
  sipPassword?: string | null;
  createdAt: string;
}

export interface Campaign {
  id: number;
  name: string;
  description: string;
  status: CampaignStatus;
  dialMode: DialMode;
  callerId: string;
  scriptId: number | null;
  callingHoursStart: string; // "HH:MM" local to the lead
  callingHoursEnd: string; // "HH:MM"
  callingDays: number[]; // 0 = Sunday … 6 = Saturday
  timezoneMode: 'lead' | 'fixed';
  fixedTimezone: string; // IANA zone used when timezoneMode = fixed or lead tz unknown
  maxAttempts: number;
  retryMinutes: number; // default retry delay when a disposition has none
  previewTimeoutSec: number; // 0 = agent must click Dial
  wrapupTimeoutSec: number; // 0 = unlimited wrap-up
  recording: RecordingPolicy;
  dialPrefix: string; // e.g. "9" or "+" - prepended by the softphone
  createdAt: string;
  updatedAt: string;
}

export interface CampaignStats {
  campaignId: number;
  leadsTotal: number;
  leadsNew: number;
  leadsInProgress: number;
  leadsCallback: number;
  leadsDone: number;
  leadsDnc: number;
  leadsInvalid: number;
  dialable: number;
  callsTotal: number;
  callsAnswered: number;
  callsToday: number;
  contacts: number;
  sales: number;
  agentsOnline: number;
  avgTalkSec: number;
}

export interface LeadList {
  id: number;
  campaignId: number;
  name: string;
  active: boolean;
  leadCount: number;
  createdAt: string;
}

export interface Lead {
  id: number;
  listId: number;
  campaignId: number;
  phone: string; // E.164
  rawPhone: string;
  firstName: string;
  lastName: string;
  company: string;
  email: string;
  timezone: string | null;
  custom: Record<string, string>;
  status: LeadStatus;
  attempts: number;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
  lastDispositionId: number | null;
  lockedBy: number | null;
  lockedAt: string | null;
  priority: number;
  notes: string;
  createdAt: string;
}

export interface Disposition {
  id: number;
  code: string;
  label: string;
  category: DispositionCategory;
  /** null = lead is finished; otherwise re-queue after this many minutes */
  retryMinutes: number | null;
  countsAsContact: boolean;
  isSale: boolean;
  color: string;
  sortOrder: number;
  system: boolean;
}

export interface DncEntry {
  id: number;
  phone: string;
  source: string;
  note: string;
  createdAt: string;
}

export interface Script {
  id: number;
  name: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface CallLog {
  id: number;
  leadId: number | null;
  campaignId: number | null;
  userId: number;
  phone: string;
  direction: 'out' | 'in';
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  durationSec: number;
  talkSec: number;
  result: CallResult;
  dispositionId: number | null;
  notes: string;
  hasRecording: boolean;
  hangupCause: string;
  /** joined, optional */
  agentName?: string;
  campaignName?: string;
  dispositionCode?: string | null;
  leadName?: string;
}

export interface Callback {
  id: number;
  leadId: number;
  campaignId: number;
  userId: number | null; // null = any agent on the campaign
  scheduledAt: string;
  note: string;
  status: CallbackStatus;
  createdBy: number;
  createdAt: string;
  /** joined, optional */
  lead?: Lead;
  agentName?: string | null;
}

export interface AgentSnapshot {
  userId: number;
  username: string;
  displayName: string;
  state: AgentState;
  pauseCode: string | null;
  campaignId: number | null;
  campaignName: string | null;
  leadId: number | null;
  leadName: string | null;
  phone: string | null;
  callId: number | null;
  stateSince: string;
  callsToday: number;
  talkSecToday: number;
}

export interface WallboardSnapshot {
  at: string;
  agents: AgentSnapshot[];
  campaigns: CampaignStats[];
  today: {
    calls: number;
    answered: number;
    contacts: number;
    sales: number;
    talkSec: number;
  };
}

export interface Webhook {
  id: number;
  url: string;
  events: string[];
  secret: string;
  active: boolean;
  createdAt: string;
}

export interface ApiKey {
  id: number;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface AuditEntry {
  id: number;
  userId: number | null;
  username: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  details: string;
  at: string;
}

export interface TelephonySettings {
  mode: TelephonyMode;
  /** e.g. wss://pbx.example.com:8089/ws */
  wssUrl: string;
  /** SIP domain / realm, e.g. pbx.example.com */
  sipDomain: string;
  /** Optional STUN/TURN servers for WebRTC */
  iceServers: { urls: string; username?: string; credential?: string }[];
  /** Register with the SIP server (needed for inbound) */
  register: boolean;
  /** seconds a call may ring before the softphone gives up */
  ringTimeoutSec: number;
}

export interface Settings {
  companyName: string;
  telephony: TelephonySettings;
  /** Default country for parsing national numbers (ISO 3166-1 alpha-2) */
  defaultCountry: string;
  defaultTimezone: string;
  recordingConsentNotice: string;
  pauseCodes: string[];
  /** Hard daily cap of attempts per phone number across campaigns (0 = none) */
  maxAttemptsPerDay: number;
  /** When true a lead must have `custom.consent` = yes/true/1 before it is dialed */
  requireConsentFlag: boolean;
}

/** Public, unauthenticated subset of settings needed before login. */
export interface PublicSettings {
  companyName: string;
  needsSetup: boolean;
  telephonyMode: TelephonyMode;
  version: string;
}

export interface SipCredentials {
  mode: TelephonyMode;
  wssUrl: string;
  sipDomain: string;
  username: string;
  authUsername: string;
  password: string;
  displayName: string;
  iceServers: TelephonySettings['iceServers'];
  register: boolean;
  ringTimeoutSec: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ImportResult {
  imported: number;
  duplicates: number;
  dnc: number;
  invalid: number;
  total: number;
  errors: string[];
}
