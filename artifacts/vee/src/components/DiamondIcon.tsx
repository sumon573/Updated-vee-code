/**
 * DiamondIcon — Vee's OWN diamond (2026-10-23, boss pick: Rose Pink).
 *
 * Until now every diamond in the app was the stock system 💎 emoji —
 * the same blue gem every app shows, which read as "demo". This is a
 * faceted vector gem in Vee's unique rose-pink palette, drawn with
 * react-native-svg (already a dependency — no new native module).
 * Use this component everywhere a diamond amount/icon is displayed
 * instead of the 💎 emoji. (💎 inside plain text strings — share
 * texts, notifications, i18n copy — stays text; only rendered icon
 * spots use this.)
 */
import React from 'react';
import Svg, { Polygon, Path } from 'react-native-svg';

export function DiamondIcon({ size = 16 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {/* Crown facets */}
      <Polygon points="6,40 26,14 32,40" fill="#F9A8D4" />
      <Polygon points="26,14 50,14 50,40 32,40" fill="#FCE7F3" />
      <Polygon points="50,14 74,14 68,40 50,40" fill="#F472B6" />
      <Polygon points="74,14 94,40 68,40" fill="#EC4899" />
      {/* Pavilion facets */}
      <Polygon points="6,40 32,40 50,90" fill="#F472B6" />
      <Polygon points="32,40 50,40 50,90" fill="#DB2777" />
      <Polygon points="50,40 68,40 50,90" fill="#EC4899" />
      <Polygon points="68,40 94,40 50,90" fill="#9D174D" />
      {/* Sparkle */}
      <Path d="M34 20 L36.5 27 L34 34 L31.5 27 Z" fill="#FFFFFF" opacity={0.9} />
    </Svg>
  );
}

export default DiamondIcon;
