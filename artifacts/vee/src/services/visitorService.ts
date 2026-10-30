/**
 * Profile Visitors — Firebase Realtime Database
 *
 * DB Structure:
 *   profileVisitors/{profileUid}/{visitorUid} → { ts: number, seen: boolean }
 *
 * One record per visitor (latest visit wins — a repeat view overwrites ts and
 * resets seen to false, so a visitor who returns after the owner viewed the
 * list shows as unseen again). The owner marks records seen when the Recent
 * Visitors list is viewed; only visitors who arrive after that view stay
 * unseen, and the bell's green dot follows the same rule.
 *
 * Display window: a visitor is LISTED only while their latest visit is within
 * the last 7 days (Today / Last 7 days sections). Older records are ignored
 * for the list AND the badge, so viewing the list always clears the badge —
 * a stale unseen record can never stick the badge above zero.
 *
 * RULES STATUS (2026-10-30, read-only check): neither the repo rules file nor
 * the live rules snapshot (2026-10-28, incl. the store-catalog patch) contains
 * a profileVisitors node, so writes here are DENIED until the patch below is
 * applied (VPS text patch on LIVE rules + read-back; NEVER the repo file,
 * NEVER a deploy from here). The write calls catch PERMISSION_DENIED silently
 * so the app never crashes; the bell + page work fully the moment the patch
 * lands, with no further build.
 *
 * Required rules patch (mirrors the followers pattern — the actor writes
 * their own entry under the target's node; the owner reads + marks seen):
 *   "profileVisitors": {
 *     "$uid": {
 *       ".read": "auth != null && auth.uid === $uid",
 *       "$visitorUid": {
 *         ".write": "auth != null && (auth.uid === $visitorUid || auth.uid === $uid)",
 *         ".validate": "!newData.exists() || (newData.child('ts').isNumber() && newData.child('seen').isBoolean())"
 *       }
 *     }
 *   }
 */

import { ref, set, get, update, onValue } from 'firebase/database';
import { database } from '../config/firebase';

export type VisitorRecord = { ts: number; seen: boolean };
export type VisitorMap = Record<string, VisitorRecord>;

const WINDOW_MS = 7 * 86400000;
const FUTURE_TOLERANCE_MS = 60000;

export function isToday(ts: number, now = Date.now()): boolean {
  return new Date(ts).toDateString() === new Date(now).toDateString();
}

export function isWithinVisitorWindow(ts: number, now = Date.now()): boolean {
  return typeof ts === 'number' && ts >= now - WINDOW_MS && ts <= now + FUTURE_TOLERANCE_MS;
}

/** Visitor uids split into Today / Last 7 days by LATEST visit, latest first. */
export function splitVisitorSections(map: VisitorMap, now = Date.now()): { today: string[]; last7: string[] } {
  const today: string[] = [];
  const last7: string[] = [];
  for (const [uid, rec] of Object.entries(map)) {
    if (!rec || !isWithinVisitorWindow(rec.ts, now)) continue;
    if (isToday(rec.ts, now)) today.push(uid);
    else last7.push(uid);
  }
  const byTsDesc = (a: string, b: string) => (map[b]?.ts ?? 0) - (map[a]?.ts ?? 0);
  today.sort(byTsDesc);
  last7.sort(byTsDesc);
  return { today, last7 };
}

/** Badge number: unseen visitors among the LISTED (7-day window) ones only. */
export function countUnseenListed(map: VisitorMap, now = Date.now()): number {
  const { today, last7 } = splitVisitorSections(map, now);
  let n = 0;
  for (const uid of [...today, ...last7]) if (map[uid]?.seen === false) n += 1;
  return n;
}

/** Total LISTED visitors (7-day window): the bell's beside-number and
 *  the Recent Visitors TitleBar count (imo bell design, 2026-10-30). */
export function countListed(map: VisitorMap, now = Date.now()): number {
  const { today, last7 } = splitVisitorSections(map, now);
  return today.length + last7.length;
}

/** Record a profile view. No-op for own profile / missing uids. Silent until the rules patch lands. */
export async function recordVisit(profileUid: string | undefined, visitorUid: string | undefined): Promise<void> {
  if (!profileUid || !visitorUid || profileUid === visitorUid) return;
  try {
    await set(ref(database, `profileVisitors/${profileUid}/${visitorUid}`), { ts: Date.now(), seen: false });
  } catch { /* rules patch pending — never crash, never surface */ }
}

/** Live subscription to one profile's visitor map. */
export function subscribeVisitors(profileUid: string, cb: (map: VisitorMap) => void): () => void {
  return onValue(ref(database, `profileVisitors/${profileUid}`), (snap) => {
    cb(snap.exists() ? (snap.val() as VisitorMap) : {});
  }, () => cb({}));
}

/** One-time read of one profile's visitor map (for the mount-time mark-seen snapshot). */
export async function getVisitorMap(profileUid: string): Promise<VisitorMap> {
  try {
    const snap = await get(ref(database, `profileVisitors/${profileUid}`));
    return snap.exists() ? (snap.val() as VisitorMap) : {};
  } catch { return {}; }
}

/** Mark the given visitors seen (owner viewing the list). One update, snapshot keys only. */
export async function markVisitorsSeen(profileUid: string, visitorUids: string[]): Promise<void> {
  if (!profileUid || visitorUids.length === 0) return;
  const updates: Record<string, boolean> = {};
  for (const uid of visitorUids) updates[`${uid}/seen`] = true;
  try {
    await update(ref(database, `profileVisitors/${profileUid}`), updates);
  } catch { /* rules patch pending — never crash */ }
}
