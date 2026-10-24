/**
 * MistNameplate — 2026-10-15 (Sumon).
 * Nameplate image with subtle animated mist overlay inside.
 * Starting from Viscount rank — each rank gets its own mist color.
 * Medium intensity: visible but elegant.
 */
import React, { useEffect, useRef } from 'react';
import { View, Image, Animated, Easing, StyleSheet } from 'react-native';

type MistParticle = {
  anim: Animated.Value;
  x: number;
  y: number;
  size: number;
  opacity: number;
  duration: number;
  delay: number;
  driftX: number;
  driftY: number;
};

function createParticles(count: number, width: number, height: number): MistParticle[] {
  return Array.from({ length: count }, () => ({
    anim: new Animated.Value(0),
    x: Math.random() * width,
    y: Math.random() * height,
    size: 8 + Math.random() * 16,
    opacity: 0.15 + Math.random() * 0.25,
    duration: 3000 + Math.random() * 3000,
    delay: Math.random() * 2000,
    driftX: (Math.random() - 0.5) * 30,
    driftY: (Math.random() - 0.5) * 20,
  }));
}

export default function MistNameplate({
  imageUrl,
  mistColor = '#BBDEFB',
  width = 120,
  height = 40,
  fit = 'contain',
}: {
  imageUrl: string;
  mistColor?: string;
  width?: number;
  height?: number;
  /** 2026-10-24 (Sumon): 'cover' fills the box completely (profile pill —
   * nameplates must be the SAME size as the Level/Follower pills). */
  fit?: 'contain' | 'cover';
}) {
  const particlesRef = useRef<MistParticle[]>(createParticles(12, width, height));

  useEffect(() => {
    const animations = particlesRef.current.map((p) => {
      // Drift + fade loop
      return Animated.loop(
        Animated.sequence([
          Animated.delay(p.delay),
          Animated.timing(p.anim, {
            toValue: 1,
            duration: p.duration,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(p.anim, {
            toValue: 0,
            duration: p.duration * 0.5,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
    });
    animations.forEach((a) => a.start());
    return () => animations.forEach((a) => a.stop());
  }, []);

  return (
    <View style={[styles.container, { width, height }]}>
      <Image
        source={{ uri: imageUrl }}
        style={{ width, height }}
        resizeMode={fit}
      />
      {/* Mist overlay — clipped inside */}
      <View style={[StyleSheet.absoluteFill, { overflow: 'hidden', borderRadius: height / 2 }]}>
        {particlesRef.current.map((p, i) => (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              left: p.x,
              top: p.y,
              width: p.size,
              height: p.size,
              borderRadius: p.size / 2,
              backgroundColor: mistColor,
              opacity: p.anim.interpolate({
                inputRange: [0, 0.5, 1],
                outputRange: [0, p.opacity, 0],
              }),
              transform: [
                {
                  translateX: p.anim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, p.driftX],
                  }),
                },
                {
                  translateY: p.anim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, p.driftY],
                  }),
                },
              ],
            }}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
