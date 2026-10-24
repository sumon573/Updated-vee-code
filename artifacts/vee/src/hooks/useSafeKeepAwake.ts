import { useEffect } from 'react';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

/**
 * useSafeKeepAwake — 2026-10-24.
 *
 * expo-keep-awake's useKeepAwake() hook left the native activation
 * rejection UNHANDLED, surfacing as a red LogBox on the phone:
 * "Uncaught (in promise) Error: Unable to activate keep awake".
 * Activation can legitimately fail during activity transitions, and
 * keep-awake is best-effort by design (the mic foreground service keeps
 * audio alive with the screen off regardless). Same behaviour as the
 * library hook — screen stays awake while mounted — but every promise
 * is caught, so a failure is silent instead of an error screen.
 */
export function useSafeKeepAwake(tag: string): void {
  useEffect(() => {
    activateKeepAwakeAsync(tag).catch(() => {
      /* best-effort — see header */
    });
    return () => {
      deactivateKeepAwake(tag).catch(() => {
        /* best-effort — see header */
      });
    };
  }, [tag]);
}
