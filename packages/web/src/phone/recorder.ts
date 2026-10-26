import { api } from '../lib/api';
import { audioContext } from './tones';

export function pickMimeType(): string {
  const MR = (globalThis as unknown as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
  if (!MR) return '';
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']) {
    try {
      if (MR.isTypeSupported(t)) return t;
    } catch {
      /* ignore */
    }
  }
  return '';
}

/**
 * Records a call in the browser: local mic + remote party mixed through an
 * AudioContext into one MediaStream. Without streams (sim mode) the mic alone
 * is recorded.
 */
export class CallRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private ownStream: MediaStream | null = null;
  private nodes: AudioNode[] = [];
  mimeType = '';

  get active() {
    return this.recorder?.state === 'recording';
  }

  async start(local: MediaStream | null, remote: MediaStream | null): Promise<void> {
    if (this.recorder) return;
    const MR = (globalThis as unknown as { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
    if (!MR) throw new Error('Recording is not supported by this browser');
    let streams = [local, remote].filter((s): s is MediaStream => Boolean(s && s.getAudioTracks().length));
    if (!streams.length) {
      this.ownStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streams = [this.ownStream];
    }
    let recordStream: MediaStream;
    const ctx = audioContext();
    if (ctx && streams.length > 1) {
      const dest = ctx.createMediaStreamDestination();
      for (const s of streams) {
        const src = ctx.createMediaStreamSource(s);
        src.connect(dest);
        this.nodes.push(src);
      }
      this.nodes.push(dest);
      recordStream = dest.stream;
    } else {
      recordStream = streams[0];
    }
    this.mimeType = pickMimeType();
    this.chunks = [];
    const rec = this.mimeType ? new MR(recordStream, { mimeType: this.mimeType }) : new MR(recordStream);
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size) this.chunks.push(e.data);
    };
    rec.start(1000);
    this.recorder = rec;
  }

  /** Stop and return the recording (null when nothing was captured). */
  stop(): Promise<Blob | null> {
    const rec = this.recorder;
    this.recorder = null;
    const cleanup = () => {
      this.nodes.forEach((n) => {
        try {
          n.disconnect();
        } catch {
          /* ignore */
        }
      });
      this.nodes = [];
      this.ownStream?.getTracks().forEach((t) => t.stop());
      this.ownStream = null;
    };
    if (!rec) {
      cleanup();
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      rec.onstop = () => {
        cleanup();
        const type = (this.mimeType || 'audio/webm').split(';')[0];
        resolve(this.chunks.length ? new Blob(this.chunks, { type }) : null);
        this.chunks = [];
      };
      try {
        rec.stop();
      } catch {
        cleanup();
        resolve(null);
      }
    });
  }
}

/** POST the blob to /api/calls/:id/recording, retrying once. */
export async function uploadRecording(callId: number, blob: Blob): Promise<void> {
  const ext = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'm4a' : 'webm';
  const send = () => {
    const form = new FormData();
    form.append('file', blob, `call-${callId}.${ext}`);
    return api.upload(`/calls/${callId}/recording`, form);
  };
  try {
    await send();
  } catch {
    await new Promise((r) => setTimeout(r, 1500));
    await send();
  }
}
