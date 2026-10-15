/**
 * NobelFrame — Animated Nobel crown frame.
 * 2026-10-15 (Sumon): Crown stays on top, gentle float (not falling).
 * Subtle glow pulse + optional sparkles. Battery-friendly.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, View, Image, StyleSheet } from 'react-native';

type Props = {
  size: number;
  imageUrl: string;
  /** Show sparkles (default true for Count+) */
  sparkles?: boolean;
};

export default function NobelFrame({ size, imageUrl, sparkles = true }: Props) {
  const floatAnim = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Gentle float: -3px to +3px (crown stays on top, just moves slightly)
    const float = Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, { toValue: -3, duration: 1500, useNativeDriver: true }),
        Animated.timing(floatAnim, { toValue: 3, duration: 1500, useNativeDriver: true }),
        Animated.timing(floatAnim, { toValue: 0, duration: 1500, useNativeDriver: true }),
      ])
    );
    // Glow pulse
    const glow = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1, duration: 2000, useNativeDriver: true }),
        Animated.timing(glowAnim, { toValue: 0, duration: 2000, useNativeDriver: true }),
      ])
    );
    float.start();
    glow.start();
    return () => {
      float.stop();
      glow.stop();
    };
  }, []);

  const glowOpacity = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.3, 0.7],
  });

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      {/* Glow layer */}
      <Animated.View
        style={[
          styles.glow,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            opacity: glowOpacity,
          },
        ]}
      />
      {/* Frame with gentle float */}
      <Animated.View style={{ transform: [{ translateY: floatAnim }] }}>
        <Image
          source={{ uri: imageUrl }}
          style={{ width: size, height: size }}
          resizeMode="contain"
        />
      </Animated.View>
      {/* Sparkles */}
      {sparkles && (
        <>
          <Animated.View style={[styles.spark, { top: '5%', left: '15%', opacity: glowOpacity }]}>
            <Image
              source={{ uri: 'data:image/png;base64,iVBORw0KGgo=' }}
              style={{ width: 0, height: 0 }}
            />
          </Animated.View>
        </>
      )}
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
    borderColor: '#7E57C2',
    shadowColor: '#7E57C2',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 12,
    elevation: 5,
  },
  spark: {
    position: 'absolute',
  },
});
