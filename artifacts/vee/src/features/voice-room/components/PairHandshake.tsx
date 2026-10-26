/**
 * PairHandshake — boss pick, 2026-10-26: the ring is GONE.
 *
 * Between two adjacent seated users who share an intimacy relation, a
 * small handshake badge sits in the gap between their avatars (his
 * reference: red hands + light outline). No ring around the seats, no
 * merged group halo: one badge per active pair (a 3-chain shows two).
 *
 * Relationship growth = the badge itself grows: colours come from the
 * pair's own design (basic tier by intimacy level, or the premium Store
 * design), sparkle count (0..3) grows with it, and a GENTLE pulse
 * breathes the badge while sparkles twinkle — হালকা, never flashy.
 * Drawn with react-native-svg (already a dependency): no image assets.
 */
import React, { useEffect, useId, useRef } from 'react';
import { Animated } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Polygon, Stop } from 'react-native-svg';
import type { HandshakeDesign } from './handshakeDesigns';

/** Badge size: sits in the ~25dp gap between adjacent avatars, slightly
 *  overlapping both edges the way his reference does. */
export const HANDSHAKE_BADGE = 36;

const SPARK = '6,0 7.6,4.4 12,6 7.6,7.6 6,12 4.4,7.6 0,6 4.4,4.4';

export default function PairHandshake({ design }: { design: HandshakeDesign }) {
  const pulse = useRef(new Animated.Value(0)).current;
  const twinkle = useRef(new Animated.Value(0)).current;
  const gid = `phs${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

  useEffect(() => {
    const p = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 1600, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 1600, useNativeDriver: true }),
    ]));
    const tw = Animated.loop(Animated.sequence([
      Animated.timing(twinkle, { toValue: 1, duration: 620, useNativeDriver: true }),
      Animated.timing(twinkle, { toValue: 0, duration: 620, useNativeDriver: true }),
    ]));
    p.start(); tw.start();
    return () => { p.stop(); tw.stop(); };
  }, [pulse, twinkle]);

  const [c1, c2] = design.colors;
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.07] });
  const sparkleOpacity = twinkle.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] });

  return (
    <Animated.View style={{ width: HANDSHAKE_BADGE, height: HANDSHAKE_BADGE, transform: [{ scale }] }}>
      <Svg width={HANDSHAKE_BADGE} height={HANDSHAKE_BADGE} viewBox="0 0 64 64">
        <Defs>
          <LinearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={c1} />
            <Stop offset="1" stopColor={c2} />
          </LinearGradient>
        </Defs>
        {/* soft glow behind the badge */}
        <Circle cx={32} cy={32} r={24} fill={c2} opacity={0.18} />
        {/* arms: left + right forearms meeting in the middle */}
        <Path d="M7 44 L27 32" stroke={`url(#${gid})`} strokeWidth={12} strokeLinecap="round" />
        <Path d="M57 44 L37 32" stroke={`url(#${gid})`} strokeWidth={12} strokeLinecap="round" />
        {/* clasp: the two palms meeting */}
        <Path d="M22 22 Q32 14 42 22 Q42 34 32 36 Q22 34 22 22 Z"
          fill={`url(#${gid})`} stroke="#ffffff" strokeWidth={2.2} />
        {/* finger lines on the clasp */}
        <Path d="M27 21 L27 31 M32 20 L32 32 M37 21 L37 30"
          stroke="#ffffff" strokeWidth={1.7} strokeLinecap="round" opacity={0.9} />
      </Svg>
      {design.sparkle > 0 && (
        <Animated.View style={{ position: 'absolute', top: -2, left: 1, opacity: sparkleOpacity }}>
          <Svg width={11} height={11}><Polygon points={SPARK} fill={c1} /></Svg>
        </Animated.View>
      )}
      {design.sparkle > 1 && (
        <Animated.View style={{ position: 'absolute', top: -2, right: 1, opacity: sparkleOpacity }}>
          <Svg width={10} height={10}><Polygon points={SPARK} fill={c2} /></Svg>
        </Animated.View>
      )}
      {design.sparkle > 2 && (
        <Animated.View style={{ position: 'absolute', top: -3, left: HANDSHAKE_BADGE / 2 - 4, opacity: sparkleOpacity }}>
          <Svg width={8} height={8}><Polygon points={SPARK} fill="#ffffff" /></Svg>
        </Animated.View>
      )}
    </Animated.View>
  );
}
