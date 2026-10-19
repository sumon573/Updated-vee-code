/**
 * audioOwner — single native-audio-pipeline guard (2026-10-19 stability fix).
 *
 * A LiveKit voice room and a 1-to-1 audio/video call must NEVER run at the
 * same time: two mic captures + two render paths on one native audio session
 * = echo loop + native WebRTC-module contention (a hard-crash class on
 * Android that try/catch cannot catch).
 *
 * The voice-room engine sets the flag on connect and clears it on
 * leave/disconnect. Call entry points (outgoing dial, incoming-call modal)
 * and the voice-room join path check it before starting a second pipeline.
 *
 * Minimal by design: a module-level boolean, no React state, no listeners.
 * Safe to import anywhere (no side effects, no native imports).
 */

let voiceRoomAudioActive = false;

/** Called by the voice-room engine on connect / leave / disconnect. */
export function setVoiceRoomAudioActive(active: boolean): void {
  voiceRoomAudioActive = active;
}

/** True while a LiveKit voice room holds the native audio pipeline. */
export function isVoiceRoomAudioActive(): boolean {
  return voiceRoomAudioActive;
}
