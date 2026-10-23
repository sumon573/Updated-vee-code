/**
 * PairHalo — the Mic Handshake visual, redesign "M" (boss pick, 2026-10-23).
 *
 * A soft glowing capsule ring wraps BOTH seats of a related pair — or the
 * WHOLE connected group when 3–4 adjacent seats chain together (one big
 * halo, never overlapping rings). No line, no middle icon: the halo itself
 * is the link. It renders BEHIND the seat grid, so Nobel/store frames and
 * seat names are never covered or clipped.
 *
 * Colours + sparkle come from the pair/group design (basic intimacy tiers
 * or a premium Store design), exactly as the old link did — only the shape
 * changed. The whole halo breathes gently; sparkles twinkle along the top.
 */
import React, { useEffect, useId, useRef } from 'react';
import { Animated } from 'react-native';
import Svg, { Defs, LinearGradient, Polygon, Rect, Stop } from 'react-native-svg';
import type { HandshakeDesign } from './handshakeDesigns';

/** Capsule outer half-height. The visible ring sits 6dp inside this, giving
 *  a 34dp ring radius — clear of a framed avatar (59dp art → 29.5dp radius). */
export const HALO_R = 40;
const RING_INSET = 6;

const SPARK = '6,0 7.6,4.4 12,6 7.6,7.6 6,12 4.4,7.6 0,6 4.4,4.4';

export default function PairHalo({ width, design }: { width: number; design: HandshakeDesign }) {
  const pulse = useRef(new Animated.Value(0)).current;
  const twinkle = useRef(new Animated.Value(0)).current;
  const gid = `halo${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  useEffect(() => {
    const p = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 1400, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 1400, useNativeDriver: true }),
    ]));
    const tw = Animated.loop(Animated.sequence([
      Animated.timing(twinkle, { toValue: 1, duration: 620, useNativeDriver: true }),
      Animated.timing(twinkle, { toValue: 0, duration: 620, useNativeDriver: true }),
    ]));
    p.start(); tw.start();
    return () => { p.stop(); tw.stop(); };
  }, [pulse, twinkle]);

  const [c1, c2] = design.colors;
  const h = HALO_R * 2;
  const iw = Math.max(0, width - RING_INSET * 2);
  const ih = h - RING_INSET * 2;
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.015] });
  const sparkleOpacity = twinkle.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] });

  return (
    <Animated.View style={{ width, height: h, transform: [{ scale }], opacity: 0.98 }}>
      <Svg width={width} height={h}>
        <Defs>
          <LinearGradient id={gid} x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={c1} />
            <Stop offset="1" stopColor={c2} />
          </LinearGradient>
        </Defs>
        {/* soft outer glow */}
        <Rect x={RING_INSET} y={RING_INSET} width={iw} height={ih} rx={ih / 2}
          fill="none" stroke={c2} strokeWidth={10} opacity={0.20} />
        {/* the halo ring itself */}
        <Rect x={RING_INSET} y={RING_INSET} width={iw} height={ih} rx={ih / 2}
          fill="none" stroke={`url(#${gid})`} strokeWidth={3.4} />
      </Svg>
      {design.sparkle > 0 && (
        <Animated.View style={{ position: 'absolute', top: -3, left: width * 0.24, opacity: sparkleOpacity }}>
          <Svg width={12} height={12}><Polygon points={SPARK} fill={c1} /></Svg>
        </Animated.View>
      )}
      {design.sparkle > 1 && (
        <Animated.View style={{ position: 'absolute', top: -3, right: width * 0.24, opacity: sparkleOpacity }}>
          <Svg width={10} height={10}><Polygon points={SPARK} fill={c2} /></Svg>
        </Animated.View>
      )}
      {design.sparkle > 2 && (
        <Animated.View style={{ position: 'absolute', top: -4, left: width / 2 - 4, opacity: sparkleOpacity }}>
          <Svg width={8} height={8}><Polygon points={SPARK} fill="#ffffff" /></Svg>
        </Animated.View>
      )}
    </Animated.View>
  );
}
