/**
 * incomingCallRingtone — ringtone + vibration for the incoming-call modal.
 *
 * 2026-10-19 polish: incoming calls were completely silent. When the ringing
 * modal shows we now play a looping ringtone plus a repeating vibration
 * cadence. Both stop idempotently on accept / decline / caller-cancel /
 * timeout / unmount.
 *
 * No new native module: vibration uses the RN Vibration API; the ringtone is
 * synthesized at runtime (classic 440+480Hz dual-tone "ring-ring", written
 * once as a WAV into the cache dir) and played looped via expo-audio
 * (already a dependency). No binary asset is committed to the repo.
 *
 * Everything is fail-soft: if the audio player can't start, vibration still
 * works; if vibration throws, the modal is unaffected.
 */
import { Vibration } from 'react-native';
import * as Notifications from 'expo-notifications';

let alertActive = false;
let player: { pause(): void; remove(): void } | null = null;

/** Start the ringtone + vibration. Safe to call repeatedly. */
export function startIncomingCallAlert(): void {
  if (alertActive) return;
  alertActive = true;
  // Ring-like cadence, repeating: 900ms buzz, 500ms pause.
  try {
    Vibration.vibrate([0, 900, 500], true);
  } catch {
    /* non-critical — ringtone may still work */
  }
  try {
    const uri = ensureRingtoneUri();
    if (!uri) return;
    // Lazy require — a playback problem must never break the modal.
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
  } catch {
    /* vibration-only fallback */
  }
}

/** Stop the ringtone + vibration. Safe to call repeatedly. */
export function stopIncomingCallAlert(): void {
  if (!alertActive && !player) return;
  alertActive = false;
  try {
    Vibration.cancel();
  } catch {
    /* ignore */
  }
  const p = player;
  player = null;
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

/**
 * Dismiss any lingering incoming-call notifications from the tray.
 * Called whenever the ringing modal goes away (accept / decline /
 * caller-cancel / timeout) so a stale "Incoming audio call" notification
 * never survives the call's end. Matches by the push payload's data.type
 * (the only reliable client-side handle — FCM doesn't expose a stable tag
 * to expo-notifications).
 */
export async function dismissIncomingCallNotifications(): Promise<void> {
  try {
    const presented = await Notifications.getPresentedNotificationsAsync();
    for (const n of presented) {
      const data = (n.request?.content?.data ?? {}) as Record<string, unknown>;
      if (data?.type === 'incoming-call') {
        await Notifications.dismissNotificationAsync(n.request.identifier).catch(() => {});
      }
    }
  } catch {
    /* best-effort — a stale tray entry is cosmetic */
  }
}

const RINGTONE_FILE = 'vee_incoming_call.wav';

/** Generate the ringtone WAV in the cache dir on first use; return its uri. */
function ensureRingtoneUri(): string | null {
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
    const file = new File(Paths.cache, RINGTONE_FILE);
    if (!file.exists) {
      file.write(buildRingtoneWav());
    }
    return file.uri;
  } catch {
    return null;
  }
}

/**
 * Classic telephone "ring-ring": 1s dual-tone burst, 0.4s pause, 1s burst.
 * 22050Hz mono 16-bit PCM — ~106KB, generated in well under 100ms.
 */
function buildRingtoneWav(): Uint8Array {
  const sr = 22050;
  const dur = 2.4;
  const n = Math.floor(sr * dur);
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
  view.setUint32(28, sr * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const ringing = t < 1.0 || t >= 1.4;
    let v = 0;
    if (ringing) {
      const seg = t < 1.0 ? t : t - 1.4;
      const env = Math.min(1, seg / 0.05) * Math.min(1, Math.max(0, (1.0 - seg) / 0.1));
      v = ((Math.sin(2 * Math.PI * 440 * t) + Math.sin(2 * Math.PI * 480 * t)) / 2) * env * 0.6;
    }
    view.setInt16(44 + i * 2, Math.round(v * 32767), true);
  }
  return buf;
}
