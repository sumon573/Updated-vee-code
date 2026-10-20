/**
 * Noble (Nobel) service — NOTE 10 (2026-10-11).
 *
 * Noble XP grows ONLY from real diamonds sent as gifts in voice rooms
 * (hooked in walletService.sendGiftViaFirebase). Self-gifts do NOT count
 * (anti-farming).
 *
 * Data model — users/{uid}/noble (single node, updated in ONE atomic
 * runTransaction per gift, so concurrent gifts can never double-count):
 *   xp                   lifetime XP (diamonds sent, excl. self-gifts)
 *   rankIndex            highest achieved rank (0=Knight … 9=SSKing)
 *   maintenanceRequired  XP that must be sent inside the current window
 *                        to keep the rank secured (= ceil(rankMinXP / 2);
 *                        e.g. Baron 1260 → 630, matching the IMO reference)
 *   maintenanceDeadline  epoch ms when the current 30-day window ends
 *   maintenanceXP        XP sent inside the current window
 *   lapsed               true when a window expired without meeting the
 *                        requirement — privileges are suspended until the
 *                        current window's requirement is met again
 *
 * Rank-ups grant REAL items (official source) via badgeService:
 *   Noble Nameplate → Honor → Nameplate tab (equippable)
 *   Noble Badge     → Honor → Badge tab (Verification section)
 *   Noble Avatar Frame (Count and above) → Decoration → Frames tab
 * Grants use fixed IDs (noble-plate-{rank} etc.) so concurrent rank-ups
 * are idempotent.
 *
 * Privileges with no full code path yet (Microphone Ripple, Upgrade Banner,
 * Homepage Skin) are flagged enforced:false and the UI shows them honestly
 * as locked — never as unlocked-but-dead. Noble Gift is enforced via
 * noble-gated gift catalog (minNobleRank); Seat Priority has the pure
 * ranking rule (pickSeatByNoblePriority) with seat-claim integration
 * owned by the voice-room flow.
 */
import { ref, onValue, get, set, update, runTransaction, remove } from 'firebase/database';
import { database } from '../config/firebase';
import { grantBadge, grantFrame, grantNameplate, grantRipple, grantEntryEffect } from './badgeService';
import { rewardsForRank, rewardIcon } from './nobleRewardsCatalog';

export const NOBLE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export type PrivilegeKey =
  | 'nameplate'
  | 'badge'
  | 'gift'
  | 'avatarFrame'
  | 'entryEffects'
  | 'micRipple'
  | 'seatPriority'
  | 'upgradeBanner'
  | 'homepageSkin';

export interface PrivilegeDef {
  key: PrivilegeKey;
  name: string;
  icon: string;
  /** First rank index (0-based) that grants this privilege */
  minRankIndex: number;
  /** False when no real code path enforces this privilege yet */
  enforced: boolean;
}

/* Privilege unlock indices — EXACT from IMO's My Nobel video (2026-10-20):
 * nameplate Knight(0) · badge/gift Baron(1) · avatarFrame Viscount(2) ·
 * entryEffects Count(3) · homepageSkin Duke(5) · micRipple RoyalDuke(6) ·
 * seatPriority King(7) · upgradeBanner SKing(8). */
export const PRIVILEGES: PrivilegeDef[] = [
  { key: 'nameplate',    name: 'Noble Nameplate',   icon: '🎖️', minRankIndex: 0, enforced: true  },
  { key: 'badge',        name: 'Noble Badge',       icon: '🛡️', minRankIndex: 1, enforced: true  },
  { key: 'gift',         name: 'Noble Gift',        icon: '🎁', minRankIndex: 1, enforced: true  },
  { key: 'avatarFrame',  name: 'Avatar Frame',      icon: '🖼️', minRankIndex: 2, enforced: true  },
  { key: 'entryEffects', name: 'Fancy Entry Effects', icon: '✨', minRankIndex: 3, enforced: true },
  { key: 'micRipple',    name: 'Microphone Ripple', icon: '🎤', minRankIndex: 6, enforced: false },
  { key: 'seatPriority', name: 'Seat Priority',     icon: '💺', minRankIndex: 7, enforced: true  },
  { key: 'upgradeBanner', name: 'Upgrade Banner',  icon: '🚩', minRankIndex: 8, enforced: false },
  { key: 'homepageSkin',  name: 'Homepage Skin',    icon: '🏠', minRankIndex: 5, enforced: false },
];

export interface NobleRank {
  key: string;
  name: string;
  minXP: number;
  maxXP: number;
  color: string;
  privileges: PrivilegeKey[];
  /** IMO "Prop Level" for entry effects (1-5) and upgrade banner (2) — 2026-10-20. */
  propLevels?: Partial<Record<'entryEffects' | 'upgradeBanner', number>>;
}

/**
 * IMO Prop Level for a privilege at a rank (0 when the rank lacks it).
 * e.g. propLevelFor(9, 'entryEffects') === 5 (SSKing, Entry ★5).
 */
export function propLevelFor(rankIndex: number, key: 'entryEffects' | 'upgradeBanner'): number {
  const rank = NOBLE_RANKS[Math.max(0, Math.min(rankIndex, NOBLE_RANKS.length - 1))];
  return rank?.propLevels?.[key] ?? 0;
}

/* ── Per-rank artwork on Vee's VPS (uploaded 2026-10-20, from IMO's video) ──
 * https://vee-club.duckdns.org/nobel-art/rank-{slug}-{nameplate,badge,frame}.png
 * slug: knight|baron|viscount|count|marquis|duke|rduke|king|sking|ssking
 * Components use nobleArtUrl() and fall back to the color theme when an
 * image fails to load — never a broken image. */
export const NOBEL_ART_BASE = 'https://vee-club.duckdns.org/nobel-art';
const NOBLE_ART_SLUGS = ['knight', 'baron', 'viscount', 'count', 'marquis', 'duke', 'rduke', 'king', 'sking', 'ssking'];

export function nobleArtUrl(
  rankIndex: number,
  kind: 'nameplate' | 'badge' | 'frame',
): string | null {
  if (rankIndex < 0 || rankIndex >= NOBLE_RANKS.length) return null;
  const slug = NOBLE_ART_SLUGS[rankIndex];
  const priv: PrivilegeKey = kind === 'nameplate' ? 'nameplate' : kind === 'badge' ? 'badge' : 'avatarFrame';
  if (!NOBLE_RANKS[rankIndex].privileges.includes(priv)) return null;
  return `${NOBEL_ART_BASE}/rank-${slug}-${kind}.png`;
}

/** URL of the rank badge image for the entry effect (Count+ always have badge). */
export function nobleEntryBadgeUrl(rankIndex: number): string | null {
  return nobleArtUrl(rankIndex, 'badge');
}

/** Rank index for a rank key ('count' → 3); -1 when unknown. */
export function rankIndexForKey(key: string): number {
  return NOBLE_RANKS.findIndex((r) => r.key === key);
}

/**
 * First rank whose Nobel visuals are ANIMATED (2026-10-20, boss's order):
 * Count (index 3) and above — nameplate shimmer, badge glow + sparkles,
 * frame rotating sparkles, entry-effect sparkle burst. Baron/Viscount
 * visuals stay static, matching IMO (entry effects start at Count).
 */
export const NOBLE_ANIMATED_MIN_RANK = 3;
export function nobleVisualsAnimated(rankIndex: number): boolean {
  return rankIndex >= NOBLE_ANIMATED_MIN_RANK;
}

/**
 * Rank thresholds — EXACT values read from IMO's My Noble page video
 * (2026-10-20, boss's screen recording):
 * Baron 1260~8399 | Viscount 8400~83999 | Count 84000~251999 |
 * Marquis 252000~587999 | Duke 588000~1259999 | Royal Duke 1260K~4200K |
 * King 4200K~12600K | SKing 12600K~42000K | SSKing 42000K+.
 *
 * Privilege unlock order (exact, from the video's Noble Privileges grid):
 * Baron → Nameplate, Badge, Gift
 * Viscount → + Avatar Frame
 * Count → + Fancy Entry Effects (Prop Level ★1)
 * Marquis → Entry ★2
 * Duke → + Homepage Skin (Entry ★3)
 * Royal Duke → + Microphone Ripple (Entry ★4)
 * King → + Seat Priority (Entry ★4)
 * SKing → + Upgrade Banner (Entry ★4, Banner ★2)
 * SSKing → Entry ★5, Banner ★2
 */
export const NOBLE_RANKS: NobleRank[] = [
  { key: 'knight',    name: 'Knight',     minXP: 0,         maxXP: 1259,       color: '#8BC34A', privileges: ['nameplate'] },
  { key: 'baron',     name: 'Baron',      minXP: 1260,      maxXP: 8399,       color: '#26A69A', privileges: ['nameplate', 'badge', 'gift'] },
  { key: 'viscount',  name: 'Viscount',   minXP: 8400,      maxXP: 83999,      color: '#42A5F5', privileges: ['nameplate', 'badge', 'gift', 'avatarFrame'] },
  { key: 'count',     name: 'Count',      minXP: 84000,     maxXP: 251999,     color: '#7E57C2', privileges: ['nameplate', 'badge', 'gift', 'avatarFrame', 'entryEffects'], propLevels: { entryEffects: 1 } },
  { key: 'marquis',   name: 'Marquis',    minXP: 252000,    maxXP: 587999,    color: '#EC407A', privileges: ['nameplate', 'badge', 'gift', 'avatarFrame', 'entryEffects'], propLevels: { entryEffects: 2 } },
  { key: 'duke',      name: 'Duke',       minXP: 588000,    maxXP: 1259999,   color: '#FF7043', privileges: ['nameplate', 'badge', 'gift', 'avatarFrame', 'entryEffects', 'homepageSkin'], propLevels: { entryEffects: 3 } },
  { key: 'royalDuke', name: 'Royal Duke', minXP: 1260000,   maxXP: 4200000,   color: '#FFA000', privileges: ['nameplate', 'badge', 'gift', 'avatarFrame', 'entryEffects', 'micRipple', 'homepageSkin'], propLevels: { entryEffects: 4 } },
  { key: 'king',      name: 'King',       minXP: 4200001,   maxXP: 12600000,  color: '#FBC02D', privileges: ['nameplate', 'badge', 'gift', 'avatarFrame', 'entryEffects', 'micRipple', 'homepageSkin', 'seatPriority'], propLevels: { entryEffects: 4 } },
  { key: 'sking',     name: 'SKing',      minXP: 12600001,  maxXP: 42000000,  color: '#E65100', privileges: ['nameplate', 'badge', 'gift', 'avatarFrame', 'entryEffects', 'micRipple', 'homepageSkin', 'seatPriority', 'upgradeBanner'], propLevels: { entryEffects: 4, upgradeBanner: 2 } },
  { key: 'ssking',    name: 'SSKing',     minXP: 42000001,  maxXP: Number.MAX_SAFE_INTEGER, color: '#BF360C',
    privileges: ['nameplate', 'badge', 'gift', 'avatarFrame', 'entryEffects', 'micRipple', 'homepageSkin', 'seatPriority', 'upgradeBanner'], propLevels: { entryEffects: 5, upgradeBanner: 2 } },
];

/**
 * 2026-10-15 (Sumon): per-rank visual identity — EVERY noble rank gets its
 * OWN entry effect + speaking ripple. Derived from the rank color.
 */
export interface NobleVisualTheme {
  entryGradient: [string, string];
  entryIcon: string;
  rippleWave: string;
  rippleMist: string[];
  rippleParticles: string[];
  // 2026-10-16 (Sumon): Per-rank distinct effect — each rank has its own
  // premium/gorgeous effect type. Higher rank = more spectacular.
  rippleEffect: 'leaves' | 'droplets' | 'snow' | 'stars' | 'petals' | 'flames' | 'coins' | 'crowns' | 'sparks' | 'diamonds';
  rippleWaveCount: number;  // Distinct wave count per rank
}
function themeFor(
  color: string,
  entryIcon: string,
  particles: string[],
  effect: NobleVisualTheme['rippleEffect'],
  waveCount: number,
): NobleVisualTheme {
  return {
    entryGradient: [color, lightenHex(color, 60)],
    entryIcon,
    rippleWave: color,
    rippleMist: [color, lightenHex(color, 40), lightenHex(color, 80)],
    rippleParticles: particles,
    rippleEffect: effect,
    rippleWaveCount: waveCount,
  };
}
function lightenHex(hex: string, amt: number): string {
  const n = hex.replace('#', '');
  const full = n.length === 3 ? n.split('').map((c) => c + c).join('') : n;
  const num = parseInt(full, 16);
  if (!Number.isFinite(num)) return hex;
  const r = Math.min(255, ((num >> 16) & 0xff) + amt);
  const g = Math.min(255, ((num >> 8) & 0xff) + amt);
  const b = Math.min(255, (num & 0xff) + amt);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
export const NOBLE_THEMES: NobleVisualTheme[] = [
  // 2026-10-16 (Sumon): Each rank = distinct premium effect. Higher = more gorgeous.
  themeFor('#8BC34A', '\uD83D\uDEE1\uFE0F', ['\uD83C\uDF43', '\uD83C\uDF3F', '☘️'], 'leaves', 2),
  themeFor('#26A69A', '⚔️', ['\uD83D\uDCA7', '\uD83D\uDCA6', '\uD83C\uDF0A'], 'droplets', 2),
  themeFor('#42A5F5', '\uD83D\uDD37', ['✨', '\uD83D\uDCAB', '❄️'], 'snow', 3),
  themeFor('#7E57C2', '\uD83D\uDD2E', ['⭐', '\uD83C\uDF1F', '\uD83D\uDC9C'], 'stars', 3),
  themeFor('#EC407A', '\uD83C\uDF39', ['\uD83C\uDF38', '\uD83D\uDC97', '\uD83E\uDD69'], 'petals', 3),
  themeFor('#FF7043', '\uD83D\uDD25', ['\uD83D\uDD25', '\uD83E\uDDE1', '⚡'], 'flames', 4),
  themeFor('#FFA000', '\uD83E\uDE99', ['\uD83E\uDE99', '✨', '\uD83C\uDF1F'], 'coins', 4),
  themeFor('#FBC02D', '\uD83D\uDC51', ['\uD83D\uDC51', '✨', '\uD83D\uDC9B'], 'crowns', 4),
  themeFor('#E65100', '\uD83D\uDCA5', ['\uD83D\uDCA5', '\uD83D\uDD25', '⚡'], 'sparks', 5),
  themeFor('#BF360C', '\uD83D\uDC8E', ['\uD83D\uDC8E', '\uD83D\uDC51', '✨'], 'diamonds', 5),
];
export function nobleThemeFor(rankIndex: number): NobleVisualTheme | null {
  if (rankIndex < 0 || rankIndex >= NOBLE_THEMES.length) return null;
  return NOBLE_THEMES[rankIndex];
}

export interface NobleState {
  xp: number;
  rankIndex: number;
  maintenanceRequired: number;
  maintenanceDeadline: number;
  maintenanceXP: number;
  lapsed: boolean;
}

export function rankIndexForXP(xp: number): number {
  for (let i = NOBLE_RANKS.length - 1; i >= 0; i--) {
    if (xp >= NOBLE_RANKS[i].minXP) return i;
  }
  return 0;
}

/** XP that must be sent inside a 30-day window to keep a rank secured. */
export function maintenanceFor(rankIndex: number): number {
  const minXP = NOBLE_RANKS[Math.max(0, Math.min(rankIndex, NOBLE_RANKS.length - 1))].minXP;
  return Math.ceil(minXP / 2);
}

function coerceState(raw: unknown): NobleState | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.xp !== 'number' || typeof s.rankIndex !== 'number') return null;
  return {
    xp: s.xp,
    rankIndex: Math.max(0, Math.min(9, Math.floor(s.rankIndex))),
    maintenanceRequired: typeof s.maintenanceRequired === 'number' ? s.maintenanceRequired : 0,
    maintenanceDeadline: typeof s.maintenanceDeadline === 'number' ? s.maintenanceDeadline : 0,
    maintenanceXP: typeof s.maintenanceXP === 'number' ? s.maintenanceXP : 0,
    lapsed: s.lapsed === true,
  };
}

/**
 * Pure transaction body: apply one gift's XP to the noble state.
 * Handles first-gift init, 30-day window rollover (with lapse marking),
 * rank-ups (fresh maintenance window) and un-lapsing.
 */
function applyNobleGift(cur: unknown, price: number, now: number): NobleState {
  let s: NobleState = coerceState(cur) ?? {
    xp: 0,
    rankIndex: 0,
    maintenanceRequired: maintenanceFor(0),
    maintenanceDeadline: now + NOBLE_WINDOW_MS,
    maintenanceXP: 0,
    lapsed: false,
  };
  // Roll over expired windows (guard caps very long absences).
  // 2026-10-15 (Sumon): DEMOTION — if the 30-day maintenance was NOT met,
  // the noble DROPS ONE RANK (not just "lapsed"). XP is capped to the new
  // rank's ceiling so the demotion sticks (no instant re-rank on next gift).
  let guard = 0;
  while (now > s.maintenanceDeadline && guard++ < 240) {
    const prev: NobleState = s;
    const maintained: boolean = prev.maintenanceXP >= prev.maintenanceRequired;
    if (maintained) {
      s = {
        xp: prev.xp,
        rankIndex: prev.rankIndex,
        maintenanceRequired: prev.maintenanceRequired,
        maintenanceDeadline: prev.maintenanceDeadline + NOBLE_WINDOW_MS,
        maintenanceXP: 0,
        lapsed: false,
      };
    } else {
      const newRank = Math.max(0, prev.rankIndex - 1);
      const newMaxXP = NOBLE_RANKS[newRank].maxXP;
      s = {
        xp: Math.min(prev.xp, newMaxXP),
        rankIndex: newRank,
        maintenanceRequired: maintenanceFor(newRank),
        maintenanceDeadline: prev.maintenanceDeadline + NOBLE_WINDOW_MS,
        maintenanceXP: 0,
        lapsed: false,
      };
    }
  }
  const xp = s.xp + price;
  const maxRank = rankIndexForXP(xp);
  if (maxRank > s.rankIndex) {
    // RANK UP — fresh 30-day window; this gift counts toward it.
    return {
      xp,
      rankIndex: maxRank,
      maintenanceRequired: maintenanceFor(maxRank),
      maintenanceDeadline: now + NOBLE_WINDOW_MS,
      maintenanceXP: price,
      lapsed: false,
    };
  }
  const maintenanceXP = s.maintenanceXP + price;
  return {
    xp,
    rankIndex: s.rankIndex,
    maintenanceRequired: s.maintenanceRequired,
    maintenanceDeadline: s.maintenanceDeadline,
    maintenanceXP,
    lapsed: false,
  };
}

/** Grant the real items a noble rank bestows (idempotent fixed IDs). */
async function grantNobleRankItems(uid: string, rankIndex: number): Promise<void> {
  const rank = NOBLE_RANKS[rankIndex];
  if (!rank) return;
  /* 2026-10-15 (Sumon): Read designs from the central catalog —
   * when Sumon provides designs, plug URLs there and grants use them automatically. */
  const catalog = rewardsForRank(rankIndex);
  const now = Date.now();
  const desc = `Noble privilege — earned by reaching ${rank.name} rank.`;
  await grantNameplate(uid, {
    id: `noble-plate-${rank.key}`,
    name: `${rank.name} Nameplate`,
    icon: catalog ? rewardIcon(catalog.nameplate) : '🎖️',
    obtainedAt: now,
    validity: now + NOBLE_WINDOW_MS, // 2026-10-16 (Sumon): 30-day validity, expires with rank
    source: 'official',
    description: desc,
    grantedBy: 'noble-system',
  });
  if (catalog?.badge) {
    await grantBadge(uid, {
      id: `noble-badge-${rank.key}`,
      name: `${rank.name} Noble`,
      icon: rewardIcon(catalog.badge),
      obtainedAt: now,
      validity: now + NOBLE_WINDOW_MS, // 2026-10-16 (Sumon): 30-day validity, expires with rank
      source: 'official',
      description: desc,
      howToGet: 'Send diamonds as gifts in voice rooms to earn Noble XP.',
      grantedBy: 'noble-system',
    });
  }
  if (catalog?.frame) {
    await grantFrame(uid, {
      id: `noble-frame-${rank.key}`,
      name: `${rank.name} Frame`,
      icon: rewardIcon(catalog.frame),
      obtainedAt: now,
      validity: now + NOBLE_WINDOW_MS, // 2026-10-16 (Sumon): 30-day validity, expires with rank
      source: 'official',
      description: desc,
      grantedBy: 'noble-system',
    });
  }
  if (catalog?.ripple) {
    await grantRipple(uid, {
      id: `noble-ripple-${rank.key}`,
      name: `${rank.name} Ripple`,
      icon: rewardIcon(catalog.ripple),
      colors: catalog.ripple.config?.colors as string[] | undefined,
      obtainedAt: now,
      validity: now + NOBLE_WINDOW_MS, // 2026-10-16 (Sumon): 30-day validity, expires with rank
      source: 'noble',
      description: desc,
      grantedBy: 'noble-system',
    });
  }
  if (catalog?.entryEffect) {
    await grantEntryEffect(uid, {
      id: `noble-effect-${rank.key}`,
      name: `${rank.name} Entry`,
      icon: rewardIcon(catalog.entryEffect),
      obtainedAt: now,
      validity: now + NOBLE_WINDOW_MS, // 2026-10-16 (Sumon): 30-day validity, expires with rank
      source: 'noble',
      description: desc,
      grantedBy: 'noble-system',
    });
  }
}

/* ── 2026-10-16 (Sumon): Revoke rank items when rank drops ──
 * Nobel ranks have 30-day maintenance. When a user drops a rank,
 * the higher rank's rewards (frame, badge, nameplate, ripple, entry)
 * are REMOVED — rewards expire with the rank, not permanent. */
async function revokeNobleRankItems(uid: string, rankIndex: number): Promise<void> {
  const rank = NOBLE_RANKS[rankIndex];
  if (!rank || !uid) return;
  const key = rank.key;
  const removals: Promise<void>[] = [
    remove(ref(database, `users/${uid}/frames/noble-frame-${key}`)),
    remove(ref(database, `users/${uid}/badges/noble-badge-${key}`)),
    remove(ref(database, `users/${uid}/nameplates/noble-plate-${key}`)),
    remove(ref(database, `users/${uid}/ripples/noble-ripple-${key}`)),
    remove(ref(database, `users/${uid}/entryEffects/noble-effect-${key}`)),
  ];
  await Promise.all(removals.map(p => p.catch(() => {})));
  try {
    const [frameSnap, plateSnap, rippleSnap, effectSnap] = await Promise.all([
      get(ref(database, `users/${uid}/activeFrame`)),
      get(ref(database, `users/${uid}/activeNameplate`)),
      get(ref(database, `users/${uid}/activeRipple`)),
      get(ref(database, `users/${uid}/activeEntryEffect`)),
    ]);
    const clears: Promise<void>[] = [];
    if (frameSnap.val() === `noble-frame-${key}`) clears.push(remove(ref(database, `users/${uid}/activeFrame`)).catch(() => {}));
    const plateVal = plateSnap.val();
    const plateId = typeof plateVal === 'string' ? plateVal : plateVal?.id;
    if (plateId === `noble-plate-${key}`) clears.push(remove(ref(database, `users/${uid}/activeNameplate`)).catch(() => {}));
    const rippleVal = rippleSnap.val();
    const rippleId = typeof rippleVal === 'string' ? rippleVal : rippleVal?.id;
    if (rippleId === `noble-ripple-${key}`) clears.push(remove(ref(database, `users/${uid}/activeRipple`)).catch(() => {}));
    const effectVal = effectSnap.val();
    const effectId = typeof effectVal === 'string' ? effectVal : effectVal?.id;
    if (effectId === `noble-effect-${key}`) clears.push(remove(ref(database, `users/${uid}/activeEntryEffect`)).catch(() => {}));
    try {
      const badgeSnap = await get(ref(database, `users/${uid}/officialBadge`));
      const badgeVal = badgeSnap.val();
      const badgeId = typeof badgeVal === 'string' ? badgeVal : badgeVal?.id;
      if (badgeId === `noble-badge-${key}`) clears.push(remove(ref(database, `users/${uid}/officialBadge`)).catch(() => {}));
    } catch {}
    await Promise.all(clears);
  } catch {}
}

/* ── 2026-10-16 (Sumon): Renew reward validity on successful maintenance ──
 * 2026-10-19 perf: (1) skip when the stored deadline already equals the new
 * one — same-rank gifts recompute an identical deadline, so one cheap read
 * guards five no-op writes; (2) the five writes are one atomic multi-path
 * update instead of five separate sets. */
async function renewNobleRankValidity(uid: string, rankIndex: number, newDeadline: number): Promise<void> {
  const rank = NOBLE_RANKS[rankIndex];
  if (!rank || !uid) return;
  const key = rank.key;
  try {
    const cur = await get(ref(database, `users/${uid}/frames/noble-frame-${key}/validity`));
    if (cur.exists() && cur.val() === newDeadline) return; // unchanged — skip
  } catch {
    // Read failed — fall through and write (safe).
  }
  const updates: Record<string, number> = {};
  updates[`users/${uid}/frames/noble-frame-${key}/validity`] = newDeadline;
  updates[`users/${uid}/badges/noble-badge-${key}/validity`] = newDeadline;
  updates[`users/${uid}/nameplates/noble-plate-${key}/validity`] = newDeadline;
  updates[`users/${uid}/ripples/noble-ripple-${key}/validity`] = newDeadline;
  updates[`users/${uid}/entryEffects/noble-effect-${key}/validity`] = newDeadline;
  await update(ref(database), updates).catch(() => {});
}

/* ── 2026-10-15 (Sumon): Self-healing — grant missing rank items ──
 * Users who reached their rank before auto-grant existed never received
 * their nameplate/badge/frame/ripple/entry-effect. This checks the user's
 * current rank and grants any missing items. Called from refreshNobleState.
 * Idempotent: re-running grants nothing new. */
export async function healMissingNobleItems(uid: string): Promise<void> {
  if (!uid) return;
  try {
    const nobleSnap = await get(ref(database, `users/${uid}/noble`));
    if (!nobleSnap.exists()) return;
    const state = coerceState(nobleSnap.val());
    if (!state) return;
    const rank = NOBLE_RANKS[state.rankIndex];
    if (!rank) return;

    // Check existing items in parallel
    const [platesSnap, badgesSnap, framesSnap, ripplesSnap, effectsSnap] = await Promise.all([
      get(ref(database, `users/${uid}/nameplates`)).catch(() => null),
      get(ref(database, `users/${uid}/badges`)).catch(() => null),
      get(ref(database, `users/${uid}/frames`)).catch(() => null),
      get(ref(database, `users/${uid}/ripples`)).catch(() => null),
      get(ref(database, `users/${uid}/entryEffects`)).catch(() => null),
    ]);

    const hasPlate = platesSnap?.exists() && platesSnap.hasChild(`noble-plate-${rank.key}`);
    const hasBadge = badgesSnap?.exists() && badgesSnap.hasChild(`noble-badge-${rank.key}`);
    const hasFrame = framesSnap?.exists() && framesSnap.hasChild(`noble-frame-${rank.key}`);
    const hasRipple = ripplesSnap?.exists() && ripplesSnap.hasChild(`noble-ripple-${rank.key}`);
    const hasEffect = effectsSnap?.exists() && effectsSnap.hasChild(`noble-effect-${rank.key}`);

    // 2026-10-15 (Sumon): Also update icons if catalog has newer design URLs.
    // grantNobleRankItems uses set() so it's safe to re-run — updates stale fallback icons.
    // Check ALL ranks up to current (not just current) — old ranks may have stale fallback icons.
    // 2026-10-15 (Sumon): Check nameplates AND badges AND frames — no demo icons ever.
    const catalog = rewardsForRank(state.rankIndex);
    let needsUpdate = !hasPlate || !hasBadge || !hasFrame || !hasRipple || !hasEffect;
    if (!needsUpdate) {
      for (let i = 0; i <= state.rankIndex; i++) {
        const r = NOBLE_RANKS[i];
        if (!r) continue;
        const rankCatalog = rewardsForRank(i);
        if (!rankCatalog) continue;
        // Check nameplate
        const plateId = `noble-plate-${r.key}`;
        const existingPlate = platesSnap?.child(plateId).val();
        if (existingPlate) {
          const expectedIcon = rewardIcon(rankCatalog.nameplate);
          if (existingPlate.icon !== expectedIcon) {
            needsUpdate = true;
            break;
          }
        }
        // Check badge
        if (rankCatalog.badge) {
          const badgeId = `noble-badge-${r.key}`;
          const existingBadge = badgesSnap?.child(badgeId).val();
          if (existingBadge) {
            const expectedBadgeIcon = rewardIcon(rankCatalog.badge);
            if (existingBadge.icon !== expectedBadgeIcon) {
              needsUpdate = true;
              break;
            }
          }
        }
        // Check frame
        if (rankCatalog.frame) {
          const frameId = `noble-frame-${r.key}`;
          const existingFrame = framesSnap?.child(frameId).val();
          if (existingFrame) {
            const expectedFrameIcon = rewardIcon(rankCatalog.frame);
            if (existingFrame.icon !== expectedFrameIcon) {
              needsUpdate = true;
              break;
            }
          }
        }
      }
    }
    if (!needsUpdate && catalog) {
      // Check if existing plate has outdated icon
      const plateId = `noble-plate-${rank.key}`;
      const existingPlate = platesSnap?.child(plateId).val();
      const expectedIcon = rewardIcon(catalog.nameplate);
      if (existingPlate && existingPlate.icon !== expectedIcon) {
        needsUpdate = true;
      }
    }
    // Grant only what's missing or outdated — grantNobleRankItems is idempotent per item
    if (needsUpdate) {
      // Re-grant all ranks up to current to fix stale icons
      for (let i = 0; i <= state.rankIndex; i++) {
        await grantNobleRankItems(uid, i);
      }
    }
  } catch {
    // Non-critical — will retry on next refresh
  }
}
export async function recordNobleXP(uid: string, price: number): Promise<void> {
  if (!uid || !(price > 0)) return;
  const nobleRef = ref(database, `users/${uid}/noble`);
  const now = Date.now();
  // 2026-10-19 (Sumon): before/after state is captured INSIDE the transaction
  // update function — never from a pre-read. The old get() before
  // runTransaction could return a stale rank (a concurrent gift committing in
  // between), causing skipped rank-item grants or wrong revokes. (The update
  // fn may run more than once on retry; the last run's `before` is the
  // committed write's true pre-image. Boxed in an object so TS keeps the
  // declared type — a bare `let` would be narrowed to `null`.)
  const box: { before: NobleState | null } = { before: null };
  const result = await runTransaction(nobleRef, (cur) => {
    box.before = coerceState(cur);
    return applyNobleGift(cur, price, now);
  });
  if (!result.committed) return;
  const next = coerceState(result.snapshot.val());
  const prevRank = box.before?.rankIndex ?? 0;
  const existed = box.before !== null;
  const nextRank = next?.rankIndex ?? 0;
  // First gift (node created → Knight) or any rank-up: grant rank items.
  if (next && (nextRank > prevRank || !existed)) {
    try {
      await grantNobleRankItems(uid, nextRank);
    } catch {
      // Non-critical — items will be granted on the next rank-up / gift.
    }
  }
  // 2026-10-16 (Sumon): Rank DROPPED (30-day maintenance failed) —
  // revoke the higher rank's rewards. Rewards expire with the rank.
  if (next && nextRank < prevRank) {
    try {
      for (let r = prevRank; r > nextRank; r--) {
        await revokeNobleRankItems(uid, r);
      }
    } catch {
      // Non-critical — items will be cleaned on next heal.
    }
    // 2026-10-19 polish: the demoted-TO rank's reward validity was left stale
    // (up to ~30 days) — renew it to the new maintenance deadline so the
    // kept rank's frame/badge/plate/ripple/entryEffect don't expire early.
    // renewNobleRankValidity skips when the deadline is already correct.
    try {
      if (next.maintenanceDeadline > Date.now()) {
        await renewNobleRankValidity(uid, nextRank, next.maintenanceDeadline);
      }
    } catch {
      // Non-critical
    }
  }
  // 2026-10-16 (Sumon): Rank MAINTAINED — renew reward validity to new deadline.
  if (next && nextRank === prevRank && next.maintenanceDeadline > Date.now()) {
    try {
      await renewNobleRankValidity(uid, nextRank, next.maintenanceDeadline);
    } catch {
      // Non-critical
    }
  }
}

/* ── 2026-10-16 (Sumon): Maintenance check on read ──
 * The 30-day maintenance window must be enforced even when the user
 * is NOT sending gifts. Call this when loading profile/Honor/Decoration
 * so inactive users don't keep their rank forever.
 * Returns the (possibly updated) rank index. */
export async function checkNobleMaintenance(uid: string): Promise<number> {
  if (!uid) return 0;
  const nobleRef = ref(database, `users/${uid}/noble`);
  let prevRank = 0;
  try {
    const snap = await get(nobleRef);
    if (!snap.exists()) return 0;
    prevRank = coerceState(snap.val())?.rankIndex ?? 0;
  } catch {
    return 0;
  }
  const now = Date.now();
  const result = await runTransaction(nobleRef, (cur) => {
    const s = coerceState(cur);
    if (!s) return cur;
    if (now <= s.maintenanceDeadline) return undefined; // No change needed - abort
    return applyNobleGift(cur, 0, now);
  });
  if (!result.committed) return prevRank;
  const next = coerceState(result.snapshot.val());
  const nextRank = next?.rankIndex ?? 0;
  if (nextRank < prevRank) {
    try {
      for (let r = prevRank; r > nextRank; r--) {
        await revokeNobleRankItems(uid, r);
      }
    } catch {}
  }
  // 2026-10-16 (Sumon): Rank maintained — renew validity.
  if (next && nextRank === prevRank && next.maintenanceDeadline > Date.now()) {
    try {
      await renewNobleRankValidity(uid, nextRank, next.maintenanceDeadline);
    } catch {}
  }
  return nextRank;
}

/** One-shot read of a user's noble state (null when never earned XP). */
export async function getNobleState(uid: string): Promise<NobleState | null> {
  const snap = await get(ref(database, `users/${uid}/noble`));
  return snap.exists() ? coerceState(snap.val()) : null;
}

/**
 * 2026-10-15 (Sumon): lazy demotion check for views.
 * Rolls over expired 30-day windows (demoting one rank per missed window)
 * and writes back ONLY if something changed. Call on NobelScreen / profile
 * mount so demotion applies even if the user never sends another gift.
 */
export async function refreshNobleState(uid: string): Promise<NobleState | null> {
  if (!uid) return null;
  try {
    const nobleRef = ref(database, `users/${uid}/noble`);
    const now = Date.now();
    // 2026-10-19 (Sumon): the rollover now runs INSIDE a transaction (same
    // pattern as checkNobleMaintenance). The old get → local roll → set()
    // could silently lose a concurrent gift's XP committed between the read
    // and the write. applyNobleGift(cur, 0, now) performs the identical
    // window rollover with price 0 (no rank-up possible from a refresh).
    const result = await runTransaction(nobleRef, (cur) => {
      const s = coerceState(cur);
      if (!s) return undefined; // no noble state — abort, nothing to roll
      if (now <= s.maintenanceDeadline) return undefined; // no expiry — abort, no write
      return applyNobleGift(cur, 0, now);
    });
    const next = coerceState(result.snapshot.val());
    /* 2026-10-15 (Sumon): Self-heal — grant any missing rank rewards.
     * Non-blocking: runs in background, never fails the refresh. */
    healMissingNobleItems(uid).catch(() => {});
    return next;
  } catch {
    return null;
  }
}

/** Live-subscribe to a user's noble state. */
export function subscribeNoble(
  uid: string,
  callback: (state: NobleState | null) => void,
  onError?: (e: unknown) => void,
): () => void {
  return onValue(
    ref(database, `users/${uid}/noble`),
    (snap) => {
      try {
        callback(snap.exists() ? coerceState(snap.val()) : null);
      } catch {
        // Malformed data — keep the last good state.
      }
    },
    (e) => {
      if (onError) onError(e);
    },
  );
}

/**
 * True when a noble privilege is genuinely active for the user:
 * rank reached, privilege has a real code path, and maintenance not lapsed.
 */
export function hasPrivilege(state: NobleState | null, key: PrivilegeKey): boolean {
  if (!state || state.lapsed) return false;
  const p = PRIVILEGES.find((d) => d.key === key);
  return !!p && p.enforced && state.rankIndex >= p.minRankIndex;
}

/**
 * Seat Priority (IMO "Seat Priority" privilege, SSKing).
 * When a voice-room seat opens, nobles outrank non-nobles: the highest-ranked
 * noble requesting the seat is seated first; ties break on noble XP.
 *
 * `requests` = each seat request as { uid, nobleRankIndex, nobleXP }.
 * Returns the uid that should take the seat (null when empty).
 *
 * NOTE: this is the pure ranking rule. The voice-room seat-claim integration
 * (calling this when seats open) is owned by the voice-room agent — flag it
 * to the parent for assignment.
 */
export function pickSeatByNoblePriority(
  requests: Array<{ uid: string; nobleRankIndex: number; nobleXP: number }>,
): string | null {
  if (!requests.length) return null;
  const sorted = [...requests].sort((a, b) =>
    b.nobleRankIndex - a.nobleRankIndex || b.nobleXP - a.nobleXP);
  return sorted[0].uid;
}

/** "1260", "12K", "4.2M" — matches the IMO reference formatting. */
export function formatXP(n: number): string {
  if (!Number.isFinite(n)) return '∞';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 10000) return `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}K`;
  return `${Math.floor(n)}`;
}

/** "YYYY-MM-DD HH:mm" — matches the IMO deadline format. */
export function formatDeadline(ts: number): string {
  const d = new Date(ts);
  const pad = (x: number) => `${x}`.padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
