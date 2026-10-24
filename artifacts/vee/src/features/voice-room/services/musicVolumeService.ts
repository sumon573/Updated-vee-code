/**
 * musicVolumeService.ts — room-music volume, LOCAL to this phone (2026-10-25).
 *
 * The bot's audio is one LiveKit track; its volume is a per-listener setting
 * (RemoteParticipant.setVolume, livekit-client — real device-side gain, not
 * a fake slider). One listener lowering music must never lower it for the
 * whole room, so this value is NEVER written to RTDB — AsyncStorage only.
 * The voice engine reads the cached value when the music bot (re)joins, so
 * pause/resume and LiveKit restarts keep the user's volume.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'vee_music_volume_v1';

let cached = 1;
let loaded = false;

AsyncStorage.getItem(KEY)
  .then((raw) => {
    const v = raw == null ? NaN : parseFloat(raw);
    if (Number.isFinite(v) && v >= 0 && v <= 1) cached = v;
    loaded = true;
  })
  .catch(() => {
    loaded = true;
  });

/** Synchronous cached volume (1.0 until the stored value loads). */
export function getMusicVolumeSync(): number {
  return cached;
}

/** Persist a volume (0–1). The caller also applies it to the live room. */
export async function setMusicVolume(volume: number): Promise<void> {
  const v = Math.min(1, Math.max(0, volume));
  cached = v;
  loaded = true;
  try {
    await AsyncStorage.setItem(KEY, String(v));
  } catch {
    // non-critical — the cached value still applies this session
  }
}

export function isMusicVolumeLoaded(): boolean {
  return loaded;
}
