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
