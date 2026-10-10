import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'vee_voice_crash_breadcrumb';

export type VoiceStage =
  | 'screen_mount'
  | 'room_info_ok'
  | 'engine_init_start'
  | 'sdk_loaded'
  | 'token_ok'
  | 'audio_session_started'
  | 'room_created'
  | 'listeners_registered'
  | 'connect_started'
  | 'room_connected';

/**
 * Crash breadcrumb for voice-room entry.
 *
 * The app has a suspected NATIVE crash when entering a voice room (a JS
 * ErrorBoundary cannot catch a SIGSEGV from the WebRTC/audio stack). Before
 * each native-touching stage we persist a breadcrumb; on a clean exit or a
 * successful connect the breadcrumb is cleared. If the app is launched and a
 * breadcrumb is still present, the previous session died mid-join — the
 * stored stage tells us exactly which native call killed it.
 *
 * All writes are fire-and-forget so breadcrumb I/O can never break the
 * voice path itself.
 */
export function markVoiceStage(stage: VoiceStage, roomId: string): void {
  try {
    const payload = JSON.stringify({ stage, roomId, ts: Date.now() });
    // Async, fire-and-forget — never await in the voice path.
    AsyncStorage.setItem(KEY, payload).catch(() => {});
  } catch {
    // never break the voice path
  }
}

export function clearVoiceBreadcrumb(): void {
  try {
    AsyncStorage.removeItem(KEY).catch(() => {});
  } catch {
    // never break the voice path
  }
}

export async function getVoiceBreadcrumb(): Promise<{
  stage: VoiceStage;
  roomId: string;
  ts: number;
} | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { stage: VoiceStage; roomId: string; ts: number };
    if (!parsed || typeof parsed.stage !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}
