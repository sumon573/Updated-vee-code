/**
 * svipPageConfig — FULLY SERVER-DRIVEN SVIP page config (F8, 2026-11-05).
 *
 * The SVIP page is a SLOT RENDERER: every piece of SVIP content comes
 * from the staging RTDB node `svip_page` — theme colours, layout sizes,
 * tier hero/banner/flower art, rewards slots, buy-bar copy, preview copy.
 * The client holds NO SVIP content values: no tier names, prices, art
 * URLs, reward labels or preview text. If the node is absent or
 * malformed the screen shows an honest empty state, never demo values.
 *
 * Server shape (svip_page):
 *   { version, theme: {...}, layout: {...}, topBar: {title},
 *     buyBar: {priceSuffix, ctaLabel, waitlistedLabel, joiningLabel, activeLabel},
 *     preview: {nameplateTitle, nameplateDescription, frameTitle, frameDescription},
 *     tiers: { "<tier>": {heroArt, heroMarginTopPx, heroTransparent,
 *              flowerArt, bannerArt, rewards: [{slot, kind, id, label, art,
 *              artW, artH, sprite: {cols, rows, frames, stepMs}}]} } }
 *
 * RTDB normalisation: a tiers object with numeric keys ("1".."7") comes
 * back as an ARRAY ([null, tier1, ...]) — both shapes are accepted.
 * A tier page entry may be {} (no slots: hero/banner/rewards all hidden).
 * A reward slot whose art is missing/invalid degrades to kind "empty"
 * (outlined box, no label) so the grid geometry never breaks.
 *
 * Sanitisation follows the svipConfig pattern: a malformed entry is
 * skipped/dropped, never a crash. Layout numbers fall back to the
 * showcase design constants ONLY when the server omits the field.
 */

export interface SvipSpriteSpec {
  cols: number;
  rows: number;
  frames: number;
  stepMs: number;
}

export interface SvipRewardSlot {
  slot: number;
  kind: string; // 'nameplate' | 'frame' | 'empty' (other kinds render as empty)
  id?: string;
  label?: string;
  art?: string;
  artW?: number;
  artH?: number;
  sprite?: SvipSpriteSpec;
}

export interface SvipTierPage {
  heroArt?: string;
  heroMarginTopPx?: number;
  heroTransparent?: boolean;
  flowerArt?: string;
  bannerArt?: string;
  rewards?: SvipRewardSlot[];
}

export interface SvipPageTheme {
  pageBg: string;
  pageBgDeep: string;
  gold: string;
  goldBright: string;
  goldDeep: string;
  ink: string;
  inkSoft: string;
  inkFaint: string;
  onGold: string;
  line: string;
  labelGold: string;
}

export interface SvipPageLayout {
  topBarHeight: number;
  titleSize: number;
  tabSize: number;
  tabUnderlineW: number;
  tabUnderlineH: number;
  heroMaxPx: number;
  heroWidthPct: number;
  heroMaxHeightDvh: number;
  heroMaxHeightSmallDvh: number;
  swipeThresholdPx: number;
  transitionMs: number;
  rewardsCols: number;
  rewardsGapPx: number;
  rewardsSlots: number;
  rewardLabelSizePx: number;
  buyBarPadTopPx: number;
  radiusCard: number;
  radiusTile: number;
  radiusSlot: number;
}

export interface SvipPageBuyBar {
  priceSuffix: string;
  ctaLabel: string;
  waitlistedLabel: string;
  joiningLabel: string;
  activeLabel: string;
}

export interface SvipPagePreview {
  nameplateTitle: string;
  nameplateDescription: string;
  frameTitle: string;
  frameDescription: string;
}

export interface SvipPageConfig {
  version: number;
  theme: SvipPageTheme;
  layout: SvipPageLayout;
  topBar: { title: string };
  buyBar: SvipPageBuyBar;
  preview: SvipPagePreview | null;
  tiers: Record<number, SvipTierPage>;
}

function isColor(s: unknown): s is string {
  if (typeof s !== 'string' || !s) return false;
  if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s)) return true;
  return /^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(,\s*[\d.]+\s*)?\)$/.test(s);
}

function isUrl(s: unknown): s is string {
  return typeof s === 'string' && s.startsWith('https://') && s.length < 2048;
}

function num(v: unknown, def: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some((x) => !Number.isFinite(x))) return 'rgba(232,184,75,0.22)';
  return `rgba(${r},${g},${b},${alpha})`;
}

function sanitizeTheme(raw: any): SvipPageTheme | null {
  if (!raw || typeof raw !== 'object') return null;
  const pageBg = isColor(raw.pageBg) ? raw.pageBg : null;
  const gold = isColor(raw.gold) ? raw.gold : null;
  if (!pageBg || !gold) return null;
  const ink = isColor(raw.ink) ? raw.ink : '#FFFFFF';
  const inkSoft = isColor(raw.inkSoft) ? raw.inkSoft : ink;
  return {
    pageBg,
    pageBgDeep: isColor(raw.pageBgDeep) ? raw.pageBgDeep : pageBg,
    gold,
    goldBright: isColor(raw.goldBright) ? raw.goldBright : gold,
    goldDeep: isColor(raw.goldDeep) ? raw.goldDeep : gold,
    ink,
    inkSoft,
    inkFaint: isColor(raw.inkFaint) ? raw.inkFaint : inkSoft,
    onGold: isColor(raw.onGold) ? raw.onGold : '#000000',
    line: isColor(raw.line) ? raw.line : hexToRgba(gold, 0.22),
    labelGold: isColor(raw.labelGold) ? raw.labelGold : gold,
  };
}

/** Showcase design constants — used ONLY when the server omits a field. */
const LAYOUT_DEFAULTS: SvipPageLayout = {
  topBarHeight: 54,
  titleSize: 19,
  tabSize: 15,
  tabUnderlineW: 26,
  tabUnderlineH: 3,
  heroMaxPx: 220,
  heroWidthPct: 68,
  heroMaxHeightDvh: 44,
  heroMaxHeightSmallDvh: 36,
  swipeThresholdPx: 48,
  transitionMs: 380,
  rewardsCols: 3,
  rewardsGapPx: 12,
  rewardsSlots: 6,
  rewardLabelSizePx: 9,
  buyBarPadTopPx: 14,
  radiusCard: 22,
  radiusTile: 14,
  radiusSlot: 10,
};

function sanitizeLayout(raw: any): SvipPageLayout {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    topBarHeight: num(r.topBarHeight, LAYOUT_DEFAULTS.topBarHeight, 32, 120),
    titleSize: num(r.titleSize, LAYOUT_DEFAULTS.titleSize, 12, 32),
    tabSize: num(r.tabSize, LAYOUT_DEFAULTS.tabSize, 10, 24),
    tabUnderlineW: num(r.tabUnderlineW, LAYOUT_DEFAULTS.tabUnderlineW, 8, 80),
    tabUnderlineH: num(r.tabUnderlineH, LAYOUT_DEFAULTS.tabUnderlineH, 1, 8),
    heroMaxPx: num(r.heroMaxPx, LAYOUT_DEFAULTS.heroMaxPx, 80, 600),
    heroWidthPct: num(r.heroWidthPct, LAYOUT_DEFAULTS.heroWidthPct, 20, 100),
    heroMaxHeightDvh: num(r.heroMaxHeightDvh, LAYOUT_DEFAULTS.heroMaxHeightDvh, 10, 80),
    heroMaxHeightSmallDvh: num(r.heroMaxHeightSmallDvh, LAYOUT_DEFAULTS.heroMaxHeightSmallDvh, 10, 80),
    swipeThresholdPx: num(r.swipeThresholdPx, LAYOUT_DEFAULTS.swipeThresholdPx, 8, 200),
    transitionMs: num(r.transitionMs, LAYOUT_DEFAULTS.transitionMs, 0, 2000),
    rewardsCols: Math.floor(num(r.rewardsCols, LAYOUT_DEFAULTS.rewardsCols, 1, 6)),
    rewardsGapPx: num(r.rewardsGapPx, LAYOUT_DEFAULTS.rewardsGapPx, 0, 40),
    rewardsSlots: Math.floor(num(r.rewardsSlots, LAYOUT_DEFAULTS.rewardsSlots, 1, 12)),
    rewardLabelSizePx: num(r.rewardLabelSizePx, LAYOUT_DEFAULTS.rewardLabelSizePx, 7, 16),
    buyBarPadTopPx: num(r.buyBarPadTopPx, LAYOUT_DEFAULTS.buyBarPadTopPx, 0, 40),
    radiusCard: num(r.radiusCard, LAYOUT_DEFAULTS.radiusCard, 0, 40),
    radiusTile: num(r.radiusTile, LAYOUT_DEFAULTS.radiusTile, 0, 40),
    radiusSlot: num(r.radiusSlot, LAYOUT_DEFAULTS.radiusSlot, 0, 40),
  };
}

function sanitizeBuyBar(raw: any): SvipPageBuyBar | null {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.ctaLabel !== 'string' || !raw.ctaLabel.trim()) return null;
  if (typeof raw.priceSuffix !== 'string') return null;
  return {
    priceSuffix: raw.priceSuffix,
    ctaLabel: raw.ctaLabel.trim(),
    waitlistedLabel: typeof raw.waitlistedLabel === 'string' ? raw.waitlistedLabel : '',
    joiningLabel: typeof raw.joiningLabel === 'string' ? raw.joiningLabel : '',
    activeLabel: typeof raw.activeLabel === 'string' ? raw.activeLabel : '',
  };
}

function sanitizePreview(raw: any): SvipPagePreview | null {
  if (!raw || typeof raw !== 'object') return null;
  return {
    nameplateTitle: typeof raw.nameplateTitle === 'string' ? raw.nameplateTitle : '',
    nameplateDescription: typeof raw.nameplateDescription === 'string' ? raw.nameplateDescription : '',
    frameTitle: typeof raw.frameTitle === 'string' ? raw.frameTitle : '',
    frameDescription: typeof raw.frameDescription === 'string' ? raw.frameDescription : '',
  };
}

function sanitizeSprite(raw: any): SvipSpriteSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const cols = Math.floor(num(raw.cols, 0, 1, 16));
  const rows = Math.floor(num(raw.rows, 0, 1, 16));
  const frames = Math.floor(num(raw.frames, 0, 1, 512));
  const stepMs = num(raw.stepMs, 0, 50, 2000);
  if (!cols || !rows || !frames || !stepMs) return null;
  if (frames > cols * rows) return null;
  return { cols, rows, frames, stepMs };
}

function sanitizeReward(raw: any): SvipRewardSlot | null {
  if (!raw || typeof raw !== 'object') return null;
  const slot = Math.floor(num(raw.slot, 0, 1, 12));
  if (!slot) return null;
  const kind = typeof raw.kind === 'string' ? raw.kind : 'empty';
  if (kind === 'empty') return { slot, kind: 'empty' };
  // A filled slot without valid art degrades to an empty outlined box
  // (grid geometry preserved, never a broken image).
  if (!isUrl(raw.art)) return { slot, kind: 'empty' };
  const out: SvipRewardSlot = {
    slot,
    kind,
    id: typeof raw.id === 'string' ? raw.id : undefined,
    label: typeof raw.label === 'string' ? raw.label : undefined,
    art: raw.art,
  };
  const artW = Math.floor(num(raw.artW, 0, 1, 10000));
  const artH = Math.floor(num(raw.artH, 0, 1, 10000));
  if (artW && artH) { out.artW = artW; out.artH = artH; }
  if (kind === 'frame') {
    const sprite = sanitizeSprite(raw.sprite);
    if (sprite) out.sprite = sprite;
  }
  return out;
}

function sanitizeTierPage(raw: any): SvipTierPage {
  if (!raw || typeof raw !== 'object') return {};
  const out: SvipTierPage = {};
  if (isUrl(raw.heroArt)) out.heroArt = raw.heroArt;
  if (isUrl(raw.flowerArt)) out.flowerArt = raw.flowerArt;
  if (isUrl(raw.bannerArt)) out.bannerArt = raw.bannerArt;
  const m = Number(raw.heroMarginTopPx);
  if (Number.isFinite(m)) out.heroMarginTopPx = Math.min(100, Math.max(-100, m));
  if (typeof raw.heroTransparent === 'boolean') out.heroTransparent = raw.heroTransparent;
  if (Array.isArray(raw.rewards)) {
    const rewards = raw.rewards.map(sanitizeReward).filter(Boolean) as SvipRewardSlot[];
    if (rewards.length > 0) out.rewards = rewards.sort((a, b) => a.slot - b.slot);
  }
  return out;
}

/**
 * Validate a raw `svip_page` value. Returns null when the node is absent
 * or malformed (caller shows the honest empty state). Accepts `tiers`
 * as an object keyed by tier number OR as an RTDB-normalised array.
 */
export function sanitizePageConfig(raw: any): SvipPageConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const theme = sanitizeTheme(raw.theme);
  if (!theme) return null;
  const buyBar = sanitizeBuyBar(raw.buyBar);
  if (!buyBar) return null;
  const tiersRaw = raw.tiers;
  const tiers: Record<number, SvipTierPage> = {};
  if (Array.isArray(tiersRaw)) {
    tiersRaw.forEach((entry, idx) => {
      if (idx === 0) return; // RTDB pads numeric-keyed objects with null at 0
      if (entry && typeof entry === 'object') tiers[idx] = sanitizeTierPage(entry);
    });
  } else if (tiersRaw && typeof tiersRaw === 'object') {
    for (const key of Object.keys(tiersRaw)) {
      const n = Number(key);
      if (Number.isFinite(n) && n >= 1) tiers[Math.floor(n)] = sanitizeTierPage(tiersRaw[key]);
    }
  }
  if (Object.keys(tiers).length === 0) return null;
  return {
    version: Math.floor(num(raw.version, 1, 1, 999)),
    theme,
    layout: sanitizeLayout(raw.layout),
    topBar: { title: typeof raw.topBar?.title === 'string' && raw.topBar.title.trim() ? raw.topBar.title.trim() : 'SVIP' },
    buyBar,
    preview: sanitizePreview(raw.preview),
    tiers,
  };
}

/** Live subscription to `svip_page` — sanitised; null = absent/malformed. */
export function subscribeSvipPageConfig(
  cb: (c: SvipPageConfig | null) => void,
  onError?: (e: unknown) => void,
): () => void {
  let detach: (() => void) | null = null;
  let cancelled = false;
  (async () => {
    try {
      const { ref, onValue } = await import('firebase/database');
      const { database } = await import('@/src/config/firebase');
      if (cancelled) return;
      detach = onValue(
        ref(database, 'svip_page'),
        (snap) => { if (!cancelled) cb(sanitizePageConfig(snap.val())); },
        (e) => onError?.(e),
      );
    } catch (e) {
      if (!cancelled) onError?.(e);
    }
  })();
  return () => {
    cancelled = true;
    try { detach?.(); } catch { /* non-critical */ }
  };
}
