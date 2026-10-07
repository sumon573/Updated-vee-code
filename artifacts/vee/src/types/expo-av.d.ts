/**
 * Minimal type declarations for expo-av.
 * The real package is installed via package.json; this is only for
 * TypeScript during local checks (EAS Build does a fresh install).
 */
declare module 'expo-av' {
  export namespace Audio {
    export interface AudioMode {
      allowsRecordingIOS?: boolean;
      playsInSilentModeIOS?: boolean;
      staysActiveInBackground?: boolean;
      shouldDuckAndroid?: boolean;
      playThroughEarpieceAndroid?: boolean;
      interruptionModeIOS?: number;
      interruptionModeAndroid?: number;
    }
    export function setAudioModeAsync(mode: AudioMode): Promise<void>;
    export class Sound {
      static createAsync(
        source: any,
        initialStatus?: { isLooping?: boolean; volume?: number },
      ): Promise<{ sound: Sound }>;
      playAsync(): Promise<void>;
      stopAsync(): Promise<void>;
      unloadAsync(): Promise<void>;
    }
    export const INTERRUPTION_MODE_IOS_DUCK_OTHERS: number;
    export const INTERRUPTION_MODE_ANDROID_DUCK_OTHERS: number;
  }
}
