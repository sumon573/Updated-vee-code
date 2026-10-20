/**
 * outgoingCallTone — caller-side progress tones (2026-10-20, boss's order).
 *
 * The boss heard ONE sound for both states and ordered them different:
 *  - "calling" (callee not ringing yet): a soft, short progress beep that
 *    repeats every 2s — quiet, clearly a "still connecting" sound.
 *  - "ringing" (callee's phone is ringing): the classic ringback cadence —
 *    2s dual-tone burst, then 4s of silence, looped.
 *
 * Modeled on incomingCallRingtone.ts: tones are synthesized at runtime as
 * WAV files in the cache dir (no binary assets) and played via expo-audio
 * (already a dependency). Everything is fail-soft — a tone problem must
 * never break the call screen. Caller-side only; no vibration.
 */
export type OutgoingToneKind = 'calling' | 'ringing';

let activeKind: OutgoingToneKind | null = null;
let player: { pause(): void; remove(): void } | null = null;

function stopPlayer(): void {
  const p = player;
  player = null;
  activeKind = null;
  if (p) {
    try {
      p.pause();
    } catch {
      /* ignore */
    }
    try {
      p.remove();
    } catch {
      /* ignore */
    }
  }
}

/** Start (or switch) the outgoing progress tone. Safe to call repeatedly. */
export function startOutgoingTone(kind: OutgoingToneKind): void {
  if (activeKind === kind && player) return;
  stopPlayer();
  try {
    const uri = ensureToneUri(kind);
    if (!uri) return;
    // Lazy require — a playback problem must never break the call screen.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createAudioPlayer } = require('expo-audio') as {
      createAudioPlayer: (src: { uri: string }) => {
        loop: boolean;
        play(): void;
        pause(): void;
        remove(): void;
      };
    };
    const p = createAudioPlayer({ uri });
    p.loop = true;
    p.play();
    player = p;
    activeKind = kind;
  } catch {
    /* fail-soft — the call itself is unaffected */
  }
}

/** Stop the outgoing tone (connected / ended / declined / unmount). */
export function stopOutgoingTone(): void {
  if (!player && !activeKind) return;
  stopPlayer();
}

const TONE_FILES: Record<OutgoingToneKind, string> = {
  calling: 'vee_outgoing_calling.wav',
  ringing: 'vee_outgoing_ringing.wav',
};

function ensureToneUri(kind: OutgoingToneKind): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { File, Paths } = require('expo-file-system') as {
      File: new (dir: unknown, name: string) => {
        exists: boolean;
        uri: string;
        write(content: Uint8Array): void;
      };
      Paths: { cache: unknown };
    };
    const file = new File(Paths.cache, TONE_FILES[kind]);
    if (!file.exists) {
      file.write(kind === 'calling' ? buildCallingWav() : buildRingingWav());
    }
    return file.uri;
  } catch {
    return null;
  }
}

/** Shared 22050Hz mono 16-bit PCM WAV writer. */
function buildWav(durSec: number, sample: (t: number) => number): Uint8Array {
  const sr = 22050;
  const n = Math.floor(sr * durSec);
  const buf = new Uint8Array(44 + n * 2);
  const view = new DataView(buf.buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + n * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, sample(i / sr)));
    view.setInt16(44 + i * 2, Math.round(v * 32767), true);
  }
  return buf;
}

/** CALLING: one soft 425Hz beep (0.4s) then silence — 2s loop, low volume. */
function buildCallingWav(): Uint8Array {
  return buildWav(2.0, (t) => {
    if (t >= 0.4) return 0;
    const env = Math.min(1, t / 0.03) * Math.min(1, (0.4 - t) / 0.08);
    return Math.sin(2 * Math.PI * 425 * t) * env * 0.32;
  });
}

/** RINGING: classic ringback — 2s of 440+480Hz, then 4s silence (6s loop). */
function buildRingingWav(): Uint8Array {
  return buildWav(6.0, (t) => {
    if (t >= 2.0) return 0;
    const env = Math.min(1, t / 0.05) * Math.min(1, (2.0 - t) / 0.1);
    return (
      ((Math.sin(2 * Math.PI * 440 * t) + Math.sin(2 * Math.PI * 480 * t)) / 2) *
      env *
      0.5
    );
  });
}
