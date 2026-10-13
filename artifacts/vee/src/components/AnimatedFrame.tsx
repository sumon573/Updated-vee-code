/**
 * AnimatedFrame — Vee Official DP frame with live animation.
 * Uses the approved final frame design (blue ring + official banner +
 * Vee logo + vines).
 *
 * 2026-10-13 (Sumon): Video-reference exact — NO rotation. The reference
 * video shows a STATIC ring with vines growing + sparkles + glow pulse.
 * Only the glow pulse animation, no spinning.
 * NO native modules, NO lottie — 100% safe, zero crash risk.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet, Image } from 'react-native';

type Props = {
  /** Diameter of the avatar being framed (frame scales around it) */
  size: number;
};

export default function AnimatedFrame({ size }: Props) {
  const pulseAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Gentle glow pulse like the video — 2.5s cycle, NO rotation
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1250,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 1250,
          useNativeDriver: true,
        }),
      ])
    );
    pulseLoop.start();
    return () => {
      pulseLoop.stop();
    };
  }, [pulseAnim]);

  // Frame is larger than the DP to surround it
  const frameSize = size * 1.45;

  const pulseScale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.03],
  });

  const pulseOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.9, 1],
  });

  return (
    <View style={[styles.container, { width: frameSize, height: frameSize }]}>
      <Animated.View
        style={{
          width: frameSize,
          height: frameSize,
          transform: [{ scale: pulseScale }],
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
