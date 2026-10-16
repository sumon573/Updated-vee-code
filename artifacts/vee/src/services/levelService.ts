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

// ── Level curve (very slow; Gold much slower) ──
// Bronze (total 1-16):  xp = 200 * (n-1)^2          → Lv16 = 45,000 XP
// Silver (total 17-32): xp = 500 * (n-17)^2 + 45k   → Lv32 = 157,500 XP
// Gold (total 33-48):   xp = 2000 * (n-33)^2 + 157.5k → Lv48 = 607,500 XP
// Max: xp >= 607,500

const BRONZE_MAX_XP = 200 * 15 * 15; // 45,000
const SILVER_MAX_XP = 500 * 15 * 15 + BRONZE_MAX_XP; // 157,500
const GOLD_MAX_XP = 2000 * 15 * 15 + SILVER_MAX_XP; // 607,500

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
    totalLevel = 33 + Math.floor(Math.sqrt(goldXp / 2000));
  } else if (xp >= BRONZE_MAX_XP) {
    // Silver: total 17-32
    const silverXp = xp - BRONZE_MAX_XP;
    totalLevel = 17 + Math.floor(Math.sqrt(silverXp / 500));
  } else {
    // Bronze: total 1-16
    totalLevel = 1 + Math.floor(Math.sqrt(xp / 200));
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
  else if (total >= 33) xp = SILVER_MAX_XP + 2000 * (total - 33) * (total - 33);
  else if (total >= 17) xp = BRONZE_MAX_XP + 500 * (total - 17) * (total - 17);
  else xp = 200 * (total - 1) * (total - 1);
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
