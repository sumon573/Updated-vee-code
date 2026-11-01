/**
 * couplePaidLevels.ts — Couple PAID levels 1–5 (boss spec 2026-11-01).
 *
 * This is a SECOND couple level system, distinct from the hearts curve in
 * coupleLevels.ts (hearts from gifts/time/PK, 10 levels, shown on the
 * Intimacy tab meter). The paid system works like this:
 *   - Sending a couple request costs COUPLE_REQUEST_PRICE diamonds.
 *   - On accept, the couple starts at paid level 1.
 *   - Upgrades are diamond purchases: Lv2 2000, Lv3 3500, Lv4 5000,
 *     Lv5 7000 (Max). No other way to climb paid levels.
 *   - Every paid level grants ONE profile frame + ONE entry effect
 *     (rendered by CoupleLevelArt.tsx as original code-drawn visuals —
 *     no imo art, no emoji art). Frames grow more premium from Lv1
 *     (simple) to Lv5 (most ornate).
 *
 * Money: upgrade charges go through chargeCoupleDiamonds() in
 * couplePayment.ts — the ONE money entry point. Nothing in this file
 * touches wallets or balances.
 *
 * RTDB shape (new fields on the EXISTING couple record; nothing else
 * moves, and no live data is written by this build):
 *   couples/{pairKey}/paidLevel: number 1..5 (absent = 1 — a couple
 *     always starts at level 1 on formation).
 *   couples/{pairKey}/claimedLevels/{level}: true (roadmap reward for
 *     that level claimed; non-money record write only).
 *   couple_config/invitePriceDiamonds: request price override (owned by
 *     the live-data owner; the app default below is 1200).
 *
 * All reads are event-driven subscriptions (no polling, no timers) and
 * never throw: bad data falls back to level 1 / no claims.
 */

import { ref, onValue, update } from 'firebase/database';
import { database } from '@/src/config/firebase';

// ─── Prices (boss spec 2026-11-01) ──────────────────────────────────────────

/** Diamonds to send a couple request. Was 5000 in the old model. */
export const COUPLE_REQUEST_PRICE = 1200;

/** Diamond cost to upgrade TO each level (level 1 is free — it is the start). */
export const COUPLE_UPGRADE_COSTS: Record<number, number> = {
  2: 2000,
  3: 3500,
  4: 5000,
  5: 7000,
};

export const COUPLE_PAID_LEVEL_IDS = [1, 2, 3, 4, 5] as const;
export const COUPLE_MAX_PAID_LEVEL = 5;

// ─── Levels ──────────────────────────────────────────────────────────────────

export interface CouplePaidLevel {
  id: number; // 1..5
  /** Cost to upgrade TO this level; null for level 1 (the starting level). */
  upgradeCost: number | null;
  /** Short English label for showcase cards. */
  frameLabel: string;
  entryLabel: string;
}

/**
 * Detailed reward list, in English (boss order 2026-11-01: no Bengali
 * anywhere on the Couple page). Level 1 has no reward line — it is
 * the starting level, so the detailed list runs Lv.2–Lv.5 only.
 */
export const COUPLE_PAID_REWARDS_EN: Record<number, string> = {
  2: 'Upgraded profile frame, special entry effect, couple chat badge',
  3: 'Stunning profile frame, glowing entry effect, exclusive couple room theme',
  4: 'Royal profile frame, deluxe entry effect, couple emoji pack',
  5: 'Empire profile frame, ultimate entry effect, couple title frame',
};

export const COUPLE_PAID_LEVELS: CouplePaidLevel[] = COUPLE_PAID_LEVEL_IDS.map((id) => ({
  id,
  upgradeCost: id === 1 ? null : COUPLE_UPGRADE_COSTS[id] ?? null,
  frameLabel: `Lv.${id} Frame`,
  entryLabel: `Lv.${id} Entry Effect`,
}));

/** "Lv.1" … "Lv.5 (Max)". */
export function formatPaidLevel(id: number): string {
  const v = Math.min(COUPLE_MAX_PAID_LEVEL, Math.max(1, Math.floor(id) || 1));
  return v >= COUPLE_MAX_PAID_LEVEL ? `Lv.${v} (Max)` : `Lv.${v}`;
}

/** Clamp any stored value to a valid paid level (1..5). */
export function clampPaidLevel(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : 1;
  return Math.min(COUPLE_MAX_PAID_LEVEL, Math.max(1, n));
}

/**
 * Roadmap progress 0..1 from the paid level: 0 at Lv.1, 1 at Lv.5.
 * This is purely "how far along the 1–5 roadmap", not a currency
 * balance and not hearts — paid levels are bought, not ground.
 */
export function paidLevelProgress(paidLevel: number): number {
  const v = clampPaidLevel(paidLevel);
  return (v - 1) / (COUPLE_MAX_PAID_LEVEL - 1);
}

// ─── Reads (event-driven, never throw) ───────────────────────────────────────

/** Live paid level for a couple; emits 1 when absent/invalid/no pair. */
export function subscribeCouplePaidLevel(
  pairKey: string | null | undefined,
  cb: (level: number) => void,
): () => void {
  if (!pairKey) {
    cb(1);
    return () => {};
  }
  try {
    return onValue(
      ref(database, `couples/${pairKey}/paidLevel`),
      (snap) => cb(clampPaidLevel(snap.exists() ? snap.val() : 1)),
      () => cb(1),
    );
  } catch {
    cb(1);
    return () => {};
  }
}

/** Live claimed-roadmap set for a couple; emits empty when absent. */
export function subscribeCoupleClaims(
  pairKey: string | null | undefined,
  cb: (claimed: Set<number>) => void,
): () => void {
  if (!pairKey) {
    cb(new Set());
    return () => {};
  }
  try {
    return onValue(
      ref(database, `couples/${pairKey}/claimedLevels`),
      (snap) => {
        const out = new Set<number>();
        if (snap.exists()) {
          const v = snap.val() as Record<string, unknown> | null;
          if (v && typeof v === 'object') {
            for (const k of Object.keys(v)) {
              const n = Number(k);
              if (Number.isInteger(n) && n >= 1 && n <= COUPLE_MAX_PAID_LEVEL && v[k] === true) {
                out.add(n);
              }
            }
          }
        }
        cb(out);
      },
      () => cb(new Set()),
    );
  } catch {
    cb(new Set());
    return () => {};
  }
}

// ─── Non-money writes (called only AFTER a successful charge) ───────────────

/** Record a paid-level upgrade. Call only after chargeCoupleDiamonds succeeds. */
export async function setCouplePaidLevel(pairKey: string, level: number): Promise<void> {
  if (!pairKey) throw new Error('No couple.');
  await update(ref(database, `couples/${pairKey}`), { paidLevel: clampPaidLevel(level) });
}

/** Record a roadmap reward claim (non-money; the reward itself is display). */
export async function claimCoupleLevelReward(pairKey: string, level: number): Promise<void> {
  if (!pairKey) throw new Error('No couple.');
  const v = clampPaidLevel(level);
  await update(ref(database, `couples/${pairKey}/claimedLevels`), { [v]: true });
}
