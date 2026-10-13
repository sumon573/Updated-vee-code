/**
 * AnimatedFrame — Vee Official DP frame, video-exact.
 * Uses the exact frame design from the reference video (blue ring +
 * "official" ribbon + Vee logo + vines) with twinkling sparkles
 * like the video. NO rotation.
 * NO native modules — 100% safe, zero crash risk, no lag.
 *
 * 2026-10-13 (Sumon): Video-exact — sparkles twinkle on the ring
 * in waves, like the reference video. Static ring, no rotation.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet, Image, Text } from 'react-native';

type Props = {
  /** Diameter of the avatar being framed (frame scales around it) */
  size: number;
};

// Sparkle positions (relative to frame, 0-1) — on/around the ring like video
const SPARKLES = [
  { x: 0.22, y: 0.18, delay: 0, size: 16 },
  { x: 0.72, y: 0.12, delay: 400, size: 20 },
  { x: 0.85, y: 0.32, delay: 800, size: 14 },
  { x: 0.12, y: 0.45, delay: 1200, size: 18 },
  { x: 0.88, y: 0.55, delay: 1600, size: 16 },
  { x: 0.18, y: 0.72, delay: 600, size: 14 },
  { x: 0.82, y: 0.78, delay: 1000, size: 20 },
  { x: 0.42, y: 0.88, delay: 1400, size: 16 },
];

function Sparkle({ x, y, delay, size: sparkleSize, frameSize }: {
  x: number; y: number; delay: number; size: number; frameSize: number;
}) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, {
          toValue: 1,
          duration: 400,
          useNativeDriver: true,
        }),
        Animated.timing(anim, {
          toValue: 0,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.delay(1800 - delay),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim, delay]);

  const opacity = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  const scale = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 1.4],
  });

  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: x * frameSize - sparkleSize / 2,
        top: y * frameSize - sparkleSize / 2,
        opacity,
        transform: [{ scale }],
      }}
    >
      <Text style={{ fontSize: sparkleSize, color: '#fff', textShadowColor: '#B3E5FC', textShadowRadius: 8 }}>
        ✦
      </Text>
    </Animated.View>
  );
}

export default function AnimatedFrame({ size }: Props) {
  const pulseAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Subtle glow pulse — 3s cycle, NO rotation
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1500,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 1500,
          useNativeDriver: true,
        }),
      ])
    );
    pulseLoop.start();
    return () => {
      pulseLoop.stop();
    };
  }, [pulseAnim]);

  // Frame is larger than the DP to surround it
  const frameSize = size * 1.45;

  const pulseOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.92, 1],
  });

  return (
    <View style={[styles.container, { width: frameSize, height: frameSize }]}>
      <Animated.View
        style={{
          width: frameSize,
          height: frameSize,
          opacity: pulseOpacity,
        }}
      >
        <Image
          source={require('@/assets/images/vee-official-frame.png')}
          style={{ width: frameSize, height: frameSize }}
          resizeMode="contain"
        />
      </Animated.View>
      {/* Twinkling sparkles like the video */}
      {SPARKLES.map((s, i) => (
        <Sparkle key={i} {...s} frameSize={frameSize} />
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
