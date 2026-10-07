/**
 * Honor & Decoration System — IMO-style badges, nameplates, and avatar frames.
 *
 * • Badges/frames are NOT given by default — users earn them via room activity
 *   or admins grant them officially.
 * • `badges/{badgeId}`: badge definitions (admin-managed)
 * • `userBadges/{uid}/{badgeId}`: user's earned badges {earnedAt, grantedBy?}
 * • `frames/{frameId}`: frame definitions (admin-managed)
 * • `userFrames/{uid}/{frameId}`: user's frames {earnedAt, grantedBy?}
 * • `userFrames/{uid}/active`: currently active frame ID
 */

import { ref, get, set, onValue, remove } from 'firebase/database';
import { database } from '@/src/config/firebase';

export type Badge = {
  id: string;
  name: string;
  nameKey?: string; // i18n key
  icon: string; // emoji or image URL
  description: string;
  descriptionKey?: string;
  category: 'activity' | 'special' | 'vip';
  requirement?: string; // e.g. "Host 10 rooms"
  stars: number; // 1-5
};

export type AvatarFrame = {
  id: string;
  name: string;
  nameKey?: string;
  imageURL: string; // frame overlay image
  previewURL?: string;
  category: 'level' | 'special' | 'vip';
  requirement?: string;
  stars: number;
};

// ─── Badge definitions (seeded by admin) ────────────────────────────────

export const DEFAULT_BADGES: Badge[] = [
  { id: 'host_10', name: 'Super Host', icon: '🎙️', description: 'Host 10 voice rooms', category: 'activity', requirement: 'Host 10 rooms', stars: 3 },
  { id: 'host_50', name: 'Star Host', icon: '⭐', description: 'Host 50 voice rooms', category: 'activity', requirement: 'Host 50 rooms', stars: 4 },
  { id: 'gift_100', name: 'Gift Star', icon: '🎁', description: 'Send 100 gifts', category: 'activity', requirement: 'Send 100 gifts', stars: 4 },
  { id: 'gift_1000', name: 'Super Rich', icon: '💎', description: 'Send 1000 gifts', category: 'activity', requirement: 'Send 1000 gifts', stars: 5 },
  { id: 'friend_10', name: 'Social Butterfly', icon: '🦋', description: 'Make 10 friends', category: 'activity', requirement: '10 friends', stars: 2 },
  { id: 'vip_gold', name: 'Gold VIP', icon: '👑', description: 'Official VIP badge', category: 'vip', stars: 5 },
  { id: 'official_star', name: 'Official Star', icon: '🌟', description: 'Granted by Vee team', category: 'special', stars: 5 },
];

export const DEFAULT_FRAMES: AvatarFrame[] = [
  { id: 'frame_bronze', name: 'Bronze Frame', imageURL: '', category: 'level', requirement: 'Reach Lv.5', stars: 1 },
  { id: 'frame_silver', name: 'Silver Frame', imageURL: '', category: 'level', requirement: 'Reach Lv.10', stars: 2 },
  { id: 'frame_gold', name: 'Gold Frame', imageURL: '', category: 'level', requirement: 'Reach Lv.20', stars: 3 },
  { id: 'frame_diamond', name: 'Diamond Frame', imageURL: '', category: 'vip', requirement: 'VIP only', stars: 5 },
  { id: 'frame_star', name: 'Star Frame', imageURL: '', category: 'special', requirement: 'Official grant', stars: 4 },
];

// ─── User badges ────────────────────────────────────────────────────────

export function subscribeUserBadges(uid: string, cb: (badges: Record<string, { earnedAt: number; grantedBy?: string }>) => void) {
  return onValue(ref(database, `userBadges/${uid}`), (snap) => {
    cb(snap.exists() ? snap.val() : {});
  }, () => cb({}));
}

export async function grantBadge(uid: string, badgeId: string, grantedBy?: string): Promise<void> {
  try {
    await set(ref(database, `userBadges/${uid}/${badgeId}`), {
      earnedAt: Date.now(),
      ...(grantedBy ? { grantedBy } : {}),
    });
  } catch (e) {
    console.warn('[honor] grantBadge failed:', e);
    throw e;
  }
}

export async function revokeBadge(uid: string, badgeId: string): Promise<void> {
  try {
    await remove(ref(database, `userBadges/${uid}/${badgeId}`));
  } catch (e) {
    console.warn('[honor] revokeBadge failed:', e);
    throw e;
  }
}

// ─── User frames ────────────────────────────────────────────────────────

export function subscribeUserFrames(uid: string, cb: (frames: Record<string, { earnedAt: number; grantedBy?: string }>) => void) {
  return onValue(ref(database, `userFrames/${uid}`), (snap) => {
    const val = snap.exists() ? snap.val() : {};
    delete val.active; // active is not a frame
    cb(val);
  }, () => cb({}));
}

export function subscribeActiveFrame(uid: string, cb: (frameId: string | null) => void) {
  return onValue(ref(database, `userFrames/${uid}/active`), (snap) => {
    cb(snap.exists() ? (snap.val() as string) : null);
  }, () => cb(null));
}

export async function grantFrame(uid: string, frameId: string, grantedBy?: string): Promise<void> {
  try {
    await set(ref(database, `userFrames/${uid}/${frameId}`), {
      earnedAt: Date.now(),
      ...(grantedBy ? { grantedBy } : {}),
    });
  } catch (e) {
    console.warn('[honor] grantFrame failed:', e);
    throw e;
  }
}

export async function setActiveFrame(uid: string, frameId: string | null): Promise<void> {
  try {
    if (frameId) {
      await set(ref(database, `userFrames/${uid}/active`), frameId);
    } else {
      await remove(ref(database, `userFrames/${uid}/active`));
    }
  } catch (e) {
    console.warn('[honor] setActiveFrame failed:', e);
    throw e;
  }
}

// ─── Badge definitions ──────────────────────────────────────────────────

export function subscribeBadgeDefs(cb: (badges: Badge[]) => void) {
  return onValue(ref(database, 'badges'), (snap) => {
    if (!snap.exists()) {
      cb(DEFAULT_BADGES);
      return;
    }
    const val = snap.val() as Record<string, Badge>;
    cb(Object.values(val));
  }, () => cb(DEFAULT_BADGES));
}

export function subscribeFrameDefs(cb: (frames: AvatarFrame[]) => void) {
  return onValue(ref(database, 'frames'), (snap) => {
    if (!snap.exists()) {
      cb(DEFAULT_FRAMES);
      return;
    }
    const val = snap.val() as Record<string, AvatarFrame>;
    cb(Object.values(val));
  }, () => cb(DEFAULT_FRAMES));
}
