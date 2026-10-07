/**
 * Call sounds — stubbed (expo-av removed due to startup crash).
 * Functions are no-ops to keep the app working.
 */

export async function setupCallAudioMode(): Promise<void> {
  // No-op: expo-av removed
}

export async function startRingback(): Promise<void> {
  // No-op
}

export async function stopRingback(): Promise<void> {
  // No-op
}

export async function startRingtone(): Promise<void> {
  // No-op
}

export async function stopRingtone(): Promise<void> {
  // No-op
}

export async function stopAllCallSounds(): Promise<void> {
  // No-op
}

// Aliases for compatibility
export const playRingback = startRingback;
export const playRingtone = startRingtone;
