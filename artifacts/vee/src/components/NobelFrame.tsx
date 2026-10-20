/**
 * NobelFrame — Static Nobel crown frame with sparkle shimmer.
 * 2026-10-15 (Sumon): Frame STAYS STILL (no movement). Sparkles twinkle
 * around the entire frame perimeter. Battery-friendly.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, View, Image, StyleSheet } from 'react-native';

type Props = {
  size: number;
  imageUrl: string;
  /** Show sparkles (default true for Count+) */
  sparkles?: boolean;
  /** Frame color for glow (defaults to Count purple) */
  glowColor?: string;
};

// Sparkle positions around the frame (percentages)
const SPARKLE_POSITIONS = [
  { top: '2%', left: '20%' },
  { top: '8%', left: '75%' },
  { top: '25%', left: '92%' },
  { top: '50%', left: '97%' },
  { top: '75%', left: '88%' },
  { top: '90%', left: '65%' },
  { top: '95%', left: '35%' },
  { top: '85%', left: '8%' },
  { top: '60%', left: '0%' },
  { top: '35%', left: '3%' },
];

function Twinkle({ delay, size: s }: { delay: number; size: number }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    const twinkle = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(opacity, { toValue: 1, duration: 800, useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1, duration: 800, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(opacity, { toValue: 0, duration: 800, useNativeDriver: true }),
          Animated.timing(scale, { toValue: 0.5, duration: 800, useNativeDriver: true }),
        ]),
      ])
    );
    twinkle.start();
    return () => twinkle.stop();
  }, []);

  return (
    <Animated.Text
      style={{
        fontSize: s,
        opacity,
        transform: [{ scale }],
        textShadowColor: '#FFFFFF',
        textShadowRadius: 4,
      }}
    >
      ✨
    </Animated.Text>
  );
}

export default function NobelFrame({ size, imageUrl, sparkles = true, glowColor = '#7E57C2' }: Props) {
  const glowAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Glow pulse only — frame itself never moves
    const glow = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1, duration: 2000, useNativeDriver: true }),
        Animated.timing(glowAnim, { toValue: 0, duration: 2000, useNativeDriver: true }),
      ])
    );
    glow.start();
    return () => glow.stop();
  }, []);

  const glowOpacity = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.4, 0.8],
  });

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      {/* Glow layer — pulsing, frame stays still */}
      <Animated.View
        style={[
          styles.glow,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderColor: glowColor,
            shadowColor: glowColor,
            opacity: glowOpacity,
          },
        ]}
      />
      {/* Frame — STATIC, no movement */}
      <Image
        source={{ uri: imageUrl }}
        style={{ width: size, height: size }}
        resizeMode="contain"
      />
      {/* Sparkles around the entire frame */}
      {sparkles && SPARKLE_POSITIONS.map((pos, i) => (
        <View key={i} style={[styles.spark, pos as any]}>
          <Twinkle delay={i * 300} size={size * 0.12} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    backgroundColor: 'transparent',
    borderWidth: 2,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 12,
    elevation: 5,
  },
  spark: {
    position: 'absolute',
  },
});
