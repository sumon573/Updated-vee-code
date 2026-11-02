/**
 * Vee Royal SVIP design handoff (UI-only fallback/reference).
 * LIVE server config from svip_config and svip_design wins over these values.
 * Do not write to either server node from this design file.
 * Real membership entitlements are always resolved by existing svipService.
 */
export const SVIP_THEME = {
  background: '#130D31',
  gold: '#E8B84B',
  appearance: 'Snake–Dragon Royal Luxury',
} as const;

export const SVIP_TIERS_FALLBACK = [
  { tier: 1, name: 'SVIP 1', priceDiamonds: 10000, durationDays: 30 },
  { tier: 2, name: 'SVIP 2', priceDiamonds: 20000, durationDays: 30 },
  { tier: 3, name: 'SVIP 3', priceDiamonds: 30000, durationDays: 30 },
  { tier: 4, name: 'SVIP 4', priceDiamonds: 40000, durationDays: 30 },
  { tier: 5, name: 'SVIP 5', priceDiamonds: 60000, durationDays: 30 },
] as const;

export const SVIP_PRIVILEGES_FALLBACK = [
  { key: 'badge', name: 'SVIP Badge', minTier: 1 },
  { key: 'nameplate', name: 'SVIP Nameplate', minTier: 1 },
  { key: 'entryEffect', name: 'Exclusive Entry Effect', minTier: 2 },
  { key: 'antiKick', name: 'Anti-Kick Privilege', minTier: 3 },
  { key: 'kickOut', name: 'Kick-Out Privilege', minTier: 3 },
] as const;

// Artifact filenames in the accompanying Muse handoff ZIP (NOT published
// remote URLs). Muse must upload approved images and fill verified CDN URLs.
// Frame overlays are cosmetic preview artwork, NOT a sixth privilege.
export const SVIP_APPROVED_ART_FILENAMES = {
  badges: {
    1: 'assets/badges/svip-badge-1.webp',
    2: 'assets/badges/svip-badge-2.webp',
    3: 'assets/badges/svip-badge-3.webp',
    4: 'assets/badges/svip-badge-4.webp',
    5: 'assets/badges/svip-badge-5.webp',
  },
  profileFrames: {
    1: 'assets/frames/svip-frame-1.webp',
    2: 'assets/frames/svip-frame-2.webp',
    3: 'assets/frames/svip-frame-3.webp',
    4: 'assets/frames/svip-frame-4.webp',
    5: 'assets/frames/svip-frame-5.webp',
  },
  nameplate: 'PLACEHOLDER',
  entryEffectAnimation: 'PLACEHOLDER', // rejected previous movement; NOT approved
  antiKickArt: 'PLACEHOLDER',
  kickOutArt: 'PLACEHOLDER',
} as const;

// IMPORTANT: A prior request asked to preview Entry Effect at S1;
// the live code currently unlocks it at S2. A preview is not entitlement.
// Preserve the live S2 unlock until explicitly approved for live change.
