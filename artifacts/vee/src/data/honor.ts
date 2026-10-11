/**
 * Honor — achievement catalog + nameplate catalog (shared).
 *
 * Every achievement is evaluated from REAL user activity only:
 * no demo/placeholder badges are ever granted. Locked achievements are
 * shown greyed-out with their unlock requirement so the user can see
 * exactly what to do — nothing is faked as earned.
 *
 * Used by:
 *  - app/profile/index.tsx (Honor section preview)
 *  - app/profile/honor.tsx (Honor detail screen: Badge / Nameplate tabs)
 *  - app/profile/decoration.tsx (nameplate catalog)
 */

export interface HonorStats {
  roomsHosted: number;
  totalGifts: number;
  followers: number;
  following: number;
  level: number;
}

export interface Achievement {
  id: string;
  icon: string;
  label: string;
  /** Human-readable unlock condition, e.g. "Host 5 rooms" */
  requirement: string;
  isUnlocked: (s: HonorStats) => boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'host',       icon: '🎤', label: 'Host',        requirement: 'Host 1 room',      isUnlocked: (s) => s.roomsHosted >= 1 },
  { id: 'super-host', icon: '👑', label: 'Super Host',  requirement: 'Host 5 rooms',     isUnlocked: (s) => s.roomsHosted >= 5 },
  { id: 'loved',      icon: '💝', label: 'Loved',       requirement: 'Receive 1 gift',   isUnlocked: (s) => s.totalGifts >= 1 },
  { id: 'treasured',  icon: '💎', label: 'Treasured',   requirement: 'Receive 50 gifts', isUnlocked: (s) => s.totalGifts >= 50 },
  { id: 'popular',    icon: '⭐', label: 'Popular',     requirement: '10 followers',     isUnlocked: (s) => s.followers >= 10 },
  { id: 'celebrity',  icon: '🌟', label: 'Celebrity',   requirement: '100 followers',    isUnlocked: (s) => s.followers >= 100 },
  { id: 'friendly',   icon: '🤝', label: 'Friendly',    requirement: 'Follow 10 people', isUnlocked: (s) => s.following >= 10 },
  { id: 'rising',     icon: '🚀', label: 'Rising Star', requirement: 'Reach Lv.5',       isUnlocked: (s) => s.level >= 5 },
];

/** Split the catalog into earned / locked for a given stats snapshot. */
export function evaluateAchievements(stats: HonorStats): {
  earned: Achievement[];
  locked: Achievement[];
} {
  const earned: Achievement[] = [];
  const locked: Achievement[] = [];
  for (const a of ACHIEVEMENTS) {
    (a.isUnlocked(stats) ? earned : locked).push(a);
  }
  return { earned, locked };
}

export interface NameplateDef {
  id: string;
  name: string;
  icon: string;
  requirement: string;
}

/** Nameplate catalog — ownership is tracked in users/{uid}/ownedNameplates. */
export const NAMEPLATES: NameplateDef[] = [
  { id: 'vip',    name: 'VIP',        icon: '⭐', requirement: 'Receive 50 gifts' },
  { id: 'star',   name: 'Rising Star', icon: '🌟', requirement: 'Reach Lv.3' },
  { id: 'legend', name: 'Legend',     icon: '🏆', requirement: 'Reach Lv.15' },
];
