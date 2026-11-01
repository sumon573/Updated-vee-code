/**
 * CoupleLevelArt.tsx — Premium image art for the Couple area.
 *
 * All visuals are real 3D-render-style images served from the Vee media
 * backend (https://vee-club.duckdns.org/m/...), rendered with expo-image
 * (never RN Image, never emoji art). Frames are transparency-keyed WebPs:
 * the ring art overlays the avatar and the avatar shows through the
 * transparent center. Layout positions, sizes, costs, and flows are
 * identical to the previous version — only the visual source changed
 * (the boss rejected the old code-drawn vector art as demo-looking).
 *
 * STATIC by design: no Animated values, no timers, no loops — the page
 * stays smooth and heat-safe. Entry previews are stills, not live
 * effects (full animated entry effects are a follow-up).
 */

import React from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';

const M = (id: string) => `https://vee-club.duckdns.org/m/${id}`;

// Vee-original art, uploaded 2026-11-01 (byte-verified on upload).
const FRAME_ART: Record<number, string> = {
  1: M('2a7295ee2bd9a0615717ea42a98f127a'),
  2: M('7f5b18dab6f16b26b42004579fea3cd7'),
  3: M('68ae69350a76700273b1d349146c0b3e'),
  4: M('08e354a8a9957f989ab8a265417aa368'),
  5: M('43accd0bfd6dc464e2f76863abe45b67'),
};
const ENTRY_ART: Record<number, string> = {
  1: M('1dae7cdc30bb6a270342b9ce3fe26ff2'),
  2: M('71b9491e54b9347411c282519686edf7'),
  3: M('d16cbc992bc8c0e5cce3bf79d4ddd7f7'),
  4: M('d01b83a730a001ed90ffe5bd7107256d'),
  5: M('4eab11d51f071eee62bf16df54dcc819'),
};
const HOUSE_ART: Record<number, string> = {
  1: M('aacd1399b5d2da6bae061613299d57bc'),
  2: M('926027c62817936a94c1e9bdd20cb22a'),
  3: M('5f8a86d00c527a0cb0c0c5ffa011e0eb'),
  4: M('400bd3056ccc4146252210a77973091c'),
  5: M('6ec734b95a51f4b550834a8728ccae7e'),
};
const CRYSTAL_ART = M('5c8f3bed6c90042ef7be7f17d01e1a4f');
const RING_ART = M('cc76b0697a8fcd193691d5b5ad23c358');
const LOVE_HOUSE_ART = M('753dc14d326d92a9cd457105d5f11057');

function lvOf(level: number) {
  return Math.min(5, Math.max(1, Math.floor(level) || 1));
}

// ─── Profile frames (round, around an avatar) ───────────────────────────────

/**
 * Round couple frame. `children` (usually an avatar) sits centered inside;
 * the transparent-center frame image overlays it. Lv.1: elegant simple
 * gold ring → Lv.5: most ornate jewel-encrusted royal frame with crown.
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
  const lv = lvOf(level);
  const opacity = dimmed ? 0.45 : 1;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', opacity }}>
      {children}
      <Image
        source={{ uri: FRAME_ART[lv] }}
        style={{ position: 'absolute', width: size, height: size }}
        contentFit="contain"
      />
    </View>
  );
}

// ─── Entry-effect previews (dark tiles, stills) ──────────────────────────────

/**
 * Still preview of a level's entry effect: a golden sparkle scene that
 * grows grander per level (Lv.1 soft sparkles → Lv.5 grand golden portal).
 */
export function CoupleEntryEffectPreview({ level, width }: { level: number; width: number }) {
  const lv = lvOf(level);
  const height = Math.round(width * 0.78);
  return (
    <View
      style={{
        width, height, borderRadius: 12, backgroundColor: '#22102A',
        alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
      }}
    >
      <Image
        source={{ uri: ENTRY_ART[lv] }}
        style={{ width, height }}
        contentFit="cover"
      />
    </View>
  );
}

// ─── Houses (roadmap + Love House) ───────────────────────────────────────────

/** Roadmap house for one level: small hut (Lv.1) growing to a mansion (Lv.5). */
export function CoupleHouseArt({ level, width }: { level: number; width: number }) {
  const lv = lvOf(level);
  return (
    <Image
      source={{ uri: HOUSE_ART[lv] }}
      style={{ width, height: width }}
      contentFit="cover"
    />
  );
}

/** Love House: pink dream house on a floating flower island. Lock overlay stays code-drawn. */
export function LoveHouseArt({ width, locked }: { width: number; locked: boolean }) {
  return (
    <View style={{ width, alignItems: 'center' }}>
      <View style={{ width, borderRadius: 12, overflow: 'hidden' }}>
        <Image
          source={{ uri: LOVE_HOUSE_ART }}
          style={{ width, height: Math.round(width * 0.67) }}
          contentFit="cover"
        />
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

/** Large faceted crystal with gold orbit rings — the Couple tab center motif. */
export function CrystalMotif({ size }: { size: number }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Image
        source={{ uri: CRYSTAL_ART }}
        style={{ width: size, height: size }}
        contentFit="contain"
      />
    </View>
  );
}

/** Ring motif — the Intimacy tab center motif (gold band + diamond). */
export function RingMotif({ size }: { size: number }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Image
        source={{ uri: RING_ART }}
        style={{ width: size, height: size }}
        contentFit="contain"
      />
    </View>
  );
}
