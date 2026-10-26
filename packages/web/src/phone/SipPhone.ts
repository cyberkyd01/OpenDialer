import type { SipCredentials } from '@opendialer/shared';
import {
  Invitation,
  Inviter,
  Registerer,
  RegistererState,
  SessionState,
  UserAgent,
  Web,
  type Session,
} from 'sip.js';
import { startRingback } from './tones';
import { Emitter, causeFromSipCode, type Phone, type PhoneCallState, type PhoneStatus } from './types';

type WebSdh = InstanceType<typeof Web.SessionDescriptionHandler>;

/**
 * WebRTC softphone on top of sip.js (SIP over secure WebSocket). Works with
 * Asterisk/FreePBX (PJSIP + WebRTC), FreeSWITCH (verto off, SIP.js profile),
 * Kamailio/OpenSIPS + rtpengine and most hosted WebRTC-capable SIP providers.
 */
export class SipPhone extends Emitter implements Phone {
  readonly kind = 'sip' as const;
  status: PhoneStatus = 'disconnected';
  callState: PhoneCallState = 'idle';

  private ua: UserAgent | null = null;
  private registerer: Registerer | null = null;
  private creds: SipCredentials | null = null;
  private session: Session | null = null;
  private incoming: Invitation | null = null;
  private audio: HTMLAudioElement;
  private ringTimer: ReturnType<typeof setTimeout> | null = null;
  /** cause decided locally (ring timeout, local cancel) */
  private localCause: string | null = null;
  /** final response code seen for the current outbound INVITE */
  private finalCode: number | null = null;
  private established = false;
  private stopTone: (() => void) | null = null;

  constructor() {
    super();
    this.audio = document.createElement('audio');
    this.audio.autoplay = true;
    this.audio.setAttribute('playsinline', '');
    this.audio.style.display = 'none';
    document.body.appendChild(this.audio);
  }

  get localStream(): MediaStream | null {
    return (this.session?.sessionDescriptionHandler as WebSdh | undefined)?.localMediaStream ?? null;
  }

  get remoteStream(): MediaStream | null {
    return (this.session?.sessionDescriptionHandler as WebSdh | undefined)?.remoteMediaStream ?? null;
  }

  private setStatus(s: PhoneStatus) {
    this.status = s;
    if (s === 'registered' || s === 'connected') this.emit('registered');
    else if (s === 'disconnected') this.emit('unregistered');
  }

  async connect(creds: SipCredentials): Promise<void> {
    this.disconnect();
    this.creds = creds;
    if (!creds.wssUrl || !creds.sipDomain) {
      this.status = 'error';
      this.emit('error', { message: 'Telephony is not configured (WSS URL / SIP domain missing) – ask an admin.' });
      return;
    }
    if (!creds.username) {
      this.status = 'error';
      this.emit('error', { message: 'Your user has no SIP username – ask an admin to set one.' });
      return;
    }
    const uri = UserAgent.makeURI(`sip:${creds.username}@${creds.sipDomain}`);
    if (!uri) {
      this.status = 'error';
      this.emit('error', { message: 'Invalid SIP username or domain' });
      return;
    }
    this.status = 'connecting';
    const ua = new UserAgent({
      uri,
      transportOptions: { server: creds.wssUrl, traceSip: false },
      authorizationUsername: creds.authUsername || creds.username,
      authorizationPassword: creds.password,
      displayName: creds.displayName,
      logLevel: 'warn',
      sessionDescriptionHandlerFactoryOptions: {
        peerConnectionConfiguration: { iceServers: creds.iceServers.map((s) => ({ ...s })) },
      },
      delegate: {
        onInvite: (inv) => this.onInvite(inv),
        onDisconnect: (error) => {
          if (error) {
            this.status = 'error';
            this.emit('error', { message: `SIP connection lost: ${error.message}` });
            // try to come back
            setTimeout(() => {
              if (this.ua === ua) ua.reconnect().then(() => this.afterTransportUp(ua)).catch(() => {});
            }, 3000);
          } else {
            this.setStatus('disconnected');
          }
        },
      },
    });
    this.ua = ua;
    try {
      await ua.start();
      await this.afterTransportUp(ua);
    } catch (err) {
      this.status = 'error';
      this.emit('error', { message: `Cannot connect to ${creds.wssUrl}: ${(err as Error).message}` });
    }
  }

  private async afterTransportUp(ua: UserAgent) {
    if (!this.creds?.register) {
      this.setStatus('connected');
      return;
    }
    if (!this.registerer) {
      this.registerer = new Registerer(ua, { expires: 300 });
      this.registerer.stateChange.addListener((st) => {
        if (st === RegistererState.Registered) this.setStatus('registered');
        else if (st === RegistererState.Unregistered && this.status === 'registered') this.setStatus('connected');
      });
    }
    await this.registerer.register({
      requestDelegate: {
        onReject: (res) => {
          this.status = 'error';
          this.emit('error', { message: `SIP registration failed: ${res.message.statusCode} ${res.message.reasonPhrase}` });
        },
      },
    });
  }

  disconnect(): void {
    this.hangup();
    const ua = this.ua;
    this.ua = null;
    const reg = this.registerer;
    this.registerer = null;
    if (reg) void reg.unregister().catch(() => {});
    if (ua) void ua.stop().catch(() => {});
    if (this.status !== 'disconnected') this.setStatus('disconnected');
  }

  private target(number: string) {
    const n = number.trim();
    if (n.startsWith('sip:')) return UserAgent.makeURI(n);
    const user = n.replace(/[^\d+*#a-zA-Z._-]/g, '');
    return UserAgent.makeURI(`sip:${user}@${this.creds?.sipDomain ?? ''}`);
  }

  async dial(number: string): Promise<void> {
    if (!this.ua) throw new Error('Softphone not connected');
    if (this.session) throw new Error('A call is already in progress');
    const target = this.target(number);
    if (!target) throw new Error(`Invalid number: ${number}`);
    const inviter = new Inviter(this.ua, target, {
      sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } },
    });
    this.beginSession(inviter);
    this.callState = 'ringing';
    this.emit('ringing');
    const ringSec = this.creds?.ringTimeoutSec || 45;
    this.ringTimer = setTimeout(() => {
      if (!this.established && this.session === inviter) {
        this.localCause = 'no-answer';
        void inviter.cancel().catch(() => {});
      }
    }, ringSec * 1000);
    try {
      await inviter.invite({
        requestDelegate: {
          onProgress: (res) => {
            if (res.message.statusCode === 180 && !this.stopTone) this.stopTone = startRingback();
            if (res.message.statusCode === 183) this.toneOff(); // early media plays instead
          },
          onReject: (res) => {
            this.finalCode = res.message.statusCode ?? null;
          },
        },
      });
    } catch (err) {
      // invite() rejects e.g. when getUserMedia is denied
      this.localCause = 'failed';
      this.emit('error', { message: `Call failed: ${(err as Error).message}` });
      if (this.session === inviter) this.endSession(inviter);
    }
  }

  private beginSession(session: Session) {
    this.session = session;
    this.established = false;
    this.localCause = null;
    this.finalCode = null;
    session.stateChange.addListener((st) => {
      if (this.session !== session) return;
      if (st === SessionState.Established) {
        this.established = true;
        this.clearRingTimer();
        this.toneOff();
        this.attachAudio(session);
        this.callState = 'talking';
        this.emit('answered', { providerCallId: this.callIdOf(session) });
      } else if (st === SessionState.Terminated) {
        this.endSession(session);
      }
    });
    session.delegate = {
      onSessionDescriptionHandler: () => this.attachAudio(session),
    };
  }

  private callIdOf(session: Session): string | undefined {
    try {
      return (session as Inviter | Invitation).request.callId;
    } catch {
      return undefined;
    }
  }

  private attachAudio(session: Session) {
    const sdh = session.sessionDescriptionHandler as WebSdh | undefined;
    if (!sdh) return;
    const stream = sdh.remoteMediaStream;
    if (this.audio.srcObject !== stream) this.audio.srcObject = stream;
    void this.audio.play().catch(() => {});
    sdh.peerConnectionDelegate = {
      ontrack: () => {
        this.audio.srcObject = sdh.remoteMediaStream;
        void this.audio.play().catch(() => {});
      },
    };
  }

  private endSession(session: Session) {
    if (this.session !== session) return;
    const cause = this.established ? 'normal' : (this.localCause ?? causeFromSipCode(this.finalCode));
    const providerCallId = this.callIdOf(session);
    this.session = null;
    this.incoming = null;
    this.clearRingTimer();
    this.toneOff();
    this.audio.srcObject = null;
    this.callState = 'idle';
    this.emit('ended', { cause, providerCallId });
  }

  hangup(): void {
    const s = this.session;
    if (!s) return;
    switch (s.state) {
      case SessionState.Initial:
      case SessionState.Establishing:
        if (s instanceof Inviter) {
          this.localCause = this.localCause ?? 'cancelled';
          void s.cancel().catch(() => this.endSession(s));
        } else if (s instanceof Invitation) {
          void s.reject().catch(() => this.endSession(s));
        }
        break;
      case SessionState.Established:
        void s.bye().catch(() => this.endSession(s));
        break;
      default:
        this.endSession(s);
    }
  }

  private onInvite(inv: Invitation) {
    if (this.session) {
      void inv.reject({ statusCode: 486 }).catch(() => {});
      return;
    }
    this.incoming = inv;
    this.beginSession(inv);
    this.callState = 'incoming';
    const id = inv.remoteIdentity;
    this.emit('incoming', { from: id.uri.user ?? id.uri.toString(), displayName: id.displayName || undefined });
  }

  async answer(): Promise<void> {
    const inv = this.incoming;
    if (!inv) return;
    await inv.accept({ sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } } });
  }

  reject(): void {
    const inv = this.incoming;
    if (!inv) return;
    void inv.reject().catch(() => {});
  }

  mute(on: boolean): void {
    const pc = (this.session?.sessionDescriptionHandler as WebSdh | undefined)?.peerConnection;
    pc?.getSenders().forEach((sender) => {
      if (sender.track && sender.track.kind === 'audio') sender.track.enabled = !on;
    });
  }

  async hold(on: boolean): Promise<void> {
    const s = this.session;
    if (!s || s.state !== SessionState.Established) throw new Error('No active call');
    await s.invite({ sessionDescriptionHandlerModifiers: on ? [Web.holdModifier] : [] });
  }

  sendDtmf(digits: string): void {
    const s = this.session;
    if (!s || s.state !== SessionState.Established) return;
    const sdh = s.sessionDescriptionHandler as WebSdh | undefined;
    for (const d of digits) {
      // RFC 4733 in-band first, SIP INFO as fallback
      const ok = sdh?.sendDtmf(d) ?? false;
      if (!ok) {
        void s
          .info({ requestOptions: { body: { contentDisposition: 'render', contentType: 'application/dtmf-relay', content: `Signal=${d}\r\nDuration=160` } } })
          .catch(() => {});
      }
    }
  }

  async transfer(target: string): Promise<void> {
    const s = this.session;
    if (!s || s.state !== SessionState.Established) throw new Error('No active call');
    const uri = this.target(target);
    if (!uri) throw new Error('Invalid transfer target');
    await s.refer(uri, {
      requestDelegate: {
        onAccept: () => {
          void s.bye().catch(() => {});
        },
        onReject: (res) => {
          this.emit('error', { message: `Transfer rejected: ${res.message.statusCode} ${res.message.reasonPhrase}` });
        },
      },
    });
  }

  private clearRingTimer() {
    if (this.ringTimer) clearTimeout(this.ringTimer);
    this.ringTimer = null;
  }

  private toneOff() {
    this.stopTone?.();
    this.stopTone = null;
  }
}
