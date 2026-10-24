/**
 * Permanent User Level System (2026-10-16, Sumon)
 *
 * - Bronze 1-16 → Silver 1-16 → Gold 1-16 → Max
 * - XP stored on SERVER (users/{uid}/level) — survives app updates, never resets
 * - VERY SLOW progression; Gold is MUCH slower than Bronze/Silver
 * - XP from gift sending (priority) + voice room activity
 * - PERMANENT — never needs touching again
 */

import { ref, get, set, runTransaction, onValue } from 'firebase/database';
import { database } from '@/src/config/firebase';

// ── Level curve ──
// 2026-10-24 (Sumon): "আরো অনেক ধীর করো — খুব সহজেই যেনো লেবেল up না হয়"
// Coefficients raised ~5-6x over the 2026-10-16 curve (Gold slowed most,
// as before). Reaching Max is now a long-term achievement.
// Bronze (total 1-16):  xp = 1000 * (n-1)^2           → Lv16 = 225,000 XP
// Silver (total 17-32): xp = 3000 * (n-17)^2 + 225k  → Lv32 = 900,000 XP
// Gold (total 33-48):   xp = 12000 * (n-33)^2 + 900k → Lv48 = 3,600,000 XP
// Max: xp >= 3,600,000

const BRONZE_C = 1000;
const SILVER_C = 3000;
const GOLD_C = 12000;
const BRONZE_MAX_XP = BRONZE_C * 15 * 15; // 225,000
const SILVER_MAX_XP = SILVER_C * 15 * 15 + BRONZE_MAX_XP; // 900,000
const GOLD_MAX_XP = GOLD_C * 15 * 15 + SILVER_MAX_XP; // 3,600,000

export type LevelTier = 'bronze' | 'silver' | 'gold' | 'max';

export interface UserLevel {
  totalLevel: number; // 1-48, 49+ = max
  tier: LevelTier;
  levelInTier: number; // 1-16 (for max, shows as "Max")
  xp: number;
}

/** Convert total XP to level info */
export function getLevelFromXP(xp: number): UserLevel {
  let totalLevel: number;
  if (xp >= GOLD_MAX_XP) {
    totalLevel = 49; // Max
  } else if (xp >= SILVER_MAX_XP) {
    // Gold: total 33-48
    const goldXp = xp - SILVER_MAX_XP;
    totalLevel = 33 + Math.floor(Math.sqrt(goldXp / GOLD_C));
  } else if (xp >= BRONZE_MAX_XP) {
    // Silver: total 17-32
    const silverXp = xp - BRONZE_MAX_XP;
    totalLevel = 17 + Math.floor(Math.sqrt(silverXp / SILVER_C));
  } else {
    // Bronze: total 1-16
    totalLevel = 1 + Math.floor(Math.sqrt(xp / BRONZE_C));
  }
  totalLevel = Math.max(1, Math.min(49, totalLevel));

  let tier: LevelTier;
  let levelInTier: number;
  if (totalLevel >= 49) {
    tier = 'max';
    levelInTier = 0;
  } else if (totalLevel >= 33) {
    tier = 'gold';
    levelInTier = totalLevel - 32;
  } else if (totalLevel >= 17) {
    tier = 'silver';
    levelInTier = totalLevel - 16;
  } else {
    tier = 'bronze';
    levelInTier = totalLevel;
  }

  return { totalLevel, tier, levelInTier, xp };
}

/** Convert OLD level number (1-100) to new system */
export function migrateOldLevel(oldLevel: number): UserLevel {
  // Old: 1-30 Bronze, 31-60 Silver, 61-99 Gold, 100 Max
  // New: treat old number as total, map to 1-48 + Max
  const total = Math.max(1, Math.min(49, oldLevel > 48 ? 49 : oldLevel));
  // Calculate XP that would give this level (reverse engineer)
  let xp: number;
  if (total >= 49) xp = GOLD_MAX_XP;
  else if (total >= 33) xp = SILVER_MAX_XP + GOLD_C * (total - 33) * (total - 33);
  else if (total >= 17) xp = BRONZE_MAX_XP + SILVER_C * (total - 17) * (total - 17);
  else xp = BRONZE_C * (total - 1) * (total - 1);
  return getLevelFromXP(xp);
}

/** Record XP for a user (atomic, server-side) */
export async function recordLevelXP(uid: string, xpToAdd: number): Promise<void> {
  if (!uid || xpToAdd <= 0) return;
  try {
    const levelRef = ref(database, `users/${uid}/level/xp`);
    await runTransaction(levelRef, (cur) => {
      const current = typeof cur === 'number' ? cur : 0;
      return current + xpToAdd;
    }).catch(() => {});
    // Update timestamp
    const tsRef = ref(database, `users/${uid}/level/updatedAt`);
    await set(tsRef, Date.now()).catch(() => {});
  } catch {
    // Non-critical
  }
}

/** Subscribe to a user's level (real-time) */
export function subscribeLevel(
  uid: string,
  callback: (level: UserLevel) => void,
): () => void {
  if (!uid) {
    callback(getLevelFromXP(0));
    return () => {};
  }
  const levelRef = ref(database, `users/${uid}/level/xp`);
  return onValue(levelRef, (snap) => {
    const xp = typeof snap.val() === 'number' ? snap.val() : 0;
    callback(getLevelFromXP(xp));
  }, () => {
    callback(getLevelFromXP(0));
  });
}

/** Get level tier display info */
export function getTierDisplay(tier: LevelTier): { label: string; colors: [string, string, string] } {
  switch (tier) {
    case 'bronze':
      return { label: 'Bronze', colors: ['#8C6239', '#CD7F32', '#F0B46A'] };
    case 'silver':
      return { label: 'Silver', colors: ['#7E8FA0', '#B8C6D4', '#EDF2F7'] };
    case 'gold':
      return { label: 'Gold', colors: ['#9A6B0F', '#E8B91A', '#FFE873'] };
    case 'max':
      return { label: 'Max', colors: ['#5B1A9E', '#9D4EDD', '#FFD700'] };
  }
}
