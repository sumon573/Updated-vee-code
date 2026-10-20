/**
 * PairLink — the animated Mic Handshake connector between two ADJACENT
 * seated users who share a diamond-sending intimacy relation
 * (2026-10-20, Sumon).
 *
 * Drawn with react-native-svg; a heartbeat/wave line flows between the two
 * avatars with the design's motif in the middle. The whole link gently
 * pulses; sparkles twinkle when the tier/design calls for them. Sits
 * BETWEEN the seats only — never covers an avatar or a name.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import Svg, { Path, Circle, Polygon, Ellipse, Rect, G } from 'react-native-svg';
import type { HandshakeDesign } from './handshakeDesigns';

export const PAIR_LINK_W = 76;
export const PAIR_LINK_H = 36;

const HEART = 'M0 3.2 C0 1.6 -1.6 -0.4 -3.8 -0.4 C-7.2 -0.4 -9.6 2.4 -9.6 5.4 C-9.6 9.4 -4.4 12.4 0 16 C4.4 12.4 9.6 9.4 9.6 5.4 C9.6 2.4 7.2 -0.4 3.8 -0.4 C1.6 -0.4 0 1.6 0 3.2 Z';
const STAR = '0,-8 2.2,-2.8 7.6,-2.6 3.4,1.2 5,6.4 0,3.6 -5,6.4 -7.6,-2.6 -2.2,-2.8';

function Motif({ design }: { design: HandshakeDesign }) {
  const [c1, c2] = design.colors;
  const cx = PAIR_LINK_W / 2;
  const cy = PAIR_LINK_H / 2;
  switch (design.motif) {
    case 'ecgHeart':
      return (
        <G transform={`translate(${cx - 7}, ${cy - 9}) scale(0.78)`}>
          <Path d={HEART} fill={c1} />
        </G>
      );
    case 'star':
      return <Polygon points={STAR} transform={`translate(${cx}, ${cy})`} fill={c1} stroke={c2} strokeWidth={1} />;
    case 'hearts':
      return (
        <>
          <G transform={`translate(${cx - 10}, ${cy - 8}) scale(0.62)`}><Path d={HEART} fill={c1} /></G>
          <G transform={`translate(${cx + 1}, ${cy - 6}) scale(0.5)`}><Path d={HEART} fill={c2} /></G>
        </>
      );
    case 'fireheart':
      return (
        <>
          <Path d={`M${cx} ${cy - 14} C ${cx + 3} ${cy - 8} ${cx + 7} ${cy - 6} ${cx + 6} ${cy - 1} C ${cx + 5} ${cy + 2} ${cx + 2} ${cy + 2} ${cx} ${cy - 1} C ${cx - 2} ${cy + 2} ${cx - 5} ${cy + 2} ${cx - 6} ${cy - 1} C ${cx - 7} ${cy - 6} ${cx - 3} ${cy - 8} ${cx} ${cy - 14} Z`} fill={c2} />
          <G transform={`translate(${cx - 6}, ${cy - 3}) scale(0.66)`}><Path d={HEART} fill={c1} /></G>
        </>
      );
    case 'bow':
      return (
        <>
          <Polygon points={`${cx - 2},${cy} ${cx - 15},${cy - 8} ${cx - 15},${cy + 8}`} fill={c1} />
          <Polygon points={`${cx + 2},${cy} ${cx + 15},${cy - 8} ${cx + 15},${cy + 8}`} fill={c1} />
          <Circle cx={cx} cy={cy} r={4} fill={c2} stroke={c1} strokeWidth={1.4} />
        </>
      );
    case 'letter':
      return (
        <>
          <Rect x={cx - 11} y={cy - 8} width={22} height={16} rx={2.5} fill="#fff1f2" stroke={c1} strokeWidth={1.4} />
          <Path d={`M${cx - 11} ${cy - 6} L${cx} ${cy + 1} L${cx + 11} ${cy - 6}`} stroke={c1} strokeWidth={1.4} fill="none" />
          <G transform={`translate(${cx - 3.4}, ${cy - 4.6}) scale(0.36)`}><Path d={HEART} fill={c1} /></G>
        </>
      );
    case 'butterfly':
      return (
        <>
          <Ellipse cx={cx - 6} cy={cy - 4} rx={6.5} ry={4.6} fill={c1} transform={`rotate(-24 ${cx - 6} ${cy - 4})`} />
          <Ellipse cx={cx + 6} cy={cy - 4} rx={6.5} ry={4.6} fill={c2} transform={`rotate(24 ${cx + 6} ${cy - 4})`} />
          <Ellipse cx={cx - 5} cy={cy + 5} rx={5} ry={3.6} fill={c2} transform={`rotate(20 ${cx - 5} ${cy + 5})`} />
          <Ellipse cx={cx + 5} cy={cy + 5} rx={5} ry={3.6} fill={c1} transform={`rotate(-20 ${cx + 5} ${cy + 5})`} />
          <Rect x={cx - 1.1} y={cy - 6} width={2.2} height={13} rx={1.1} fill="#374151" />
        </>
      );
    case 'ring':
      return (
        <>
          <Circle cx={cx} cy={cy + 3} r={8.5} fill="none" stroke={c1} strokeWidth={3} />
          <Polygon points={`${cx},${cy - 13} ${cx + 5},${cy - 7} ${cx},${cy - 3} ${cx - 5},${cy - 7}`} fill={c2} stroke="#fff" strokeWidth={0.8} />
        </>
      );
    default:
      return null;
  }
}

export default function PairLink({ design }: { design: HandshakeDesign }) {
  const pulse = useRef(new Animated.Value(0)).current;
  const twinkle = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const p = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
    ]));
    const tw = Animated.loop(Animated.sequence([
      Animated.timing(twinkle, { toValue: 1, duration: 620, useNativeDriver: true }),
      Animated.timing(twinkle, { toValue: 0, duration: 620, useNativeDriver: true }),
    ]));
    p.start(); tw.start();
    return () => { p.stop(); tw.stop(); };
  }, [pulse, twinkle]);

  const [c1, c2] = design.colors;
  const cy = PAIR_LINK_H / 2;
  const line = design.motif === 'wave'
    ? `M3 ${cy} Q 14 ${cy - 9}, 26 ${cy} T 50 ${cy} T 73 ${cy}`
    : design.motif === 'ecg' || design.motif === 'ecgHeart'
      ? `M3 ${cy} H20 L25 ${cy - 11} L32 ${cy + 11} L37 ${cy} H56 L61 ${cy - 8} L66 ${cy + 6} L69 ${cy} H73`
      : `M3 ${cy} H73`;
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] });
  const sparkleOpacity = twinkle.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] });

  return (
    <Animated.View style={{ width: PAIR_LINK_W, height: PAIR_LINK_H, transform: [{ scale }], opacity: 0.97 }}>
      <Svg width={PAIR_LINK_W} height={PAIR_LINK_H}>
        <Path d={line} stroke={c2} strokeWidth={5} strokeLinecap="round" fill="none" opacity={0.3} />
        <Path d={line} stroke={c1} strokeWidth={2.2} strokeLinecap="round" fill="none" />
        <Motif design={design} />
      </Svg>
      {design.sparkle > 0 && (
        <Animated.View style={{ position: 'absolute', top: -2, left: 6, opacity: sparkleOpacity }}>
          <Svg width={12} height={12}><Polygon points="6,0 7.6,4.4 12,6 7.6,7.6 6,12 4.4,7.6 0,6 4.4,4.4" fill={c1} /></Svg>
        </Animated.View>
      )}
      {design.sparkle > 1 && (
        <Animated.View style={{ position: 'absolute', bottom: -2, right: 8, opacity: sparkleOpacity }}>
          <Svg width={10} height={10}><Polygon points="5,0 6.3,3.7 10,5 6.3,6.3 5,10 3.7,6.3 0,5 3.7,3.7" fill={c2} /></Svg>
        </Animated.View>
      )}
      {design.sparkle > 2 && (
        <Animated.View style={{ position: 'absolute', top: 2, right: 20, opacity: sparkleOpacity }}>
          <Svg width={8} height={8}><Polygon points="4,0 5,3 8,4 5,5 4,8 3,5 0,4 3,3" fill="#ffffff" /></Svg>
        </Animated.View>
      )}
    </Animated.View>
  );
}
