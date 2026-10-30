/**
 * roomEntryCache.ts — 2026-10-29 (boss: slow-network room entry is far too slow).
 *
 * Cached-first voice-room entry: the last-known room header + seat occupants
 * for a room, persisted in AsyncStorage, so entering a room paints instantly
 * (name, topic, cover, seated occupants) while the slow network's live
 * subscriptions are still connecting. Live data always replaces the cache on
 * first delivery — the cache is display-only seed data, never a substitute
 * for live state.
 *
 * Stored fields are DISPLAY/IDENTITY only: room name/topic/cover + each
 * seat's occupant id, name, initials, color, photo, role, frame, noble rank.
 * NEVER stored: muted / hostMuted / speaking — those are volatile live state
 * and must always come from the live subscription. Seat actions are
 * server-guarded (takeSeat runs a transaction that aborts on another
 * occupant), so a tap landing on a stale cached row during the brief
 * pre-live window fails safely instead of corrupting state.
 *
 * Write rule (enforced by the caller): only write after live data has
 * delivered at least once for the room (seatsLoadedRef), and only when the
 * identity signature changes — speaking/mute/heartbeat churn must never
 * cause a write. Best-effort throughout: any failure leaves the cache
 * untouched and entry falls back to today's empty-until-live behavior.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export type CachedSeatOccupant = {
  id: string;
  name: string;
  initials: string;
  color: string;
  photoURL?: string;
  role: string;
  roleLevel?: number;
  activeFrame?: string;
  nobleRankIndex?: number;
};

export type RoomEntryCache = {
  name?: string;
  topic?: string;
  imageUri?: string | null;
  /** 10 slots, null = empty seat — same shape as the screen's seats state. */
  seats: Array<CachedSeatOccupant | null>;
  savedAt: number;
};

const keyFor = (roomId: string) => `vee_room_entry_v1_${roomId}`;

function isValidSeat(s: unknown): s is CachedSeatOccupant {
  if (!s || typeof s !== 'object') return false;
  const o = s as Record<string, unknown>;
  return typeof o.id === 'string' && !!o.id
    && typeof o.name === 'string'
    && typeof o.initials === 'string'
    && typeof o.color === 'string'
    && typeof o.role === 'string';
}

export async function getRoomEntryCache(roomId: string): Promise<RoomEntryCache | null> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(roomId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RoomEntryCache>;
    if (!Array.isArray(parsed.seats)) return null;
    const seats: Array<CachedSeatOccupant | null> = [];
    for (let i = 0; i < 10; i++) {
      const s = parsed.seats[i];
      seats.push(isValidSeat(s) ? {
        id: s.id,
        name: s.name,
        initials: s.initials,
        color: s.color,
        photoURL: typeof s.photoURL === 'string' ? s.photoURL : undefined,
        role: s.role,
        roleLevel: typeof s.roleLevel === 'number' ? s.roleLevel : undefined,
        activeFrame: typeof s.activeFrame === 'string' ? s.activeFrame : undefined,
        nobleRankIndex: typeof s.nobleRankIndex === 'number' ? s.nobleRankIndex : undefined,
      } : null);
    }
    return {
      name: typeof parsed.name === 'string' ? parsed.name : undefined,
      topic: typeof parsed.topic === 'string' ? parsed.topic : undefined,
      imageUri: typeof parsed.imageUri === 'string' ? parsed.imageUri : null,
      seats,
      savedAt: typeof parsed.savedAt === 'number' ? parsed.savedAt : 0,
    };
  } catch {
    return null;
  }
}

export async function saveRoomEntryCache(roomId: string, data: RoomEntryCache): Promise<void> {
  try {
    await AsyncStorage.setItem(keyFor(roomId), JSON.stringify({ ...data, savedAt: Date.now() }));
  } catch {
    // Best-effort — a failed cache write must never break entry.
  }
}
