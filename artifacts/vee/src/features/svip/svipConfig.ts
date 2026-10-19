/**
 * svipConfig — Vee SVIP membership configuration (2026-10-19).
 *
 * SVIP = Vee's paid premium membership, modeled on IMO's SVIP:
 * tiered levels with badge icon + nameplate icon + room privileges.
 *
 * ⚠️ BOSS DECISIONS PENDING (do NOT invent):
 * 1. PRICING — all prices below are PLACEHOLDERS (0 = unset). Boss sets
 *    real diamond prices per tier + duration before any payment flow ships.
 * 2. PAYMENT METHOD — how users pay (diamonds from wallet? bKash? Google
 *    Play?). Until decided, the "Become SVIP" CTA only joins a waitlist.
 *
 * Server-driven: this file is the client fallback. The RTDB node
 * `svipConfig` (same shape) overrides it when present — so boss can change
 * tiers/prices without a build once the payment flow exists.
 */

export interface SvipTier {
  /** 1-based tier level (matches IMO's svip_level) */
  tier: number;
  name: string;
  /** Brand color for the tier */
  color: string;
  /** ⚠️ PLACEHOLDER — boss sets real price. 0 = not for sale yet. */
  priceDiamonds: number;
  /** Duration in days per purchase */
  durationDays: number;
  /** Privilege keys unlocked at this tier (see SVIP_PRIVILEGES) */
  privileges: string[];
  /** SVIP Points granted on purchase (proportional to tier value) */
  pointsGranted: number;
}

export interface SvipPrivilegeDef {
  key: string;
  name: string;
  icon: string;
  /** First tier (1-based) that grants this privilege */
  minTier: number;
  /** False when no real code path enforces it yet — shows locked, never dead */
  enforced: boolean;
  /** TODO note for the stubbed ones */
  todo?: string;
}

export const SVIP_TIERS: SvipTier[] = [
  {
    tier: 1,
    name: 'SVIP 1',
    color: '#42A5F5',
    priceDiamonds: 0, // ⚠️ BOSS: set price
    durationDays: 30,
    privileges: ['badge', 'nameplate'],
    pointsGranted: 100,
  },
  {
    tier: 2,
    name: 'SVIP 2',
    color: '#7E57C2',
    priceDiamonds: 0, // ⚠️ BOSS: set price
    durationDays: 30,
    privileges: ['badge', 'nameplate', 'entryEffect'],
    pointsGranted: 300,
  },
  {
    tier: 3,
    name: 'SVIP 3',
    color: '#FF9800',
    priceDiamonds: 0, // ⚠️ BOSS: set price
    durationDays: 30,
    privileges: ['badge', 'nameplate', 'entryEffect', 'antiKick', 'kickOut'],
    pointsGranted: 800,
  },
];

export const SVIP_PRIVILEGES: SvipPrivilegeDef[] = [
  {
    key: 'badge',
    name: 'SVIP Badge',
    icon: '👑',
    minTier: 1,
    enforced: true,
  },
  {
    key: 'nameplate',
    name: 'SVIP Nameplate',
    icon: '📛',
    minTier: 1,
    enforced: true,
  },
  {
    key: 'entryEffect',
    name: 'Exclusive Entry Effect',
    icon: '✨',
    minTier: 2,
    enforced: true,
  },
  {
    key: 'antiKick',
    name: 'Anti-Kick Privilege',
    icon: '🛡️',
    minTier: 3,
    enforced: true,
  },
  {
    key: 'kickOut',
    name: 'Kick-Out Privilege',
    icon: '⚡',
    minTier: 3,
    enforced: true,
  },
];

/** Highest tier whose privileges the given tier includes. */
export function privilegesForTier(tier: number): SvipPrivilegeDef[] {
  return SVIP_PRIVILEGES.filter((p) => tier >= p.minTier);
}
