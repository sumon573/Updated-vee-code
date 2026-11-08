import React from 'react';
import { Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

// 2026-10-30 (Sumon): every noble reward shows its rank's star at the end of
// the reward card (Decoration + Honor Nameplate only). ONE pill per reward:
// rank color + white star + star number (boss's samples: star + number).
// Ranks without a spec (Knight, and any future rank) render nothing.
//
// 2026-11-09 (boss): every SVIP reward has a star too — SVIP1 = 2, SVIP2 = 2,
// SVIP3 = 3, SVIP4 = 4, SVIP5 = 5 (his 01:31 mapping). SVIP pills are GOLD
// (King-style gradient), read from the grant's server-driven `stars` field.
// A grant with no stars field and no noble rank renders nothing — never invent.
const STAR_SPECS: Record<string, { stars: number; color: string; border?: string; colors?: [string, string, ...string[]]; locations?: [number, number, ...number[]]; numColor?: string }> = {
  baron: { stars: 1, color: '#26A69A' },
  viscount: { stars: 2, color: '#42A5F5' },
  count: { stars: 3, color: '#7E57C2', border: 'rgba(255,255,255,0.55)' },
  marquis: { stars: 4, color: '#EC407A', border: 'rgba(255,255,255,0.55)' },
  duke: { stars: 4, color: '#FF7043', border: 'rgba(255,255,255,0.55)' },
  king: { stars: 5, color: '#FBC02D', border: '#6B4A00',
    colors: ['#FFF6C8', '#F5C542', '#C9970D', '#F8D95A', '#8A5E00'],
    locations: [0, 0.28, 0.52, 0.75, 1], numColor: '#4A3200' },
};

// SVIP star pill style — gold, like the King frame's "⭐ 5" (boss's sample).
const SVIP_GOLD: { colors: [string, string, ...string[]]; locations: [number, number, ...number[]]; border: string; numColor: string } = {
  colors: ['#FFF6C8', '#F5C542', '#C9970D', '#F8D95A', '#8A5E00'],
  locations: [0, 0.28, 0.52, 0.75, 1],
  border: '#6B4A00',
  numColor: '#4A3200',
};

function lighten(hex: string, f: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * f);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

// Grant ids look like noble-frame-viscount, noble-badge-duke, ...;
// non-noble ids (vee-official-frame, zen-g-frame) match nothing -> null.
export function nobleRankKeyFromGrantId(id: string): string | null {
  const m = /^noble-(?:frame|badge|plate|ripple|effect)-(.+)$/.exec(id || '');
  if (!m) return null;
  const slug = m[1].toLowerCase().replace(/-/g, '');
  return slug in STAR_SPECS ? slug : null;
}

/** Resolve a grant's star count: the grant's server-driven `stars` field
 * first, else the noble rank spec for noble-* ids, else null (no star known).
 * Used for the pill AND for ordering nameplates by stars (most first). */
export function grantStars(item: { id: string; stars?: number }): number | null {
  if (typeof item.stars === 'number' && Number.isFinite(item.stars) && item.stars > 0) {
    return Math.floor(item.stars);
  }
  const key = nobleRankKeyFromGrantId(item.id);
  return key ? STAR_SPECS[key].stars : null;
}

function StarPillView({ n, colors, locations, border, numColor }: {
  n: number; colors: [string, string, ...string[]]; locations?: [number, number, ...number[]]; border?: string; numColor?: string;
}) {
  return (
    <LinearGradient
      colors={colors}
      locations={locations}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={{
        height: 20, borderRadius: 10, paddingHorizontal: 7,
        flexDirection: 'row', alignItems: 'center', marginLeft: 6,
        borderWidth: border ? 1 : 0, borderColor: border || 'transparent',
      }}
    >
      <Text style={{ fontSize: 12, color: '#FFFFFF', marginRight: 3 }}>★</Text>
      <Text style={{ fontSize: 11, fontWeight: '800', color: numColor ?? '#FFFFFF' }}>{n}</Text>
    </LinearGradient>
  );
}

export function NobleStarPill({ grantId, stars }: { grantId: string; stars?: number }) {
  // SVIP: the grant's server-driven stars field wins — gold pill.
  if (typeof stars === 'number' && Number.isFinite(stars) && stars > 0) {
    return (
      <StarPillView
        n={Math.floor(stars)}
        colors={SVIP_GOLD.colors}
        locations={SVIP_GOLD.locations}
        border={SVIP_GOLD.border}
        numColor={SVIP_GOLD.numColor}
      />
    );
  }
  const key = nobleRankKeyFromGrantId(grantId);
  if (!key) return null;
  const spec = STAR_SPECS[key];
  return (
    <StarPillView
      n={spec.stars}
      colors={spec.colors ?? [lighten(spec.color, 0.45), spec.color]}
      locations={spec.locations}
      border={spec.border}
      numColor={spec.numColor}
    />
  );
}
