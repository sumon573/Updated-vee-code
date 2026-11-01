/**
 * CoupleLevelArt.tsx — Original code-drawn visuals for the Couple area.
 *
 * Everything here is drawn with Views / SVG shapes in code — no remote
 * art, no imo artwork, no emoji art. Frames and entry effects grow
 * progressively richer from Lv.1 (simple) to Lv.5 (most ornate), exactly
 * as the boss ordered: each level's frame is a step more premium than
 * the last.
 *
 * STATIC by design: no Animated values, no timers, no loops — the page
 * stays smooth and heat-safe. Previews are stills, not live effects.
 */

import React from 'react';
import { View } from 'react-native';
import Svg, { Polygon, Ellipse, Circle } from 'react-native-svg';
import { Feather } from '@expo/vector-icons';

const GOLD = '#D4AF37';
const GOLD_LIGHT = '#F5D67B';
const GOLD_DEEP = '#B8860B';
const ROSE = '#EC4899';
const ROSE_LIGHT = '#F472B6';

// ─── Profile frames (round, around an avatar) ───────────────────────────────

/**
 * Round couple frame. `children` (usually an avatar) sits centered inside.
 * Lv.1: single gold ring. Lv.2: + inner ring. Lv.3: + 4 orbit dots.
 * Lv.4: + 8 orbit dots + top gem. Lv.5: + thicker rings + top/bottom gems.
 */
export function CoupleFrameArt({
  level,
  size,
  children,
  dimmed = false,
}: {
  level: number;
  size: number;
  children?: React.ReactNode;
  dimmed?: boolean;
}) {
  const lv = Math.min(5, Math.max(1, Math.floor(level) || 1));
  const opacity = dimmed ? 0.45 : 1;
  const ring = size * 0.06;
  const dot = Math.max(4, size * 0.07);
  const dots =
    lv >= 4
      ? [0, 45, 90, 135, 180, 225, 270, 315]
      : lv >= 3
        ? [45, 135, 225, 315]
        : [];
  const gem = Math.max(7, size * 0.13);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', opacity }}>
      {/* Outer ring */}
      <View
        style={{
          position: 'absolute', width: size, height: size, borderRadius: size / 2,
          borderWidth: lv >= 5 ? 4 : lv >= 4 ? 3 : 2,
          borderColor: lv >= 5 ? GOLD_LIGHT : GOLD,
        }}
      />
      {/* Inner ring (Lv.2+) */}
      {lv >= 2 && (
        <View
          style={{
            position: 'absolute', width: size - ring * 2, height: size - ring * 2,
            borderRadius: (size - ring * 2) / 2, borderWidth: 1, borderColor: GOLD_DEEP,
          }}
        />
      )}
      {/* Second inner ring (Lv.5) */}
      {lv >= 5 && (
        <View
          style={{
            position: 'absolute', width: size - ring * 4, height: size - ring * 4,
            borderRadius: (size - ring * 4) / 2, borderWidth: 1, borderColor: ROSE_LIGHT,
          }}
        />
      )}
      {/* Orbit dots (Lv.3+) */}
      {dots.map((deg) => {
        const rad = (deg * Math.PI) / 180;
        const r = size / 2;
        return (
          <View
            key={deg}
            style={{
              position: 'absolute',
              left: r + Math.cos(rad) * r - dot / 2,
              top: r + Math.sin(rad) * r - dot / 2,
              width: dot, height: dot, borderRadius: dot / 2,
              backgroundColor: deg % 90 === 0 ? ROSE : GOLD_LIGHT,
            }}
          />
        );
      })}
      {/* Top gem (Lv.4+) */}
      {lv >= 4 && (
        <View
          style={{
            position: 'absolute', top: -gem * 0.28, width: gem, height: gem,
            backgroundColor: ROSE, transform: [{ rotate: '45deg' }], borderRadius: 2,
          }}
        />
      )}
      {/* Bottom gem (Lv.5) */}
      {lv >= 5 && (
        <View
          style={{
            position: 'absolute', bottom: -gem * 0.28, width: gem, height: gem,
            backgroundColor: GOLD_LIGHT, transform: [{ rotate: '45deg' }], borderRadius: 2,
          }}
        />
      )}
      {children}
    </View>
  );
}

// ─── Entry-effect previews (dark tiles, stills) ──────────────────────────────

function Sparkle({ left, top, size, color }: { left: number; top: number; size: number; color: string }) {
  return (
    <View
      style={{
        position: 'absolute', left, top, width: size, height: size,
        backgroundColor: color, transform: [{ rotate: '45deg' }], borderRadius: 1,
      }}
    />
  );
}

function GlowDot({ left, top, size, color }: { left: number; top: number; size: number; color: string }) {
  return (
    <View
      style={{
        position: 'absolute', left, top, width: size, height: size,
        borderRadius: size / 2, backgroundColor: color,
      }}
    />
  );
}

/**
 * Still preview of a level's entry effect: a dark tile, a silhouette disc,
 * and a spray of diamond sparkles + glow dots that grows denser per level.
 * Lv.1: 3 sparkles. Lv.2: 5. Lv.3: 7 + streak. Lv.4: 9 + 2 streaks.
 * Lv.5: 12 + 3 streaks + halo ring.
 */
export function CoupleEntryEffectPreview({ level, width }: { level: number; width: number }) {
  const lv = Math.min(5, Math.max(1, Math.floor(level) || 1));
  const height = Math.round(width * 0.78);
  const cx = width / 2;
  const cy = height / 2;
  const sparkles: { left: number; top: number; size: number; color: string }[] = [
    { left: cx - 34, top: cy - 26, size: 8, color: GOLD_LIGHT },
    { left: cx + 26, top: cy - 30, size: 10, color: '#FFFFFF' },
    { left: cx + 34, top: cy + 18, size: 7, color: ROSE_LIGHT },
  ];
  if (lv >= 2) {
    sparkles.push(
      { left: cx - 44, top: cy + 8, size: 6, color: '#FFFFFF' },
      { left: cx + 8, top: cy - 40, size: 7, color: GOLD_LIGHT },
    );
  }
  if (lv >= 3) {
    sparkles.push(
      { left: cx - 18, top: cy + 30, size: 9, color: GOLD_LIGHT },
      { left: cx + 44, top: cy - 8, size: 6, color: '#FFFFFF' },
    );
  }
  if (lv >= 4) {
    sparkles.push(
      { left: cx - 52, top: cy - 16, size: 7, color: ROSE_LIGHT },
      { left: cx + 18, top: cy + 38, size: 6, color: '#FFFFFF' },
    );
  }
  if (lv >= 5) {
    sparkles.push(
      { left: cx - 30, top: cy - 44, size: 8, color: '#FFFFFF' },
      { left: cx + 52, top: cy + 26, size: 8, color: GOLD_LIGHT },
      { left: cx - 6, top: cy + 46, size: 7, color: ROSE_LIGHT },
    );
  }
  return (
    <View
      style={{
        width, height, borderRadius: 12, backgroundColor: '#22102A',
        alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      }}
    >
      {/* Halo ring (Lv.5) */}
      {lv >= 5 && (
        <View
          style={{
            position: 'absolute', width: Math.min(width, height) * 0.9,
            height: Math.min(width, height) * 0.9, borderRadius: 999,
            borderWidth: 1, borderColor: GOLD,
          }}
        />
      )}
      {/* Silhouette disc */}
      <View
        style={{
          width: Math.min(width, height) * 0.42, height: Math.min(width, height) * 0.42,
          borderRadius: 999, backgroundColor: '#4A2B52',
        }}
      />
      {/* Light streaks (Lv.3+) */}
      {lv >= 3 && (
        <View
          style={{
            position: 'absolute', left: width * 0.12, top: height * 0.62,
            width: width * 0.76, height: 2, backgroundColor: GOLD_LIGHT,
            opacity: 0.7, transform: [{ rotate: '-18deg' }],
          }}
        />
      )}
      {lv >= 4 && (
        <View
          style={{
            position: 'absolute', left: width * 0.18, top: height * 0.3,
            width: width * 0.6, height: 2, backgroundColor: ROSE_LIGHT,
            opacity: 0.6, transform: [{ rotate: '14deg' }],
          }}
        />
      )}
      {lv >= 5 && (
        <View
          style={{
            position: 'absolute', left: width * 0.1, top: height * 0.46,
            width: width * 0.8, height: 2, backgroundColor: '#FFFFFF',
            opacity: 0.5, transform: [{ rotate: '-6deg' }],
          }}
        />
      )}
      {sparkles.map((s, i) => (
        <Sparkle key={i} {...s} />
      ))}
      <GlowDot left={cx - 58} top={cy + 26} size={4} color={GOLD_LIGHT} />
      <GlowDot left={cx + 56} top={cy - 34} size={4} color={ROSE_LIGHT} />
      {lv >= 4 && <GlowDot left={cx - 14} top={cy - 52} size={4} color="#FFFFFF" />}
    </View>
  );
}

// ─── Houses (roadmap + Love House) ───────────────────────────────────────────

function HouseBody({
  width,
  level,
}: {
  width: number;
  level: number;
}) {
  const lv = Math.min(5, Math.max(1, Math.floor(level) || 1));
  const bodyW = width * 0.72;
  const bodyH = width * (lv >= 5 ? 0.62 : lv >= 4 ? 0.56 : 0.5);
  const win = Math.max(8, width * 0.11);
  const windows = lv >= 5 ? 4 : lv >= 4 ? 3 : lv >= 3 ? 2 : lv >= 2 ? 2 : 1;
  return (
    <View style={{ width, alignItems: 'center' }}>
      {/* Roof */}
      <View
        style={{
          width: 0, height: 0,
          borderLeftWidth: width * 0.48, borderRightWidth: width * 0.48,
          borderBottomWidth: width * 0.36,
          borderLeftColor: 'transparent', borderRightColor: 'transparent',
          borderBottomColor: lv >= 4 ? '#7C2D12' : '#B45309',
        }}
      />
      {/* Chimney (Lv.3+) */}
      {lv >= 3 && (
        <View
          style={{
            position: 'absolute', right: width * 0.2, top: width * 0.08,
            width: width * 0.09, height: width * 0.18, backgroundColor: '#92400E',
            borderRadius: 2,
          }}
        />
      )}
      {/* Body */}
      <View
        style={{
          width: bodyW, height: bodyH, backgroundColor: lv >= 5 ? '#FDE68A' : '#FCD34D',
          alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 2,
          borderLeftWidth: 1, borderRightWidth: 1, borderBottomWidth: 1,
          borderColor: '#D97706',
        }}
      >
        <View style={{ flexDirection: 'row', gap: 4, marginBottom: 3 }}>
          {Array.from({ length: windows }).map((_, i) => (
            <View key={i} style={{ width: win, height: win, backgroundColor: '#BFDBFE', borderWidth: 1, borderColor: '#93C5FD' }} />
          ))}
        </View>
        {/* Door */}
        <View style={{ width: win * 1.1, height: bodyH * 0.42, backgroundColor: '#92400E', borderTopLeftRadius: 3, borderTopRightRadius: 3 }} />
      </View>
      {/* Side wings (Lv.5 mansion) */}
      {lv >= 5 && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', width: width * 0.96, marginTop: -bodyH * 0.55 }}>
          <View style={{ width: width * 0.16, height: bodyH * 0.5, backgroundColor: '#FDE68A', borderWidth: 1, borderColor: '#D97706' }} />
          <View style={{ width: width * 0.16, height: bodyH * 0.5, backgroundColor: '#FDE68A', borderWidth: 1, borderColor: '#D97706' }} />
        </View>
      )}
      {/* Fence (Lv.4+) */}
      {lv >= 4 && (
        <View style={{ flexDirection: 'row', gap: 3, marginTop: 3 }}>
          {Array.from({ length: 7 }).map((_, i) => (
            <View key={i} style={{ width: 3, height: 8, backgroundColor: '#B45309', borderRadius: 1 }} />
          ))}
        </View>
      )}
      {/* Ground */}
      <View style={{ width: width * 0.9, height: 5, backgroundColor: '#86EFAC', borderRadius: 3, marginTop: 3 }} />
    </View>
  );
}

/** Roadmap house for one level: small hut (Lv.1) growing to a mansion (Lv.5). */
export function CoupleHouseArt({ level, width }: { level: number; width: number }) {
  return <HouseBody width={width} level={level} />;
}

/** Love House: a large house on a soft pink cloud base, optional lock overlay. */
export function LoveHouseArt({ width, locked }: { width: number; locked: boolean }) {
  return (
    <View style={{ width, alignItems: 'center' }}>
      <HouseBody width={width * 0.72} level={4} />
      {/* Cloud base */}
      <View style={{ flexDirection: 'row', marginTop: -4 }}>
        <View style={{ width: width * 0.34, height: 14, backgroundColor: '#FBCFE8', borderRadius: 7, marginRight: -8 }} />
        <View style={{ width: width * 0.4, height: 18, backgroundColor: '#F9A8D4', borderRadius: 9, marginTop: -3 }} />
        <View style={{ width: width * 0.34, height: 14, backgroundColor: '#FBCFE8', borderRadius: 7, marginLeft: -8 }} />
      </View>
      {locked && (
        <View
          style={{
            position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <View style={{ backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 999, padding: 12 }}>
            <Feather name="lock" size={26} color="#FFFFFF" />
          </View>
        </View>
      )}
    </View>
  );
}

// ─── Center motifs (trio header) ─────────────────────────────────────────────

/** Large faceted crystal with an orbit ring — the Couple tab center motif. */
export function CrystalMotif({ size }: { size: number }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Ellipse cx="50" cy="52" rx="46" ry="16" fill="none" stroke={GOLD} strokeWidth="1.4" opacity={0.8} transform="rotate(-18 50 52)" />
        <Polygon points="50,6 78,26 68,58 50,92 32,58 22,26" fill="#FCE7F3" />
        <Polygon points="50,6 78,26 68,58 50,58" fill="#F9A8D4" />
        <Polygon points="50,6 22,26 32,58 50,58" fill="#FBCFE8" />
        <Polygon points="32,58 50,58 50,92" fill="#F472B6" />
        <Polygon points="50,58 68,58 50,92" fill="#EC4899" />
        <Polygon points="50,6 62,26 50,58 38,26" fill="#FFFFFF" opacity={0.85} />
        <Circle cx="14" cy="30" r="3.4" fill={GOLD_LIGHT} />
        <Circle cx="88" cy="66" r="3" fill={ROSE_LIGHT} />
        <Circle cx="82" cy="22" r="2.4" fill="#FFFFFF" />
      </Svg>
    </View>
  );
}

/** Ring motif — the Intimacy tab center motif (circle band + top gem). */
export function RingMotif({ size }: { size: number }) {
  const gem = Math.max(10, size * 0.2);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          width: size * 0.78, height: size * 0.78, borderRadius: 999,
          borderWidth: Math.max(3, size * 0.05), borderColor: ROSE,
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <View
          style={{
            width: size * 0.5, height: size * 0.5, borderRadius: 999,
            borderWidth: 1, borderColor: ROSE_LIGHT,
          }}
        />
      </View>
      <View
        style={{
          position: 'absolute', top: size * 0.02, width: gem, height: gem,
          backgroundColor: ROSE_LIGHT, transform: [{ rotate: '45deg' }], borderRadius: 2,
        }}
      />
      <View style={{ position: 'absolute', left: size * 0.06, top: size * 0.5, width: 5, height: 5, borderRadius: 3, backgroundColor: GOLD_LIGHT }} />
      <View style={{ position: 'absolute', right: size * 0.06, top: size * 0.5, width: 5, height: 5, borderRadius: 3, backgroundColor: GOLD_LIGHT }} />
    </View>
  );
}
