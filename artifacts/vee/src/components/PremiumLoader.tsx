/**
 * PremiumLoader (2026-10-15, Sumon) — unified luxury loading indicator.
 *
 * Replaces all raw ActivityIndicator usages app-wide for a consistent,
 * premium, buttery-smooth loading experience. Brand blue (#007AFF) with
 * a soft glow halo and optional label.
 *
 * Sizes: 'small' (24) | 'medium' (40) | 'large' (56) | 'fullscreen'
 * Fullscreen renders a centered white overlay (light-mode-everywhere rule).
 */
import { useEffect, useRef } from 'react';
import { View, Text, Animated, Easing, StyleSheet } from 'react-native';

const BLUE = '#007AFF';

type Size = 'small' | 'medium' | 'large' | 'fullscreen';

const DIMS: Record<Exclude<Size, 'fullscreen'>, number> = {
  small: 24,
  medium: 40,
  large: 56,
};

function Spinner({ size }: { size: number }) {
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    anim.start();
    return () => anim.stop();
  }, [spin]);

  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {/* Soft glow halo */}
      <View
        style={{
          position: 'absolute',
          width: size * 1.5,
          height: size * 1.5,
          borderRadius: size * 0.75,
          backgroundColor: BLUE + '14',
        }}
      />
      <Animated.View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: Math.max(2.5, size * 0.09),
          borderColor: BLUE + '22',
          borderTopColor: BLUE,
          transform: [{ rotate }],
          shadowColor: BLUE,
          shadowOpacity: 0.3,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 2 },
          elevation: 4,
        }}
      />
    </View>
  );
}

export default function PremiumLoader({
  size = 'medium',
  label,
  color = BLUE,
}: {
  size?: Size;
  label?: string;
  color?: string;
}) {
  if (size === 'fullscreen') {
    return (
      <View style={styles.fullscreen}>
        <Spinner size={56} />
        {label ? <Text style={styles.label}>{label}</Text> : null}
      </View>
    );
  }
  const dim = DIMS[size];
  return (
    <View style={styles.inline}>
      <Spinner size={dim} />
      {label ? <Text style={[styles.label, { marginTop: 10 }]}>{label}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fullscreen: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inline: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  label: {
    marginTop: 16,
    fontSize: 14,
    fontWeight: '600',
    color: '#8E8E93',
    letterSpacing: 0.3,
  },
});
