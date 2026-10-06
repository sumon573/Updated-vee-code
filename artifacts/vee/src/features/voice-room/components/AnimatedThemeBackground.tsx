/**
 * AnimatedThemeBackground — light, beautiful animated room background.
 *
 * Layers (all pointer-events-none, GPU-friendly):
 *  1. Pulsing top glow in the theme accent color (slow breathe, 4s loop).
 *  2. Soft bottom glow for depth.
 *  3. Floating particles — small accent-tinted dots drifting upward on
 *     staggered loops, like embers / bubbles / snow depending on theme.
 *
 * Kept deliberately light: opacity-only + translateY animations driven by
 * the native driver, a fixed small particle count, no blur filters.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Dimensions, Easing, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

const { width: W, height: H } = Dimensions.get('window');
const PARTICLE_COUNT = 10;

type Props = {
  accentColor: string;
};

function Particle({ accent, index }: { accent: string; index: number }) {
  const y = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  const cfg = useMemo(() => {
    // Deterministic pseudo-random per index so particles don't jump on re-render.
    const seed = (index * 7919) % 100 / 100;
    return {
      left: seed * W,
      size: 3 + ((index * 13) % 5),
      duration: 6000 + ((index * 1700) % 5000),
      delay: (index * 900) % 4000,
      drift: ((index * 37) % 60) - 30,
      maxOpacity: 0.25 + ((index * 7) % 20) / 100,
    };
  }, [index]);

  useEffect(() => {
    let alive = true;
    y.setValue(0);
    opacity.setValue(0);
    const rise = Animated.loop(
      Animated.sequence([
        Animated.delay(cfg.delay),
        Animated.parallel([
          Animated.timing(y, {
            toValue: -(H * 0.55),
            duration: cfg.duration,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
          Animated.sequence([
            Animated.timing(opacity, {
              toValue: cfg.maxOpacity,
              duration: cfg.duration * 0.25,
              easing: Easing.out(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(opacity, {
              toValue: 0,
              duration: cfg.duration * 0.75,
              easing: Easing.in(Easing.quad),
              useNativeDriver: true,
            }),
          ]),
        ]),
      ]),
    );
    rise.start();
    return () => {
      alive = false;
      rise.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accent]);

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: cfg.left,
        bottom: H * 0.25,
        width: cfg.size,
        height: cfg.size,
        borderRadius: cfg.size / 2,
        backgroundColor: accent,
        opacity,
        transform: [{ translateY: y }, { translateX: cfg.drift }],
      }}
    />
  );
}

export function AnimatedThemeBackground({ accentColor }: Props) {
  const breathe = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1,
          duration: 3200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(breathe, {
          toValue: 0,
          duration: 3200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accentColor]);

  const glowOpacity = breathe.interpolate({
    inputRange: [0, 1],
    outputRange: [0.55, 1],
  });
  const glowScale = breathe.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.12],
  });

  const particles = useMemo(
    () => Array.from({ length: PARTICLE_COUNT }, (_, i) => i),
    [],
  );

  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 0 }}
    >
      {/* Breathing top glow in the theme accent */}
      <Animated.View
        style={{
          position: 'absolute',
          top: -60,
          left: -40,
          right: -40,
          height: 300,
          opacity: glowOpacity,
          transform: [{ scale: glowScale }],
        }}
      >
        <LinearGradient
          colors={[accentColor + '38', accentColor + '00']}
          style={{ flex: 1 }}
        />
      </Animated.View>

      {/* Soft bottom glow for depth */}
      <LinearGradient
        colors={[accentColor + '00', accentColor + '14']}
        style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 180 }}
      />

      {/* Floating particles */}
      {particles.map((i) => (
        <Particle key={`${accentColor}-${i}`} accent={accentColor} index={i} />
      ))}
    </View>
  );
}
