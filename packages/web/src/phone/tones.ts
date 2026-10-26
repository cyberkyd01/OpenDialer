import { KEYS, storage } from '../lib/storage';

type AC = typeof AudioContext;
const getAudioContextCtor = (): AC | null =>
  (globalThis as unknown as { AudioContext?: AC; webkitAudioContext?: AC }).AudioContext ??
  (globalThis as unknown as { webkitAudioContext?: AC }).webkitAudioContext ??
  null;

let shared: AudioContext | null = null;
export function audioContext(): AudioContext | null {
  const Ctor = getAudioContextCtor();
  if (!Ctor) return null;
  if (!shared || shared.state === 'closed') {
    try {
      shared = new Ctor();
    } catch {
      return null;
    }
  }
  if (shared.state === 'suspended') void shared.resume().catch(() => {});
  return shared;
}

export const ringbackEnabled = () => storage.get(KEYS.ringback) !== 'off';
export const setRingbackEnabled = (on: boolean) => storage.set(KEYS.ringback, on ? null : 'off');

/** North-American style ringback (440+480 Hz, 2 s on / 4 s off). Returns a stop function. */
export function startRingback(): () => void {
  if (!ringbackEnabled()) return () => {};
  const ctx = audioContext();
  if (!ctx) return () => {};
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.connect(ctx.destination);
  const oscs = [440, 480].map((f) => {
    const o = ctx.createOscillator();
    o.frequency.value = f;
    o.connect(gain);
    o.start();
    return o;
  });
  let on = false;
  const toggle = () => {
    on = !on;
    gain.gain.setTargetAtTime(on ? 0.06 : 0, ctx.currentTime, 0.01);
  };
  toggle();
  let phase = setTimeout(function step() {
    toggle();
    phase = setTimeout(step, on ? 2000 : 4000);
  }, 2000);
  return () => {
    clearTimeout(phase);
    try {
      oscs.forEach((o) => o.stop());
      gain.disconnect();
    } catch {
      /* already stopped */
    }
  };
}

/** Short attention beep (callback reminders). */
export function beep(times = 2) {
  const ctx = audioContext();
  if (!ctx) return;
  for (let i = 0; i < times; i++) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.value = 0.08;
    o.connect(g);
    g.connect(ctx.destination);
    const t = ctx.currentTime + i * 0.3;
    o.start(t);
    o.stop(t + 0.15);
  }
}

/** DTMF feedback tone (local only). */
export function dtmfTone(digit: string) {
  const ctx = audioContext();
  if (!ctx) return;
  const map: Record<string, [number, number]> = {
    '1': [697, 1209], '2': [697, 1336], '3': [697, 1477], '4': [770, 1209], '5': [770, 1336], '6': [770, 1477],
    '7': [852, 1209], '8': [852, 1336], '9': [852, 1477], '*': [941, 1209], '0': [941, 1336], '#': [941, 1477],
  };
  const f = map[digit];
  if (!f) return;
  const g = ctx.createGain();
  g.gain.value = 0.05;
  g.connect(ctx.destination);
  for (const hz of f) {
    const o = ctx.createOscillator();
    o.frequency.value = hz;
    o.connect(g);
    o.start();
    o.stop(ctx.currentTime + 0.12);
  }
}
