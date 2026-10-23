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
 * Privileges that have no real code path yet (Noble Gift, Microphone
 * Ripple, Seat Priority) are flagged enforced:false and the UI shows
 * them honestly as locked — never as unlocked-but-dead.
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

export const PRIVILEGES: PrivilegeDef[] = [
  { key: 'nameplate',    name: 'Noble Nameplate',   icon: '🎖️', minRankIndex: 0, enforced: true  },
  { key: 'badge',        name: 'Noble Badge',       icon: '🛡️', minRankIndex: 1, enforced: true  },
  { key: 'gift',         name: 'Noble Gift',        icon: '🎁', minRankIndex: 1, enforced: true  },
  { key: 'avatarFrame',  name: 'Avatar Frame',      icon: '🖼️', minRankIndex: 3, enforced: true  },
  { key: 'entryEffects', name: 'Fancy Entry Effects', icon: '✨', minRankIndex: 4, enforced: true },
  { key: 'micRipple',    name: 'Microphone Ripple', icon: '🎤', minRankIndex: 6, enforced: false },
  { key: 'seatPriority', name: 'Seat Priority',     icon: '💺', minRankIndex: 9, enforced: true  },
  { key: 'upgradeBanner', name: 'Upgrade Banner',   icon: '🚩', minRankIndex: 5, enforced: false },
  { key: 'homepageSkin',  name: 'Homepage Skin',    icon: '🏠', minRankIndex: 6, enforced: false },
];

export interface NobleRank {
  key: string;
  name: string;
  minXP: number;
  maxXP: number;
  color: string;
  privileges: PrivilegeKey[];
}

/**
 * Rank thresholds. Anchor points come from the IMO reference video
 * (Baron 1260~8399, Marquis 252000~587999, Royal Duke 1260K~4200K,
 * SSKing 42000K~1000000000000K); the in-between ranks interpolate
 * those anchors with non-overlapping contiguous ranges.
 */
export const NOBLE_RANKS: NobleRank[] = [
  { key: 'knight',    name: 'Knight',     minXP: 0,         maxXP: 1259,       color: '#8BC34A', privileges: ['nameplate'] },
  { key: 'baron',     name: 'Baron',      minXP: 1260,      maxXP: 8399,       color: '#26A69A', privileges: ['nameplate', 'badge', 'gift'] },
  { key: 'viscount',  name: 'Viscount',   minXP: 8400,      maxXP: 41999,      color: '#42A5F5', privileges: ['nameplate', 'badge', 'gift'] },
  { key: 'count',     name: 'Count',      minXP: 42000,     maxXP: 251999,     color: '#7E57C2', privileges: ['nameplate', 'badge', 'gift', 'avatarFrame'] },
  { key: 'marquis',   name: 'Marquis',    minXP: 252000,    maxXP: 587999,    color: '#EC407A', privileges: ['nameplate', 'badge', 'gift', 'avatarFrame', 'entryEffects'] },
  { key: 'duke',      name: 'Duke',       minXP: 588000,    maxXP: 1259999,   color: '#FF7043', privileges: ['nameplate', 'badge', 'gift', 'avatarFrame', 'entryEffects', 'upgradeBanner'] },
  { key: 'royalDuke', name: 'Royal Duke', minXP: 1260000,   maxXP: 4200000,   color: '#FFA000', privileges: ['nameplate', 'badge', 'gift', 'avatarFrame', 'entryEffects', 'micRipple', 'upgradeBanner', 'homepageSkin'] },
  { key: 'king',      name: 'King',       minXP: 4200001,   maxXP: 41999999,  color: '#FBC02D', privileges: ['nameplate', 'badge', 'gift', 'avatarFrame', 'entryEffects', 'micRipple', 'upgradeBanner', 'homepageSkin'] },
  { key: 'sking',     name: 'SKing',      minXP: 42000000,  maxXP: 419999999, color: '#E65100', privileges: ['nameplate', 'badge', 'gift', 'avatarFrame', 'entryEffects', 'micRipple', 'upgradeBanner', 'homepageSkin'] },
  { key: 'ssking',    name: 'SSKing',     minXP: 420000000, maxXP: Number.MAX_SAFE_INTEGER, color: '#BF360C',
    privileges: ['nameplate', 'badge', 'gift', 'avatarFrame', 'entryEffects', 'micRipple', 'upgradeBanner', 'homepageSkin', 'seatPriority'] },
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

/* ── 2026-10-23 (Sumon): CURRENT-RANK-ONLY rule ──
 * A noble holds ONLY the rewards of the rank they currently hold —
 * rewards never accumulate across ranks. Ranking up replaces the set;
 * dropping removes the higher set; stale items from any other rank
 * are revoked (and any active pointer to them cleared). */
async function revokeNobleRanksExcept(
  uid: string,
  keepRankIndex: number,
  onlyRanks?: number[],
): Promise<void> {
  const targets = onlyRanks ?? NOBLE_RANKS.map((_, i) => i);
  for (const r of targets) {
    if (r === keepRankIndex) continue;
    await revokeNobleRankItems(uid, r).catch(() => {});
  }
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

    // 2026-10-23 (Sumon): CURRENT-RANK-ONLY — heal grants/refreshes ONLY
    // the current rank's items (grantNobleRankItems is idempotent and
    // set()s fresh catalog icons), and revokes any other rank's items
    // still present in the user's collections.
    const catalog = rewardsForRank(state.rankIndex);
    let needsUpdate = !hasPlate || !hasBadge || !hasFrame || !hasRipple || !hasEffect;
    if (!needsUpdate && catalog) {
      const existingPlate = platesSnap?.child(`noble-plate-${rank.key}`).val();
      if (existingPlate && existingPlate.icon !== rewardIcon(catalog.nameplate)) needsUpdate = true;
      if (!needsUpdate && catalog.badge) {
        const existingBadge = badgesSnap?.child(`noble-badge-${rank.key}`).val();
        if (existingBadge && existingBadge.icon !== rewardIcon(catalog.badge)) needsUpdate = true;
      }
      if (!needsUpdate && catalog.frame) {
        const existingFrame = framesSnap?.child(`noble-frame-${rank.key}`).val();
        if (existingFrame && existingFrame.icon !== rewardIcon(catalog.frame)) needsUpdate = true;
      }
    }
    if (needsUpdate) {
      await grantNobleRankItems(uid, state.rankIndex);
    }
    // Enforcement: any OTHER rank with items present loses them now.
    const staleRanks: number[] = [];
    for (let i = 0; i < NOBLE_RANKS.length; i++) {
      if (i === state.rankIndex) continue;
      const k = NOBLE_RANKS[i].key;
      const present =
        platesSnap?.hasChild(`noble-plate-${k}`) ||
        badgesSnap?.hasChild(`noble-badge-${k}`) ||
        framesSnap?.hasChild(`noble-frame-${k}`) ||
        ripplesSnap?.hasChild(`noble-ripple-${k}`) ||
        effectsSnap?.hasChild(`noble-effect-${k}`);
      if (present) staleRanks.push(i);
    }
    if (staleRanks.length) {
      await revokeNobleRanksExcept(uid, state.rankIndex, staleRanks);
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
      // 2026-10-23 (Sumon): CURRENT-RANK-ONLY — ranking up replaces the
      // reward set: every lower rank's items are removed, not kept.
      await revokeNobleRanksExcept(uid, nextRank);
    } catch {
      // Non-critical — items will be granted on the next rank-up / gift.
    }
  }
  // 2026-10-16 (Sumon): Rank DROPPED (30-day maintenance failed) —
  // revoke the higher rank's rewards. Rewards expire with the rank.
  if (next && nextRank < prevRank) {
    try {
      // 2026-10-23 (Sumon): CURRENT-RANK-ONLY — after a drop, ONLY the
      // new current rank's rewards may remain.
      await revokeNobleRanksExcept(uid, nextRank);
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
  if (!result.committed) {
    // 2026-10-23 (Sumon): CURRENT-RANK-ONLY enforcement on every maintenance check.
    healMissingNobleItems(uid).catch(() => {});
    return prevRank;
  }
  const next = coerceState(result.snapshot.val());
  const nextRank = next?.rankIndex ?? 0;
  if (nextRank < prevRank) {
    try {
      // 2026-10-23 (Sumon): CURRENT-RANK-ONLY — only the new current
      // rank's rewards may remain after a maintenance drop.
      await revokeNobleRanksExcept(uid, nextRank);
    } catch {}
  }
  // 2026-10-16 (Sumon): Rank maintained — renew validity.
  if (next && nextRank === prevRank && next.maintenanceDeadline > Date.now()) {
    try {
      await renewNobleRankValidity(uid, nextRank, next.maintenanceDeadline);
    } catch {}
  }
  // 2026-10-23 (Sumon): CURRENT-RANK-ONLY enforcement on every maintenance check.
  healMissingNobleItems(uid).catch(() => {});
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
