/**
 * useVoiceRecorder — IMO-style voice message recording for chat.
 *
 * Flow (matches IMO's recording UX):
 *  1. tap mic → permission check → recording starts, UI shows timer + waves
 *  2. tap send → stop → local URI + duration returned to caller
 *  3. tap cancel → stop + discard (no file kept)
 *
 * Uses expo-audio (already a dependency — no new native module).
 * Recording preset HIGH_QUALITY = AAC/m4a, plays everywhere expo-audio plays.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import {
  AudioModule,
  RecordingPresets,
  useAudioRecorder,
  setAudioModeAsync,
} from 'expo-audio';

export type VoiceRecording = {
  uri: string;
  durationSec: number;
};

/** 2026-10-20 (boss): voice messages are capped at 2 minutes. */
export const MAX_VOICE_SEC = 120;

type RecorderState = 'idle' | 'recording';

export function useVoiceRecorder() {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [state, setState] = useState<RecorderState>('idle');
  const [elapsedSec, setElapsedSec] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => stopTimer, [stopTimer]);

  /** Request mic permission. Returns true when granted. */
  const ensurePermission = useCallback(async (): Promise<boolean> => {
    try {
      const res = await AudioModule.requestRecordingPermissionsAsync();
      if (!res.granted) {
        Alert.alert(
          'Microphone needed',
          'Allow microphone access to send voice messages.',
        );
        return false;
      }
      return true;
    } catch {
      Alert.alert('Microphone needed', 'Could not access the microphone.');
      return false;
    }
  }, []);

  /** Start recording. Returns false if permission denied or start failed. */
  const startRecording = useCallback(async (): Promise<boolean> => {
    if (state === 'recording') return true;
    const ok = await ensurePermission();
    if (!ok) return false;
    try {
      // Plays in silent mode so the recording-start feedback isn't muted;
      // keep routing through the speaker (not the earpiece).
      await setAudioModeAsync({
        playsInSilentMode: true,
        shouldRouteThroughEarpiece: false,
      }).catch(() => {});
      await recorder.prepareToRecordAsync();
      recorder.record();
      startTimeRef.current = Date.now();
      setElapsedSec(0);
      setState('recording');
      timerRef.current = setInterval(() => {
        setElapsedSec(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 500);
      return true;
    } catch {
      stopTimer();
      setState('idle');
      return false;
    }
  }, [state, ensurePermission, recorder, stopTimer]);

  /**
   * Stop and keep the recording.
   * Returns the local URI + duration, or null if nothing was recorded.
   */
  const stopRecording = useCallback(async (): Promise<VoiceRecording | null> => {
    stopTimer();
    if (state !== 'recording') {
      setState('idle');
      return null;
    }
    try {
      await recorder.stop();
    } catch {
      // stop() can throw if the recorder never actually started
    }
    setState('idle');
    const uri = recorder.uri;
    // AudioRecorder.currentTime is in seconds.
    // 2026-10-20 (boss): hard cap — a voice message never exceeds 2 minutes.
    const durationSec = Math.min(
      MAX_VOICE_SEC,
      Math.max(
        1,
        Math.round(recorder.currentTime || (Date.now() - startTimeRef.current) / 1000),
      ),
    );
    if (!uri) return null;
    return { uri, durationSec };
  }, [state, recorder, stopTimer]);

  /** Stop and discard the recording. */
  const cancelRecording = useCallback(async (): Promise<void> => {
    stopTimer();
    if (state === 'recording') {
      try {
        await recorder.stop();
      } catch {
        /* discard anyway */
      }
    }
    setState('idle');
    setElapsedSec(0);
  }, [state, recorder, stopTimer]);

  return {
    state,
    isRecording: state === 'recording',
    elapsedSec,
    startRecording,
    stopRecording,
    cancelRecording,
  };
}

/** mm:ss for the recording timer / bubble duration labels. */
export function formatVoiceDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
