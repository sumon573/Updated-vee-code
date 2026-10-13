/**
 * AnimatedFrame — Vee DP frame (server-hosted).
 * 2026-10-13 (Sumon): Frames are NOT bundled in the APK — Sumon will add many
 * frames, bundling would bloat the app. The APNG is downloaded once from the
 * server (admin-controlled URL in honors_catalog), cached locally, and played
 * via <Image> (APNG supported on iOS + Android).
 * Fallback: bundled static frame with subtle "breathing" if server load fails.
 * The frame is used EXACTLY as given — nothing overlaid on top. NO rotation.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, View, StyleSheet, Image } from 'react-native';
import { getCachedFrameUri } from '../services/frameService';

type Props = {
  size: number;
  /** Catalog frame id (users/{uid}/activeFrame). Omit for bundled fallback only. */
  frameId?: string;
};

export default function AnimatedFrame({ size, frameId }: Props) {
  const frameBreath = useRef(new Animated.Value(0)).current;
  const [serverUri, setServerUri] = useState<string | null>(null);
  const [serverFailed, setServerFailed] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Resolve + cache the server APNG for this frame.
  useEffect(() => {
    if (!frameId) return;
    setServerUri(null);
    setServerFailed(false);
    let cancelled = false;
    getCachedFrameUri(frameId)
      .then((uri) => {
        if (!cancelled && mounted.current) {
          if (uri) setServerUri(uri);
          else setServerFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled && mounted.current) setServerFailed(true);
      });
    return () => { cancelled = true; };
  }, [frameId]);

  // Breathing fallback animation (only used when showing the bundled static frame).
  useEffect(() => {
    if (serverUri && !serverFailed) return; // APNG animates itself
    const breathLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(frameBreath, { toValue: 1, duration: 2000, useNativeDriver: true }),
        Animated.timing(frameBreath, { toValue: 0, duration: 2000, useNativeDriver: true }),
      ])
    );
    breathLoop.start();
    return () => breathLoop.stop();
  }, [frameBreath, serverUri, serverFailed]);

  const frameSize = size * 1.45;

  const frameScale = frameBreath.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.02],
  });

  const showServer = !!serverUri && !serverFailed;

  return (
    <View style={[styles.container, { width: frameSize, height: frameSize }]}>
      {showServer ? (
        // Server APNG — animation is baked in, no code animation on top.
        <Image
          source={{ uri: serverUri! }}
          style={{ width: frameSize, height: frameSize }}
          resizeMode="contain"
          onError={() => setServerFailed(true)}
        />
      ) : (
        // Fallback: bundled static frame with subtle breathing.
        <Animated.View style={{ transform: [{ scale: frameScale }] }}>
          <Image
            source={require('@/assets/images/vee-official-frame.png')}
            style={{ width: frameSize, height: frameSize }}
            resizeMode="contain"
          />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
