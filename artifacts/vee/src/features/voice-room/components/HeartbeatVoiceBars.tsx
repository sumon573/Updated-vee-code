/**
 * HeartbeatVoiceBars — live-voice bars that pulse like a heartbeat.
 *
 * 2026-11-09 (boss, marked screenshots: the voice icon must animate
 * "like a heartbeat"): 4 bars pulse in a lub-dub rhythm — a strong beat,
 * a brief pause, a softer second beat, then a rest — looping at ~53 bpm
 * (one 1140ms cycle). Gentle and subtle, never a strobe.
 *
 * HEAT / SMOOTHNESS (boss order 2026-11-08): the ONLY animated property
 * is transform scaleY (+ a bottom-pinning translateY derived from the
 * same value) on the NATIVE driver — fixed bar heights, zero layout work,
 * zero JS-thread frames while looping, no timers/intervals. Same cost
 * class as the VoiceWaves / MinimizedRoomBar ripple precedent, and the
 * loop is mounted ONLY where the icon is rendered (pill / sheet rows /
 * minimized bubble), so nothing animates off-screen. Each bar's phase is
 * staggered once (delay before its loop starts), so the beat ripples
 * left-to-right like a heartbeat trace and the bars stay in phase
 * forever (identical cycle lengths — no drift).
 *
 * Used by: ActiveFollowingsBar (pill, white on black), ActiveFollowings
 * sheet rows (black on white, next to the name of someone in a room),
 * MinimizedRoomBar bubble ripple (same motif, converted to this rhythm).
 */
import { memo, useEffect, useRef } from 'react';
import { View, Animated, Easing } from 'react-native';

// Rest heights, as fractions of maxHeight — the pill's old static bars
// [8, 13, 10, 7] / 13. A beat lifts a bar from its rest height to PEAK.
const REST_SCALES = [8 / 13, 1, 10 / 13, 7 / 13];
const PEAK = 1.15; // beat apex — slightly above full height, subtle lift
const CYCLE_MS = 1140; // lub(110+160) + pause(120) + dub(110+160) + rest(480)

function HeartBar({
  index,
  rest,
  maxHeight,
  barWidth,
  color,
}: {
  index: number;
  rest: number;
  maxHeight: number;
  barWidth: number;
  color: string;
}) {
  const s = useRef(new Animated.Value(rest)).current;
  // Pin the bar's BOTTOM edge while it scales (same trick as the
  // MinimizedRoomBar ripple): scaling about the centre would dip the bar
  // below the row baseline; translateY compensates exactly.
  const ty = s.interpolate({
    inputRange: [rest, PEAK],
    outputRange: [(maxHeight * (rest - 1)) / 2, (maxHeight * (PEAK - 1)) / 2],
  });

  useEffect(() => {
    // Second beat slightly softer than the first (the "dub").
    const peak2 = rest + (PEAK - rest) * 0.85;
    const beat = (peak: number) =>
      Animated.sequence([
        Animated.timing(s, { toValue: peak, duration: 110, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(s, { toValue: rest, duration: 160, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]);
    const cycle = Animated.sequence([
      beat(PEAK),
      Animated.delay(120),
      beat(peak2),
      Animated.delay(480),
    ]);
    // Stagger once, BEFORE the loop: every bar's loop is the same length
    // (CYCLE_MS), so the phase offset never drifts.
    const start = Animated.sequence([
      Animated.delay(index * 60),
      Animated.loop(cycle),
    ]);
    start.start();
    return () => start.stop();
  }, [s, rest, index]);

  return (
    <Animated.View
      style={{
        width: barWidth,
        height: maxHeight,
        borderRadius: barWidth / 2,
        backgroundColor: color,
        transform: [{ scaleY: s }, { translateY: ty }],
      }}
    />
  );
}

function HeartbeatVoiceBars({
  color = '#FFFFFF',
  maxHeight = 13,
  barWidth = 3,
  gap = 2,
}: {
  color?: string;
  maxHeight?: number;
  barWidth?: number;
  gap?: number;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap, height: maxHeight }}>
      {REST_SCALES.map((rest, i) => (
        <HeartBar key={i} index={i} rest={rest} maxHeight={maxHeight} barWidth={barWidth} color={color} />
      ))}
    </View>
  );
}

export default memo(HeartbeatVoiceBars);
export { CYCLE_MS };
