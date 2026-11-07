/**
 * glassTokens.ts — Glassmorphism design tokens for Vee (FOUNDATION, Phase 1).
 *
 * Generated through the ui-ux-pro-max skill (candidate generation only):
 * pattern + style + colors + typography + effects + anti-patterns +
 * adapted pre-delivery checklist — see GLASS_RULES.md. Status: CANDIDATES,
 * awaiting his pick. Nothing here is applied to any screen yet.
 *
 * GROUNDING — built on Vee's existing glass language, Seat Style A
 * 'Glass Pod' (src/features/voice-room/components/SeatCard.tsx, boss pick
 * 2026-10-23): frosted disc, gradient ring sky->violet (#7ED0FF->#8E7BFF,
 * gold #FFD964->#F0A92E for host), inner fill #FFFFFF->#D9EFFF, top sheen
 * rgba(255,255,255,0.8), accent shadow opacity 0.28 / radius 7 / y 2.
 * These tokens extend that pod to full-app panels — they do NOT invent a
 * conflicting glass style.
 *
 * BLUR — REAL blur is NOT active. `expo-blur` is NOT in package.json and
 * no BlurView exists anywhere in the tree (app/_layout.tsx already notes
 * "No expo-blur — avatar image at low opacity + dark overlay"). expo-blur
 * is a native module: adding it would need a new native build, which the
 * boss's no-more-builds rule forbids. So every variant below is a
 * TRANSLUCENT FILL + border + sheen + shadow. `blurIntensity` is recorded
 * only as the forward target if a build ever allows real blur again.
 * GlassView degrades gracefully by design: it never imports expo-blur.
 *
 * HEAT RULE (boss standing order): no new timers / intervals / polls /
 * loops / animations. Glass is 100% static styling — zero animation,
 * zero JS work per frame, one translucent layer per surface max.
 */

export type GlassMode = 'light' | 'dark';
export type GlassCandidateId = 'A' | 'B' | 'C';
export type GlassVariant =
  | 'card'
  | 'panel'
  | 'modal'
  | 'nav'
  | 'chip'
  | 'seat';

export type GlassVariantTokens = {
  /** Translucent fill, e.g. 'rgba(255,255,255,0.55)'. */
  fill: string;
  /** Border colour (light, translucent white / dark faint white). */
  border: string;
  borderWidth: number;
  /** Top-edge inner highlight ("sheen") colour. */
  sheen: string;
  /** Shadow colour / opacity / radius / y-offset (iOS) + elevation (Android). */
  shadowColor: string;
  shadowOpacity: number;
  shadowRadius: number;
  shadowOffsetY: number;
  elevation: number;
  borderRadius: number;
  /** Forward target only — NOT active (no expo-blur, see header). */
  blurIntensity: number;
};

export type GlassCandidate = {
  id: GlassCandidateId;
  name: string;
  /** One-line character of this candidate. */
  character: string;
  /** Where this candidate wins / where it loses. */
  bestFor: string;
  risk: string;
  light: Record<GlassVariant, GlassVariantTokens>;
  dark: Record<GlassVariant, GlassVariantTokens>;
  /** Gradient ring colours (Style A pod ring). [start, end]; gold = host. */
  ring: [string, string];
  ringGold: [string, string];
};

/* Shared per-variant geometry (same across candidates — only the
   fill/border/shadow strengths differ). Radii follow the pod: round
   seats, soft cards, full-pill chips. */
const RADII: Record<GlassVariant, number> = {
  card: 16,
  panel: 20,
  modal: 24,
  nav: 28,
  chip: 999,
  seat: 999,
};

function v(
  fill: string,
  border: string,
  sheen: string,
  shadowColor: string,
  shadowOpacity: number,
  shadowRadius: number,
  shadowOffsetY: number,
  elevation: number,
  radius: number,
  blurIntensity: number,
): GlassVariantTokens {
  return {
    fill,
    border,
    borderWidth: 1,
    sheen,
    shadowColor,
    shadowOpacity,
    shadowRadius,
    shadowOffsetY,
    elevation,
    borderRadius: radius,
    blurIntensity,
  };
}

/* ── Candidate A — "Pod Glass" (RECOMMENDED) ──────────────────────────
   Direct extension of the approved Glass Pod. Mid fills, white border,
   pod shadow. Reads as Vee, only more premium. */
const CANDIDATE_A: GlassCandidate = {
  id: 'A',
  name: 'Pod Glass',
  character: 'The Glass Pod, grown up: frosted white, sky-violet ring, soft shadow.',
  bestFor: 'Every screen — the default. Closest to the approved seat look.',
  risk: 'Low. On the busiest scene backgrounds (scene-sunset / scene-rain) small text needs the +0.15 opacity boost (see resolveGlassTheme).',
  ring: ['#7ED0FF', '#8E7BFF'],
  ringGold: ['#FFD964', '#F0A92E'],
  light: {
    card: v('rgba(255,255,255,0.55)', 'rgba(255,255,255,0.65)', 'rgba(255,255,255,0.80)', 'rgba(15,23,42,0.10)', 0.10, 16, 4, 3, RADII.card, 20),
    panel: v('rgba(255,255,255,0.62)', 'rgba(255,255,255,0.65)', 'rgba(255,255,255,0.80)', 'rgba(15,23,42,0.10)', 0.10, 16, 4, 3, RADII.panel, 20),
    modal: v('rgba(255,255,255,0.72)', 'rgba(255,255,255,0.70)', 'rgba(255,255,255,0.85)', 'rgba(15,23,42,0.14)', 0.14, 20, 6, 5, RADII.modal, 20),
    nav: v('rgba(255,255,255,0.68)', 'rgba(255,255,255,0.60)', 'rgba(255,255,255,0.75)', 'rgba(15,23,42,0.10)', 0.10, 18, -2, 4, RADII.nav, 20),
    chip: v('rgba(255,255,255,0.45)', 'rgba(255,255,255,0.55)', 'rgba(255,255,255,0.70)', 'rgba(15,23,42,0.08)', 0.08, 8, 2, 1, RADII.chip, 20),
    seat: v('rgba(255,255,255,0.70)', 'rgba(255,255,255,0.80)', 'rgba(255,255,255,0.80)', 'rgba(74,144,217,0.28)', 0.28, 7, 2, 3, RADII.seat, 20),
  },
  dark: {
    card: v('rgba(16,17,20,0.55)', 'rgba(255,255,255,0.14)', 'rgba(255,255,255,0.12)', 'rgba(0,0,0,0.45)', 0.45, 16, 4, 3, RADII.card, 20),
    panel: v('rgba(16,17,20,0.62)', 'rgba(255,255,255,0.14)', 'rgba(255,255,255,0.12)', 'rgba(0,0,0,0.45)', 0.45, 16, 4, 3, RADII.panel, 20),
    modal: v('rgba(16,17,20,0.72)', 'rgba(255,255,255,0.16)', 'rgba(255,255,255,0.14)', 'rgba(0,0,0,0.50)', 0.50, 20, 6, 5, RADII.modal, 20),
    nav: v('rgba(16,17,20,0.68)', 'rgba(255,255,255,0.12)', 'rgba(255,255,255,0.10)', 'rgba(0,0,0,0.45)', 0.45, 18, -2, 4, RADII.nav, 20),
    chip: v('rgba(16,17,20,0.45)', 'rgba(255,255,255,0.12)', 'rgba(255,255,255,0.10)', 'rgba(0,0,0,0.40)', 0.40, 8, 2, 1, RADII.chip, 20),
    seat: v('rgba(16,17,20,0.70)', 'rgba(255,255,255,0.16)', 'rgba(255,255,255,0.12)', 'rgba(0,0,0,0.50)', 0.50, 7, 2, 3, RADII.seat, 20),
  },
};

/* ── Candidate B — "Frost Deep" ───────────────────────────────────────
   Heavier frost: higher fills, stronger border, deeper shadow. Maximum
   readability on busy / animated backgrounds; looks more solid, less airy. */
const CANDIDATE_B: GlassCandidate = {
  id: 'B',
  name: 'Frost Deep',
  character: 'Thick frost: milky panels, crisp border, deep shadow. Safest text.',
  bestFor: 'Voice Room scene themes, modals over chat, any surface over a photo or animation.',
  risk: 'Can feel heavy / less "glass" on plain light screens — background barely shows through.',
  ring: ['#5EB8FF', '#7C5CFF'],
  ringGold: ['#FFD964', '#F0A92E'],
  light: {
    card: v('rgba(255,255,255,0.72)', 'rgba(255,255,255,0.85)', 'rgba(255,255,255,0.90)', 'rgba(15,23,42,0.16)', 0.16, 20, 5, 4, RADII.card, 30),
    panel: v('rgba(255,255,255,0.78)', 'rgba(255,255,255,0.85)', 'rgba(255,255,255,0.90)', 'rgba(15,23,42,0.16)', 0.16, 20, 5, 4, RADII.panel, 30),
    modal: v('rgba(255,255,255,0.85)', 'rgba(255,255,255,0.88)', 'rgba(255,255,255,0.92)', 'rgba(15,23,42,0.18)', 0.18, 24, 8, 6, RADII.modal, 30),
    nav: v('rgba(255,255,255,0.80)', 'rgba(255,255,255,0.80)', 'rgba(255,255,255,0.85)', 'rgba(15,23,42,0.16)', 0.16, 20, -2, 5, RADII.nav, 30),
    chip: v('rgba(255,255,255,0.62)', 'rgba(255,255,255,0.75)', 'rgba(255,255,255,0.85)', 'rgba(15,23,42,0.12)', 0.12, 10, 2, 2, RADII.chip, 30),
    seat: v('rgba(255,255,255,0.82)', 'rgba(255,255,255,0.88)', 'rgba(255,255,255,0.90)', 'rgba(74,144,217,0.32)', 0.32, 8, 2, 4, RADII.seat, 30),
  },
  dark: {
    card: v('rgba(16,17,20,0.72)', 'rgba(255,255,255,0.18)', 'rgba(255,255,255,0.14)', 'rgba(0,0,0,0.50)', 0.50, 20, 5, 4, RADII.card, 30),
    panel: v('rgba(16,17,20,0.78)', 'rgba(255,255,255,0.18)', 'rgba(255,255,255,0.14)', 'rgba(0,0,0,0.50)', 0.50, 20, 5, 4, RADII.panel, 30),
    modal: v('rgba(16,17,20,0.85)', 'rgba(255,255,255,0.20)', 'rgba(255,255,255,0.16)', 'rgba(0,0,0,0.55)', 0.55, 24, 8, 6, RADII.modal, 30),
    nav: v('rgba(16,17,20,0.80)', 'rgba(255,255,255,0.16)', 'rgba(255,255,255,0.12)', 'rgba(0,0,0,0.50)', 0.50, 20, -2, 5, RADII.nav, 30),
    chip: v('rgba(16,17,20,0.62)', 'rgba(255,255,255,0.16)', 'rgba(255,255,255,0.12)', 'rgba(0,0,0,0.45)', 0.45, 10, 2, 2, RADII.chip, 30),
    seat: v('rgba(16,17,20,0.82)', 'rgba(255,255,255,0.20)', 'rgba(255,255,255,0.14)', 'rgba(0,0,0,0.55)', 0.55, 8, 2, 4, RADII.seat, 30),
  },
};

/* ── Candidate C — "Air Light" ────────────────────────────────────────
   Barely-there glass: low fills, hairline border, whisper shadow.
   Maximum background show-through; the most premium-feeling on calm
   screens — and the riskiest for text. Text scrim mandatory. */
const CANDIDATE_C: GlassCandidate = {
  id: 'C',
  name: 'Air Light',
  character: 'Whisper glass: the background stays the star, panels float.',
  bestFor: 'Login hero, Home top bar, calm light screens with a plain backdrop.',
  risk: 'Highest readability risk — NEVER use over photos, scenes, or busy lists without a scrim; small secondary text can wash out.',
  ring: ['#A8DCFF', '#B9A8FF'],
  ringGold: ['#FFE08A', '#F5C04E'],
  light: {
    card: v('rgba(255,255,255,0.38)', 'rgba(255,255,255,0.45)', 'rgba(255,255,255,0.65)', 'rgba(15,23,42,0.06)', 0.06, 12, 3, 2, RADII.card, 12),
    panel: v('rgba(255,255,255,0.45)', 'rgba(255,255,255,0.48)', 'rgba(255,255,255,0.65)', 'rgba(15,23,42,0.06)', 0.06, 12, 3, 2, RADII.panel, 12),
    modal: v('rgba(255,255,255,0.55)', 'rgba(255,255,255,0.55)', 'rgba(255,255,255,0.70)', 'rgba(15,23,42,0.08)', 0.08, 14, 4, 3, RADII.modal, 12),
    nav: v('rgba(255,255,255,0.50)', 'rgba(255,255,255,0.45)', 'rgba(255,255,255,0.60)', 'rgba(15,23,42,0.06)', 0.06, 12, -2, 2, RADII.nav, 12),
    chip: v('rgba(255,255,255,0.32)', 'rgba(255,255,255,0.40)', 'rgba(255,255,255,0.55)', 'rgba(15,23,42,0.05)', 0.05, 6, 1, 1, RADII.chip, 12),
    seat: v('rgba(255,255,255,0.55)', 'rgba(255,255,255,0.60)', 'rgba(255,255,255,0.70)', 'rgba(74,144,217,0.20)', 0.20, 6, 2, 2, RADII.seat, 12),
  },
  dark: {
    card: v('rgba(16,17,20,0.38)', 'rgba(255,255,255,0.10)', 'rgba(255,255,255,0.08)', 'rgba(0,0,0,0.35)', 0.35, 12, 3, 2, RADII.card, 12),
    panel: v('rgba(16,17,20,0.45)', 'rgba(255,255,255,0.10)', 'rgba(255,255,255,0.08)', 'rgba(0,0,0,0.35)', 0.35, 12, 3, 2, RADII.panel, 12),
    modal: v('rgba(16,17,20,0.55)', 'rgba(255,255,255,0.12)', 'rgba(255,255,255,0.10)', 'rgba(0,0,0,0.40)', 0.40, 14, 4, 3, RADII.modal, 12),
    nav: v('rgba(16,17,20,0.50)', 'rgba(255,255,255,0.10)', 'rgba(255,255,255,0.08)', 'rgba(0,0,0,0.35)', 0.35, 12, -2, 2, RADII.nav, 12),
    chip: v('rgba(16,17,20,0.32)', 'rgba(255,255,255,0.08)', 'rgba(255,255,255,0.06)', 'rgba(0,0,0,0.30)', 0.30, 6, 1, 1, RADII.chip, 12),
    seat: v('rgba(16,17,20,0.55)', 'rgba(255,255,255,0.12)', 'rgba(255,255,255,0.10)', 'rgba(0,0,0,0.40)', 0.40, 6, 2, 2, RADII.seat, 12),
  },
};

export const GLASS_CANDIDATES: Record<GlassCandidateId, GlassCandidate> = {
  A: CANDIDATE_A,
  B: CANDIDATE_B,
  C: CANDIDATE_C,
};

/** The foundation default: Candidate A (Pod Glass). Change only on his pick. */
export const DEFAULT_GLASS_CANDIDATE: GlassCandidateId = 'A';

export function getGlassCandidate(id: GlassCandidateId): GlassCandidate {
  return GLASS_CANDIDATES[id] ?? GLASS_CANDIDATES.A;
}

export function getGlassTokens(
  variant: GlassVariant,
  mode: GlassMode,
  candidate: GlassCandidateId = DEFAULT_GLASS_CANDIDATE,
): GlassVariantTokens {
  const c = getGlassCandidate(candidate);
  return (mode === 'dark' ? c.dark : c.light)[variant];
}

/* ── Theme adaptation ────────────────────────────────────────────────
   Vee has TWO theme axes, both must feed the glass:
   1. App dark mode — ThemeContext `darkMode` (default false = light).
      Picks the light/dark token table above.
   2. Room themes — 16 entries in src/features/voice-room/constants/
      theme.ts (ROOM_THEMES): 15 light + exactly ONE dark ('midnight'),
      6 of them animated scenes. Server can recolour/add themes via RTDB
      `room_themes/{themeId}` — so NEVER hardcode a theme id's colours
      here; resolve from the theme object passed in at runtime.
   TEXT READABILITY — the rule that decides everything:
   - Text on glass ALWAYS uses the active theme's onBg / onBgSub
     (#111827/#64748B on imo-light; theme-provided elsewhere), never a
     fixed white or black. The glass fill is what adapts, not the text.
   - `fillBoost` raises the fill opacity when the backdrop is busy:
     +0.15 on animated scene themes, +0.08 on very light backdrops
     (luminance > 0.85, e.g. imo-light #FFFFFF), +0.00 otherwise.
   - `scrim` is an extra flat translucent layer placed UNDER text (never
     over art): light themes get the theme surface at 0.5, dark themes get
     black at 0.35. Mandatory for Candidate C and for any text over a
     scene; optional for A/B on calm screens.
   - Midnight is the ONLY dark room theme: it always resolves to the dark
     token table with light text (#F8FAFC / #94A3B8).
   - No theme gets a solid fallback EXCEPT the special cases in
     GLASS_RULES.md (full-screen photos, gift animations) — glass stays
     translucent everywhere else, with the boost doing the work. */
export type RoomThemeInput = {
  id: string;
  bg: string;
  surface: string;
  onBg: string;
  onBgSub: string;
  accent: string;
  /** Present on the 6 animated scene themes. */
  scene?: string;
};

export type ResolvedGlass = {
  mode: GlassMode;
  candidate: GlassCandidate;
  /** 0..0.30 — add to the fill alpha of every variant on this screen. */
  fillBoost: number;
  /** Flat translucent layer under text when the backdrop is busy. */
  scrim: string | null;
  text: string;
  subtext: string;
  accent: string;
  /** True when the backdrop is an animated scene. */
  isScene: boolean;
};

/** Relative luminance of a #RRGGBB colour (0 = black, 1 = white). */
export function hexLuminance(hex: string): number {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return 1;
  const n = parseInt(m[1], 10);
  const ch = (v: number): number => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Bump an rgba() fill's alpha by `boost`, clamped to 0.92. */
export function boostFillAlpha(fill: string, boost: number): string {
  if (boost <= 0) return fill;
  const m = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([0-9.]+)\s*\)$/.exec(fill);
  if (!m) return fill;
  const alpha = Math.min(0.92, parseFloat(m[4]) + boost);
  return `rgba(${m[1]},${m[2]},${m[3]},${alpha.toFixed(2)})`;
}

export function resolveGlassTheme(
  theme: RoomThemeInput,
  darkMode: boolean,
  candidate: GlassCandidateId = DEFAULT_GLASS_CANDIDATE,
): ResolvedGlass {
  const isMidnight = theme.id === 'midnight';
  const mode: GlassMode = darkMode || isMidnight ? 'dark' : 'light';
  const isScene = typeof theme.scene === 'string' && theme.scene.length > 0;
  const bgLum = hexLuminance(theme.bg);
  let fillBoost = 0;
  if (isScene) fillBoost += 0.15;
  if (!isScene && bgLum > 0.85) fillBoost += 0.08;
  const scrim =
    isScene || candidate === 'C'
      ? mode === 'dark'
        ? 'rgba(0,0,0,0.35)'
        : 'rgba(255,255,255,0.50)'
      : null;
  return {
    mode,
    candidate: getGlassCandidate(candidate),
    fillBoost,
    scrim,
    text: mode === 'dark' ? '#F8FAFC' : theme.onBg,
    subtext: mode === 'dark' ? '#94A3B8' : theme.onBgSub,
    accent: theme.accent,
    isScene,
  };
}

/** Convenience: variant tokens already boosted for the resolved theme. */
export function getThemedGlassTokens(
  resolved: ResolvedGlass,
  variant: GlassVariant,
): GlassVariantTokens {
  const base = getGlassTokens(variant, resolved.mode, resolved.candidate.id);
  if (resolved.fillBoost <= 0) return base;
  return { ...base, fill: boostFillAlpha(base.fill, resolved.fillBoost) };
}
