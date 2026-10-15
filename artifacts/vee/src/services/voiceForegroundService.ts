/**
 * voiceForegroundService.ts
 * 2026-10-15 (Sumon): JS bridge for the voice foreground service.
 *
 * Android kills/suspends backgrounded apps and blocks their mic. The native
 * foreground service (type "microphone", added by the
 * withVoiceForegroundService Expo plugin) keeps talking + hearing alive when
 * the app is backgrounded — in voice rooms and 1-to-1 calls, like IMO.
 *
 * Ref-counted: a voice room and a call can overlap; the service stops only
 * when both are done. No-op on iOS / when the native module is missing.
 */
import { NativeModules, Platform } from 'react-native';

const M = (NativeModules as { VoiceForegroundService?: { start: (t: string) => void; stop: () => void } })
  ?.VoiceForegroundService;

let refCount = 0;

export function startVoiceForegroundService(title: string): void {
  if (Platform.OS !== 'android') return;
  try {
    refCount += 1;
    if (refCount === 1) {
      M?.start(title);
    }
  } catch {
    refCount = Math.max(0, refCount - 1);
  }
}

export function stopVoiceForegroundService(): void {
  if (Platform.OS !== 'android') return;
  try {
    refCount = Math.max(0, refCount - 1);
    if (refCount === 0) {
      M?.stop();
    }
  } catch {
    // non-critical
  }
}
