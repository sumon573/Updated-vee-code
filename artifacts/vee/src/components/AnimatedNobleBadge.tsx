/**
 * AnimatedNobleBadge — 2026-10-20 (boss's order).
 * Nobel badge with premium animation for Count rank and above:
 * a soft glow that pulses behind the badge + small sparkle particles
 * that float up around it and fade. Layered on top of the static rank
 * artwork. Ranks below Count use a plain static badge image.
 *
 * Pure Animated API, useNativeDriver (opacity + translate + scale),
 * loops stop on unmount. The badge artwork itself stays still.
 */
import React, { useEffect, useRef } from 'react';
import { View, Image, Animated, Easing } from 'react-native';

type Sparkle = {
  anim: Animated.Value;
  x: number;
  size: number;
  driftX: number;
  rise: number;
  duration: number;
  delay: number;
  glyph: string;
};

const GLYPHS = ['✨', '⭐', '💫', '✨', '⭐'];

function SparkleParticle({ s }: { s: Sparkle }) {
  const opacity = s.anim.interpolate({
    inputRange: [0, 0.3, 0.75, 1],
    outputRange: [0, 1, 0.8, 0],
  });
  const translateY = s.anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -s.rise],
  });
  const translateX = s.anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, s.driftX],
  });
  const scale = s.anim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.6, 1, 0.7],
  });
  return (
    <Animated.Text
      style={{
        position: 'absolute',
        left: s.x,
        top: '55%',
        fontSize: s.size,
        opacity,
        transform: [{ translateX }, { translateY }, { scale }],
      }}
    >
      {s.glyph}
    </Animated.Text>
  );
}

export default function AnimatedNobleBadge({
  imageUrl,
  size = 56,
  glowColor = '#FFD700',
}: {
  imageUrl: string;
  size?: number;
  glowColor?: string;
}) {
  const glow = useRef(new Animated.Value(0)).current;
  const sparklesRef = useRef<Sparkle[] | null>(null);
  if (sparklesRef.current === null) {
    sparklesRef.current = Array.from({ length: 5 }, (_, i) => ({
      anim: new Animated.Value(0),
      x: 4 + ((size - 16) / 4) * i + (i % 2) * 3,
      size: size * 0.2 + (i % 3),
      driftX: (i % 2 === 0 ? 1 : -1) * (4 + i * 2),
      rise: size * 0.55 + i * 3,
      duration: 2200 + i * 450,
      delay: i * 620,
      glyph: GLYPHS[i % GLYPHS.length],
    }));
  }
  const sparkles = sparklesRef.current;

  useEffect(() => {
    const glowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, {
          toValue: 1, duration: 1600, easing: Easing.inOut(Easing.ease), useNativeDriver: true,
        }),
        Animated.timing(glow, {
          toValue: 0, duration: 1600, easing: Easing.inOut(Easing.ease), useNativeDriver: true,
        }),
      ]),
    );
    glowLoop.start();
    const sparkleLoops = sparkles.map((s) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(s.delay),
          Animated.timing(s.anim, {
            toValue: 1, duration: s.duration, easing: Easing.out(Easing.ease), useNativeDriver: true,
          }),
          Animated.timing(s.anim, { toValue: 0, duration: 0, useNativeDriver: true }),
          Animated.delay(Math.max(0, 2600 - s.duration)),
        ]),
      ));
    sparkleLoops.forEach((l) => l.start());
    return () => {
      glowLoop.stop();
      sparkleLoops.forEach((l) => l.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glow]);

  const glowOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.7] });
  const glowScale = glow.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.06] });

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {/* Glow pulse behind the badge */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          width: size * 0.98,
          height: size * 0.98,
          borderRadius: size / 2,
          backgroundColor: glowColor,
          opacity: glowOpacity,
          transform: [{ scale: glowScale }],
          shadowColor: glowColor,
          shadowOpacity: 0.9,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 0 },
          elevation: 6,
        }}
      />
      {/* Badge artwork — static, stays still */}
      <Image
        source={{ uri: imageUrl }}
        style={{ width: size, height: size }}
        resizeMode="contain"
      />
      {/* Floating sparkles */}
      <View
        pointerEvents="none"
        style={{ position: 'absolute', left: 0, top: 0, width: size, height: size, overflow: 'visible' }}
      >
        {sparkles.map((s, i) => (
          <SparkleParticle key={i} s={s} />
        ))}
      </View>
    </View>
  );
}
