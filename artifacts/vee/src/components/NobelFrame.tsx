/**
 * NobelFrame — Static Nobel crown frame with sparkle effects.
 * 2026-10-15 (Sumon): Frame STAYS STILL (no movement). Sparkles twinkle
 * around the entire frame perimeter. Battery-friendly.
 * 2026-10-20 (boss's order): Count+ ranks get a ROTATING sparkle ring
 * around the still frame + subtle glow pulse. Baron/Viscount keep the
 * static frame (IMO — effects start at Count).
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
  /**
   * 2026-10-20 (boss's order): rotating sparkle ring for Count+ ranks.
   * false = twinkling sparkles (Baron/Viscount), true = rotating ring.
   */
  rotatingSparkles?: boolean;
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

/**
 * RotatingSparkles — a ring of sparkles that rotates around a square area.
 * The center (frame artwork) stays still; only the sparkle ring spins.
 * Exported for reuse in NobelRankPreview. Pure useNativeDriver (rotate).
 */
export function RotatingSparkles({ size, count = 8 }: { size: number; count?: number }) {
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    spin.setValue(0);
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 12000,
        easing: (t) => t, // linear — constant spin
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);

  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  // Sparkle glyphs placed on the ring's cardinal/diagonal points.
  const points = Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2;
    return {
      left: size / 2 + Math.cos(angle) * (size / 2 - 4) - 8,
      top: size / 2 + Math.sin(angle) * (size / 2 - 4) - 8,
      glyph: i % 3 === 0 ? '⭐' : '✨',
      fontSize: 14 + (i % 2) * 4,
    };
  });

  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
    >
      <Animated.View
        style={{
          width: size,
          height: size,
          transform: [{ rotate }],
        }}
      >
        {points.map((p, i) => (
          <View
            key={i}
            style={{ position: 'absolute', left: p.left, top: p.top, width: 16, height: 16 }}
          >
            <Animated.Text
              style={{
                fontSize: p.fontSize,
                textShadowColor: '#FFFFFF',
                textShadowRadius: 5,
              }}
            >
              {p.glyph}
            </Animated.Text>
          </View>
        ))}
      </Animated.View>
    </View>
  );
}

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

export default function NobelFrame({ size, imageUrl, sparkles = true, glowColor = '#7E57C2', rotatingSparkles = false }: Props) {
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
      {/* 2026-10-20 (boss's order): Count+ gets a rotating sparkle ring
          (frame still stays still); below Count keeps twinkles. */}
      {sparkles && (rotatingSparkles
        ? <RotatingSparkles size={size * 1.18} />
        : SPARKLE_POSITIONS.map((pos, i) => (
          <View key={i} style={[styles.spark, pos as any]}>
            <Twinkle delay={i * 300} size={size * 0.12} />
          </View>
        )))}
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
