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
 * Until a design is provided, the `fallbackIcon` (emoji) is used.
 * NEVER ship a reward with neither designUrl nor fallbackIcon.
 */

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
      designUrl: 'https://cdn.jsdelivr.net/gh/sumon573/vee-admin-dashboard@main/public/nobel/noble-plate-knight.png',
      fallbackIcon: '🎖️',
    },
    badge: null,
    frame: {
      designUrl: 'https://cdn.jsdelivr.net/gh/sumon573/vee-admin-dashboard@main/public/nobel/noble-frame-knight.png',
      fallbackIcon: '🖼️',
    },
    ripple: null, entryEffect: null,
  },
  {
    rankKey: 'baron', rankName: 'Baron', rankColor: '#26A69A',
    nameplate: {
      designUrl: 'https://cdn.jsdelivr.net/gh/sumon573/vee-admin-dashboard@main/public/nobel/noble-plate-baron.png',
      fallbackIcon: '🎖️',
    },
    badge: {
      designUrl: 'https://cdn.jsdelivr.net/gh/sumon573/vee-admin-dashboard@main/public/nobel/noble-badge-baron.png',
      fallbackIcon: '👑',
    },
    frame: {
      designUrl: 'https://cdn.jsdelivr.net/gh/sumon573/vee-admin-dashboard@main/public/nobel/noble-frame-baron.png',
      fallbackIcon: '🖼️',
    },
    ripple: null, entryEffect: null,
  },
  {
    rankKey: 'viscount', rankName: 'Viscount', rankColor: '#42A5F5',
    nameplate: {
      designUrl: 'https://cdn.jsdelivr.net/gh/sumon573/vee-admin-dashboard@main/public/nobel/noble-plate-viscount.png',
      fallbackIcon: '🎖️',
      mistColor: '#BBDEFB', // 2026-10-15 (Sumon): mist animation starts from Viscount
    },
    badge: {
      designUrl: 'https://cdn.jsdelivr.net/gh/sumon573/vee-admin-dashboard@main/public/nobel/noble-badge-viscount.png',
      fallbackIcon: '👑',
    },
    frame: {
      designUrl: 'https://vee-club.duckdns.org/nobel-art/rank-viscount-frame.png',
      fallbackIcon: '🖼️',
    },
    ripple: null, entryEffect: null,
  },
  {
    rankKey: 'count', rankName: 'Count', rankColor: '#7E57C2',
    nameplate: {
      fallbackIcon: '🎖️',
      designUrl: 'https://cdn.jsdelivr.net/gh/sumon573/vee-admin-dashboard@main/public/nobel/noble-plate-count.png',
      mistColor: '#CE93D8',
    },
    badge: {
      fallbackIcon: '👑',
      designUrl: 'https://cdn.jsdelivr.net/gh/sumon573/vee-admin-dashboard@main/public/nobel/noble-badge-count.png',
    },
    frame: {
      fallbackIcon: '🖼️',
      designUrl: 'https://cdn.jsdelivr.net/gh/sumon573/vee-admin-dashboard@main/public/nobel/noble-frame-count.png',
    },
    ripple: null, entryEffect: null,
  },
  {
    rankKey: 'marquis', rankName: 'Marquis', rankColor: '#EC407A',
    nameplate: { fallbackIcon: '🎖️' },
    badge: {
      designUrl: 'https://cdn.jsdelivr.net/gh/sumon573/vee-admin-dashboard@main/public/nobel/noble-badge-marquis.png',
      fallbackIcon: '👑',
    },
    frame: {
      designUrl: 'https://cdn.jsdelivr.net/gh/sumon573/vee-admin-dashboard@main/public/nobel/noble-frame-marquis.png',
      fallbackIcon: '🖼️',
    },
    ripple: null,
    entryEffect: { fallbackIcon: '✨' },
  },
  {
    rankKey: 'duke', rankName: 'Duke', rankColor: '#FF7043',
    nameplate: { fallbackIcon: '🎖️' },
    badge: {
      designUrl: 'https://cdn.jsdelivr.net/gh/sumon573/vee-admin-dashboard@main/public/nobel/noble-badge-duke.png',
      fallbackIcon: '👑',
    },
    frame: {
      designUrl: 'https://cdn.jsdelivr.net/gh/sumon573/vee-admin-dashboard@main/public/nobel/noble-frame-duke.png',
      fallbackIcon: '🖼️',
    },
    ripple: null,
    entryEffect: { fallbackIcon: '✨' },
  },
  {
    rankKey: 'royalDuke', rankName: 'Royal Duke', rankColor: '#FFA000',
    nameplate: { fallbackIcon: '🎖️' },
    badge: {
      designUrl: 'https://cdn.jsdelivr.net/gh/sumon573/vee-admin-dashboard@main/public/nobel/noble-badge-royalduke.png',
      fallbackIcon: '👑',
    },
    frame: {
      designUrl: 'https://cdn.jsdelivr.net/gh/sumon573/vee-admin-dashboard@main/public/nobel/noble-frame-royalduke.png',
      fallbackIcon: '🖼️',
    },
    ripple: { fallbackIcon: '🌊', config: { colors: ['#FFA000', '#FF8F00'] } },
    entryEffect: { fallbackIcon: '✨' },
  },
  {
    rankKey: 'king', rankName: 'King', rankColor: '#FBC02D',
    nameplate: { fallbackIcon: '🎖️' },
    badge: {
      designUrl: 'https://cdn.jsdelivr.net/gh/sumon573/vee-admin-dashboard@main/public/nobel/noble-badge-king.png',
      fallbackIcon: '👑',
    },
    frame: {
      designUrl: 'https://cdn.jsdelivr.net/gh/sumon573/vee-admin-dashboard@main/public/nobel/noble-frame-king.png',
      fallbackIcon: '🖼️',
    },
    ripple: { fallbackIcon: '🌊', config: { colors: ['#FBC02D', '#F9A825'] } },
    entryEffect: { fallbackIcon: '✨' },
  },
  {
    rankKey: 'sking', rankName: 'SKing', rankColor: '#E65100',
    nameplate: { fallbackIcon: '🎖️' },
    badge: {
      designUrl: 'https://cdn.jsdelivr.net/gh/sumon573/vee-admin-dashboard@main/public/nobel/noble-badge-sking.png',
      fallbackIcon: '👑',
    },
    frame: {
      designUrl: 'https://cdn.jsdelivr.net/gh/sumon573/vee-admin-dashboard@main/public/nobel/noble-frame-sking.png',
      fallbackIcon: '🖼️',
    },
    ripple: { fallbackIcon: '🌊', config: { colors: ['#E65100', '#BF360C'] } },
    entryEffect: { fallbackIcon: '✨' },
  },
  {
    rankKey: 'ssking', rankName: 'SSKing', rankColor: '#BF360C',
    nameplate: { fallbackIcon: '🎖️' },
    badge: {
      designUrl: 'https://cdn.jsdelivr.net/gh/sumon573/vee-admin-dashboard@main/public/nobel/noble-badge-ssking.png',
      fallbackIcon: '👑',
    },
    frame: {
      designUrl: 'https://cdn.jsdelivr.net/gh/sumon573/vee-admin-dashboard@main/public/nobel/noble-frame-ssking.png',
      fallbackIcon: '🖼️',
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
  const catalog = getActiveCatalog();
  // 2026-10-20 FIX (boss: noble frame missing on voice-room seats): exact
  // match first, then a case-insensitive match. Two key conventions
  // coexist — NOBLE_RANKS / catalog rankKey 'royalDuke' vs the item/asset
  // id suffix 'royalduke' (designUrls, admin-granted ids). A frame id in
  // the other convention's case resolved to NO entry, and callers fell
  // back to full-size frame art (Avatar seat ring) or lost designUrls.
  return (
    catalog.find((r) => r.rankKey === rankKey) ??
    catalog.find((r) => r.rankKey.toLowerCase() === rankKey.toLowerCase()) ??
    null
  );
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
