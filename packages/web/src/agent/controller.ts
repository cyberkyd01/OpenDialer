import { io, type Socket } from 'socket.io-client';
import {
  RT_NAMESPACE,
  type Ack,
  type AgentStatePayload,
  type Callback,
  type CallLog,
  type DisposePayload,
  type Lead,
  type LeadAssignedPayload,
  type SipCredentials,
} from '@opendialer/shared';
import { api, describeError } from '../lib/api';
import { getServerUrl, getToken } from '../lib/config';
import { fmtDateTime, leadName } from '../lib/format';
import { createPhone } from '../phone';
import { CallRecorder, uploadRecording } from '../phone/recorder';
import { beep } from '../phone/tones';
import type { Phone } from '../phone/types';
import { useToasts } from '../store/toasts';
import { initialAgentView, isBusyState, shouldRecord, useAgent, type AgentView, type CallInfo, type JoinedCampaign } from './store';

const CAMPAIGN_KEY = 'opendialer.joinedCampaign';
const ACK_TIMEOUT_MS = 10_000;

export interface ControllerDeps {
  /** create the realtime socket (tests inject a fake) */
  socketFactory?: (url: string, token: string) => Socket;
  /** create the softphone (tests inject a SimPhone) */
  phoneFactory?: (creds: SipCredentials) => Promise<Phone>;
  /** fetch softphone credentials */
  loadCredentials?: () => Promise<SipCredentials>;
  loadCampaign?: (id: number) => Promise<JoinedCampaign>;
  onUnauthorized?: () => void;
  notify?: (level: 'info' | 'success' | 'warning' | 'error', message: string, extra?: { title?: string; actions?: { label: string; onClick: () => void; kind?: 'primary' | 'danger' }[]; timeout?: number }) => void;
}

const defaultNotify: NonNullable<ControllerDeps['notify']> = (level, message, extra) =>
  useToasts.getState().push({ level, message, ...extra });

/**
 * Agent console brain: owns the Socket.IO connection, the softphone and the
 * call recorder, follows the server's agent state machine and publishes a
 * view model into the `useAgent` zustand store. React components only read
 * the store and call methods on the controller.
 */
export class AgentController {
  socket: Socket | null = null;
  phone: Phone | null = null;
  private recorder = new CallRecorder();
  private dialInFlight = false;
  private autoDialedLeadId: number | null = null;
  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  private orphanTimer: ReturnType<typeof setTimeout> | null = null;
  private hadConnected = false;
  private stateBeforeDrop: string | null = null;
  private joinedCampaignId: number | null | undefined = undefined;
  private callPhones = new Map<number, string>();
  private disposers: (() => void)[] = [];
  private stopped = false;
  private notify: NonNullable<ControllerDeps['notify']>;

  constructor(private deps: ControllerDeps = {}) {
    this.notify = deps.notify ?? defaultNotify;
  }

  /* ------------------------------------------------------------------ */
  /* view helpers                                                        */
  /* ------------------------------------------------------------------ */

  get view(): AgentView {
    return useAgent.getState();
  }

  private set(patch: Partial<AgentView>) {
    if (this.stopped) return;
    useAgent.setState(patch);
  }

  private setCall(patch: Partial<CallInfo>) {
    const call = this.view.call;
    if (call) this.set({ call: { ...call, ...patch } });
  }

  /* ------------------------------------------------------------------ */
  /* lifecycle                                                           */
  /* ------------------------------------------------------------------ */

  /**
   * Start the softphone. The realtime socket is opened lazily: only when the
   * agent joins a campaign, or re-joins after a page reload (sessionStorage).
   */
  async start() {
    useAgent.setState(initialAgentView());
    void this.startPhone();
    void this.autoJoin();
  }

  stop() {
    this.stopped = true;
    this.clearPreviewTimer();
    if (this.orphanTimer) clearTimeout(this.orphanTimer);
    this.disposers.forEach((d) => d());
    this.disposers = [];
    void this.recorder.stop();
    try {
      this.phone?.disconnect();
    } catch {
      /* ignore */
    }
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
    useAgent.setState({ ...initialAgentView(), connection: 'closed' });
  }

  private async startPhone() {
    try {
      const creds = this.deps.loadCredentials ? await this.deps.loadCredentials() : await api.get<SipCredentials>('/auth/sip');
      const phone = this.deps.phoneFactory ? await this.deps.phoneFactory(creds) : await createPhone(creds);
      if (this.stopped) return;
      this.phone = phone;
      this.set({ phoneKind: phone.kind, phoneStatus: 'connecting' });
      this.wirePhone(phone);
      await phone.connect(creds);
      this.set({ phoneStatus: phone.status });
    } catch (err) {
      this.set({ phoneStatus: 'error', phoneError: describeError(err) });
    }
  }

  private wirePhone(phone: Phone) {
    const sync = () => this.set({ phoneStatus: phone.status });
    this.disposers.push(
      phone.on('registered', () => {
        sync();
        this.set({ phoneError: null });
      }),
      phone.on('unregistered', sync),
      phone.on('error', ({ message }) => {
        this.set({ phoneStatus: phone.status, phoneError: message });
        this.notify('error', message, { title: 'Softphone' });
      }),
      phone.on('ringing', () => this.onPhoneRinging()),
      phone.on('answered', (p) => this.onPhoneAnswered(p.providerCallId)),
      phone.on('ended', (p) => this.onPhoneEnded(p.cause, p.providerCallId)),
      phone.on('incoming', (p) => this.onIncoming(p.from, p.displayName)),
    );
  }

  private connectSocket() {
    const token = getToken() ?? '';
    const url = getServerUrl() + RT_NAMESPACE;
    const socket = this.deps.socketFactory
      ? this.deps.socketFactory(url, token)
      : io(url, { auth: { token }, reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 5000 });
    this.socket = socket;

    socket.on('connect', () => {
      const reconnect = this.hadConnected;
      this.hadConnected = true;
      this.set({ connection: 'connected' });
      if (reconnect && this.joinedCampaignId !== undefined) void this.rejoin();
    });
    socket.on('disconnect', (reason: string) => {
      if (this.view.connection === 'replaced' || this.stopped) return;
      this.stateBeforeDrop = this.view.agent?.state ?? null;
      this.set({ connection: reason === 'io client disconnect' ? 'closed' : 'reconnecting' });
    });
    socket.on('connect_error', (err: Error) => {
      if (err?.message === 'unauthorized') {
        socket.disconnect();
        this.deps.onUnauthorized?.();
        return;
      }
      this.set({ connection: this.hadConnected ? 'reconnecting' : 'connecting' });
    });

    socket.on('agent:state', (p: AgentStatePayload) => this.onAgentState(p));
    socket.on('lead:assigned', (p: LeadAssignedPayload) => this.onLeadAssigned(p));
    socket.on('lead:released', (p: { leadId: number; reason: string }) => this.onLeadReleased(p));
    socket.on('call:started', (p: { call: CallLog }) => this.callPhones.set(p.call.id, p.call.phone));
    socket.on('call:ended', () => this.set({ callsVersion: this.view.callsVersion + 1 }));
    socket.on('callback:due', (p: { callback: Callback }) => this.onCallbackDue(p.callback));
    socket.on('notice', (p: { level: 'info' | 'warning' | 'error'; message: string }) => this.notify(p.level, p.message));
    socket.on('session:replaced', () => this.onReplaced());
    socket.on('campaign:changed', (p: { campaignId: number }) => void this.onCampaignChanged(p.campaignId));
  }

  /** Open the socket if needed and wait until it is connected. */
  private ensureSocket(timeoutMs = ACK_TIMEOUT_MS): Promise<boolean> {
    if (this.stopped) return Promise.resolve(false);
    if (this.socket?.connected) return Promise.resolve(true);
    if (!this.socket) {
      this.set({ connection: 'connecting' });
      this.connectSocket();
    }
    const socket = this.socket!;
    return new Promise((resolve) => {
      const done = (ok: boolean) => {
        clearTimeout(timer);
        socket.off?.('connect', onConnect);
        resolve(ok);
      };
      const onConnect = () => done(true);
      const timer = setTimeout(() => done(Boolean(socket.connected)), timeoutMs);
      socket.on('connect', onConnect);
    });
  }

  private closeSocket() {
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
    this.hadConnected = false;
    this.set({ connection: 'idle' });
  }

  /** emit with ack + timeout; never rejects */
  private call<T>(event: string, payload: unknown): Promise<Ack<T>> {
    const socket = this.socket;
    if (!socket || !socket.connected) return Promise.resolve({ ok: false, error: 'Not connected to the server' });
    return new Promise((resolve) => {
      socket.timeout(ACK_TIMEOUT_MS).emit(event, payload, (err: Error | null, res: Ack<T>) => {
        if (err) {
          resolve({ ok: false, error: 'The server did not answer in time' });
          return;
        }
        // another tab took over the agent session (server refuses this socket's agent events)
        if (res && !res.ok && /no longer the active agent console/i.test(res.error ?? '')) this.onReplaced();
        resolve(res ?? { ok: false, error: 'Empty reply' });
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* joining                                                             */
  /* ------------------------------------------------------------------ */

  private async autoJoin() {
    let stored: string | null = null;
    try {
      stored = sessionStorage.getItem(CAMPAIGN_KEY);
    } catch {
      /* ignore */
    }
    if (stored == null) return;
    const id = stored === 'none' ? null : Number(stored);
    await this.join(Number.isFinite(id as number) ? id : null, true);
  }

  private async rejoin() {
    const before = this.stateBeforeDrop;
    const r = await this.join(this.joinedCampaignId ?? null, true);
    if (r && before === 'ready' && this.view.agent?.state === 'paused' && !this.view.agent.pauseCode) {
      await this.ready();
    }
  }

  async join(campaignId: number | null, silent = false): Promise<boolean> {
    this.set({ busy: true });
    if (!(await this.ensureSocket())) {
      this.set({ busy: false });
      if (!silent) this.notify('error', 'Cannot connect to the server');
      return false;
    }
    const r = await this.call<AgentStatePayload>('agent:join', { campaignId });
    this.set({ busy: false });
    if (!r.ok) {
      if (!silent) this.notify('error', r.error ?? 'Could not join');
      else this.forgetJoin();
      return false;
    }
    this.joinedCampaignId = campaignId;
    try {
      sessionStorage.setItem(CAMPAIGN_KEY, campaignId == null ? 'none' : String(campaignId));
    } catch {
      /* ignore */
    }
    this.set({ joined: true });
    if (r.data) this.onAgentState(r.data);
    await this.loadCampaign(campaignId);
    return true;
  }

  private forgetJoin() {
    this.joinedCampaignId = undefined;
    try {
      sessionStorage.removeItem(CAMPAIGN_KEY);
    } catch {
      /* ignore */
    }
  }

  private async loadCampaign(id: number | null) {
    if (id == null) {
      this.set({ campaign: null });
      return;
    }
    try {
      const c = this.deps.loadCampaign ? await this.deps.loadCampaign(id) : await api.get<JoinedCampaign>(`/campaigns/${id}`);
      this.set({ campaign: c, recordToggle: c.recording === 'always' ? true : this.view.recordToggle });
    } catch (err) {
      this.notify('warning', `Could not load campaign: ${describeError(err)}`);
    }
  }

  async leave() {
    if (this.view.call && this.view.call.phase !== 'ended') this.phone?.hangup();
    await this.call('agent:leave', {});
    this.forgetJoin();
    this.closeSocket();
    this.clearPreviewTimer();
    this.set({ joined: false, campaign: null, agent: null, assignment: null, lead: null, call: null, pendingPause: null });
  }

  /* ------------------------------------------------------------------ */
  /* agent commands                                                      */
  /* ------------------------------------------------------------------ */

  async ready() {
    const r = await this.call<AgentStatePayload>('agent:ready', {});
    if (!r.ok) this.notify('error', r.error ?? 'Could not go ready');
    else {
      this.set({ pendingPause: null });
      if (r.data) this.onAgentState(r.data);
    }
  }

  async pause(code: string) {
    const r = await this.call<AgentStatePayload>('agent:pause', { code });
    if (!r.ok) {
      this.notify('error', r.error ?? 'Could not pause');
      return;
    }
    if (r.data && isBusyState(r.data.state)) this.set({ pendingPause: code });
    if (r.data) this.onAgentState(r.data);
  }

  async skip(requeue = true) {
    const a = this.view.assignment;
    if (!a) return;
    this.clearPreviewTimer();
    this.set({ busy: true });
    const r = await this.call<AgentStatePayload>('lead:skip', { leadId: a.lead.id, requeue });
    this.set({ busy: false });
    if (!r.ok) this.notify('error', r.error ?? 'Could not skip');
  }

  /** Dial the assigned lead (preview "Dial", progressive auto-dial, preview timeout). */
  async dialAssigned() {
    const a = this.view.assignment;
    const st = this.view.agent?.state;
    if (!a || st !== 'assigned' || this.view.call || this.dialInFlight) return;
    this.clearPreviewTimer();
    this.dialInFlight = true;
    this.autoDialedLeadId = a.lead.id;
    this.set({ busy: true });
    try {
      const r = await this.call<{ callId: number }>('lead:dial', { leadId: a.lead.id });
      if (!r.ok || !r.data) {
        this.notify('error', r.error ?? 'Could not dial');
        return;
      }
      this.beginCall(r.data.callId, a.lead.phone, a.lead.id, false);
      await this.phoneDial(a.dialString);
    } finally {
      this.dialInFlight = false;
      this.set({ busy: false });
    }
  }

  /** Manual / click-to-dial. Resolves with an error message when the server refuses (DNC, hours…). */
  async manualDial(phone: string, leadId: number | null = null): Promise<string | null> {
    const st = this.view.agent?.state;
    if (!this.view.joined || !st) return 'Join a campaign first';
    if (st !== 'ready' && st !== 'paused') return `Cannot dial while ${st}`;
    if (this.view.call || this.dialInFlight) return 'A call is already in progress';
    this.dialInFlight = true;
    this.set({ busy: true });
    try {
      const r = await this.call<{ callId: number; dialString: string; lead: Lead | null }>('manual:dial', {
        phone,
        campaignId: this.joinedCampaignId ?? null,
        leadId,
      });
      if (!r.ok || !r.data) return r.error ?? 'Could not dial';
      this.clearPreviewTimer();
      this.set({ assignment: null, lead: r.data.lead, disposedEarly: false });
      this.beginCall(r.data.callId, r.data.lead?.phone ?? phone, r.data.lead?.id ?? null, true);
      await this.phoneDial(r.data.dialString);
      return null;
    } finally {
      this.dialInFlight = false;
      this.set({ busy: false });
    }
  }

  private beginCall(callId: number, phone: string, leadId: number | null, manual: boolean) {
    this.set({
      disposedEarly: false,
      call: {
        callId,
        phone,
        leadId,
        manual,
        phase: 'dialing',
        startedAt: Date.now(),
        answeredAt: null,
        endedAt: null,
        cause: null,
        muted: false,
        held: false,
        recording: false,
      },
    });
  }

  private async phoneDial(dialString: string) {
    const phone = this.phone;
    try {
      if (!phone) throw new Error('Softphone is not ready');
      await phone.dial(dialString);
    } catch (err) {
      this.notify('error', `Dial failed: ${describeError(err)}`);
      // the call never got going – close it on the server so the agent can disposition
      if (this.view.call && this.view.call.phase !== 'ended') this.onPhoneEnded('failed');
    }
  }

  hangup() {
    const call = this.view.call;
    if (!call || call.phase === 'ended') return;
    if (this.phone && this.phone.callState !== 'idle') this.phone.hangup();
    else this.onPhoneEnded(call.phase === 'talking' ? 'normal' : 'cancelled');
  }

  mute(on: boolean) {
    this.phone?.mute(on);
    this.setCall({ muted: on });
  }

  async hold(on: boolean) {
    try {
      await this.phone?.hold(on);
      this.setCall({ held: on });
    } catch (err) {
      this.notify('error', `Hold failed: ${describeError(err)}`);
    }
  }

  sendDtmf(d: string) {
    this.phone?.sendDtmf(d);
  }

  async transfer(target: string) {
    try {
      await this.phone?.transfer(target);
      this.notify('info', `Transferred to ${target}`);
    } catch (err) {
      this.notify('error', `Transfer failed: ${describeError(err)}`);
    }
  }

  async setRecord(on: boolean) {
    this.set({ recordToggle: on });
    const call = this.view.call;
    if (!call || call.phase !== 'talking') return;
    if (on && !call.recording) await this.startRecording();
    else if (!on && call.recording) await this.finishRecording(call.callId);
  }

  async dispose(input: Omit<DisposePayload, 'callId'>): Promise<boolean> {
    const callId = this.view.call?.callId ?? this.view.agent?.callId;
    if (!callId) {
      this.notify('error', 'No call to disposition');
      return false;
    }
    this.set({ busy: true });
    const r = await this.call<AgentStatePayload>('call:dispose', { ...input, callId });
    this.set({ busy: false });
    if (!r.ok) {
      this.notify('error', r.error ?? 'Could not save the disposition');
      return false;
    }
    if (input.pauseAfter) this.set({ pendingPause: input.pauseAfter });
    const stillUp = this.view.call && this.view.call.phase !== 'ended';
    if (stillUp) {
      this.set({ disposedEarly: true });
      this.notify('success', 'Disposition saved – it applies when the call ends');
    }
    this.set({ callbacksVersion: this.view.callbacksVersion + (input.callback ? 1 : 0) });
    if (r.data) this.onAgentState(r.data);
    return true;
  }

  /** Update the lead shown on the card after an edit (notes, details). */
  patchLead(lead: Lead) {
    const v = this.view;
    if (v.lead?.id !== lead.id) return;
    this.set({ lead, assignment: v.assignment && v.assignment.lead.id === lead.id ? { ...v.assignment, lead } : v.assignment });
  }

  async answerIncoming() {
    try {
      await this.phone?.answer?.();
    } catch (err) {
      this.notify('error', `Could not answer: ${describeError(err)}`);
    }
    this.set({ incoming: null });
  }

  declineIncoming() {
    this.phone?.reject?.();
    this.set({ incoming: null });
  }

  /* ------------------------------------------------------------------ */
  /* phone events                                                        */
  /* ------------------------------------------------------------------ */

  private sendUpdate(state: 'ringing' | 'answered' | 'ended', callId: number, extra: { cause?: string; providerCallId?: string } = {}) {
    void this.call<AgentStatePayload>('call:update', { callId, state, ...extra }).then((r) => {
      if (!r.ok) console.warn(`call:update ${state} rejected: ${r.error}`);
      else if (r.data) this.onAgentState(r.data);
    });
  }

  private onPhoneRinging() {
    const call = this.view.call;
    if (!call || call.phase !== 'dialing') return;
    this.setCall({ phase: 'ringing' });
    this.sendUpdate('ringing', call.callId);
  }

  private onPhoneAnswered(providerCallId?: string) {
    const call = this.view.call;
    if (this.view.incoming) this.set({ incoming: null });
    if (!call || call.phase === 'ended') return; // inbound call outside the dialer flow: audio only
    this.setCall({ phase: 'talking', answeredAt: Date.now() });
    this.sendUpdate('answered', call.callId, { providerCallId });
    if (shouldRecord(this.view)) void this.startRecording();
  }

  private onPhoneEnded(cause: string, providerCallId?: string) {
    if (this.view.incoming) this.set({ incoming: null });
    const call = this.view.call;
    if (!call || call.phase === 'ended') return;
    this.setCall({ phase: 'ended', endedAt: Date.now(), cause, muted: false, held: false });
    this.sendUpdate('ended', call.callId, { cause, providerCallId });
    if (call.recording) void this.finishRecording(call.callId);
  }

  private onIncoming(from: string, displayName?: string) {
    this.set({ incoming: { from, displayName } });
    this.notify('info', `Incoming call from ${displayName ? `${displayName} (${from})` : from}`, {
      title: 'Incoming call',
      timeout: 0,
      actions: [
        { label: 'Answer', kind: 'primary', onClick: () => void this.answerIncoming() },
        { label: 'Decline', kind: 'danger', onClick: () => this.declineIncoming() },
      ],
    });
  }

  private async startRecording() {
    const call = this.view.call;
    if (!call || call.recording) return;
    try {
      await this.recorder.start(this.phone?.localStream ?? null, this.phone?.remoteStream ?? null);
      if (this.view.call?.callId === call.callId) this.setCall({ recording: true });
      else void this.recorder.stop();
    } catch (err) {
      this.notify('warning', `Recording unavailable: ${describeError(err)}`);
    }
  }

  private async finishRecording(callId: number) {
    if (this.view.call?.callId === callId) this.setCall({ recording: false });
    const blob = await this.recorder.stop();
    if (!blob) return;
    try {
      await uploadRecording(callId, blob);
    } catch (err) {
      this.notify('error', `Recording upload failed: ${describeError(err)}`);
    }
  }

  /* ------------------------------------------------------------------ */
  /* server events                                                       */
  /* ------------------------------------------------------------------ */

  private onAgentState(p: AgentStatePayload) {
    const prev = this.view.agent;
    const patch: Partial<AgentView> = { agent: p };
    if (p.state === 'ready' || p.state === 'paused' || p.state === 'offline') {
      const call = this.view.call;
      if (!call || call.phase === 'ended') {
        patch.call = null;
        patch.assignment = null;
        patch.lead = null;
        patch.disposedEarly = false;
        this.autoDialedLeadId = null;
      }
      patch.previewDeadline = null;
      patch.wrapupDeadline = null;
      this.clearPreviewTimer();
      if (p.state === 'paused') patch.pendingPause = null;
    }
    if (p.state === 'wrapup' && prev?.state !== 'wrapup') {
      patch.wrapupDeadline = p.wrapupTimeoutSec > 0 ? Date.now() + p.wrapupTimeoutSec * 1000 : null;
    }
    if (p.state !== 'wrapup') patch.wrapupDeadline = null;
    this.set(patch);
    this.checkOrphanCall(p);
  }

  /** Server thinks we are in a call that this page does not know (reload / crash) → end it so wrap-up can proceed. */
  private checkOrphanCall(p: AgentStatePayload) {
    if (this.orphanTimer) clearTimeout(this.orphanTimer);
    this.orphanTimer = null;
    const callId = p.callId;
    if ((p.state !== 'dialing' && p.state !== 'talking') || !callId) return;
    this.orphanTimer = setTimeout(() => {
      this.orphanTimer = null;
      const v = this.view;
      if (this.dialInFlight || v.agent?.callId !== callId || v.agent.state !== p.state) return;
      if (v.call?.callId === callId) return;
      const phone = this.callPhones.get(callId) ?? v.lead?.phone ?? '';
      this.beginCall(callId, phone, p.leadId, false);
      this.notify('warning', 'The previous call was lost (page reloaded or connection dropped). Please disposition it.');
      this.onPhoneEnded('failed');
    }, 1500);
  }

  private onLeadAssigned(p: LeadAssignedPayload) {
    const v = this.view;
    const sameLead = v.assignment?.lead.id === p.lead.id;
    if (v.call && v.call.leadId === p.lead.id) {
      // reconnect resend while a call is up – refresh data only
      this.set({ assignment: p, lead: p.lead });
      return;
    }
    if (v.call && v.call.phase !== 'ended') return;
    this.set({ assignment: p, lead: p.lead, disposedEarly: false, call: v.call?.leadId === p.lead.id ? v.call : null });
    if (p.callback) {
      this.notify('info', `Scheduled callback${p.callback.note ? `: ${p.callback.note}` : ''}`, { title: `Callback – ${leadName(p.lead) || p.lead.phone}` });
    }
    const state = this.view.agent?.state;
    if (state && state !== 'assigned') return;
    if (p.autoDial) {
      if (this.autoDialedLeadId !== p.lead.id) void this.dialAssigned();
      return;
    }
    if (p.previewTimeoutSec > 0 && !(sameLead && this.previewTimer)) {
      this.clearPreviewTimer();
      const deadline = Date.now() + p.previewTimeoutSec * 1000;
      this.set({ previewDeadline: deadline });
      this.previewTimer = setTimeout(() => {
        this.previewTimer = null;
        this.set({ previewDeadline: null });
        void this.dialAssigned();
      }, p.previewTimeoutSec * 1000);
    }
  }

  private clearPreviewTimer() {
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.previewTimer = null;
    if (this.view.previewDeadline) this.set({ previewDeadline: null });
  }

  private onLeadReleased(p: { leadId: number; reason: string }) {
    const v = this.view;
    if (v.assignment?.lead.id === p.leadId && (!v.call || v.call.phase === 'ended')) {
      this.clearPreviewTimer();
      this.set({ assignment: null, lead: null });
    }
    this.notify('warning', `Lead released: ${p.reason}`);
  }

  private onCallbackDue(cb: Callback) {
    beep(3);
    const who = cb.lead ? leadName(cb.lead) || cb.lead.phone : `lead #${cb.leadId}`;
    this.set({ callbacksVersion: this.view.callbacksVersion + 1 });
    const actions = cb.lead
      ? [
          {
            label: 'Dial now',
            kind: 'primary' as const,
            onClick: () => {
              void this.manualDial(cb.lead!.phone, cb.leadId).then((err) => err && this.notify('error', err));
            },
          },
        ]
      : undefined;
    this.notify('info', `${who} at ${fmtDateTime(cb.scheduledAt)}${cb.note ? ` – ${cb.note}` : ''}`, { title: 'Callback due', actions, timeout: 0 });
  }

  private onReplaced() {
    this.set({ connection: 'replaced' });
    this.clearPreviewTimer();
    try {
      this.phone?.disconnect();
    } catch {
      /* ignore */
    }
    this.socket?.disconnect();
  }

  private async onCampaignChanged(campaignId: number) {
    if (this.joinedCampaignId !== campaignId) return;
    await this.loadCampaign(campaignId);
    const c = this.view.campaign;
    if (c) this.notify('info', `Campaign "${c.name}" is now ${c.status}`);
  }
}

let current: AgentController | null = null;
export const getController = () => current;
export const setController = (c: AgentController | null) => {
  current = c;
};
