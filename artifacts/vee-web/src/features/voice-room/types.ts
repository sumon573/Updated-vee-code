/**
 * Voice-room shared types (web port of the native `types/room.ts` seat shapes
 * plus the RTDB shapes from API_CONTRACT.md).
 *
 * Contract notes:
 *  - `rooms/{roomId}/seats/{0..9}` — 10 speaker seats, idx 0 = host.
 *  - `rooms/{roomId}/audience/{uid}` — listeners.
 *  - `rooms/{roomId}/lockedSeats/{idx}` — host-locked seats (value `true`).
 *  - `rooms/{roomId}/giftFeed/{pushId}` — gift receive entries.
 */

/** Number of speaker seats per room (contract: seats/{0..9}). */
export const SEAT_COUNT = 10;

export type SeatRole = 'host' | 'admin' | 'member';

export interface RoomSeat {
  userId: string;
  userName: string;
  initials: string;
  color: string;
  photoURL?: string;
  muted: boolean;
  role: SeatRole;
}

export interface RoomAudienceMember {
  userId: string;
  userName: string;
  initials: string;
  color: string;
  photoURL?: string;
  role?: 'member' | 'admin';
}

export interface RoomInfoShape {
  id: string;
  name: string;
  topic: string;
  themeColor: string;
  ownerId: string;
  ownerName: string;
  allowGifts: boolean;
  active: boolean;
  isLive: boolean;
  isPublic?: boolean;
  isLocked?: boolean;
}

/** Shape of a `rooms/{roomId}/giftFeed/{pushId}` entry (per contract). */
export interface GiftFeedEntry {
  fromUid: string;
  fromName: string;
  toUid: string;
  toName: string;
  giftId: string;
  emoji: string;
  coins: number;
  ts: number;
  fromAvatar?: string;
  toAvatar?: string;
}

/** Deterministic pastel-ish avatar color from a name (avatar fallback). */
export function hashAvatarColor(name: string): string {
  let h = 0;
  const s = name || '?';
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 360;
  return `hsl(${h}, 62%, 44%)`;
}

/** Initial letters for an avatar fallback. */
export function initialsOf(name: string): string {
  const parts = (name || '?').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
