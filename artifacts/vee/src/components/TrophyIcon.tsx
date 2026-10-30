/**
 * TrophyIcon — Vee's OWN trophy (2026-10-29, boss order: Fix #12).
 *
 * The home Leaderboard banner used the stock system 🏆 emoji — the
 * same flat trophy every app shows, which read as "demo". This is a
 * proper vector trophy in a premium gold palette: metallic gradient
 * cup, highlight streak, star medallion, twin handles, stepped gold
 * plinth, soft ground shadow — drawn with react-native-svg (already
 * a dependency — no new native module), following the DiamondIcon
 * pattern. Use this wherever a trophy icon is rendered instead of
 * the 🏆 emoji. (🏆 inside plain text strings stays text; only
 * rendered icon spots use this.)
 */
import React from 'react';
import Svg, { Defs, Ellipse, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

export function TrophyIcon({ size = 28 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id="trophyCup" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#FFE89A" />
          <Stop offset="0.35" stopColor="#FFC93C" />
          <Stop offset="0.65" stopColor="#F59E0B" />
          <Stop offset="1" stopColor="#C77F0A" />
        </LinearGradient>
      </Defs>
      {/* Soft ground shadow */}
      <Ellipse cx={50} cy={91} rx={24} ry={4} fill="#000000" opacity={0.12} />
      {/* Twin handles */}
      <Path d="M20 20 C8 20 6 34 14 44 C18 49 24 50 26 48" fill="none" stroke="#D98E00" strokeWidth={6} strokeLinecap="round" />
      <Path d="M80 20 C92 20 94 34 86 44 C82 49 76 50 74 48" fill="none" stroke="#D98E00" strokeWidth={6} strokeLinecap="round" />
      {/* Cup body */}
      <Path d="M20 16 H80 C80 40 66 56 50 58 C34 56 20 40 20 16 Z" fill="url(#trophyCup)" />
      {/* Rim */}
      <Rect x={18} y={10} width={64} height={9} rx={4.5} fill="#FFDF7E" />
      {/* Highlight streak */}
      <Path d="M32 24 Q28 38 36 52" fill="none" stroke="#FFFFFF" strokeWidth={6} strokeLinecap="round" opacity={0.55} />
      {/* Star medallion */}
      <Path d="M50 26 L52.9 33.1 L60.4 33.4 L54.7 38.2 L56.6 45.6 L50 41.5 L43.4 45.6 L45.3 38.2 L39.6 33.4 L47.1 33.1 Z" fill="#FFF8DC" />
      {/* Stem */}
      <Rect x={46} y={58} width={8} height={12} fill="#D98E00" />
      {/* Stepped plinth */}
      <Rect x={32} y={70} width={36} height={6} rx={2} fill="#FFC93C" />
      <Rect x={28} y={76} width={44} height={10} rx={3} fill="#9A6200" />
    </Svg>
  );
}

export default TrophyIcon;
