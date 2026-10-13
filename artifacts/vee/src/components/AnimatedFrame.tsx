import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet, Easing } from 'react-native';

/**
 * 2026-10-13 (Sumon): Pure React Native animated frame — NO native modules.
 * Replaces lottie-react-native (which caused startup crashes).
 * Design: rotating blue dashed ring + pulsing dot, matching the approved
 * Vee Official frame animation (vines rotate like snakes coiling).
 */
interface AnimatedFrameProps {
  size: number; // total frame size (e.g. 110 for profile DP overlay)
}

export function AnimatedFrame({ size }: AnimatedFrameProps) {
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Continuous 360° rotation over 2 seconds (matches Lottie: 120 frames @60fps)
    const rotate = Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 2000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    // Pulsing dot: scale 1 → 1.3 → 1 over 1 second
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.3,
          duration: 500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    rotate.start();
    pulse.start();
    return () => {
      rotate.stop();
      pulse.stop();
    };
  }, [rotateAnim, pulseAnim]);

  const rotate = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const ringSize = size;
  const ringThickness = Math.max(3, size * 0.04);

  return (
    <View style={[styles.container, { width: size, height: size }]} pointerEvents="none">
      {/* Rotating dashed ring — Vee blue #3399FF */}
      <Animated.View
        style={[
          styles.ring,
          {
            width: ringSize,
            height: ringSize,
            borderRadius: ringSize / 2,
            borderWidth: ringThickness,
            transform: [{ rotate }],
          },
        ]}
      />
      {/* Pulsing dot at bottom-right (matches Lottie dot at 380,380) */}
      <Animated.View
        style={[
          styles.dot,
          {
            width: size * 0.08,
            height: size * 0.08,
            borderRadius: size * 0.04,
            right: size * 0.08,
            bottom: size * 0.08,
            transform: [{ scale: pulseAnim }],
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    borderColor: '#3399FF',
    borderStyle: 'dashed',
  },
  dot: {
    position: 'absolute',
    backgroundColor: '#3399FF',
  },
});
