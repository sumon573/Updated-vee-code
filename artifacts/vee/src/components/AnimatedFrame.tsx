/**
 * AnimatedFrame — Vee Official DP frame.
 * Clean frame design + subtle pulsing Vee logo + tiny twinkling sparkles on ring.
 * NO rotation. NO native modules — safe, no lag.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet, Image } from 'react-native';

type Props = {
  size: number;
};

// Subtle sparkle dots on the ring (angles in degrees)
const SPARKLE_ANGLES = [30, 90, 150, 210, 270, 330];
const RING_RADIUS = 0.31;

function Sparkle({ angle, delay, frameSize }: {
  angle: number; delay: number; frameSize: number;
}) {
  const anim = useRef(new Animated.Value(0)).current;
  const rad = (angle * Math.PI) / 180;
  const x = 0.5 + RING_RADIUS * Math.cos(rad);
  const y = 0.5 + RING_RADIUS * Math.sin(rad);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 700, useNativeDriver: true }),
        Animated.delay(2200),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim, delay]);

  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: x * frameSize - 3,
        top: y * frameSize - 3,
        width: 6,
        height: 6,
        borderRadius: 3,
        backgroundColor: '#fff',
        opacity: anim,
        shadowColor: '#fff',
        shadowRadius: 4,
        shadowOpacity: 0.8,
      }}
    />
  );
}

export default function AnimatedFrame({ size }: Props) {
  const logoPulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(logoPulse, { toValue: 1, duration: 1200, useNativeDriver: true }),
        Animated.timing(logoPulse, { toValue: 0, duration: 1200, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [logoPulse]);

  const frameSize = size * 1.45;
  const logoSize = frameSize * 0.24;

  const logoScale = logoPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.08],
  });

  return (
    <View style={[styles.container, { width: frameSize, height: frameSize }]}>
      <Image
        source={require('@/assets/images/vee-official-frame.png')}
        style={{ width: frameSize, height: frameSize }}
        resizeMode="contain"
      />
      <Animated.View
        style={{
          position: 'absolute',
          right: frameSize * 0.1,
          bottom: frameSize * 0.12,
          width: logoSize,
          height: logoSize,
          transform: [{ scale: logoScale }],
        }}
      >
        <Image
          source={require('@/assets/images/vee-logo.png')}
          style={{ width: logoSize, height: logoSize }}
          resizeMode="contain"
        />
      </Animated.View>
      {SPARKLE_ANGLES.map((angle, i) => (
        <Sparkle key={i} angle={angle} delay={i * 350} frameSize={frameSize} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
