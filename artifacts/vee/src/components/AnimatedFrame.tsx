/**
 * AnimatedFrame — pure React Native animated DP frame.
 * NO native modules, NO lottie — 100% safe, zero crash risk.
 *
 * Design: rotating dashed blue ring + pulsing dot (bottom-right),
 * approximating the approved Vee Official frame animation.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet } from 'react-native';

type Props = {
  /** Diameter of the avatar being framed (frame scales around it) */
  size: number;
};

export default function AnimatedFrame({ size }: Props) {
  const ringAnim = useRef(new Animated.Value(0)).current;
  const dotAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Rotating ring: 0 -> 360deg over 2s, linear, infinite loop
    const ringLoop = Animated.loop(
      Animated.timing(ringAnim, {
        toValue: 1,
        duration: 2000,
        useNativeDriver: true,
      })
    );
    // Pulsing dot: scale 1 -> 1.3 -> 1, 500ms each way, infinite
    const dotLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(dotAnim, {
          toValue: 1,
          duration: 500,
          useNativeDriver: true,
        }),
        Animated.timing(dotAnim, {
          toValue: 0,
          duration: 500,
          useNativeDriver: true,
        }),
      ])
    );
    ringLoop.start();
    dotLoop.start();
    return () => {
      ringLoop.stop();
      dotLoop.stop();
    };
  }, [ringAnim, dotAnim]);

  const ringSize = size * 1.35;
  const ringRotate = ringAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });
  const dotScale = dotAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.3],
  });
  const dotSize = Math.max(8, size * 0.12);

  return (
    <View style={[styles.container, { width: ringSize, height: ringSize }]}>
      {/* Rotating dashed ring */}
      <Animated.View
        style={[
          styles.ring,
          {
            width: ringSize,
            height: ringSize,
            borderRadius: ringSize / 2,
            borderWidth: Math.max(3, size * 0.04),
            transform: [{ rotate: ringRotate }],
          },
        ]}
      />
      {/* Pulsing dot (bottom-right) */}
      <Animated.View
        style={[
          styles.dot,
          {
            width: dotSize,
            height: dotSize,
            borderRadius: dotSize / 2,
            transform: [{ scale: dotScale }],
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    borderColor: '#3399FF',
    borderStyle: 'dashed',
    position: 'absolute',
  },
  dot: {
    backgroundColor: '#3399FF',
    position: 'absolute',
    bottom: 2,
    right: 2,
  },
});
