/**
 * VoiceWaves — IMO-style recording waveform animation.
 *
 * IMO's recording UI (bci.xml) shows animated waves next to the timer.
 * This renders 5 bars that bounce in a loop while recording.
 * Pure React Native Animated — no native module.
 */
import { memo, useEffect, useRef } from 'react';
import { View, Animated } from 'react-native';

const BARS = 5;
const BAR_W = 3;
const GAP = 3;

function Bar({ delay, color }: { delay: number; color: string }) {
  const h = useRef(new Animated.Value(6)).current;

  useEffect(() => {
    const seq = Animated.sequence([
      Animated.timing(h, { toValue: 18, duration: 350, delay, useNativeDriver: false }),
      Animated.timing(h, { toValue: 6, duration: 350, useNativeDriver: false }),
    ]);
    const loop = Animated.loop(seq);
    loop.start();
    return () => loop.stop();
  }, [h, delay]);

  return (
    <Animated.View
      style={{
        width: BAR_W,
        height: h,
        borderRadius: BAR_W / 2,
        backgroundColor: color,
      }}
    />
  );
}

function VoiceWaves({ color = '#009dff' }: { color?: string }) {
  const barsRef = useRef<number[] | null>(null);
  if (!barsRef.current) {
    barsRef.current = Array.from({ length: BARS }, (_, i) => i * 120);
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: GAP, height: 20 }}>
      {barsRef.current.map((d) => (
        <Bar key={d} delay={d} color={color} />
      ))}
    </View>
  );
}

export default memo(VoiceWaves);
