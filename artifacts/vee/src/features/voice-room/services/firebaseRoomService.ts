/**
 * Firebase Voice Room Service
 * Rooms: create, join, leave, seat management, audience management
 *
 * BUG 14 fix: Room persistence — onDisconnect handlers now keep `active:true`
 *   and only remove the specific seat/audience entry. Rooms never auto-close
 *   on disconnect; only an explicit closeRoom() call deactivates a room.
 *
 * BUG 15 fix: Room lifecycle — owner disconnect no longer closes the room.
 *   The room stays active until closeRoom() is explicitly called by the host,
 *   OR until the server-side cleanup job auto-closes it after it has been
 *   empty (no seats, no audience) for >10 min — see
 *   artifacts/api-server/src/jobs/roomCleanup.ts. That same job also purges
 *   long-inactive rooms' data so old/empty rooms don't pile up in the DB.
 *   Client-side we only do explicit closes.
 *
 * BUG 16 fix: All subscriptions already use onValue (real-time); added
 *   null-guard for subscribeRoomInfo so consumers handle a closed/missing room.
 *
 * DB Structure:
 *   rooms/{roomId}/info         → RoomInfo
 *   rooms/{roomId}/seats/{idx}  → RoomSeat | null (10 seats, idx 0-9)
 *   rooms/{roomId}/audience/{uid} → RoomAudienceMember
 */

import {
  ref, set, update, remove, get, push,
  onValue, query, orderByChild, equalTo,
  serverTimestamp, DataSnapshot, runTransaction, onDisconnect,
  limitToLast,
} from 'firebase/database';
import { database, auth } from '@/src/config/firebase';
import { tryGetApiBase } from '@/src/utils/platform';
import { getApiBase } from '@/src/utils/platform';
import { MemberPreview, VoiceRoom } from '../types/room';
import { sendPushNotification } from '@/src/services/notifyService';
import { canReceiveRoomInvite } from '@/src/services/privacyService';

// ─── Types ───────────────────────────────────────────────────────────────────

export type RoomSeat = {
  userId: string;
  userName: string;
  initials: string;
  color: string;
  photoURL?: string;
  muted: boolean;
  role: 'host' | 'admin' | 'member';
} | null;

export type RoomAudienceMember = {
  userId: string;
  userName: string;
  initials: string;
  color: string;
  photoURL?: string;
  role?: 'member' | 'admin';
};

export type RoomInfo = {
  id: string;
  name: string;
  topic: string;
  description: string;
  themeColor: string;
  memberCount: number;
  maxMembers: number;
  isLive: boolean;
  isTrending: boolean;
  category: 'adda' | 'music' | 'game' | 'ludo' | 'trending' | 'talk' | 'study' | 'new';
  tags: string[];
  ownerId: string;
  ownerName: string;
  allowGifts: boolean;
  createdAt: number;
  memberPreviews: MemberPreview[];
  isPublic: boolean;
  /** When true, new audience members cannot join the room. */
  isLocked: boolean;
  listenerCount: number;
  active: boolean;
  coverImageUrl?: string;
  /** Set when the room is deactivated (explicit close or server auto-close). */
  closedAt?: number;
  /** Optional geolocation of the room creator — stored at creation time. */
  location?: { lat: number; lng: number };
  /** Synced room theme id (e.g. 'cosmic'). Changed by owner/admin, visible to all. */
  themeId?: string;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const USER_COLORS = [
  '#7C3AED', '#EC4899', '#3B82F6', '#10B981',
  '#F97316', '#A855F7', '#0EA5E9', '#22C55E',
  '#EF4444', '#F59E0B',
];

export function getUserColor(uid: string): string {
  let hash = 0;
  for (let i = 0; i < uid.length; i++) {
    hash = (hash + uid.charCodeAt(i)) % USER_COLORS.length;
  }
  return USER_COLORS[hash];
}

export function getInitials(name: string | undefined | null): string {
  if (!name) return '?';
  return name
    .split(' ')
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?';
}

// ─── Room CRUD ────────────────────────────────────────────────────────────────

/**
 * Atomically claim a unique 7-digit room ID AND write the full room info in
 * a single transaction.
 *
 * FIX (2026-10-10): Previously this reserved the slot with a {_reserving:true}
 * placeholder and createRoom() overwrote it with set(). When the set() (or a
 * later step) failed, the placeholder was never cleaned up — leaving nameless
 * zombie rooms ("Live · 0 members") polluting My Rooms. Writing the complete
 * info in the claiming transaction makes placeholder zombies impossible: if
 * the transaction fails/aborts, nothing is left behind.
 *
 * Returns the claimed room ID, or throws after MAX_TRIES attempts.
 */
async function claimRoomIdWithInfo(info: RoomInfo): Promise<string> {
  const MAX_TRIES = 20;
  for (let i = 0; i < MAX_TRIES; i++) {
    // 7-digit range: 1000000 – 9999999
    const id = String(Math.floor(1_000_000 + Math.random() * 9_000_000));
    const roomInfoRef = ref(database, `rooms/${id}/info`);
    let result;
    try {
      result = await runTransaction(roomInfoRef, (current) => {
        // If the slot is already taken (any non-null value), abort the transaction.
        // FIX (2026-10-10): Use != (loose) to catch BOTH null and undefined.
        // On first run, current can be undefined (no local cache) — the old
        // `!== null` check aborted even for empty slots, failing all 20 tries.
        if (current != null) return undefined;
        // Atomically claim with the complete room info (id stamped in).
        return { ...info, id };
      });
    } catch {
      // Transaction error (e.g. network blip) — try another ID.
      continue;
    }
    if (result.committed) return id;
  }
  throw new Error('Could not generate a unique room ID after 20 attempts');
}

/**
 * Delete stale {_reserving:true} placeholder rooms owned by the user.
 * These are leftovers from the pre-2026-10-10 two-step creation (reserve then
 * set). They render as nameless "Live · 0 members" cards. Best-effort.
 */
export async function cleanupStaleReservations(uid: string): Promise<number> {
  try {
    const { get, query, orderByChild, equalTo, remove } = await import('firebase/database');
    const q = query(ref(database, 'rooms'), orderByChild('info/ownerId'), equalTo(uid));
    const snap = await get(q);
    if (!snap.exists()) return 0;
    let deleted = 0;
    const jobs: Promise<void>[] = [];
    snap.forEach((child) => {
      const info = child.child('info').val() as Record<string, unknown> | null;
      // A reservation placeholder has _reserving:true and no name.
      if (info && (info as { _reserving?: boolean })._reserving === true) {
        const roomId = child.key as string;
        jobs.push(
          remove(ref(database, `rooms/${roomId}`))
            .then(() => { deleted += 1; })
            .catch(() => {})
        );
      }
    });
    await Promise.all(jobs);
    return deleted;
  } catch {
    return 0;
  }
}

/** Create a new room and put the host in seat 0. Returns roomId. */
export async function createRoom(data: {
  name: string;
  topic: string;
  description: string;
  isPublic: boolean;
  category: RoomInfo['category'];
  themeColor: string;
  hostId: string;
  hostName: string;
  /** RC6 fix Issue 5: host profile photo URL — stored in seat 0 so the host's
   *  avatar shows correctly in the seat grid immediately after room creation. */
  hostPhotoURL?: string;
  coverImageUrl?: string;
  /** Fix 6: Optional geolocation so this room appears in Nearby filters. */
  location?: { lat: number; lng: number };
  /** SHA-256 hashed PIN for private rooms. */
  hashedPin?: string;
}): Promise<string> {
  // DIAGNOSTIC (2026-10-10): Step-by-step logging to find the EXACT failure.
  // Each step is logged; errors include the step name and Firebase error code.
  const log = (step: string, detail?: string) => {
    console.log(`[createRoom] ${step}${detail ? ': ' + detail : ''}`);
  };

  // Timeout wrapper: Firebase ops must not hang forever (user reports long loading).
  // 15s per operation; throws TIMEOUT_<step> on expiry.
  const withTimeout = <T>(promise: Promise<T>, step: string, ms = 15000): Promise<T> => {
    return Promise.race([
      promise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`TIMEOUT_${step}`)), ms)
      ),
    ]);
  };

  // ROOM LIMITS (2026-10-10, Sumon's rule): max 2 public + 1 private per user.
  // Enforced here so the UI and any future callers all respect it.
  log('STEP1', 'checking room limits');
  let publicCount = 0, privateCount = 0;
  try {
    const counts = await withTimeout(getUserRoomCounts(data.hostId), 'LIMITS_CHECK');
    publicCount = counts.publicCount;
    privateCount = counts.privateCount;
    log('STEP1_OK', `public=${publicCount} private=${privateCount}`);
  } catch (e: any) {
    log('STEP1_FAIL', e?.message || String(e));
    throw new Error(`LIMITS_CHECK_FAILED: ${e?.message || String(e)}`);
  }
  if (data.isPublic && publicCount >= 2) {
    throw new Error('ROOM_LIMIT_PUBLIC');
  }
  if (!data.isPublic && privateCount >= 1) {
    throw new Error('ROOM_LIMIT_PRIVATE');
  }

  // PERMANENT FIX (2026-10-10): Firebase set() REJECTS objects containing
  // `undefined` values. The exact cause of the room-creation failure was
  // `memberPreviews[0].photoURL: undefined` (user has no profile photo).
  // This recursive stripper removes ALL undefined values from any object
  // before writing to Firebase — future-proof against any new optional field.
  const stripUndefined = (obj: any): any => {
    if (Array.isArray(obj)) {
      return obj.map(stripUndefined);
    }
    if (obj !== null && typeof obj === 'object') {
      const clean: any = {};
      for (const key of Object.keys(obj)) {
        if (obj[key] !== undefined) {
          clean[key] = stripUndefined(obj[key]);
        }
      }
      return clean;
    }
    return obj;
  };

  const info: RoomInfo = {
    id: '', // stamped below after ID generation
    name: data.name,
    topic: data.topic || 'Live now',
    description: data.description,
    themeColor: data.themeColor,
    memberCount: 1,
    maxMembers: 20,
    isLive: true,
    isTrending: false,
    category: data.category,
    tags: [],
    ownerId: data.hostId,
    ownerName: data.hostName,
    allowGifts: true,
    createdAt: Date.now(),
    memberPreviews: [
      {
        initials: getInitials(data.hostName),
        color: getUserColor(data.hostId),
        photoURL: data.hostPhotoURL,
      },
    ],
    isPublic: data.isPublic,
    isLocked: false,
    listenerCount: 0,
    active: true,
    ...(data.coverImageUrl ? { coverImageUrl: data.coverImageUrl } : {}),
    ...(data.location ? { location: data.location } : {}),
  };

  // FIX (2026-10-10 v2): Replaced the transaction-based claimRoomIdWithInfo
  // with a simple get-then-set. The transaction was failing on-device
  // (exact cause unknown — likely a validation rule interaction), causing
  // "Could not create room" for every attempt. This approach:
  // 1. Generates a random 7-digit ID
  // 2. Checks it doesn't exist via get()
  // 3. Writes the FULL room (info + host seat) in ONE set() — no placeholder,
  //    so a failed write never leaves a zombie.
  // Collision probability with 9M IDs is negligible; the get() check handles it.
  const { get: dbGet } = await import('firebase/database');
  log('STEP2', 'generating unique room ID');
  let roomId: string | null = null;
  for (let i = 0; i < 20; i++) {
    const id = String(Math.floor(1_000_000 + Math.random() * 9_000_000));
    try {
      const snap = await withTimeout(dbGet(ref(database, `rooms/${id}/info`)), 'ID_CHECK', 8000);
      if (!snap.exists()) {
        roomId = id;
        log('STEP2_OK', `id=${id} (try ${i + 1})`);
        break;
      }
      log('STEP2', `id ${id} taken, retrying`);
    } catch (e: any) {
      log('STEP2_TRY_FAIL', `try ${i + 1}: ${e?.message || String(e)}`);
      // Network blip — try another ID
      continue;
    }
  }
  if (!roomId) {
    log('STEP2_FAIL', 'all 20 tries exhausted');
    throw new Error('ID_GEN_FAILED: Could not generate a unique room ID after 20 attempts');
  }

  // Stamp the ID into the info
  const fullInfo: RoomInfo = stripUndefined({ ...info, id: roomId });

  // Build the host seat
  const hostSeat: NonNullable<RoomSeat> = stripUndefined({
    userId: data.hostId,
    userName: data.hostName,
    initials: getInitials(data.hostName),
    color: getUserColor(data.hostId),
    muted: false,
    role: 'host',
    ...(data.hostPhotoURL ? { photoURL: data.hostPhotoURL } : {}),
  });

  // FIX (2026-10-10 v3): Write info and seat SEPARATELY (like the last working
  // version a5a262e). A combined set(rooms/{id}, {info, seats}) fails because
  // the rooms/$roomId .write rule is delete-only, and there's no .write on the
  // intermediate `seats` node — Firebase denies the multi-child write.
  // Separate writes hit the specific child rules directly (info/.write and
  // seats/$seatIndex/.write), which allow creation.
  log('STEP3', `writing info to rooms/${roomId}/info`);
  try {
    await withTimeout(set(ref(database, `rooms/${roomId}/info`), fullInfo), 'INFO_WRITE');
    log('STEP3_OK', 'info written');
  } catch (e: any) {
    log('STEP3_FAIL', e?.message || String(e));
    throw new Error(`INFO_WRITE_FAILED: ${e?.message || String(e)}`);
  }

  log('STEP4', `writing seat to rooms/${roomId}/seats/0`);
  try {
    await withTimeout(set(ref(database, `rooms/${roomId}/seats/0`), hostSeat), 'SEAT_WRITE');
    log('STEP4_OK', 'seat written');
  } catch (e: any) {
    log('STEP4_FAIL', e?.message || String(e));
    // Seat write failed — remove the info so we don't leave a half-created room
    await remove(ref(database, `rooms/${roomId}`)).catch(() => {});
    throw new Error(`SEAT_WRITE_FAILED: ${e?.message || String(e)}`);
  }

  log('STEP5', 'room created successfully');
  try {

  // Record this room in the host's persistent "My Room" index. Never
  // removed on leave/exit, so the created room is always findable again.
  // background: safe to swallow — analytics index write
  recordUserRoomVisit(data.hostId, roomId, 'owner').catch(() => {});

  // Store hashed PIN for private rooms — non-fatal: room is still created even if this write fails
  if (!data.isPublic && data.hashedPin) {
    try {
      await set(ref(database, `roomPins/${roomId}`), { hashedPin: data.hashedPin, updatedAt: Date.now() });
    } catch {
      // PIN storage failure is non-fatal — the room is created without PIN enforcement.
      // This happens when Firebase security rules block the roomPins path.
    }
  }

  // FIX (2026-10-09): DO NOT use onDisconnect().remove() for host seat either.
  // Brief network blips were dropping the host from their seat. The seat now
  // persists until explicit leave or room close. Cancel any stale handler.
  const hostSeatRef = ref(database, `rooms/${roomId}/seats/0`);
  onDisconnect(hostSeatRef).cancel().catch(() => {/* non-critical */});

  return roomId;
  } catch (e) {
    // If any post-creation step fails, remove the just-created room so we
    // never leave a half-created room behind. The owner-delete rule allows this.
    await remove(ref(database, `rooms/${roomId}`)).catch(() => {});
    throw e;
  }
}

/**
 * Record that a user has created or joined a room, in their persistent
 * "My Room" index (userRooms/{uid}/{roomId}). This is never cleared on
 * leave/exit/minimize — it's what lets a room be found again in "My Room"
 * after the user has left it, exactly like a room they still own.
 */
export function recordUserRoomVisit(
  uid: string,
  roomId: string,
  role: 'owner' | 'member',
): Promise<void> {
  const payload = { joinedAt: Date.now(), role };
  // Write to both the per-user index (userRooms/{uid}/{roomId}) AND a
  // per-room reverse index (roomMembers/{roomId}/{uid}).  The reverse index
  // is what lets disbandRoom clean up ALL past members — not just those who
  // happen to be online at the moment of disband.
  return Promise.all([
    set(ref(database, `userRooms/${uid}/${roomId}`), payload),
    set(ref(database, `roomMembers/${roomId}/${uid}`), payload),
  ]).then(() => undefined);
}

/**
 * Subscribe to rooms created by the given user (My Rooms).
 * Uses orderByChild + equalTo for efficiency.
 */
export function subscribeMyRooms(
  userId: string,
  callback: (rooms: RoomInfo[]) => void,
): () => void {
  const myRoomsQuery = query(
    ref(database, 'rooms'),
    orderByChild('info/ownerId'),
    equalTo(userId),
  );
  return onValue(myRoomsQuery, (snap) => {
    if (!snap.exists()) { callback([]); return; }
    const rooms: RoomInfo[] = [];
    snap.forEach((child) => {
      const infoSnap = child.child('info');
      if (infoSnap.exists()) {
        const info = infoSnap.val() as RoomInfo & { _reserving?: boolean };
        // FIX (2026-10-10): Hide stale {_reserving:true} placeholders left by
        // the old two-step creation. They have no name and must never render
        // as rooms (cleanupStaleReservations deletes them in the background).
        if (info._reserving === true) return;
        // CRITICAL-8 fix: show ALL owned rooms regardless of active state
        rooms.push(info);
      }
    });
    rooms.sort((a, b) => b.createdAt - a.createdAt);
    callback(rooms);
  }, () => { callback([]); });
}

/**
 * Subscribe to the combined "My Room" list: rooms the user owns (created),
 * followed by rooms the user has joined (as audience or a seat) that they
 * don't own — ordered created-rooms-first, then joined rooms most-recently
 * joined first. Backed by the persistent userRooms/{uid} index, so a room
 * stays listed here even after the user minimizes or fully exits it.
 */
export function subscribeMyRoomsCombined(
  userId: string,
  callback: (rooms: RoomInfo[]) => void,
): () => void {
  let ownedRooms: RoomInfo[] = [];
  let joinedOrder: string[] = [];
  const joinedInfo = new Map<string, RoomInfo>();
  const joinedUnsubs = new Map<string, () => void>();

  function emit() {
    const ownedIds = new Set(ownedRooms.map((r) => r.id));
    const joined = joinedOrder
      .filter((id) => !ownedIds.has(id))
      .map((id) => joinedInfo.get(id))
      // Show only rooms that still exist AND are active. Disbanded rooms
      // (null info) and inactive/closed rooms are hidden from My Rooms.
      .filter((r): r is RoomInfo => !!r && r.active === true);
    // Owned rooms: show only if they still exist (not disbanded).
    const owned = ownedRooms.filter((r) => !!r);
    callback([...owned, ...joined]);
  }

  const unsubOwned = subscribeMyRooms(userId, (rooms) => {
    ownedRooms = rooms;
    emit();
  });

  const unsubIndex = onValue(
    // RC8-B2: cap to the 20 most recently joined rooms to bound the number of
    // nested room-info listeners created below. Previously unbounded — a user
    // who had joined hundreds of rooms created hundreds of simultaneous listeners.
    query(ref(database, `userRooms/${userId}`), orderByChild('joinedAt'), limitToLast(20)),
    (snap) => {
      const entries: { id: string; ts: number }[] = [];
      if (snap.exists()) {
        snap.forEach((child) => {
          const v = child.val() as { joinedAt?: number };
          entries.push({ id: child.key!, ts: v.joinedAt ?? 0 });
        });
      }
      entries.sort((a, b) => b.ts - a.ts); // most recently joined first
      const newIds = entries.map((e) => e.id);

      // Stop listening to rooms no longer in the index
      for (const [id, unsub] of joinedUnsubs) {
        if (!newIds.includes(id)) {
          unsub();
          joinedUnsubs.delete(id);
          joinedInfo.delete(id);
        }
      }
      // Start listening to any newly-added rooms
      for (const id of newIds) {
        if (!joinedUnsubs.has(id)) {
          const unsub = subscribeRoomInfo(id, (info) => {
            if (info) joinedInfo.set(id, info);
            else joinedInfo.delete(id);
            emit();
          });
          joinedUnsubs.set(id, unsub);
        }
      }
      joinedOrder = newIds;
      emit();
    },
    () => { joinedOrder = []; emit(); },
  );

  return () => {
    unsubOwned();
    unsubIndex();
    for (const unsub of joinedUnsubs.values()) unsub();
  };
}

/** Get all active public rooms in real-time. */
export function subscribeActiveRooms(
  callback: (rooms: RoomInfo[]) => void,
): () => void {
  // BUG 14 fix: Query rooms whose info.active === true.
  // orderByChild('info/active') on the 'rooms' collection traverses the
  // nested path — Firebase supports this. The matching index in
  // database.rules.json keeps this efficient.
  const activeRoomsQuery = query(
    ref(database, 'rooms'),
    orderByChild('info/active'),
    equalTo(true),
  );
  return onValue(activeRoomsQuery, (snap) => {
    if (!snap.exists()) { callback([]); return; }
    const rooms: RoomInfo[] = [];
    snap.forEach((child) => {
      const infoSnap = child.child('info');
      if (infoSnap.exists()) {
        const info = infoSnap.val() as RoomInfo;
        // Show ALL active rooms (both public and private) — UI shows lock icon for private
        if (info.active) rooms.push(info);
      }
    });
    rooms.sort((a, b) => b.createdAt - a.createdAt);
    callback(rooms);
  }, () => {
    // On subscription error (e.g. permission denied), return empty list
    // rather than leaving the UI stuck in loading state.
    callback([]);
  });
}

/** Subscribe to a room's info. */
export function subscribeRoomInfo(
  roomId: string,
  callback: (info: RoomInfo | null) => void,
): () => void {
  // BUG 16 fix: handle null snapshot (room deleted / closed)
  return onValue(ref(database, `rooms/${roomId}/info`), (snap) => {
    callback(snap.exists() ? (snap.val() as RoomInfo) : null);
  }, () => {
    callback(null);
  });
}

/** Subscribe to all seats (returns array of 10). */
export function subscribeSeats(
  roomId: string,
  callback: (seats: Array<RoomSeat>) => void,
): () => void {
  return onValue(ref(database, `rooms/${roomId}/seats`), (snap) => {
    const seats: Array<RoomSeat> = Array(10).fill(null);
    if (snap.exists()) {
      snap.forEach((child) => {
        const idx = parseInt(child.key ?? '0', 10);
        if (idx >= 0 && idx < 10) seats[idx] = child.val() as NonNullable<RoomSeat>;
      });
    }
    callback(seats);
  }, () => {
    callback(Array(10).fill(null));
  });
}

/** Subscribe to audience members. */
export function subscribeAudience(
  roomId: string,
  callback: (audience: RoomAudienceMember[]) => void,
): () => void {
  return onValue(ref(database, `rooms/${roomId}/audience`), (snap) => {
    const audience: RoomAudienceMember[] = [];
    if (snap.exists()) {
      snap.forEach((child) => {
        audience.push(child.val() as RoomAudienceMember);
      });
    }
    callback(audience);
  }, () => {
    callback([]);
  });
}

// ─── Audience ─────────────────────────────────────────────────────────────────

/** Add user to audience when they enter the room. */
export async function joinRoomAsAudience(
  roomId: string,
  member: RoomAudienceMember,
): Promise<void> {
  const audienceRef = ref(database, `rooms/${roomId}/audience/${member.userId}`);
  await set(audienceRef, member);
  // BUG 14/15 fix: if the app crashes/loses connection without an explicit
  // leave, Firebase removes this audience entry automatically so the room
  // doesn't show ghost members. The room info (active:true) is NOT touched
  // by this onDisconnect — rooms only close via an explicit closeRoom() call.
  onDisconnect(audienceRef).remove().catch(() => {/* non-critical */});
  // Record this room in the joiner's persistent "My Room" index (never
  // cleared on leave/exit — see recordUserRoomVisit).
  // background: safe to swallow — analytics index write
  recordUserRoomVisit(member.userId, roomId, 'member').catch(() => {});
  // Count update is best-effort
  _updateCounts(roomId).catch(() => {});
}

/** Remove user from audience. */
export async function leaveAudience(
  roomId: string,
  userId: string,
): Promise<void> {
  const audienceRef = ref(database, `rooms/${roomId}/audience/${userId}`);
  // Cancel any pending onDisconnect before removing manually
  onDisconnect(audienceRef).cancel().catch(() => {/* non-critical */});
  await remove(audienceRef);
}

// ─── Seat Management ─────────────────────────────────────────────────────────

/**
 * User takes a seat (moves from audience to seat).
 * Uses a transaction so two users racing for the same empty seat can't both
 * "win" — only the first writer succeeds, the second is rejected.
 */
// SEAT-SWITCH RACE FIX (2026-10-10): Serialize takeSeat calls per user per
// room with a promise-chain mutex. Rapid seat switches (3-4+ taps) fired
// overlapping takeSeat calls; each call's ghost-seat cleanup did a
// non-atomic get()+update(), so a LATE cleanup from switch #1 could delete
// the seat just claimed by switch #2 (and vice versa) — the user's ID then
// disappeared from every seat. Serializing guarantees each switch fully
// finishes (claim + ghost cleanup) before the next begins.
const takeSeatQueues = new Map<string, Promise<void>>();

export async function takeSeat(
  roomId: string,
  seatIndex: number,
  member: NonNullable<RoomSeat>,
): Promise<{ success: boolean }> {
  const queueKey = `${roomId}:${member.userId}`;
  const prev = takeSeatQueues.get(queueKey) ?? Promise.resolve();
  let release!: () => void;
  const ticket = new Promise<void>((r) => { release = r; });
  const tail = prev.catch(() => {}).then(() => ticket);
  takeSeatQueues.set(queueKey, tail);
  // Wait for our turn (a previous failure must not block the queue).
  await prev.catch(() => {});
  try {
    return await takeSeatInner(roomId, seatIndex, member);
  } finally {
    release();
    if (takeSeatQueues.get(queueKey) === tail) takeSeatQueues.delete(queueKey);
  }
}

async function takeSeatInner(
  roomId: string,
  seatIndex: number,
  member: NonNullable<RoomSeat>,
): Promise<{ success: boolean }> {
  const seatRef = ref(database, `rooms/${roomId}/seats/${seatIndex}`);
  const result = await runTransaction(seatRef, (current) => {
    if (current !== null) {
      // Seat already taken by someone else — abort the transaction.
      return undefined;
    }
    return member;
  });

  if (!result.committed) {
    return { success: false };
  }

  // GHOST FIX (2026-10-09): atomically clear EVERY other seat held by this
  // user. The UI's mySeatIdx-based removeSeat() is fire-and-forget and can be
  // stale, leaving ghost profiles that inflate member counts and duplicate
  // the member list. Clearing here (service level) is authoritative.
  try {
    const seatsSnap = await get(ref(database, `rooms/${roomId}/seats`));
    if (seatsSnap.exists()) {
      const ghostPaths: Record<string, null> = {};
      seatsSnap.forEach((child) => {
        const key = child.key ?? '';
        const s = child.val() as { userId?: string } | null;
        if (s && s.userId === member.userId && Number(key) !== seatIndex) {
          ghostPaths[`rooms/${roomId}/seats/${key}`] = null;
          // Also cancel any lingering onDisconnect for the ghost seat so a
          // later disconnect doesn't wipe the NEW seat by mistake.
          onDisconnect(ref(database, `rooms/${roomId}/seats/${key}`)).cancel().catch(() => {});
        }
      });
      if (Object.keys(ghostPaths).length > 0) {
        await update(ref(database), ghostPaths);
      }
    }
  } catch {
    // Non-critical — ghosts will be cleaned on next seat change; counts
    // are recomputed best-effort below.
  }

  // Seat won — clear the audience onDisconnect and register one for the seat
  // so a dropped connection frees the seat rather than leaving a ghost.
  const audienceRef = ref(database, `rooms/${roomId}/audience/${member.userId}`);
  onDisconnect(audienceRef).cancel().catch(() => {/* non-critical */});
  await remove(audienceRef);
  // FIX (2026-10-09): DO NOT use onDisconnect().remove() for seats.
  // Brief network blips (1-2 min) were dropping users from seats even though
  // they were still in the room. Seats now persist until explicit leaveSeat(),
  // room close, or the H8 ghost-seat cleanup on next seat take.
  // Cancel any stale onDisconnect from a previous seat to be safe.
  onDisconnect(seatRef).cancel().catch(() => {/* non-critical */});
  // Belt-and-suspenders: also record in "My Room" index in case a seat was
  // taken directly without going through joinRoomAsAudience first.
  // background: safe to swallow — analytics index write
  recordUserRoomVisit(member.userId, roomId, 'member').catch(() => {});
  _updateCounts(roomId).catch(() => {}); // best-effort
  return { success: true };
}

/** User leaves their seat (goes back to audience). */
export async function leaveSeat(
  roomId: string,
  seatIndex: number,
  userId: string,
  audienceMember?: RoomAudienceMember,
): Promise<void> {
  const seatRef = ref(database, `rooms/${roomId}/seats/${seatIndex}`);
  onDisconnect(seatRef).cancel().catch(() => {/* non-critical */});

  const ops: Promise<void>[] = [remove(seatRef)];
  if (audienceMember) {
    const audienceRef = ref(database, `rooms/${roomId}/audience/${userId}`);
    ops.push(set(audienceRef, audienceMember));
    onDisconnect(audienceRef).remove().catch(() => {/* non-critical */});
  }
  await Promise.all(ops);
  _updateCounts(roomId).catch(() => {}); // best-effort
}

/** Toggle mute on a seat. */
export async function setSeatMute(
  roomId: string,
  seatIndex: number,
  muted: boolean,
): Promise<void> {
  const seatRef = ref(database, `rooms/${roomId}/seats/${seatIndex}`);
  const snap = await get(seatRef).catch(() => null);
  if (!snap?.exists()) return; // Don't create phantom seats
  await update(seatRef, { muted });
}

/** Update role in a seat. */
export async function setSeatRole(
  roomId: string,
  seatIndex: number,
  role: 'host' | 'admin' | 'member',
): Promise<void> {
  const seatRef = ref(database, `rooms/${roomId}/seats/${seatIndex}`);
  const snap = await get(seatRef).catch(() => null);
  if (!snap?.exists()) return; // Don't create phantom seats
  await update(seatRef, { role });
}

/** Remove a member from a seat (kick). */
export async function removeSeat(
  roomId: string,
  seatIndex: number,
): Promise<void> {
  const seatRef = ref(database, `rooms/${roomId}/seats/${seatIndex}`);
  onDisconnect(seatRef).cancel().catch(() => {/* non-critical */});
  await remove(seatRef);
  _updateCounts(roomId).catch(() => {}); // best-effort
}

/** Remove a member from audience (kick). */
export async function removeAudienceMember(
  roomId: string,
  userId: string,
): Promise<void> {
  const audienceRef = ref(database, `rooms/${roomId}/audience/${userId}`);
  onDisconnect(audienceRef).cancel().catch(() => {/* non-critical */});
  await remove(audienceRef);
}

// ─── Room Lifecycle ───────────────────────────────────────────────────────────

/** Close the room (host only — explicit close). */
export async function closeRoom(roomId: string): Promise<void> {
  await Promise.all([
    update(ref(database, `rooms/${roomId}/info`), {
      active: false,
      isLive: false,
      closedAt: Date.now(),
    }),
    remove(ref(database, `rooms/${roomId}/seats`)),
    remove(ref(database, `rooms/${roomId}/audience`)),
  ]);
}

/**
 * Fully disband a room (owner only) — removes all data associated with the
 * room: the room itself, its PIN, blocks, seat requests, seat invites,
 * room invites, and the `userRooms` index for ALL members who ever joined
 * (past and present) — not just those currently online at disband time.
 *
 * Uses the `roomMembers/{roomId}` reverse index written by recordUserRoomVisit
 * to discover past members.  Falls back to scanning current seats/audience for
 * rooms created before the reverse index was introduced.
 */
export async function disbandRoom(roomId: string): Promise<void> {
  // Each path is removed independently — Firebase rules may block some paths
  // (e.g. roomPins when the room is not private) so we must not let one
  // failure block the rest. The primary room node is awaited last so the
  // room disappears from the list only after cleanup has been attempted.
  const tryRemove = (path: string) =>
    remove(ref(database, path)).catch(() => { /* non-critical */ });

  // ── Step 1: Collect ALL member UIDs ──────────────────────────────────────
  const uidSet = new Set<string>();

  try {
    // Primary source: roomMembers reverse index — covers every user who ever
    // called recordUserRoomVisit for this room (past + present members).
    const membersSnap = await get(ref(database, `roomMembers/${roomId}`));
    if (membersSnap.exists()) {
      membersSnap.forEach((child) => {
        if (child.key) uidSet.add(child.key);
      });
    }
  } catch { /* non-critical */ }

  try {
    // Fallback / supplement: scan current seats & audience for rooms that
    // pre-date the reverse index so no one is missed.
    const [seatsSnap, audSnap] = await Promise.all([
      get(ref(database, `rooms/${roomId}/seats`)),
      get(ref(database, `rooms/${roomId}/audience`)),
    ]);
    if (seatsSnap.exists()) {
      seatsSnap.forEach((child) => {
        const seat = child.val() as { userId?: string };
        if (seat?.userId) uidSet.add(seat.userId);
      });
    }
    if (audSnap.exists()) {
      audSnap.forEach((child) => {
        const aud = child.val() as { userId?: string };
        if (aud?.userId) uidSet.add(aud.userId);
      });
    }
  } catch { /* non-critical — we still disband even if we can't read members */ }

  const memberUids = Array.from(uidSet);

  // ── Step 2: Remove all side-tables and per-user index entries ─────────────
  await Promise.all([
    // Room-scoped side-tables
    tryRemove(`roomPins/${roomId}`),
    tryRemove(`roomBlocks/${roomId}`),
    tryRemove(`roomSeatRequests/${roomId}`),
    tryRemove(`seatInvites/${roomId}`),
    // Reverse index itself
    tryRemove(`roomMembers/${roomId}`),
    // Remove userRooms entry for EVERY member (past and present)
    ...memberUids.map((uid) => tryRemove(`userRooms/${uid}/${roomId}`)),
  ]);

  // ── Step 3: Remove the room itself ────────────────────────────────────────
  // Done last — room disappears from lists only after all cleanup is complete.
  // Firebase cascades: seats, audience, chat, reactions, lockedSeats all gone.
  await remove(ref(database, `rooms/${roomId}`));
}

/** Update room settings (name, topic, isPublic, isLocked, coverImageUrl). */
export async function updateRoomSettings(
  roomId: string,
  data: { name?: string; topic?: string; isPublic?: boolean; isLocked?: boolean; coverImageUrl?: string; themeId?: string; hashedPin?: string },
): Promise<void> {
  await update(ref(database, `rooms/${roomId}/info`), data);
}

// ─── Seat Lock (Firebase-synced) ─────────────────────────────────────────────

/** Lock a seat so no one can take it (stored in Firebase). */
export async function lockSeat(roomId: string, seatIndex: number): Promise<void> {
  await set(ref(database, `rooms/${roomId}/lockedSeats/${seatIndex}`), true);
}

/** Unlock a seat. */
export async function unlockSeat(roomId: string, seatIndex: number): Promise<void> {
  await remove(ref(database, `rooms/${roomId}/lockedSeats/${seatIndex}`));
}

/** Subscribe to locked seats (real-time). */
export function subscribeLockedSeats(
  roomId: string,
  callback: (locked: Set<number>) => void,
): () => void {
  return onValue(
    ref(database, `rooms/${roomId}/lockedSeats`),
    (snap) => {
      const locked = new Set<number>();
      if (snap.exists()) {
        snap.forEach((child) => {
          const idx = parseInt(child.key ?? '-1', 10);
          if (idx >= 0 && child.val() === true) locked.add(idx);
        });
      }
      callback(locked);
    },
    () => {
      // On subscription error (e.g. permission denied), return empty set
      // rather than leaving the UI with a stale locked-seats state.
      callback(new Set<number>());
    },
  );
}

// ─── Audience Role (Firebase-synced) ─────────────────────────────────────────

/** Update an audience member's role in Firebase. */
export async function setAudienceRole(
  roomId: string,
  userId: string,
  role: 'admin' | 'member',
): Promise<void> {
  await update(ref(database, `rooms/${roomId}/audience/${userId}`), { role });
}

// ─── Seat Request System ──────────────────────────────────────────────────────

export type SeatRequest = {
  id: string;
  userId: string;
  userName: string;
  initials: string;
  color: string;
  seatIdx: number;
  ts: number;
  hostId: string;
  status: 'pending' | 'approved' | 'rejected';
};

/** Audience member requests to take a specific seat (non-admin flow). */
export async function sendSeatRequest(
  roomId: string,
  request: Omit<SeatRequest, 'id' | 'status'>,
): Promise<string> {
  const reqRef = push(ref(database, `roomSeatRequests/${roomId}`));
  await set(reqRef, { ...request, status: 'pending' });
  return reqRef.key!;
}

/** Subscribe to PENDING seat requests for a room (real-time). */
export function subscribeSeatRequests(
  roomId: string,
  callback: (requests: SeatRequest[]) => void,
): () => void {
  return onValue(ref(database, `roomSeatRequests/${roomId}`), (snap) => {
    const requests: SeatRequest[] = [];
    if (snap.exists()) {
      snap.forEach((child) => {
        const v = child.val() as Omit<SeatRequest, 'id'>;
        if (v.status === 'pending') {
          requests.push({ id: child.key!, ...v });
        }
      });
    }
    callback(requests);
  });
}

/** Host approves a seat request → marks approved and push-notifies the requester. */
export async function approveSeatRequest(
  roomId: string,
  requestId: string,
): Promise<void> {
  const [reqSnap, infoSnap] = await Promise.all([
    get(ref(database, `roomSeatRequests/${roomId}/${requestId}`)),
    get(ref(database, `rooms/${roomId}/info/name`)),
  ]);

  await update(ref(database, `roomSeatRequests/${roomId}/${requestId}`), { status: 'approved' });

  if (reqSnap.exists()) {
    const req = reqSnap.val() as Omit<SeatRequest, 'id'>;
    const roomName = (infoSnap.val() as string | null) ?? 'the room';
    sendPushNotification(req.userId, 'Vee', `Your seat request was approved in "${roomName}"`, {
      type: 'seat-approved',
      roomId,
    }, 'voiceRooms');
  }
}

/** Host rejects a seat request → marks rejected and push-notifies the requester. */
export async function rejectSeatRequest(
  roomId: string,
  requestId: string,
): Promise<void> {
  const [reqSnap, infoSnap] = await Promise.all([
    get(ref(database, `roomSeatRequests/${roomId}/${requestId}`)),
    get(ref(database, `rooms/${roomId}/info/name`)),
  ]);

  await update(ref(database, `roomSeatRequests/${roomId}/${requestId}`), { status: 'rejected' });

  if (reqSnap.exists()) {
    const req = reqSnap.val() as Omit<SeatRequest, 'id'>;
    const roomName = (infoSnap.val() as string | null) ?? 'the room';
    sendPushNotification(req.userId, 'Vee', `Your seat request was declined in "${roomName}"`, {
      type: 'seat-rejected',
      roomId,
    }, 'voiceRooms');
  }
}

// ─── Room Block System (Firebase-persisted) ───────────────────────────────────

export type RoomBlockRecord = {
  userId: string;
  userName: string;
  initials: string;
  color: string;
  blockedAt: number;
  blockedBy: string;
  byName: string;
  action: 'room-block' | 'comment-block';
};

/** Write a block record to Firebase — persists across sessions. */
export async function blockUserInRoom(
  roomId: string,
  record: RoomBlockRecord,
): Promise<void> {
  await set(ref(database, `roomBlocks/${roomId}/${record.userId}`), record);
}

/** Remove a block from Firebase (unblock). */
export async function unblockUserInRoom(
  roomId: string,
  userId: string,
): Promise<void> {
  await remove(ref(database, `roomBlocks/${roomId}/${userId}`));
}

/** Subscribe to all room blocks in real-time. */
export function subscribeRoomBlocks(
  roomId: string,
  callback: (blocks: Map<string, RoomBlockRecord>) => void,
): () => void {
  return onValue(ref(database, `roomBlocks/${roomId}`), (snap) => {
    const blocks = new Map<string, RoomBlockRecord>();
    if (snap.exists()) {
      snap.forEach((child) => {
        if (child.key) blocks.set(child.key, child.val() as RoomBlockRecord);
      });
    }
    callback(blocks);
  });
}

/** One-time check: is this user blocked in this room? */
export async function isUserBlockedInRoom(
  roomId: string,
  userId: string,
): Promise<boolean> {
  const snap = await get(ref(database, `roomBlocks/${roomId}/${userId}`));
  return snap.exists();
}

// ─── Room Invite ────────────────────────────────────────────────────────────

/** Write a room invite for a user and push-notify them. */
export async function sendRoomInvite(
  roomId: string,
  roomName: string,
  inviterUid: string,
  inviterName: string,
  inviteeUid: string,
): Promise<void> {
  // Privacy enforcement: silently skip if the invitee has disabled invites.
  // We don't surface an error to the inviter to prevent probing user settings.
  const allowed = await canReceiveRoomInvite(inviteeUid);
  if (!allowed) return;

  await set(ref(database, `roomInvites/${inviteeUid}/${roomId}`), {
    roomId,
    roomName,
    inviterUid,
    inviterName,
    ts: Date.now(),
  });

  sendPushNotification(inviteeUid, inviterName, `invited you to join "${roomName}"`, {
    type: 'room-invite',
    roomId,
  }, 'voiceRooms');
}

// ─── Seat Invite System (Fix 1) ───────────────────────────────────────────────

export type SeatInvite = {
  id: string;
  roomId: string;
  roomName: string;
  seatIdx: number;
  inviterUid: string;
  inviterName: string;
  ts: number;
};

/**
 * Send a seat invite from host to an audience member.
 * Writes to seatInvites/{inviteeUid}/{inviteId} and push-notifies the invitee.
 */
export async function sendSeatInvite(
  inviteeUid: string,
  invite: Omit<SeatInvite, 'id'>,
): Promise<string> {
  const inviteRef = push(ref(database, `seatInvites/${inviteeUid}`));
  await set(inviteRef, invite);
  sendPushNotification(
    inviteeUid,
    invite.inviterName,
    `You've been invited to seat ${invite.seatIdx + 1} in "${invite.roomName}"`,
    { type: 'seat-invite', roomId: invite.roomId, seatIdx: invite.seatIdx },
    'voiceRooms',
  );
  return inviteRef.key!;
}

/** Subscribe to incoming seat invites for a specific room. */
export function subscribeSeatInvites(
  uid: string,
  roomId: string,
  callback: (invites: SeatInvite[]) => void,
): () => void {
  return onValue(ref(database, `seatInvites/${uid}`), (snap) => {
    const invites: SeatInvite[] = [];
    if (snap.exists()) {
      snap.forEach((child) => {
        const v = child.val() as Omit<SeatInvite, 'id'>;
        // Only return invites for THIS room
        if (v.roomId === roomId) {
          invites.push({ id: child.key!, ...v });
        }
      });
    }
    callback(invites);
  });
}

/** Remove a seat invite after accept or decline. */
export async function removeSeatInvite(uid: string, inviteId: string): Promise<void> {
  await remove(ref(database, `seatInvites/${uid}/${inviteId}`));
}

// ─── Emoji Reaction Broadcast (Fix 5) ────────────────────────────────────────

export type RoomEmojiReaction = {
  emoji: string;
  byUid: string;
  byName: string;
  ts: number;
};

/**
 * Broadcast an emoji reaction to all room participants.
 * Stored at rooms/{roomId}/reactions/{pushId} with TTL enforced client-side.
 */
export async function sendRoomEmojiReaction(
  roomId: string,
  reaction: Omit<RoomEmojiReaction, 'ts'>,
): Promise<void> {
  const reactionRef = push(ref(database, `rooms/${roomId}/reactions`));
  await set(reactionRef, { ...reaction, ts: Date.now() });
}

/**
 * Subscribe to emoji reactions in a room.
 * Callback fires with the latest reaction; caller filters by ts to ignore stale.
 */
export function subscribeRoomEmojiReactions(
  roomId: string,
  callback: (reaction: RoomEmojiReaction | null) => void,
): () => void {
  // Only listen to the most recent reaction to avoid replay storms
  const q = query(ref(database, `rooms/${roomId}/reactions`), limitToLast(1));
  return onValue(q, (snap) => {
    if (!snap.exists()) { callback(null); return; }
    let latest: RoomEmojiReaction | null = null;
    snap.forEach((child) => {
      latest = child.val() as RoomEmojiReaction;
    });
    callback(latest);
  });
}

// ─── Entry Broadcast (2026-10-10) ────────────────────────────────────────────
// When a user joins a room, broadcast an entry event so ALL participants see
// the "X is Coming" entry banner — not just the joiner.

export type RoomEntryEvent = {
  uid: string;
  name: string;
  photoURL?: string | null;
  ts: number;
};

/**
 * Broadcast a room entry event to all participants.
 * Stored at rooms/{roomId}/entries/{pushId} with TTL enforced client-side.
 */
export async function sendRoomEntryEvent(
  roomId: string,
  entry: Omit<RoomEntryEvent, 'ts'>,
): Promise<void> {
  const entryRef = push(ref(database, `rooms/${roomId}/entries`));
  await set(entryRef, { ...entry, ts: Date.now() });
}

/**
 * Subscribe to room entry events.
 * Callback fires with the latest entry; caller filters by ts to ignore stale.
 */
export function subscribeRoomEntryEvents(
  roomId: string,
  callback: (entry: RoomEntryEvent | null) => void,
): () => void {
  // Only listen to the most recent entry to avoid replay storms
  const q = query(ref(database, `rooms/${roomId}/entries`), limitToLast(1));
  return onValue(q, (snap) => {
    if (!snap.exists()) { callback(null); return; }
    let latest: RoomEntryEvent | null = null;
    snap.forEach((child) => {
      latest = child.val() as RoomEntryEvent;
    });
    callback(latest);
  });
}

// ─── Room Creation Limit ─────────────────────────────────────────────────────

/**
 * Get count of active owned public and private rooms for a user.
 * Enforces the 1-public + 1-private creation limit.
 */
export async function getUserRoomCounts(
  userId: string,
): Promise<{ publicCount: number; privateCount: number }> {
  const q = query(
    ref(database, 'rooms'),
    orderByChild('info/ownerId'),
    equalTo(userId),
  );
  const snap = await get(q);
  let publicCount = 0;
  let privateCount = 0;
  if (snap.exists()) {
    snap.forEach((child) => {
      const infoSnap = child.child('info');
      if (infoSnap.exists()) {
        const info = infoSnap.val() as RoomInfo;
        if (info.active) {
          if (info.isPublic) publicCount++;
          else privateCount++;
        }
      }
    });
  }
  return { publicCount, privateCount };
}

// ─── Room PIN (Private Room Security) ────────────────────────────────────────

/**
 * Store a SHA-256 hashed PIN for a private room.
 * Stored at roomPins/{roomId}, never inside room info.
 */
export async function storeRoomPin(roomId: string, hashedPin: string): Promise<void> {
  await set(ref(database, `roomPins/${roomId}`), { hashedPin, updatedAt: Date.now() });
}

/**
 * Verify a hashed PIN for a private room.
 * Returns true when the PIN hash matches, false otherwise.
 *
 * Uses server-side verification via /api/rooms/verify-pin (deployed 2026-10-06).
 * Direct Firebase read no longer works for non-owners (rules hardened).
 */
export async function verifyRoomPin(roomId: string, hashedPin: string): Promise<boolean> {
  try {
    const idToken = await auth.currentUser?.getIdToken().catch(() => null);
    const apiBase = tryGetApiBase();
    if (!idToken || !apiBase) return false;
    const res = await fetch(`${apiBase}/api/rooms/verify-pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ roomId, hashedPin }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return data?.ok === true;
  } catch {
    return false;
  }
}

/**
 * Delete a room PIN entry (called during session reset).
 */
export async function deleteRoomPin(roomId: string): Promise<void> {
  await remove(ref(database, `roomPins/${roomId}`));
}


// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Sync room member/listener counts.
 *
 * RC8-B2: Primary path calls the API server (which uses Firebase Admin SDK and
 * bypasses security rules). This fixes the P2-2 bug where seat holders — who
 * are neither the room owner nor in the audience list — had their direct
 * Firebase count-write silently rejected by the rules.
 *
 * Fallback: direct Firebase update (works for owner/audience only). Ensures
 * counts are still updated when the API server is unavailable (e.g. cold start).
 */
async function _updateCounts(roomId: string): Promise<void> {
  // Try via API server first (bypasses rules for seat holders)
  try {
    const idToken = await auth.currentUser?.getIdToken().catch(() => null);
    if (idToken) {
      const res = await fetch(`${getApiBase()}/api/rooms/sync-counts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ roomId }),
      });
      if (res.ok) return; // server updated counts successfully
    }
  } catch {
    // API unavailable — fall through to direct Firebase write
  }

  // Fallback: direct Firebase write (works for owner/audience, silent fail for seat holders)
  try {
    const [seatsSnap, audSnap] = await Promise.all([
      get(ref(database, `rooms/${roomId}/seats`)),
      get(ref(database, `rooms/${roomId}/audience`)),
    ]);

    let memberCount = 0;
    let listenerCount = 0;
    const memberPreviews: MemberPreview[] = [];
    // DEDUPE (2026-10-09): count unique users only — ghost seats must never
    // inflate the live member count shown on room cards.
    const seenUserIds = new Set<string>();

    if (seatsSnap.exists()) {
      seatsSnap.forEach((child) => {
        const seat = child.val() as NonNullable<RoomSeat>;
        const uid = (seat as { userId?: string }).userId;
        if (uid && seenUserIds.has(uid)) return; // ghost — skip
        if (uid) seenUserIds.add(uid);
        memberCount++;
        // 2026-10-09: include real profile photo so cards show actual DPs.
        memberPreviews.push({
          initials: seat.initials,
          color: seat.color,
          photoURL: (seat as any).photoURL,
        });
      });
    }
    if (audSnap.exists()) {
      audSnap.forEach(() => { listenerCount++; });
    }

    await update(ref(database, `rooms/${roomId}/info`), {
      memberCount,
      listenerCount,
      memberPreviews: memberPreviews.slice(0, 6),
      isTrending: memberCount >= 5,
    });
  } catch {
    // Non-critical — count will be corrected by next seat/audience change
  }
}
