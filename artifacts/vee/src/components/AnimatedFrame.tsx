/**
 * AnimatedFrame — Vee Official DP frame with live animation.
 * Uses the approved final frame design (blue ring + official banner +
 * Vee logo + vines) with subtle rotation + pulse animations.
 * NO native modules, NO lottie — 100% safe, zero crash risk.
 *
 * 2026-10-13 (Sumon): Upgraded from placeholder dashed ring to the
 * actual finalized frame design, animated like the approved video
 * (vines coiling rotation, Vee logo pulsing glow).
 */
import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet, Image } from 'react-native';

type Props = {
  /** Diameter of the avatar being framed (frame scales around it) */
  size: number;
};

export default function AnimatedFrame({ size }: Props) {
  const rotateAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Slow rotation like vines coiling — 12s per full rotation
    const rotateLoop = Animated.loop(
      Animated.timing(rotateAnim, {
        toValue: 1,
        duration: 12000,
        useNativeDriver: true,
      })
    );
    // Gentle pulse like the Vee logo glow — 2s cycle
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    );
    rotateLoop.start();
    pulseLoop.start();
    return () => {
      rotateLoop.stop();
      pulseLoop.stop();
    };
  }, [rotateAnim, pulseAnim]);

  // Frame is larger than the DP to surround it
  const frameSize = size * 1.45;

  const rotate = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const pulseScale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.04],
  });

  const pulseOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.85, 1],
  });

  return (
    <View style={[styles.container, { width: frameSize, height: frameSize }]}>
      <Animated.View
        style={{
          width: frameSize,
          height: frameSize,
          transform: [{ rotate }, { scale: pulseScale }],
          opacity: pulseOpacity,
        }}
      >
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
