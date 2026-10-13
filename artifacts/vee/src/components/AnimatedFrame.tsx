/**
 * AnimatedFrame — Vee Official DP frame (FINAL).
 * 2026-10-13 (Sumon): The frame is used EXACTLY as given — nothing overlaid on top.
 * The Vee logo is already baked into the frame design.
 * Only animation: the frame itself "breathes" (very subtle scale 1.0 → 1.02).
 * NO rotation. NO native modules — safe, no lag.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet, Image } from 'react-native';

type Props = {
  size: number;
};

export default function AnimatedFrame({ size }: Props) {
  const frameBreath = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const breathLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(frameBreath, { toValue: 1, duration: 2000, useNativeDriver: true }),
        Animated.timing(frameBreath, { toValue: 0, duration: 2000, useNativeDriver: true }),
      ])
    );
    breathLoop.start();
    return () => breathLoop.stop();
  }, [frameBreath]);

  const frameSize = size * 1.45;

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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
