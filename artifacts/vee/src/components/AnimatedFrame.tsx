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
import { Image as ExpoImage } from 'expo-image';
import { getCachedFrameUri } from '../services/frameService';

type Props = {
  size: number;
  /** Catalog frame id (users/{uid}/activeFrame). Omit for bundled fallback only. */
  frameId?: string;
  /** 2026-10-13 (Sumon): Voice room seats are compact — smaller frame so it never covers the name below */
  compact?: boolean;
  /** 2026-10-29 (Fix #36, boss: seat frame slightly bigger): optional scale
      override. OMITTED everywhere except the voice-room seat path, so every
      other AnimatedFrame usage keeps the official 1.15x standard exactly. */
  scale?: number;
};

/**
 * 2026-10-17 (Sumon): PERMANENT — Official frame size standard.
 * ALL frames (current + all future) render at EXACTLY this scale relative to DP.
 * Server controls WHICH frame shows (via honors_catalog), but SIZE is always
 * the official standard — no per-frame size config, no fit issues, ever.
 * Official frame = 1.15x DP size (tight snug fit, no white gap, never covers DP).
 */
export const OFFICIAL_FRAME_SCALE = 1.15;

export default function AnimatedFrame({ size, frameId, compact, scale }: Props) {
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

  // 2026-10-17 (Sumon): PERMANENT — All frames use official size standard.
  // Server controls WHICH frame (honors_catalog), size is ALWAYS official.
  // 1.15x = tight snug fit, no white gap at edges, never covers the DP.
  // 2026-10-29 (Fix #36): the voice-room SEAT path passes scale=1.25
  // (48dp DP -> 60dp frame, +4.8dp diameter) because the boss found the seat
  // frame too small. Any other caller omits scale and gets exactly 1.15x.
  const frameSize = size * (scale ?? OFFICIAL_FRAME_SCALE);

  const frameScale = frameBreath.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.02],
  });

  const showServer = !!serverUri && !serverFailed;

  return (
    <View style={[styles.container, { width: frameSize, height: frameSize }]}>
      {showServer ? (
        // 2026-10-21: Server animated frame via expo-image — RN Image/Fresco
        // does NOT animate APNG on Android (shows only the first frame);
        // expo-image animates WebP/APNG on both platforms. Animation is
        // baked into the file, no code animation on top.
        <ExpoImage
          source={{ uri: serverUri! }}
          style={{ width: frameSize, height: frameSize }}
          contentFit="contain"
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
