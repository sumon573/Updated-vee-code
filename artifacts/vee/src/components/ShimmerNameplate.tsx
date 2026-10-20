/**
 * ShimmerNameplate — 2026-10-20 (boss's order).
 * Nobel nameplate with an animated shine sweep for Count rank and above:
 * a soft white light band glides across the plate on a ~2.5s loop
 * (1.2s sweep + pause). Layered on top of the static rank artwork.
 * Ranks below Count stay static (matches IMO — effects start at Count).
 *
 * Pure Animated API, useNativeDriver throughout (translateX + opacity):
 * 60fps, no re-renders, loop stops on unmount.
 */
import React, { useEffect, useRef } from 'react';
import { View, Image, Animated, Easing, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

export default function ShimmerNameplate({
  imageUrl,
  width = 120,
  height = 40,
}: {
  imageUrl: string;
  width?: number;
  height?: number;
}) {
  const sweep = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    sweep.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, {
          toValue: 1,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.delay(1300),
        Animated.timing(sweep, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [sweep]);

  const bandW = Math.max(24, width * 0.45);
  const translateX = sweep.interpolate({
    inputRange: [0, 1],
    outputRange: [-bandW - 12, width + 12],
  });

  return (
    <View style={[styles.container, { width, height }]}>
      <Image
        source={{ uri: imageUrl }}
        style={{ width, height }}
        resizeMode="contain"
      />
      {/* Shine sweep — clipped inside the plate, sweeping left → right */}
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { overflow: 'hidden', borderRadius: height / 2 }]}
      >
        <Animated.View
          style={{
            position: 'absolute',
            top: -height * 0.35,
            height: height * 1.7,
            width: bandW,
            transform: [{ translateX }, { rotate: '18deg' }],
          }}
        >
          <LinearGradient
            colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.55)', 'rgba(255,255,255,0)']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={{ flex: 1 }}
          />
        </Animated.View>
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
