/**
 * AnimatedFrame — Vee Official DP frame, video-exact.
 * - Exact frame design from reference video (blue ring + "official" ribbon + vines)
 * - Vee logo PULSES separately (bottom-right)
 * - Sparkles twinkle ONLY on the ring (not outside)
 * - NO rotation. NO native modules — 100% safe, zero lag.
 *
 * 2026-10-13 (Sumon): Vee logo pulses; sparkles confined to frame ring.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet, Image, Text } from 'react-native';

type Props = {
  /** Diameter of the avatar being framed (frame scales around it) */
  size: number;
};

// Sparkle positions ON THE RING (angle in degrees, 0 = right, going clockwise)
// Ring is at ~0.32 of frame size from center
const SPARKLE_ANGLES = [15, 60, 105, 150, 195, 240, 285, 330];
const RING_RADIUS = 0.32; // relative to frame size

function angleToPos(angleDeg: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: 0.5 + RING_RADIUS * Math.cos(rad),
    y: 0.5 + RING_RADIUS * Math.sin(rad),
  };
}

function Sparkle({ angle, delay, frameSize }: {
  angle: number; delay: number; frameSize: number;
}) {
  const anim = useRef(new Animated.Value(0)).current;
  const pos = angleToPos(angle);
  const sparkleSize = 14;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, {
          toValue: 1,
          duration: 350,
          useNativeDriver: true,
        }),
        Animated.timing(anim, {
          toValue: 0,
          duration: 550,
          useNativeDriver: true,
        }),
        Animated.delay(2000 - delay),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim, delay]);

  const opacity = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  const scale = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.4, 1.3],
  });

  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: pos.x * frameSize - sparkleSize / 2,
        top: pos.y * frameSize - sparkleSize / 2,
        opacity,
        transform: [{ scale }],
      }}
    >
      <Text style={{
        fontSize: sparkleSize,
        color: '#fff',
        textShadowColor: '#B3E5FC',
        textShadowRadius: 6,
      }}>
        ✦
      </Text>
    </Animated.View>
  );
}

export default function AnimatedFrame({ size }: Props) {
  const logoPulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Vee logo pulse — 2s cycle
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(logoPulse, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(logoPulse, {
          toValue: 0,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    );
    pulseLoop.start();
    return () => {
      pulseLoop.stop();
    };
  }, [logoPulse]);

  // Frame is larger than the DP to surround it
  const frameSize = size * 1.45;
  // Vee logo size and position (bottom-right, like video)
  const logoSize = frameSize * 0.28;

  const logoScale = logoPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.12],
  });

  const logoOpacity = logoPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.95, 1],
  });

  return (
    <View style={[styles.container, { width: frameSize, height: frameSize }]}>
      {/* Base frame (ring + ribbon + vines, no logo) */}
      <Image
        source={require('@/assets/images/vee-official-frame.png')}
        style={{ width: frameSize, height: frameSize }}
        resizeMode="contain"
      />
      {/* Pulsing Vee logo (bottom-right) */}
      <Animated.View
        style={{
          position: 'absolute',
          right: frameSize * 0.08,
          bottom: frameSize * 0.1,
          width: logoSize,
          height: logoSize,
          transform: [{ scale: logoScale }],
          opacity: logoOpacity,
        }}
      >
        <Image
          source={require('@/assets/images/vee-logo.png')}
          style={{ width: logoSize, height: logoSize }}
          resizeMode="contain"
        />
      </Animated.View>
      {/* Sparkles ONLY on the ring */}
      {SPARKLE_ANGLES.map((angle, i) => (
        <Sparkle
          key={i}
          angle={angle}
          delay={i * 250}
          frameSize={frameSize}
        />
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
