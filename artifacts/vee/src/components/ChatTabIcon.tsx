/**
 * ChatTabIcon — the top-bar chat tab icon (2026-10-29, boss order: Fix #25).
 *
 * The tab used the stock Ionicons `chatbubbles` glyph — two solid bubbles
 * with no message lines, which did not match the reference icon the boss
 * showed (grey double speech bubbles, front bubble carrying two message
 * lines). This is a custom vector in that exact shape, drawn with
 * react-native-svg (already a dependency — no new native module),
 * following the TrophyIcon/DiamondIcon pattern: back bubble (slightly
 * muted, upper-left) + front bubble + two white message lines.
 *
 * Tinting follows the tab convention: the caller passes the active blue
 * (#2196F3) or inactive grey (#9E9E9E) as `color`. The reference is grey
 * only because it shows an inactive state — never force grey when active.
 * The green unread badge is NOT part of this icon; it stays in IMOTopBar
 * with its dynamic count.
 */
import React from 'react';
import Svg, { Path, Rect } from 'react-native-svg';

export function ChatTabIcon({ size = 28, color = '#9E9E9E' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {/* Back bubble (upper-left, slightly muted so the pair reads as two bubbles) */}
      <Path d="M22 56 L14 70 L34 58 Z" fill={color} opacity={0.7} />
      <Rect x={14} y={16} width={52} height={42} rx={13} fill={color} opacity={0.7} />
      {/* Front bubble (lower-right) + tail */}
      <Path d="M38 78 L30 88 L50 80 Z" fill={color} />
      <Rect x={30} y={38} width={58} height={42} rx={14} fill={color} />
      {/* Two message lines inside the front bubble */}
      <Rect x={42} y={50} width={32} height={6} rx={3} fill="#FFFFFF" />
      <Rect x={42} y={62} width={22} height={6} rx={3} fill="#FFFFFF" />
    </Svg>
  );
}

export default ChatTabIcon;
