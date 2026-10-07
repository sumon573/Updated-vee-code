/**
 * Call sounds — cute ringing tones for outgoing and incoming calls.
 * Uses expo-audio. Sounds loop until explicitly stopped.
 */
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

let ringbackSound: AudioPlayer | null = null;
let ringtoneSound: AudioPlayer | null = null;

/** Configure audio mode for calls (background-capable). */
export async function setupCallAudioMode(): Promise<void> {
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'duckOthers',
      allowsRecording: true,
    });
  } catch { /* non-critical */ }
}

function loadSound(path: any): AudioPlayer | null {
  try {
    const player = createAudioPlayer(path);
    player.loop = true;
    player.volume = 0.7;
    return player;
  } catch {
    return null;
  }
}

/** Play outgoing ringback ("dee-doo") while waiting for callee. */
export async function startRingback(): Promise<void> {
  try {
    await stopAllCallSounds();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ringbackSound = loadSound(require('@/assets/sounds/ringback.wav'));
    ringbackSound?.play();
  } catch { /* non-critical */ }
}

/** Play incoming ringtone (gentle chime) while incoming modal is visible. */
export async function startRingtone(): Promise<void> {
  try {
    await stopAllCallSounds();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ringtoneSound = loadSound(require('@/assets/sounds/ringtone.wav'));
    ringtoneSound?.play();
  } catch { /* non-critical */ }
}

/** Stop any playing call sound. */
export async function stopAllCallSounds(): Promise<void> {
  try {
    if (ringbackSound) {
      try { ringbackSound.pause(); } catch {}
      try { ringbackSound.remove(); } catch {}
      ringbackSound = null;
    }
    if (ringtoneSound) {
      try { ringtoneSound.pause(); } catch {}
      try { ringtoneSound.remove(); } catch {}
      ringtoneSound = null;
    }
  } catch { /* non-critical */ }
}
