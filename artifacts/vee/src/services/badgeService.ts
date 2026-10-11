/**
 * Badge / Nameplate / Frame service (NOTE 8+9, 2026-10-11).
 *
 * Real granted items only — officially granted (by admin) or claimed from
 * special events. Stored in Firebase:
 *   users/{uid}/badges/{badgeId}      → GrantedBadge
 *   users/{uid}/nameplates/{plateId}  → GrantedNameplate
 *   users/{uid}/frames/{frameId}      → GrantedFrame
 *
 * No demo/placeholder content: lists are empty until real items exist.
 * Security: readable by any authenticated user (so friends/public can see
 * badges); writable by the owner or an admin (see database.rules.json).
 */
import { ref, onValue, set } from 'firebase/database';
import { database } from '../config/firebase';
import type { GrantedBadge } from '../data/honor';

export interface GrantedNameplate {
  id: string;
  name: string;
  icon: string;
  /** Epoch ms when granted/claimed */
  obtainedAt: number;
  /** 'permanent' or epoch ms expiry — visible to the owner only */
  validity: 'permanent' | number;
  /** 'official' → Verification section, 'event' → Achievement section */
  source: 'official' | 'event';
  description?: string;
  grantedBy?: string;
}

export interface GrantedFrame {
  id: string;
  name: string;
  /** emoji icon or image URL */
  icon: string;
  obtainedAt: number;
  validity: 'permanent' | number;
  source: 'official' | 'event';
  description?: string;
  grantedBy?: string;
}

/**
 * Normalize a Firebase list that may be stored as an array OR as a
 * keyed map ({ id1: {...}, id2: {...} }). Returns a clean array.
 */
function normalizeList<T extends { id: string }>(raw: unknown): T[] {
  if (!raw) return [];
  const arr: unknown[] = Array.isArray(raw) ? raw : Object.values(raw as Record<string, unknown>);
  return arr.filter(
    (x): x is T =>
      !!x &&
      typeof (x as any).id === 'string' &&
      typeof (x as any).name === 'string',
  );
}

function subscribeList<T extends { id: string }>(
  uid: string,
  node: 'badges' | 'nameplates' | 'frames',
  callback: (items: T[]) => void,
): () => void {
  const listRef = ref(database, `users/${uid}/${node}`);
  return onValue(
    listRef,
    (snap) => {
      try {
        callback(snap.exists() ? normalizeList<T>(snap.val()) : []);
      } catch {
        // Malformed data — keep the last good list rather than wiping it.
      }
    },
    () => {
      // Transient listener error — keep the last good list; the next
      // successful snapshot will refresh it.
    },
  );
}

/** Subscribe to a user's real granted badges. */
export function subscribeBadges(
  uid: string,
  callback: (badges: GrantedBadge[]) => void,
): () => void {
  return subscribeList<GrantedBadge>(uid, 'badges', (items) =>
    callback(
      items
        .filter((b) => typeof (b as any).icon === 'string')
        .sort((a, b) => (b.obtainedAt || 0) - (a.obtainedAt || 0)),
    ),
  );
}

/** Subscribe to a user's real granted nameplates. */
export function subscribeNameplates(
  uid: string,
  callback: (plates: GrantedNameplate[]) => void,
): () => void {
  return subscribeList<GrantedNameplate>(uid, 'nameplates', (items) =>
    callback(items.sort((a, b) => (b.obtainedAt || 0) - (a.obtainedAt || 0))),
  );
}

/** Subscribe to a user's real granted frames. */
export function subscribeFrames(
  uid: string,
  callback: (frames: GrantedFrame[]) => void,
): () => void {
  return subscribeList<GrantedFrame>(uid, 'frames', (items) =>
    callback(items.sort((a, b) => (b.obtainedAt || 0) - (a.obtainedAt || 0))),
  );
}

/** Admin-side: grant a badge to a user (officially). */
export async function grantBadge(uid: string, badge: GrantedBadge): Promise<void> {
  await set(ref(database, `users/${uid}/badges/${badge.id}`), {
    ...badge,
    source: (badge as any).source || 'official',
  });
}

/** Admin-side: grant a nameplate to a user (officially). */
export async function grantNameplate(uid: string, plate: GrantedNameplate): Promise<void> {
  await set(ref(database, `users/${uid}/nameplates/${plate.id}`), plate);
}

/** Admin-side: grant a frame to a user (officially). */
export async function grantFrame(uid: string, frame: GrantedFrame): Promise<void> {
  await set(ref(database, `users/${uid}/frames/${frame.id}`), frame);
}

/** "First obtained on" date — visible to everyone (friends/public). Format: DD-MM-YYYY */
export function formatObtainedDate(ts: number): string {
  if (!ts || typeof ts !== 'number') return '—';
  const d = new Date(ts);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

/**
 * Validity text — visible to the badge OWNER ONLY.
 * 'permanent' → "Permanent", timestamp → "Valid for DD-MM-YYYY".
 */
export function formatValidity(validity: 'permanent' | number | undefined): string {
  if (validity === 'permanent' || !validity) return 'Permanent';
  return `Valid for ${formatObtainedDate(validity)}`;
}

/** True when a time-limited badge/frame is still valid. Permanent ones never expire. */
export function isStillValid(validity: 'permanent' | number | undefined): boolean {
  if (validity === 'permanent' || !validity) return true;
  return validity > Date.now();
}
