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
    badge: null, frame: null, ripple: null, entryEffect: null,
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
    frame: null, ripple: null, entryEffect: null,
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
    frame: null, ripple: null, entryEffect: null,
  },
  {
    rankKey: 'count', rankName: 'Count', rankColor: '#7E57C2',
    nameplate: { fallbackIcon: '🎖️' },
    badge: { fallbackIcon: '👑' },
    frame: { fallbackIcon: '🖼️' },
    ripple: null, entryEffect: null,
  },
  {
    rankKey: 'marquis', rankName: 'Marquis', rankColor: '#EC407A',
    nameplate: { fallbackIcon: '🎖️' },
    badge: { fallbackIcon: '👑' },
    frame: { fallbackIcon: '🖼️' },
    ripple: null,
    entryEffect: { fallbackIcon: '✨' },
  },
  {
    rankKey: 'duke', rankName: 'Duke', rankColor: '#FF7043',
    nameplate: { fallbackIcon: '🎖️' },
    badge: { fallbackIcon: '👑' },
    frame: { fallbackIcon: '🖼️' },
    ripple: null,
    entryEffect: { fallbackIcon: '✨' },
  },
  {
    rankKey: 'royalDuke', rankName: 'Royal Duke', rankColor: '#FFA000',
    nameplate: { fallbackIcon: '🎖️' },
    badge: { fallbackIcon: '👑' },
    frame: { fallbackIcon: '🖼️' },
    ripple: { fallbackIcon: '🌊', config: { colors: ['#FFA000', '#FF8F00'] } },
    entryEffect: { fallbackIcon: '✨' },
  },
  {
    rankKey: 'king', rankName: 'King', rankColor: '#FBC02D',
    nameplate: { fallbackIcon: '🎖️' },
    badge: { fallbackIcon: '👑' },
    frame: { fallbackIcon: '🖼️' },
    ripple: { fallbackIcon: '🌊', config: { colors: ['#FBC02D', '#F9A825'] } },
    entryEffect: { fallbackIcon: '✨' },
  },
  {
    rankKey: 'sking', rankName: 'SKing', rankColor: '#E65100',
    nameplate: { fallbackIcon: '🎖️' },
    badge: { fallbackIcon: '👑' },
    frame: { fallbackIcon: '🖼️' },
    ripple: { fallbackIcon: '🌊', config: { colors: ['#E65100', '#BF360C'] } },
    entryEffect: { fallbackIcon: '✨' },
  },
  {
    rankKey: 'ssking', rankName: 'SSKing', rankColor: '#BF360C',
    nameplate: { fallbackIcon: '🎖️' },
    badge: { fallbackIcon: '👑' },
    frame: { fallbackIcon: '🖼️' },
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
  return NOBLE_REWARDS_CATALOG[rankIndex] ?? null;
}
