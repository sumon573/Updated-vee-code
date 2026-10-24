/**
 * Short ID Catalog — 4-digit premium IDs for users and rooms (2026-10-09).
 *
 * Tiers by desirability (lucky/repeating/sequential patterns cost more).
 * Prices are in diamonds. Admin can adjust via this file.
 */

export type ShortIdTier = 'SSS' | 'SS' | 'S' | 'A' | 'RANDOM';

export interface ShortIdItem {
  id: string;          // 4-digit ID, e.g. "8888"
  tier: ShortIdTier;
  price: number;       // diamonds
  label: string;       // display label (e.g. "Lucky 8")
}

export const SHORT_ID_CATALOG: ShortIdItem[] = [
  // SSS — the luckiest
  { id: '8888', tier: 'SSS', price: 50000, label: 'Lucky 8' },

  // SS — repeating digits
  { id: '6666', tier: 'SS', price: 25000, label: 'Triple 6' },
  { id: '7777', tier: 'SS', price: 25000, label: 'Triple 7' },
  { id: '9999', tier: 'SS', price: 25000, label: 'Triple 9' },

  // S — sequential / meaningful
  { id: '1234', tier: 'S', price: 10000, label: 'Sequential' },
  { id: '4321', tier: 'S', price: 10000, label: 'Reverse Seq' },
  { id: '1314', tier: 'S', price: 10000, label: 'Forever' },
  { id: '5200', tier: 'S', price: 10000, label: 'I Love You' },

  // A — round numbers
  { id: '1000', tier: 'A', price: 5000, label: 'Round 1K' },
  { id: '2000', tier: 'A', price: 5000, label: 'Round 2K' },
  { id: '3000', tier: 'A', price: 5000, label: 'Round 3K' },
  { id: '5000', tier: 'A', price: 5000, label: 'Round 5K' },
  { id: '8000', tier: 'A', price: 5000, label: 'Round 8K' },
];

export const RANDOM_SHORT_ID_PRICE = 1000;

/** 2026-10-24 (boss: no more builds) — server-driven short-ID display prices.
 * RTDB `short_id_pricing/{id}` = diamonds. The Store display follows the
 * server; the hardcoded catalog above is the fallback. (Purchase charging
 * itself is already server-side via the purchase-short-id API.) */
let serverPrices: Record<string, number> = {};
let shortIdPricingLoadAttempted = false;

export async function loadServerShortIdPricing(): Promise<void> {
  if (shortIdPricingLoadAttempted) return;
  shortIdPricingLoadAttempted = true;
  try {
    const { ref, get } = await import('firebase/database');
    const { database } = await import('@/src/config/firebase');
    const snap = await get(ref(database, 'short_id_pricing'));
    if (!snap.exists()) return;
    const data = snap.val();
    if (!data || typeof data !== 'object') return;
    const next: Record<string, number> = {};
    for (const [id, price] of Object.entries(data as Record<string, any>)) {
      if (typeof price === 'number' && price > 0 && Number.isFinite(price)) next[id] = Math.floor(price);
    }
    if (Object.keys(next).length > 0) serverPrices = next;
  } catch {
    // Fallback to hardcoded — non-critical
  }
}

/** Display price for a catalog ID: server price wins, else catalog, else random flat. */
export function getShortIdCatalogPrice(id: string): number {
  if (serverPrices[id] !== undefined) return serverPrices[id];
  const base = SHORT_ID_CATALOG.find((s) => s.id === id);
  return base?.price ?? RANDOM_SHORT_ID_PRICE;
}

/** True when the server prices this ID (random draws must exclude it too). */
export function isServerPricedShortId(id: string): boolean {
  return serverPrices[id] !== undefined;
}

export const TIER_COLORS: Record<ShortIdTier, string> = {
  SSS: '#FFD700',  // gold
  SS: '#C0C0C0',   // silver
  S: '#CD7F32',    // bronze
  A: '#8B5CF6',    // purple
  RANDOM: '#22C55E', // green
};

export const TIER_NAMES: Record<ShortIdTier, string> = {
  SSS: 'Legendary',
  SS: 'Epic',
  S: 'Rare',
  A: 'Classic',
  RANDOM: 'Random',
};
