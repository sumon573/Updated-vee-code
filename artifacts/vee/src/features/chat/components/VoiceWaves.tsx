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
  // Perf (2026-10-22 audit): animate transform scaleY on the NATIVE driver.
  // Animating `height` (layout) with useNativeDriver:false forced JS-thread
  // layout work every frame during recording. Fixed height 18 (the old max)
  // scaled 1/3→1 looks identical and costs nothing on the JS thread.
  const s = useRef(new Animated.Value(6 / 18)).current;

  useEffect(() => {
    const seq = Animated.sequence([
      Animated.timing(s, { toValue: 1, duration: 350, delay, useNativeDriver: true }),
      Animated.timing(s, { toValue: 6 / 18, duration: 350, useNativeDriver: true }),
    ]);
    const loop = Animated.loop(seq);
    loop.start();
    return () => loop.stop();
  }, [s, delay]);

  return (
    <Animated.View
      style={{
        width: BAR_W,
        height: 18,
        borderRadius: BAR_W / 2,
        backgroundColor: color,
        transform: [{ scaleY: s }],
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
