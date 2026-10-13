/**
 * AnimatedFrame — Vee Official DP frame (FINAL).
 * 2026-10-13 (Sumon): NO extra overlays. The frame itself animates + Vee logo pulses.
 * - Frame "breathes": very subtle scale pulse across the whole frame (1.0 → 1.02)
 * - Vee logo pulses (1 → 1.08)
 * - Sparkles are baked into the frame design itself — nothing added on top.
 * NO rotation. NO native modules — safe, no lag.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet, Image } from 'react-native';

type Props = {
  size: number;
};

export default function AnimatedFrame({ size }: Props) {
  const logoPulse = useRef(new Animated.Value(0)).current;
  const frameBreath = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const logoLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(logoPulse, { toValue: 1, duration: 1200, useNativeDriver: true }),
        Animated.timing(logoPulse, { toValue: 0, duration: 1200, useNativeDriver: true }),
      ])
    );
    // Frame breathes gently — the whole frame animates, nothing added on top
    const breathLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(frameBreath, { toValue: 1, duration: 2000, useNativeDriver: true }),
        Animated.timing(frameBreath, { toValue: 0, duration: 2000, useNativeDriver: true }),
      ])
    );
    logoLoop.start();
    breathLoop.start();
    return () => {
      logoLoop.stop();
      breathLoop.stop();
    };
  }, [logoPulse, frameBreath]);

  const frameSize = size * 1.45;
  const logoSize = frameSize * 0.24;

  const logoScale = logoPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.08],
  });

  // Very subtle — frame itself "breathes"
  const frameScale = frameBreath.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.02],
  });

  return (
    <View style={[styles.container, { width: frameSize, height: frameSize }]}>
      <Animated.View style={{ transform: [{ scale: frameScale }] }}>
        <Image
          source={require('@/assets/images/vee-official-frame.png')}
          style={{ width: frameSize, height: frameSize }}
          resizeMode="contain"
        />
      </Animated.View>
      {/* Pulsing Vee logo (part of the frame design) */}
      <Animated.View
        style={{
          position: 'absolute',
          right: frameSize * 0.1,
          bottom: frameSize * 0.12,
          width: logoSize,
          height: logoSize,
          transform: [{ scale: logoScale }],
        }}
      >
        <Image
          source={require('@/assets/images/vee-logo.png')}
          style={{ width: logoSize, height: logoSize }}
          resizeMode="contain"
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
