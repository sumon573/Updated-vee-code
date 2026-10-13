/**
 * AnimatedFrame — Vee Official DP frame (FINAL).
 * 2026-10-13 (Sumon): Animation ONLY on the frame itself — not outside, not inside (DP area).
 * - Traveling shimmer: bright highlight orbits the ring (whole frame)
 * - Vee logo pulses (1 → 1.08)
 * - Tiny twinkling sparkles on ring
 * NO rotation of the ring itself. NO native modules — safe, no lag.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet, Image, Easing } from 'react-native';

type Props = {
  size: number;
};

// Subtle sparkle dots on the ring (angles in degrees)
const SPARKLE_ANGLES = [30, 90, 150, 210, 270, 330];
const RING_RADIUS = 0.31;
// Shimmer orbits at ring radius — the "whole frame" animation
const SHIMMER_RADIUS = 0.31;

function Sparkle({ angle, delay, frameSize }: {
  angle: number; delay: number; frameSize: number;
}) {
  const anim = useRef(new Animated.Value(0)).current;
  const rad = (angle * Math.PI) / 180;
  const x = 0.5 + RING_RADIUS * Math.cos(rad);
  const y = 0.5 + RING_RADIUS * Math.sin(rad);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 700, useNativeDriver: true }),
        Animated.delay(2200),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim, delay]);

  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: x * frameSize - 3,
        top: y * frameSize - 3,
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: '#fff',
        opacity: anim,
        shadowColor: '#fff',
        shadowRadius: 4,
        shadowOpacity: 0.8,
      }}
    />
  );
}

/**
 * Traveling shimmer — a soft glow that orbits the frame ring.
 * This is the "whole frame" animation: light travels across the entire frame.
 * Positioned strictly ON the ring (not outside, not inside).
 */
function Shimmer({ frameSize }: { frameSize: number }) {
  const orbit = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(orbit, {
        toValue: 1,
        duration: 4000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [orbit]);

  // Interpolate 0→1 to angle 0→360, then to x/y on the ring
  // We use two interpolations via a trick: rotate a container view
  const rotate = orbit.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const shimmerSize = frameSize * 0.09;

  return (
    <Animated.View
      style={{
        position: 'absolute',
        width: frameSize,
        height: frameSize,
        alignItems: 'center',
        justifyContent: 'center',
        transform: [{ rotate }],
      }}
    >
      {/* Shimmer dot positioned at top of ring, rotates around */}
      <View
        style={{
          position: 'absolute',
          top: frameSize * (0.5 - SHIMMER_RADIUS) - shimmerSize / 2,
          width: shimmerSize,
          height: shimmerSize,
          borderRadius: shimmerSize / 2,
          backgroundColor: '#FFFFFF',
          opacity: 0.85,
          shadowColor: '#B3E5FC',
          shadowRadius: 12,
          shadowOpacity: 1,
        }}
      />
      {/* Trailing glow */}
      <View
        style={{
          position: 'absolute',
          top: frameSize * (0.5 - SHIMMER_RADIUS) - shimmerSize,
          width: shimmerSize * 2,
          height: shimmerSize * 2,
          borderRadius: shimmerSize,
          backgroundColor: '#E1F5FE',
          opacity: 0.35,
        }}
      />
    </Animated.View>
  );
}

export default function AnimatedFrame({ size }: Props) {
  const logoPulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(logoPulse, { toValue: 1, duration: 1200, useNativeDriver: true }),
        Animated.timing(logoPulse, { toValue: 0, duration: 1200, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [logoPulse]);

  const frameSize = size * 1.45;
  const logoSize = frameSize * 0.24;

  const logoScale = logoPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.08],
  });

  return (
    <View style={[styles.container, { width: frameSize, height: frameSize }]}>
      <Image
        source={require('@/assets/images/vee-official-frame.png')}
        style={{ width: frameSize, height: frameSize }}
        resizeMode="contain"
      />
      {/* Traveling shimmer — whole-frame animation, ON the ring only */}
      <Shimmer frameSize={frameSize} />
      {/* Pulsing Vee logo */}
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
      {/* Twinkling sparkles on ring */}
      {SPARKLE_ANGLES.map((angle, i) => (
        <Sparkle key={i} angle={angle} delay={i * 350} frameSize={frameSize} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
