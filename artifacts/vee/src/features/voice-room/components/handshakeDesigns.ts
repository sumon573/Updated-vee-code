/**
 * Mic Handshake designs (2026-10-20, Sumon).
 *
 * When two users with a diamond-sending intimacy relation sit in ADJACENT
 * mic seats, an animated link appears between their avatars.
 * - The BASIC design is free and automatic for every related pair (even a
 *   single diamond sent). Its colour + sparkle grow with the pair's
 *   intimacy level ("যত বেশি diamond sending, তত ঝলমলে").
 * - PREMIUM designs are sold in the Store (server-driven `store_catalog`,
 *   type 'micHandshake') and claimed with diamonds for a specific pair.
 *
 * Visuals are drawn with react-native-svg (already a dependency) so every
 * design is REAL and animated — no image assets needed in the room. The
 * store cards use server preview images of the same motifs.
 */

export type HandshakeMotif =
  | 'ecg'        // heartbeat line
  | 'ecgHeart'   // heartbeat line + heart in the middle
  | 'wave'       // smooth wave line
  | 'star'       // star in the middle, dotted links
  | 'hearts'     // two hearts in the middle
  | 'fireheart'  // flaming heart
  | 'bow'        // ribbon bow
  | 'letter'     // love letter
  | 'butterfly'  // butterfly
  | 'ring';      // gold ring with a gem

export interface HandshakeDesign {
  key: string;
  name: string;
  motif: HandshakeMotif;
  /** [primary, secondary] gradient-ish pair for the line + motif. */
  colors: [string, string];
  /** 0..3 — extra sparkle particles around the link. */
  sparkle: number;
}

export const BASIC_DESIGN_KEY = 'hs-basic';

export const HANDSHAKE_DESIGNS: Record<string, HandshakeDesign> = {
  'hs-basic': {
    key: 'hs-basic', name: 'Heartbeat', motif: 'ecg',
    colors: ['#22d3ee', '#0ea5e9'], sparkle: 0,
  },
  'hs-pulse-pink': {
    key: 'hs-pulse-pink', name: 'Pink Heartbeat', motif: 'ecg',
    colors: ['#ff5da2', '#ff8fc0'], sparkle: 0,
  },
  'hs-wave': {
    key: 'hs-wave', name: 'Ocean Wave', motif: 'wave',
    colors: ['#38bdf8', '#818cf8'], sparkle: 0,
  },
  'hs-star': {
    key: 'hs-star', name: 'Star Link', motif: 'star',
    colors: ['#fbbf24', '#f59e0b'], sparkle: 2,
  },
  'hs-hearts': {
    key: 'hs-hearts', name: 'Cupid Hearts', motif: 'hearts',
    colors: ['#ff4d6d', '#ff8fa3'], sparkle: 1,
  },
  'hs-fire': {
    key: 'hs-fire', name: 'Fire Heart', motif: 'fireheart',
    colors: ['#ff7847', '#ffb347'], sparkle: 1,
  },
  'hs-bow': {
    key: 'hs-bow', name: 'Pink Bow', motif: 'bow',
    colors: ['#f472b6', '#f9a8d4'], sparkle: 0,
  },
  'hs-gold': {
    key: 'hs-gold', name: 'Golden Heartbeat', motif: 'ecg',
    colors: ['#ffd700', '#ffb300'], sparkle: 2,
  },
  'hs-letter': {
    key: 'hs-letter', name: 'Love Letter', motif: 'letter',
    colors: ['#fda4af', '#fb7185'], sparkle: 1,
  },
  'hs-butterfly': {
    key: 'hs-butterfly', name: 'Butterfly', motif: 'butterfly',
    colors: ['#67e8f9', '#c084fc'], sparkle: 2,
  },
  'hs-ring': {
    key: 'hs-ring', name: 'Diamond Ring', motif: 'ring',
    colors: ['#ffd700', '#67e8f9'], sparkle: 2,
  },
  'hs-royal': {
    key: 'hs-royal', name: 'Royal Heartbeat', motif: 'ecgHeart',
    colors: ['#a78bfa', '#ff5da2'], sparkle: 3,
  },
};

/** Basic-design colour tiers by intimacy level (1..10). Higher = richer. */
export function basicTierForLevel(level: number): { colors: [string, string]; sparkle: number } {
  if (level >= 10) return { colors: ['#ffd700', '#ff5da2'], sparkle: 3 };
  if (level >= 9) return { colors: ['#fbbf24', '#f59e0b'], sparkle: 2 };
  if (level >= 7) return { colors: ['#a78bfa', '#8b5cf6'], sparkle: 2 };
  if (level >= 5) return { colors: ['#ff5da2', '#ec4899'], sparkle: 1 };
  if (level >= 3) return { colors: ['#34d399', '#10b981'], sparkle: 1 };
  return { colors: ['#22d3ee', '#0ea5e9'], sparkle: 0 };
}

export function resolveDesign(designKey: string | null | undefined, intimacyLevel: number): HandshakeDesign {
  if (designKey && designKey !== BASIC_DESIGN_KEY && HANDSHAKE_DESIGNS[designKey]) {
    return HANDSHAKE_DESIGNS[designKey];
  }
  const tier = basicTierForLevel(intimacyLevel);
  return { ...HANDSHAKE_DESIGNS[BASIC_DESIGN_KEY], colors: tier.colors, sparkle: tier.sparkle };
}
