/**
 * coupleLevelTokens.ts — Send-sheet level boxes Lv1–Lv5 (boss spec 2026-11-01,
 * box redesign 2026-11-02).
 *
 * The Send Couple Invitation sheet no longer offers token designs (Cupid's
 * Arrow / Eternal / Love Lock / Luster). It offers five LEVELS, all following
 * one shared design pattern, progressively upgraded: Lv1 simple glossy pink
 * heart ring box, Lv2 gold trim + small gems, Lv3 ornate gold filigree +
 * pink sapphires, Lv4 royal magenta + crown accents, Lv5 most ornate
 * jewel-encrusted crown-topped box with radiant diamond + sparkles.
 *
 * Art: Vee-original 3D-render strip (one pattern language), sliced into
 * five square tiles, AI-segmented to TRUE TRANSPARENT backgrounds
 * (u2netp full-res; Lv3 re-done with full u2net at 320px after u2netp
 * faded its base front), uploaded byte-for-byte to /m/ (verified
 * Content-Type + Content-Length). No imo art, no emoji art.
 *
 * Money: amounts are the boss's level prices. Lv1 1200 is both the request
 * price and the Lv1 send price; upgrades Lv2–Lv5 match couplePaidLevels.ts.
 */

/** Remote /m/ art URLs for the five TRANSPARENT level box tiles (uploaded 2026-11-02). */
export const COUPLE_LEVEL_ART_URLS: Record<number, string> = {
  1: 'https://vee-club.duckdns.org/m/d8f804a080cf6b6d160d1cc535b352ed',
  2: 'https://vee-club.duckdns.org/m/2404c6b7536094545c296edbe6f4c9de',
  3: 'https://vee-club.duckdns.org/m/b5daf4a28e8407b7e23086410c901ecd',
  4: 'https://vee-club.duckdns.org/m/857a726fc3a203493966defb351fd968',
  5: 'https://vee-club.duckdns.org/m/94c18c001d3b313a4b2f902d00c4f89d',
};

export interface CoupleLevelToken {
  level: number; // 1..5
  amount: number; // diamonds to send at this level
  /** Remote /m/ URL of the level tile. */
  artUrl: string | null;
  /** Local final filename under ~/workspace/vee-couple-boxes/. */
  localFile: string;
}

/** Diamonds to send at each level (boss spec 2026-11-01). */
export const COUPLE_LEVEL_AMOUNTS: Record<number, number> = {
  1: 1200,
  2: 2000,
  3: 3500,
  4: 5000,
  5: 7000,
};

export const COUPLE_LEVEL_IDS = [1, 2, 3, 4, 5] as const;

export const COUPLE_LEVEL_TOKENS: CoupleLevelToken[] = COUPLE_LEVEL_IDS.map((level) => ({
  level,
  amount: COUPLE_LEVEL_AMOUNTS[level] ?? 1200,
  artUrl: COUPLE_LEVEL_ART_URLS[level] ?? null,
  localFile: `box-lv${level}-t.webp`,
}));

/** Clamp any value to a valid send level (1..5). */
export function clampSendLevel(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : 1;
  return Math.min(5, Math.max(1, n));
}

/** Diamonds for a send level (1200 for Lv1). */
export function levelSendAmount(level: number): number {
  return COUPLE_LEVEL_AMOUNTS[clampSendLevel(level)] ?? 1200;
}

/** Level for an amount, or null when the amount is not a level price. */
export function amountToSendLevel(amount: number): number | null {
  for (const level of COUPLE_LEVEL_IDS) {
    if (COUPLE_LEVEL_AMOUNTS[level] === amount) return level;
  }
  return null;
}

/** True when the amount is exactly one of the five level prices. */
export function isLevelAmount(amount: number): boolean {
  return amountToSendLevel(amount) !== null;
}
