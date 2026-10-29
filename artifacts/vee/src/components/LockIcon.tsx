/**
 * LockIcon — Vee's OWN private-room lock (2026-10-29, boss order: Fix #22).
 *
 * The carousel card + rooms list used the stock system 🔒 emoji / generic
 * Feather lock — the same flat lock every app shows, which read as
 * "demo". This is a proper vector padlock in a premium gold palette:
 * metallic gradient body, highlight streak, dark keyhole, and a small
 * four-point sparkle at the shackle base (Vee's sparkle motif — the
 * detail that makes it unmistakably Vee's, not a stock icon). Drawn with
 * react-native-svg (already a dependency — no new native module),
 * following the TrophyIcon/DiamondIcon pattern. Use this wherever a
 * private-room lock is rendered instead of the 🔒 emoji or a generic
 * lock glyph.
 */
import React from 'react';
import Svg, { Defs, Ellipse, LinearGradient, Path, Rect, Stop, Circle } from 'react-native-svg';

export function LockIcon({ size = 13 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id="lockGold" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#FFE89A" />
          <Stop offset="0.35" stopColor="#FFC93C" />
          <Stop offset="0.65" stopColor="#F59E0B" />
          <Stop offset="1" stopColor="#C77F0A" />
        </LinearGradient>
      </Defs>
      {/* Soft ground shadow */}
      <Ellipse cx={50} cy={91} rx={24} ry={4} fill="#000000" opacity={0.12} />
      {/* Shackle */}
      <Path d="M31 48 V34 C31 17 69 17 69 34 V48" fill="none" stroke="#B97A00" strokeWidth={10} strokeLinecap="round" />
      <Path d="M31 48 V34 C31 17 69 17 69 34 V48" fill="none" stroke="#FFDF7E" strokeWidth={3.5} strokeLinecap="round" opacity={0.65} />
      {/* Body */}
      <Rect x={20} y={44} width={60} height={46} rx={13} fill="url(#lockGold)" />
      {/* Highlight streak */}
      <Path d="M32 52 Q29 64 35 78" fill="none" stroke="#FFFFFF" strokeWidth={5} strokeLinecap="round" opacity={0.55} />
      {/* Keyhole */}
      <Circle cx={50} cy={62} r={7.5} fill="#7A4A00" />
      <Rect x={47} y={66} width={6} height={12} rx={3} fill="#7A4A00" />
      {/* Vee sparkle — the unique mark */}
      <Path d="M76 42 L78.5 48.5 L85 51 L78.5 53.5 L76 60 L73.5 53.5 L67 51 L73.5 48.5 Z" fill="#FFF8DC" />
    </Svg>
  );
}

export default LockIcon;
