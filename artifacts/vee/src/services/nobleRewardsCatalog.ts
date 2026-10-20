/**
 * Nobel Rewards Catalog — 2026-10-15 (Sumon).
 *
 * CENTRAL REGISTRY for all Nobel rank rewards. When Sumon provides designs,
 * plug the CDN URLs into the `designUrl` slots below — the grant functions,
 * Decoration page, and display components all read from here.
 *
 * Design slots:
 * - nameplate: image URL for the nameplate design
 * - badge: image URL for the badge design (goes to Honor section)
 * - frame: image URL for the frame design
 * - ripple: config for the speaking ripple (colors + particle)
 * - entryEffect: image/config for the room-entry animation
 *
 * 2026-10-20: per-rank artwork lives on Vee's VPS —
 * https://vee-club.duckdns.org/nobel-art/rank-{slug}-{nameplate,badge,frame}.png
 * (extracted from IMO's My Nobel video by the assets team).
 * The `fallbackIcon` (emoji) is used ONLY if an image fails to load.
 * NEVER ship a reward with neither designUrl nor fallbackIcon.
 */

const ART_BASE = 'https://vee-club.duckdns.org/nobel-art';
const artUrl = (slug: string, kind: 'nameplate' | 'badge' | 'frame') =>
  `${ART_BASE}/rank-${slug}-${kind}.png`;

export interface RewardDesign {
  /** CDN URL (jsDelivr) — set when Sumon provides the design */
  designUrl?: string;
  /** Emoji fallback until design arrives — NEVER remove */
  fallbackIcon: string;
  /** Extra config (e.g. ripple colors) */
  config?: Record<string, unknown>;
  /** Mist animation color — set for Viscount+ nameplates (2026-10-15 Sumon) */
  mistColor?: string;
}

export interface RankRewards {
  rankKey: string;
  rankName: string;
  rankColor: string;
  nameplate: RewardDesign;
  badge: RewardDesign | null;      // null = this rank has no badge
  frame: RewardDesign | null;      // null = this rank has no frame
  ripple: RewardDesign | null;     // null = this rank has no ripple
  entryEffect: RewardDesign | null; // null = this rank has no entry effect
}

export const NOBLE_REWARDS_CATALOG: RankRewards[] = [
  {
    rankKey: 'knight', rankName: 'Knight', rankColor: '#8BC34A',
    nameplate: {
      designUrl: artUrl('knight', 'nameplate'),
      fallbackIcon: '🎖️',
    },
    badge: null, frame: null, ripple: null, entryEffect: null,
  },
  {
    rankKey: 'baron', rankName: 'Baron', rankColor: '#26A69A',
    nameplate: {
      designUrl: artUrl('baron', 'nameplate'),
      fallbackIcon: '🎖️',
    },
    badge: {
      designUrl: artUrl('baron', 'badge'),
      fallbackIcon: '👑',
    },
    frame: null, ripple: null, entryEffect: null,
  },
  {
    rankKey: 'viscount', rankName: 'Viscount', rankColor: '#42A5F5',
    nameplate: {
      designUrl: artUrl('viscount', 'nameplate'),
      fallbackIcon: '🎖️',
      mistColor: '#BBDEFB', // 2026-10-15 (Sumon): mist animation starts from Viscount
    },
    badge: {
      designUrl: artUrl('viscount', 'badge'),
      fallbackIcon: '👑',
    },
    frame: {
      designUrl: artUrl('viscount', 'frame'),
      fallbackIcon: '🖼️',
    },
    ripple: null, entryEffect: null,
  },
  {
    rankKey: 'count', rankName: 'Count', rankColor: '#7E57C2',
    nameplate: {
      fallbackIcon: '🎖️',
      designUrl: artUrl('count', 'nameplate'),
      mistColor: '#CE93D8',
    },
    badge: {
      fallbackIcon: '👑',
      designUrl: artUrl('count', 'badge'),
    },
    frame: {
      fallbackIcon: '🖼️',
      designUrl: artUrl('count', 'frame'),
    },
    ripple: null, entryEffect: null,
  },
  {
    rankKey: 'marquis', rankName: 'Marquis', rankColor: '#EC407A',
    nameplate: {
      fallbackIcon: '🎖️',
      designUrl: artUrl('marquis', 'nameplate'),
      mistColor: '#EFBCD2',
    },
    badge: {
      fallbackIcon: '👑',
      designUrl: artUrl('marquis', 'badge'),
    },
    frame: {
      fallbackIcon: '🖼️',
      designUrl: artUrl('marquis', 'frame'),
    },
    ripple: null,
    entryEffect: { fallbackIcon: '✨' },
  },
  {
    rankKey: 'duke', rankName: 'Duke', rankColor: '#FF7043',
    nameplate: {
      fallbackIcon: '🎖️',
      designUrl: artUrl('duke', 'nameplate'),
      mistColor: '#FFCCBC',
    },
    badge: {
      fallbackIcon: '👑',
      designUrl: artUrl('duke', 'badge'),
    },
    frame: {
      fallbackIcon: '🖼️',
      designUrl: artUrl('duke', 'frame'),
    },
    ripple: null,
    entryEffect: { fallbackIcon: '✨' },
  },
  {
    rankKey: 'royalDuke', rankName: 'Royal Duke', rankColor: '#FFA000',
    nameplate: {
      fallbackIcon: '🎖️',
      designUrl: artUrl('rduke', 'nameplate'),
      mistColor: '#FFE0B2',
    },
    badge: {
      fallbackIcon: '👑',
      designUrl: artUrl('rduke', 'badge'),
    },
    frame: {
      fallbackIcon: '🖼️',
      designUrl: artUrl('rduke', 'frame'),
    },
    ripple: { fallbackIcon: '🌊', config: { colors: ['#FFA000', '#FF8F00'] } },
    entryEffect: { fallbackIcon: '✨' },
  },
  {
    rankKey: 'king', rankName: 'King', rankColor: '#FBC02D',
    nameplate: {
      fallbackIcon: '🎖️',
      designUrl: artUrl('king', 'nameplate'),
      mistColor: '#FFF9C4',
    },
    badge: {
      fallbackIcon: '👑',
      designUrl: artUrl('king', 'badge'),
    },
    frame: {
      fallbackIcon: '🖼️',
      designUrl: artUrl('king', 'frame'),
    },
    ripple: { fallbackIcon: '🌊', config: { colors: ['#FBC02D', '#F9A825'] } },
    entryEffect: { fallbackIcon: '✨' },
  },
  {
    rankKey: 'sking', rankName: 'SKing', rankColor: '#E65100',
    nameplate: {
      fallbackIcon: '🎖️',
      designUrl: artUrl('sking', 'nameplate'),
      mistColor: '#FFCCBC',
    },
    badge: {
      fallbackIcon: '👑',
      designUrl: artUrl('sking', 'badge'),
    },
    frame: {
      fallbackIcon: '🖼️',
      designUrl: artUrl('sking', 'frame'),
    },
    ripple: { fallbackIcon: '🌊', config: { colors: ['#E65100', '#BF360C'] } },
    entryEffect: { fallbackIcon: '✨' },
  },
  {
    rankKey: 'ssking', rankName: 'SSKing', rankColor: '#BF360C',
    nameplate: {
      fallbackIcon: '🎖️',
      designUrl: artUrl('ssking', 'nameplate'),
      mistColor: '#EF9A9A',
    },
    badge: {
      fallbackIcon: '👑',
      designUrl: artUrl('ssking', 'badge'),
    },
    frame: {
      fallbackIcon: '🖼️',
      designUrl: artUrl('ssking', 'frame'),
    },
    ripple: { fallbackIcon: '🌊', config: { colors: ['#BF360C', '#880E4F'] } },
    entryEffect: { fallbackIcon: '✨' },
  },
];

/**
 * Get the display icon for a reward — design URL if provided, else fallback.
 * Usage: <Image source={{uri: rewardIcon(design)}} /> or <Text>{rewardIcon(design)}</Text>
 */
export function rewardIcon(design: RewardDesign): string {
  return design.designUrl || design.fallbackIcon;
}

/**
 * Get rewards for a rank index (0-9). Returns null for invalid index.
 */
export function rewardsForRank(rankIndex: number): RankRewards | null {
  return getActiveCatalog()[rankIndex] ?? null;
}

/* ─────────────────────────────────────────────────────────────
 * 2026-10-17 (Sumon): SERVER-DRIVEN Nobel rewards.
 * Admin sets rewards in Firebase `nobel_rewards/{rankKey}` — designUrl,
 * fallbackIcon, etc. App fetches once at startup, caches in memory.
 * If server is unreachable, falls back to the hardcoded catalog above.
 * After this, Sumon can add/change rank rewards via Firebase — no build needed.
 * ───────────────────────────────────────────────────────────── */

let serverCatalog: RankRewards[] | null = null;
let serverLoadAttempted = false;

/** Get the active catalog: server (if loaded) else hardcoded fallback. */
export function getActiveCatalog(): RankRewards[] {
  return serverCatalog ?? NOBLE_REWARDS_CATALOG;
}

/** Find rewards by rank key from the active catalog. */
export function rewardsForRankKey(rankKey: string): RankRewards | null {
  return getActiveCatalog().find((r) => r.rankKey === rankKey) ?? null;
}

/**
 * Load server Nobel rewards from Firebase. Call once at app startup.
 * Non-blocking — falls back to hardcoded if fetch fails.
 */
export async function loadServerNobleRewards(): Promise<void> {
  if (serverLoadAttempted) return;
  serverLoadAttempted = true;
  try {
    const { ref, get } = await import('firebase/database');
    const { database } = await import('../config/firebase');
    const snap = await get(ref(database, 'nobel_rewards'));
    if (!snap.exists()) return;
    const data = snap.val();
    const catalog: RankRewards[] = [];
    // Preserve rank order from hardcoded catalog
    for (const base of NOBLE_REWARDS_CATALOG) {
      const override = data[base.rankKey];
      if (override) {
        catalog.push({
          rankKey: base.rankKey,
          rankName: override.rankName || base.rankName,
          rankColor: override.rankColor || base.rankColor,
          nameplate: override.nameplate || base.nameplate,
          badge: override.badge !== undefined ? override.badge : base.badge,
          frame: override.frame !== undefined ? override.frame : base.frame,
          ripple: override.ripple !== undefined ? override.ripple : base.ripple,
          entryEffect: override.entryEffect !== undefined ? override.entryEffect : base.entryEffect,
        });
      } else {
        catalog.push(base);
      }
    }
    serverCatalog = catalog;
  } catch {
    // Fallback to hardcoded — non-critical
  }
}
