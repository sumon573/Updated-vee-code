import React from 'react';
import { Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

// 2026-10-30 (Sumon): every noble reward shows its rank's star at the end of
// the reward card (Decoration + Honor Nameplate only). ONE pill per reward:
// rank color + white star + star number (boss's samples: star + number).
// Ranks without a spec (Knight, and any future rank) render nothing.
const STAR_SPECS: Record<string, { stars: number; color: string; border?: string }> = {
  baron: { stars: 1, color: '#26A69A' },
  viscount: { stars: 1, color: '#42A5F5' },
  count: { stars: 2, color: '#7E57C2', border: 'rgba(255,255,255,0.55)' },
  marquis: { stars: 2, color: '#EC407A', border: 'rgba(255,255,255,0.55)' },
  duke: { stars: 2, color: '#FF7043', border: 'rgba(255,255,255,0.55)' },
  royalduke: { stars: 3, color: '#FFA000', border: 'rgba(255,215,0,0.9)' },
  king: { stars: 5, color: '#FBC02D', border: 'rgba(255,215,0,0.95)' },
};

function lighten(hex: string, f: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * f);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

// Grant ids look like noble-frame-viscount, noble-badge-royal-duke, ...;
// non-noble ids (vee-official-frame, zen-g-frame) match nothing -> null.
export function nobleRankKeyFromGrantId(id: string): string | null {
  const m = /^noble-(?:frame|badge|plate|ripple|effect)-(.+)$/.exec(id || '');
  if (!m) return null;
  const slug = m[1].toLowerCase().replace(/-/g, '');
  return slug in STAR_SPECS ? slug : null;
}

export function NobleStarPill({ grantId }: { grantId: string }) {
  const key = nobleRankKeyFromGrantId(grantId);
  if (!key) return null;
  const spec = STAR_SPECS[key];
  return (
    <LinearGradient
      colors={[lighten(spec.color, 0.45), spec.color]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={{
        height: 20, borderRadius: 10, paddingHorizontal: 7,
        flexDirection: 'row', alignItems: 'center', marginLeft: 6,
        borderWidth: spec.border ? 1 : 0, borderColor: spec.border || 'transparent',
      }}
    >
      <Text style={{ fontSize: 12, color: '#FFFFFF', marginRight: 3 }}>★</Text>
      <Text style={{ fontSize: 11, fontWeight: '800', color: '#FFFFFF' }}>{spec.stars}</Text>
    </LinearGradient>
  );
}
