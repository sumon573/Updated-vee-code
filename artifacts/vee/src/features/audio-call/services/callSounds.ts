/**
 * Call sounds — cute ringing tones for outgoing and incoming calls.
 * Uses expo-av. Sounds loop until explicitly stopped.
 */
import { Audio } from 'expo-av';

let ringbackSound: Audio.Sound | null = null;
let ringtoneSound: Audio.Sound | null = null;

/** Configure audio mode for calls (background-capable). */
export async function setupCallAudioMode(): Promise<void> {
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });
  } catch { /* non-critical */ }
}

async function loadSound(path: any): Promise<Audio.Sound | null> {
  try {
    const { sound } = await Audio.Sound.createAsync(path, {
      isLooping: true,
      volume: 0.7,
    });
    return sound;
  } catch {
    return null;
  }
}

/** Play outgoing ringback ("dee-doo") while waiting for callee. */
export async function startRingback(): Promise<void> {
  try {
    await stopAllCallSounds();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ringbackSound = await loadSound(require('@/assets/sounds/ringback.wav'));
    await ringbackSound?.playAsync();
  } catch { /* non-critical */ }
}

/** Play incoming ringtone (gentle chime) while incoming modal is visible. */
export async function startRingtone(): Promise<void> {
  try {
    await stopAllCallSounds();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ringtoneSound = await loadSound(require('@/assets/sounds/ringtone.wav'));
    await ringtoneSound?.playAsync();
  } catch { /* non-critical */ }
}

/** Stop any playing call sound. */
export async function stopAllCallSounds(): Promise<void> {
  try {
    if (ringbackSound) {
      await ringbackSound.stopAsync().catch(() => {});
      await ringbackSound.unloadAsync().catch(() => {});
      ringbackSound = null;
    }
    if (ringtoneSound) {
      await ringtoneSound.stopAsync().catch(() => {});
      await ringtoneSound.unloadAsync().catch(() => {});
      ringtoneSound = null;
    }
  } catch { /* non-critical */ }
}
