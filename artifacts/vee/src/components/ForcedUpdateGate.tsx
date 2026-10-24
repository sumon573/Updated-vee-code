import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import * as Updates from 'expo-updates';
import { withTimeout } from '@/src/utils/withTimeout';

/**
 * ForcedUpdateGate — 2026-10-24 (boss law: NO app use without updating).
 *
 * On every launch (production only) this checks the EAS Update feed:
 *  - No update available  → children render normally.
 *  - Update available     → a FULL-SCREEN blocking "Update" screen replaces
 *    the entire app. Nothing underneath is usable until the user taps
 *    Update, the new bundle downloads, and the app reloads into it.
 *  - Check fails / times out (offline, update server unreachable) → FAIL
 *    OPEN: children render. A failed check must never brick the app;
 *    the gate re-checks on the next launch. Once a check SUCCEEDS and
 *    reports an update, the gate stays blocking until download+reload
 *    succeed (download failure re-checks first, then offers Retry).
 *
 * This gate only exists in bundles published AFTER it was written: the
 * current production build has no gate, so the FIRST update carrying it
 * still arrives via normal background OTA — and from that bundle on,
 * every update goes through this gate. That is the honest bootstrap:
 * a screen that does not exist yet cannot block anything.
 */
type Phase = 'checking' | 'current' | 'available' | 'downloading' | 'failed';

const CHECK_TIMEOUT_MS = 8000;

export function ForcedUpdateGate({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>('checking');
  const mountedRef = useRef(true);

  const check = useCallback(async () => {
    if (__DEV__ || !Updates.isEnabled) {
      if (mountedRef.current) setPhase('current');
      return;
    }
    try {
      const res = await withTimeout(Updates.checkForUpdateAsync(), CHECK_TIMEOUT_MS);
      if (!mountedRef.current) return;
      if (res.timedOut) {
        // Cannot reach the update feed in time — fail open, retry next launch.
        setPhase('current');
        return;
      }
      setPhase(res.value.isAvailable ? 'available' : 'current');
    } catch {
      // Check failure (offline etc.) — fail open, never brick the app.
      if (mountedRef.current) setPhase('current');
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    check();
    return () => { mountedRef.current = false; };
  }, [check]);

  const onUpdatePress = useCallback(async () => {
    setPhase('downloading');
    try {
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync();
      // reloadAsync restarts the app; reaching here means it threw.
      if (mountedRef.current) setPhase('failed');
    } catch {
      if (!mountedRef.current) return;
      // Download failed — re-check: if the update is gone, let the user in.
      try {
        const res = await Updates.checkForUpdateAsync();
        setPhase(res.isAvailable ? 'failed' : 'current');
      } catch {
        setPhase('failed');
      }
    }
  }, []);

  if (phase === 'current') return <>{children}</>;

  if (phase === 'checking') {
    return (
      <View style={{ flex: 1, backgroundColor: '#0F0A1E', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color="#8B5CF6" />
      </View>
    );
  }

  const downloading = phase === 'downloading';
  const failed = phase === 'failed';

  return (
    <View style={{ flex: 1, backgroundColor: '#0F0A1E', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
      <Text style={{ color: '#FFFFFF', fontSize: 28, fontWeight: '800', textAlign: 'center' }}>
        Update
      </Text>
      <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 15, textAlign: 'center', marginTop: 12, lineHeight: 22 }}>
        {downloading
          ? 'Downloading update… please wait.'
          : failed
            ? 'Update download failed. Check your connection and try again.'
            : 'A new update is available. Update the app to continue.'}
      </Text>
      <Pressable
        onPress={downloading ? undefined : onUpdatePress}
        style={{
          marginTop: 28,
          backgroundColor: downloading ? 'rgba(139,92,246,0.5)' : '#7C3AED',
          paddingVertical: 15,
          paddingHorizontal: 48,
          borderRadius: 28,
          opacity: downloading ? 0.7 : 1,
        }}
      >
        {downloading ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <Text style={{ color: '#FFFFFF', fontSize: 17, fontWeight: '700' }}>
            {failed ? 'Retry Update' : 'Update'}
          </Text>
        )}
      </Pressable>
    </View>
  );
}
