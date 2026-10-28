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
import { getErrorCause } from '@/src/utils/errorDisplay';
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
  /** 2026-10-24 (boss: host-mute must stick): SEPARATE host-mute flag.
      `muted` is the member's OWN mic choice (written by their mic button);
      `hostMuted` is set ONLY by room owner/admins and can ONLY be cleared
      by them. The old single-flag model let the member's mic button
      overwrite a host mute (setSeatMute false) and unmute themselves —
      that is the bug this flag kills. Effective mic = muted || hostMuted. */
  hostMuted?: boolean;
  role: 'host' | 'admin' | 'member';
  /** 2026-10-19 (IMO port Phase 1): numeric role level (9000/8000/7000).
      Written going forward; readers fall back to string role when absent. */
  roleLevel?: number;
  // 2026-10-14 (Sumon): active frame id — synced from user profile to seat
  activeFrame?: string;
  // 2026-10-15 (Sumon): noble rank index (0-9) — for per-rank speaking ripple.
  // Written by the seat holder from their real noble state at join time.
  nobleRankIndex?: number;
  // P1 ghost-seat fix (2026-10-12): server-timestamp heartbeat, refreshed
  // every ~60s by the seat holder. Seats with a stale/absent heartbeat are
  // swept as crashed/killed clients (see sweepStaleSeats).
  seatTs?: number;
} | null;

export type RoomAudienceMember = {
  userId: string;
  userName: string;
  initials: string;
  color: string;
  photoURL?: string;
  role?: 'member' | 'admin';
  /** 2026-10-19 (IMO port Phase 1): numeric role level (8000/7000). */
  roleLevel?: number;
  /** 2026-10-13 (Sumon): active frame id for audience list display */
  activeFrame?: string;
  /** 2026-10-15 (Sumon): noble rank index (0-9) — for per-rank entry effect. */
  nobleRankIndex?: number;
  /** 2026-10-20 (boss): audience heartbeat (ms epoch) — refreshed every ~60s
   *  while in the room (refreshAudienceHeartbeat); entries with a missing or
   *  >5-min-old ts are ghosts (crashed/killed before onDisconnect cleanup)
   *  and are swept by sweepStaleAudience + ignored by live counters. */
  ts?: number;
};

export type RoomInfo = {
  id: string;
  name: string;
  topic: string;
  description: string;
  themeColor: string;
  memberCount: number;
  /** Total live in room (seated + audience) — for list/trending. memberCount stays seated-only for Room Info. */
  liveCount?: number;
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
  /** Total diamonds sent as gifts in this room (2026-10-11): drives Trending ranking. */
  totalDiamonds?: number;
  /** Set when the room is deactivated (explicit close or server auto-close). */
  closedAt?: number;
  /** Optional geolocation of the room creator — stored at creation time. */
  location?: { lat: number; lng: number };
  /** PIN version — bumped on every PIN change (2026-10-12, Sumon). Clients
   *  cache the verified version; a bump forces re-entry with the NEW pin. */
  pinVersion?: number;
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
    totalDiamonds: 0,
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
    roleLevel: 9000, // 2026-10-19 (IMO port Phase 1): numeric ChannelRole.OWNER
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
  // 2026-10-20 FIX (boss): re-entry must NEVER downgrade an existing role or
  // reset the original join time. The old set() clobbered the owner's
  // roomMembers record to role 'member' (fresh joinedAt) every time he
  // re-entered his own room via joinRoomAsAudience/takeSeat, so Room Info
  // classified the owner as a regular member. Preserve the stronger role
  // (owner > admin > member) and the earliest joinedAt already on record.
  const rank = (r?: string) => (r === 'owner' ? 3 : r === 'admin' ? 2 : 1);
  return get(ref(database, `roomMembers/${roomId}/${uid}`))
    .catch(() => null)
    .then((snap) => {
      const existing = (snap?.val() ?? null) as { role?: string; joinedAt?: number } | null;
      const finalRole = rank(existing?.role) > rank(role) ? (existing!.role as 'owner' | 'member') : role;
      const payload = {
        joinedAt: typeof existing?.joinedAt === 'number' && existing.joinedAt > 0 ? existing.joinedAt : Date.now(),
        role: finalRole };
      // Write to both the per-user index (userRooms/{uid}/{roomId}) AND a
      // per-room reverse index (roomMembers/{roomId}/{uid}).  The reverse index
      // is what lets disbandRoom clean up ALL past members — not just those who
      // happen to be online at the moment of disband.
      return Promise.all([
        set(ref(database, `userRooms/${uid}/${roomId}`), payload),
        set(ref(database, `roomMembers/${roomId}/${uid}`), payload),
      ]);
    })
    .then(() => undefined);
}

/**
 * 2026-10-16 (Sumon): REAL LEAVE — completely remove user from room.
 * Removes from roomMembers, userRooms, audience, and seats.
 * After this, the room vanishes from user's lists everywhere.
 */
export async function leaveRoomCompletely(
  roomId: string,
  uid: string,
): Promise<void> {
  const { remove } = await import('firebase/database');
  await Promise.all([
    remove(ref(database, `roomMembers/${roomId}/${uid}`)).catch(() => {}),
    remove(ref(database, `userRooms/${uid}/${roomId}`)).catch(() => {}),
    remove(ref(database, `rooms/${roomId}/audience/${uid}`)).catch(() => {}),
  ]);
}

/**
 * Remove ANOTHER member from a room (owner/admin panel action, 2026-10-27).
 * Deletes the membership itself (roomMembers + userRooms), the audience
 * record, and the seat if the target is seated — so no seated-non-member
 * remains. Membership deletes propagate errors (a rules denial must surface
 * in the UI, never a false success); audience / admin-registry cleanup is
 * best-effort. NOTE: the seat is cleared with plain removeSeat (no
 * demoteUid) — the demote path rewrites roomMembers/{uid}/role back to
 * 'member', which would resurrect the membership record just deleted.
 */
export async function removeMemberFromRoom(
  roomId: string,
  targetUid: string,
): Promise<void> {
  const seatsSnap = await get(ref(database, `rooms/${roomId}/seats`)).catch(() => null);
  const seatsVal = seatsSnap?.val();
  if (seatsVal && typeof seatsVal === 'object') {
    for (const [idx, seat] of Object.entries(seatsVal as Record<string, unknown>)) {
      const rec = seat as { userId?: unknown } | null;
      if (rec && rec.userId === targetUid) {
        await removeSeat(roomId, Number(idx));
        break;
      }
    }
  }
  await Promise.all([
    remove(ref(database, `roomMembers/${roomId}/${targetUid}`)),
    remove(ref(database, `userRooms/${targetUid}/${roomId}`)),
  ]);
  await Promise.all([
    removeAudienceMember(roomId, targetUid).catch(() => {}),
    revokeRoomAdmin(roomId, targetUid).catch(() => {}),
  ]);
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
    // Owned rooms: show only if they still exist (not disbanded) AND active.
    // Per Sumon 2026-10-12: closed rooms appear NOWHERE in the app.
    const owned = ownedRooms.filter((r) => !!r && r.active === true);
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
  onError?: () => void,
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
    // 2026-10-26 (boss: trending showed "No rooms" for a live room): an
    // error is NOT an empty list. Callers that pass onError keep their
    // cached list instead of wiping it with []; legacy callers keep the
    // old callback([]) behaviour.
    if (onError) onError();
    else callback([]);
  });
}

/** Subscribe to private active rooms only (CDN-directory companion:
 * the edge directory serves public rooms; private rooms still come from
 * Firebase so they never touch a public CDN cache). */
export function subscribePrivateActiveRooms(
  callback: (rooms: RoomInfo[]) => void,
  onError?: () => void,
): () => void {
  const privateRoomsQuery = query(
    ref(database, 'rooms'),
    orderByChild('info/isPublic'),
    equalTo(false),
  );
  return onValue(privateRoomsQuery, (snap) => {
    if (!snap.exists()) { callback([]); return; }
    const rooms: RoomInfo[] = [];
    snap.forEach((child) => {
      const infoSnap = child.child('info');
      if (infoSnap.exists()) {
        const info = infoSnap.val() as RoomInfo;
        if (info.active) rooms.push(info);
      }
    });
    rooms.sort((a, b) => b.createdAt - a.createdAt);
    callback(rooms);
  }, () => {
    if (onError) onError();
    else callback([]);
  });
}

/** Subscribe to a room's info. */
export function subscribeRoomInfo(
  roomId: string,
  callback: (info: RoomInfo | null) => void,
): () => void {
  // BUG 16 fix: handle null snapshot (room deleted / closed)
  // 2026-10-26 (weak network): an error must NOT deliver null mid-room —
  // consumers read null as "room closed". Keep last info instead.
  let delivered = false;
  return onValue(ref(database, `rooms/${roomId}/info`), (snap) => {
    delivered = true;
    callback(snap.exists() ? (snap.val() as RoomInfo) : null);
  }, () => {
    if (!delivered) { delivered = true; callback(null); }
  });
}

/** Subscribe to all seats (returns array of 10). */
export function subscribeSeats(
  roomId: string,
  callback: (seats: Array<RoomSeat>) => void,
): () => void {
  // 2026-10-26 (weak network): a transient network error must NEVER wipe
  // the seat grid mid-room (it read as "everyone left"). Keep the last
  // delivered seats; the SDK retries silently. Only a first-load error
  // delivers the empty grid (so loading still clears).
  let delivered = false;
  return onValue(ref(database, `rooms/${roomId}/seats`), (snap) => {
    const seats: Array<RoomSeat> = Array(10).fill(null);
    if (snap.exists()) {
      snap.forEach((child) => {
        const idx = parseInt(child.key ?? '0', 10);
        if (idx >= 0 && idx < 10) seats[idx] = child.val() as NonNullable<RoomSeat>;
      });
    }
    // 2026-10-23 (boss: "একটা আইডি দুই জায়গায় দেখাচ্ছে" — NEVER again):
    // render-level guarantee — the same userId must never render in two
    // seats at once, even in the brief window where a ghost seat still
    // exists in the data. Keep the seat with the freshest heartbeat
    // (seatTs); ties keep the lower seat index.
    const bestIdxByUser = new Map<string, number>();
    for (let i = 0; i < seats.length; i++) {
      const s = seats[i] as { userId?: string; seatTs?: number } | null;
      if (!s || !s.userId) continue;
      const prev = bestIdxByUser.get(s.userId);
      if (prev === undefined) { bestIdxByUser.set(s.userId, i); continue; }
      const prevTs = (seats[prev] as { seatTs?: number } | null)?.seatTs ?? 0;
      if ((s.seatTs ?? 0) > prevTs) {
        seats[prev] = null;
        bestIdxByUser.set(s.userId, i);
      } else {
        seats[i] = null;
      }
    }
    delivered = true;
    callback(seats);
  }, () => {
    if (!delivered) { delivered = true; callback(Array(10).fill(null)); }
  });
}

/** Subscribe to audience members. */
export function subscribeAudience(
  roomId: string,
  callback: (audience: RoomAudienceMember[]) => void,
): () => void {
  // 2026-10-26 (weak network): same keep-last-known rule as seats.
  let delivered = false;
  return onValue(ref(database, `rooms/${roomId}/audience`), (snap) => {
    const audience: RoomAudienceMember[] = [];
    if (snap.exists()) {
      snap.forEach((child) => {
        audience.push(child.val() as RoomAudienceMember);
      });
    }
    delivered = true;
    callback(audience);
  }, () => {
    if (!delivered) { delivered = true; callback([]); }
  });
}

/**
 * Subscribe to the room's admin registry (rooms/{roomId}/admins).
 * 2026-10-22 (boss): the registry is the SOURCE OF TRUTH for admin role —
 * the security rules check it, so the UI must too. Deriving role only from
 * seat/audience labels lost admin powers on every rejoin (the audience
 * write carried no role) until the server guard healed the label.
 */
export function subscribeRoomAdmins(
  roomId: string,
  callback: (adminUids: Set<string>) => void,
): () => void {
  return onValue(ref(database, `rooms/${roomId}/admins`), (snap) => {
    const uids = new Set<string>();
    if (snap.exists()) {
      snap.forEach((child) => {
        if (child.val() === true && child.key) uids.add(child.key);
      });
    }
    callback(uids);
  }, () => {
    callback(new Set<string>());
  });
}

// ─── Audience ─────────────────────────────────────────────────────────────────

/** Add user to audience when they enter the room. */
export async function joinRoomAsAudience(
  roomId: string,
  member: RoomAudienceMember,
): Promise<void> {
  const audienceRef = ref(database, `rooms/${roomId}/audience/${member.userId}`);
  // 2026-10-22 (boss): the admins registry is the source of truth for role.
  // This set() used to write the member object with NO role at all, so every
  // join/reconnect silently demoted admins to 'member' in the UI until the
  // server guard healed the label (up to a minute of lost powers — and any
  // seat claimed in that window carried 'member' too). Stamp the registry
  // role into the entry at write time.
  let entry: RoomAudienceMember = member;
  try {
    const adminSnap = await get(ref(database, `rooms/${roomId}/admins/${member.userId}`));
    if (adminSnap.exists() && adminSnap.val() === true) {
      entry = { ...member, role: 'admin', roleLevel: 8000 };
    }
  } catch { /* best-effort — the live registry subscription still applies */ }
  // 2026-10-20 (boss): stamp the heartbeat so a crashed session's leftover
  // entry ages out (see sweepStaleAudience) instead of showing a phantom
  // member in an empty room forever.
  await set(audienceRef, { ...entry, ts: serverTimestamp() });
  // 2026-10-22 ROOT FIX (boss, server-log proven): NO onDisconnect removal
  // for presence entries anymore. The old BUG 14/15 arm deleted the entry
  // on ANY RTDB socket drop — and backgrounded phones drop that socket
  // routinely (Doze/OEM network freezes) while the user is still live in
  // the room on LiveKit, so seats/audience vanished mid-session (falls at
  // 18:42 + 18:45 on 2026-10-22 while the user never left). Presence is
  // now heartbeat-based: entries carry `ts`, and VeeGuard sweeps only
  // entries stale >5 min whose user is NOT a live LiveKit participant.
  // Explicit leave still removes the entry immediately (leaveAudience).
  // 2026-10-27 (boss): audience entry must NOT create membership.
  // Entry = audience ONLY. The member record (roomMembers + userRooms)
  // is written ONLY when the user taps the green + button (handleJoinRoom),
  // takes a seat, or owns the room. Previously this line wrote the record
  // on every entry, so every visitor auto-became a member forever.
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
  // 2026-10-20 FIX (boss): routine exit removes LIVE PRESENCE ONLY. The
  // 2026-10-16 lines that also deleted roomMembers/userRooms here erased
  // every joined member from Room Info the moment they left the room
  // (e.g. a member who joined, sent gifts, then exited vanished from the
  // member list entirely). Membership is persistent by design — see
  // recordUserRoomVisit ("never cleared on leave/exit") and
  // subscribeRoomMembers ("covers everyone who ever joined"). Joined
  // membership ends only via leaveRoomCompletely / disbandRoom.
  // 2026-10-11 Issue #1: refresh cached counts so room cards/filters
  // never show stale audience numbers after someone leaves.
  _updateCounts(roomId).catch(() => {});
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

/**
 * 2026-10-23 (boss: একটা আইডি দুই জায়গায় — NEVER again): a user may
 * occupy exactly ONE seat per room. Atomically nulls every seat held by
 * `userId` except `keepIdx`, and cancels the ghost seats' pending
 * onDisconnect ops so a later socket drop cannot wipe the real seat.
 * Called after every successful takeSeat claim AND after the reconnect
 * presence re-register's direct seat write — the two paths that could
 * otherwise leave a resurrected ghost seat behind.
 */
export async function clearOtherSeats(
  roomId: string,
  userId: string,
  keepIdx: number,
): Promise<void> {
  try {
    const seatsSnap = await get(ref(database, `rooms/${roomId}/seats`));
    if (!seatsSnap.exists()) return;
    const ghostPaths: Record<string, null> = {};
    seatsSnap.forEach((child) => {
      const key = child.key ?? '';
      const s = child.val() as { userId?: string } | null;
      if (s && s.userId === userId && Number(key) !== keepIdx) {
        ghostPaths[`rooms/${roomId}/seats/${key}`] = null;
        onDisconnect(ref(database, `rooms/${roomId}/seats/${key}`)).cancel().catch(() => {});
      }
    });
    if (Object.keys(ghostPaths).length > 0) {
      await update(ref(database), ghostPaths);
    }
  } catch {
    // Non-critical — subscribeSeats dedupes the render and VeeGuard
    // sweeps duplicates server-side.
  }
}

async function takeSeatInner(
  roomId: string,
  seatIndex: number,
  member: NonNullable<RoomSeat>,
): Promise<{ success: boolean }> {
  // HOST SEAT (2026-10-22, Sumon): seat 1 (index 0) is reserved — only the
  // room owner or a registered admin may sit there; members never can, on
  // any path (direct tap, invite, queue admit, restore). Privilege is
  // verified against the room's own records (info.ownerId + admins
  // registry); the caller's claimed role is only a fallback when those
  // reads are unavailable.
  if (seatIndex === 0) {
    let privileged =
      member.role === 'host' || member.role === 'admin' ||
      ((member as { roleLevel?: number }).roleLevel ?? 0) >= 8000;
    try {
      const [infoSnap, adminSnap] = await Promise.all([
        get(ref(database, `rooms/${roomId}/info`)),
        get(ref(database, `rooms/${roomId}/admins/${member.userId}`)),
      ]);
      const ownerId = (infoSnap.val() as { ownerId?: string } | null)?.ownerId;
      if (ownerId || adminSnap.exists()) {
        privileged = ownerId === member.userId || adminSnap.val() === true;
      }
    } catch {
      /* best-effort — keep the role-based verdict */
    }
    if (!privileged) return { success: false };
  }

  const seatRef = ref(database, `rooms/${roomId}/seats/${seatIndex}`);
  const result = await runTransaction(seatRef, (current) => {
    // P1 fix (2026-10-12): Firebase passes `undefined` (not `null`) for
    // never-written nodes on first run. `!== null` aborted the first-ever
    // take as "occupied". `!= null` handles both.
    if (current != null) {
      // Seat already taken by someone else — abort the transaction.
      // 2026-10-23 (boss: empty-looking seat said "Seat Occupied"): a
      // record WITHOUT a userId is a malformed ghost — it renders as
      // empty, so it must be claimable, not a blocker. My OWN record
      // (state rebuilt after a reconnect) is re-stamped, not a block.
      const occupant = (current as { userId?: string }).userId;
      if (occupant && occupant !== member.userId) {
        return undefined;
      }
    }
    // P1 ghost-seat fix (2026-10-12): stamp the heartbeat on claim.
    // 2026-10-19 (IMO port Phase 1): stamp numeric roleLevel from string role
    // so every seat claim carries the ChannelRole hierarchy going forward.
    const claimRoleLevel = (member as { roleLevel?: number }).roleLevel
      ?? (member.role === 'host' ? 9000 : member.role === 'admin' ? 8000 : 7000);
    // 2026-10-24 (boss: host-mute must stick): a rejoin must NOT clear a
    // host mute — otherwise a muted member evades by leaving + rejoining.
    // Same occupant re-claiming keeps hostMuted: true; a new occupant
    // starts clean (hostMuted absent).
    const keepHostMute = current != null
      && (current as { userId?: string }).userId === member.userId
      && (current as { hostMuted?: boolean }).hostMuted === true;
    return { ...member, roleLevel: claimRoleLevel, seatTs: serverTimestamp(), ...(keepHostMute ? { hostMuted: true } : {}) };
  });

  if (!result.committed) {
    return { success: false };
  }

  // GHOST FIX (2026-10-09) — now the shared clearOtherSeats() helper
  // (2026-10-23), also called by the reconnect presence re-register.
  await clearOtherSeats(roomId, member.userId, seatIndex);

  // 2026-10-22 (boss): seated users KEEP their audience entry. The chat
  // rules require an audience entry to post, so deleting it here silently
  // broke room comments for every seated non-owner/non-admin member
  // ("sometimes comments don't send"). The kept entry also anchors
  // presence: the server guard cross-checks LiveKit before sweeping a seat
  // whose holder still has a live audience record, so a backgrounded phone
  // no longer loses its seat mid-conversation.
  const audienceRef = ref(database, `rooms/${roomId}/audience/${member.userId}`);
  try {
    const audSnap = await get(audienceRef);
    if (!audSnap.exists()) {
      // Seat taken directly (e.g. app-restart seat restore) without joining
      // the audience first — create the entry from the seat record,
      // carrying the registry role so admins keep their powers here too.
      let audRole: 'admin' | 'member' = member.role === 'admin' ? 'admin' : 'member';
      try {
        const adminSnap = await get(ref(database, `rooms/${roomId}/admins/${member.userId}`));
        if (adminSnap.exists() && adminSnap.val() === true) audRole = 'admin';
      } catch { /* best-effort */ }
      const audEntry: RoomAudienceMember = {
        userId: member.userId,
        userName: member.userName,
        initials: member.initials,
        color: member.color,
        ...(member.photoURL ? { photoURL: member.photoURL } : {}),
        ...(member.activeFrame ? { activeFrame: member.activeFrame } : {}),
        ...(typeof member.nobleRankIndex === 'number'
          ? { nobleRankIndex: member.nobleRankIndex }
          : {}),
        role: audRole,
        roleLevel: audRole === 'admin' ? 8000 : 7000,
      };
      try {
        await set(audienceRef, { ...audEntry, ts: serverTimestamp() });
      } catch {
        // If the role-carrying write is ever denied, still land the entry —
        // chat access matters more than the label (registry drives powers).
        await set(audienceRef, {
          ...audEntry, role: 'member', roleLevel: 7000, ts: serverTimestamp(),
        }).catch(() => {});
      }
    }
    // 2026-10-22 ROOT FIX: no onDisconnect re-arm for the audience entry
    // (see joinRoomAsAudience) — presence is heartbeat + VeeGuard based.
  } catch { /* non-critical — server guard restores seated audience entries */ }
  // 2026-10-22 ROOT FIX (replaces the 2026-10-14 onDisconnect arm): the
  // seat is NOT deleted when the RTDB socket drops. Socket drops in
  // background are routine and the user is usually still live on LiveKit;
  // deleting on drop threw seated users off their seats (server-log
  // proven 2026-10-22 18:42/18:45). A truly dead seat (app killed) is
  // swept by VeeGuard once seatTs is >5 min stale AND the user is absent
  // from LiveKit participants — a live participant is never swept.
  // Belt-and-suspenders: also record in "My Room" index in case a seat was
  // taken directly without going through joinRoomAsAudience first.
  // background: safe to swallow — analytics index write
  recordUserRoomVisit(member.userId, roomId, 'member').catch(() => {});
  _updateCounts(roomId).catch(() => {}); // best-effort
  return { success: true };
}

/**
 * P1 ghost-seat fix (2026-10-12): refresh the seat heartbeat.
 * Called every ~60s by the seat holder while seated (and by MinimizedRoomBar
 * while minimized). Pure JS, no new modules.
 *
 * 2026-10-13 (HIGH fix): আগের blind update() সিট মুছে যাওয়ার পরেও ফায়ার
 * হলে `{seatTs}`-শুধু phantom সিট তৈরি করত (userId ছাড়া) — ভাঙা সিট কার্ড
 * আর _updateCounts ক্র্যাশ (undefined মানে Firebase set() ব্যর্থ)। এখন
 * transaction — সিটে holder-এর নিজের userId না মিললে write abort হয়।
 */
export async function refreshSeatHeartbeat(
  roomId: string,
  seatIndex: number,
  userId: string,
  // 2026-10-26 (boss: one name only): self-heal a renamed user's seat —
  // when the caller's nickname differs from the stored seat name, the
  // heartbeat carries the fresh name so renames converge within ~60s
  // instead of lingering until the user re-takes the seat.
  userName?: string,
): Promise<void> {
  try {
    await runTransaction(
      ref(database, `rooms/${roomId}/seats/${seatIndex}`),
      (current) => {
        const s = current as { userId?: string; userName?: string } | null | undefined;
        // নিজের সিট না হলে (মুছে গেছে / অন্যের) heartbeat লিখবে না
        if (!s || s.userId !== userId) return undefined;
        if (userName && s.userName !== userName) return { ...s, userName, seatTs: serverTimestamp() };
        return { ...s, seatTs: serverTimestamp() };
      },
    );
  } catch {
    // background: safe to swallow — a missed beat just ages the seat
  }
}

/**
 * P1 ghost-seat fix (2026-10-12): remove seats whose heartbeat is stale.
 * A seat is stale when `seatTs` is older than 5 minutes (or missing on a
 * seat written before heartbeats existed AND the holder isn't in audience —
 * conservative: only sweep when we're confident it's a ghost).
 * Called on room enter. Best-effort; never throws.
 */
export async function sweepStaleSeats(roomId: string): Promise<void> {
  try {
    const [seatsSnap, audienceSnap] = await Promise.all([
      get(ref(database, `rooms/${roomId}/seats`)),
      get(ref(database, `rooms/${roomId}/audience`)),
    ]);
    if (!seatsSnap.exists()) return;
    // 2026-10-12 review fix: a minimized user keeps their seat with live
    // audio but their screen (and heartbeat) is unmounted. Never sweep a
    // seat whose holder still has a live audience presence record.
    const liveAudience = new Set<string>();
    if (audienceSnap.exists()) {
      audienceSnap.forEach((child) => { liveAudience.add(child.key as string); });
    }
    const now = Date.now();
    const STALE_MS = 5 * 60 * 1000;
    const staleKeys: string[] = [];
    seatsSnap.forEach((child) => {
      const s = child.val() as { userId?: string; seatTs?: number } | null;
      if (!s || !s.userId) return;
      if (liveAudience.has(s.userId)) return; // still in room (may be minimized)
      const ts = typeof s.seatTs === 'number' ? s.seatTs : 0;
      // Missing heartbeat (pre-heartbeat seat) → treat as stale only if very
      // old room data; heartbeat seats use the 5-min window.
      if (now - ts > STALE_MS) {
        staleKeys.push(child.key as string);
      }
    });
    // 2026-10-12 rules-audit fix: delete seats ONE BY ONE, not via multi-path
    // update. Seat delete requires seat-owner/room-owner/admin (rules), so a
    // regular member's multi-path update would fail ATOMICALLY (all-or-nothing)
    // with PERMISSION_DENIED. Per-seat deletes let permitted deletions succeed
    // while others fail silently (best-effort).
    for (const key of staleKeys) {
      try {
        await remove(ref(database, `rooms/${roomId}/seats/${key}`));
      } catch {
        // PERMISSION_DENIED or gone already — best-effort, continue
      }
    }
    if (staleKeys.length > 0) {
      _updateCounts(roomId).catch(() => {});
    }
  } catch {
    // background: safe to swallow — sweep is best-effort
  }
}

/**
 * 2026-10-20 (boss): audience heartbeat — mirror of refreshSeatHeartbeat.
 * Called every ~60s while the user is inside a room. Transaction-guarded:
 * a missing entry (left room / took a seat) is never recreated as a phantom.
 */
export async function refreshAudienceHeartbeat(
  roomId: string,
  userId: string,
): Promise<void> {
  try {
    await runTransaction(
      ref(database, `rooms/${roomId}/audience/${userId}`),
      (current) => {
        if (!current) return undefined;
        return { ...current, ts: serverTimestamp() };
      },
    );
  } catch {
    // background: safe to swallow — a missed beat just ages the entry
  }
}

/**
 * 2026-10-20 (boss): ghost-audience fix — mirror of sweepStaleSeats.
 * Removes audience entries whose heartbeat is missing or >5 min old, so an
 * empty room never shows a phantom member. A uid holding any seat is never
 * swept (they are genuinely in the room). Called on room enter. Best-effort.
 */
export async function sweepStaleAudience(roomId: string): Promise<void> {
  try {
    const [audienceSnap, seatsSnap] = await Promise.all([
      get(ref(database, `rooms/${roomId}/audience`)),
      get(ref(database, `rooms/${roomId}/seats`)),
    ]);
    if (!audienceSnap.exists()) return;
    const seatedUsers = new Set<string>();
    if (seatsSnap.exists()) {
      seatsSnap.forEach((child) => {
        const s = child.val() as { userId?: string } | null;
        if (s?.userId) seatedUsers.add(s.userId);
      });
    }
    const now = Date.now();
    const STALE_MS = 5 * 60 * 1000;
    const staleKeys: string[] = [];
    audienceSnap.forEach((child) => {
      const uid = child.key as string;
      if (seatedUsers.has(uid)) return; // on a seat — genuinely present
      const a = child.val() as { ts?: number } | null;
      const ts = typeof a?.ts === 'number' ? a.ts : 0;
      if (now - ts > STALE_MS) staleKeys.push(uid);
    });
    // One-by-one deletes (same rules reasoning as sweepStaleSeats).
    for (const key of staleKeys) {
      try {
        await remove(ref(database, `rooms/${roomId}/audience/${key}`));
      } catch {
        // PERMISSION_DENIED or gone already — best-effort, continue
      }
    }
    if (staleKeys.length > 0) {
      _updateCounts(roomId).catch(() => {});
    }
  } catch {
    // background: safe to swallow — sweep is best-effort
  }
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
    // 2026-10-22: stamp a fresh heartbeat so the re-added entry is never
    // swept as stale before the next 60s audience heartbeat lands.
    ops.push(set(audienceRef, { ...audienceMember, ts: serverTimestamp() }));
    // 2026-10-22 ROOT FIX: no onDisconnect arm for the re-added audience
    // entry — heartbeat + VeeGuard own presence lifetime now.
  }
  await Promise.all(ops);
  _updateCounts(roomId).catch(() => {}); // best-effort
}

/** Toggle mute on a seat. */
/** 2026-10-26 (boss: icon muted + voice live, and muted auto-unmuting):
    a local mic tap flips the ENGINE first; the seat-mute write can fail
    silently and nothing reconciled engine and seat mid-stay afterwards.
    The tap records its intent here; the screen's FB sync effect
    reconciles it (retry until the seat snapshot confirms, or drop it
    when intent moves). Host-mute always wins (the effect checks it). */
let pendingSeatMute: { roomId: string; seatIdx: number; value: boolean; lastTry: number } | null = null;
export function setPendingSeatMute(roomId: string, seatIdx: number, value: boolean) {
  pendingSeatMute = { roomId, seatIdx, value, lastTry: 0 };
}
export function getPendingSeatMute() {
  return pendingSeatMute;
}
export function clearPendingSeatMute() {
  pendingSeatMute = null;
}
/** Seat-mute write that survives a failed attempt: retries with backoff,
    aborting the moment a newer tap supersedes it (pending store match).
    Never throws; the pending record stays for snapshot reconciliation. */
export async function writeSeatMuteReliable(
  roomId: string,
  seatIdx: number,
  value: boolean,
): Promise<void> {
  setPendingSeatMute(roomId, seatIdx, value);
  const delays = [0, 1000, 3000, 8000];
  for (let i = 0; i < delays.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, delays[i]));
    const p = getPendingSeatMute();
    if (!p || p.roomId !== roomId || p.seatIdx !== seatIdx || p.value !== value) return;
    try {
      await setSeatMute(roomId, seatIdx, value);
      return;
    } catch {
      // retry on backoff; pending stays for snapshot reconciliation
    }
  }
}

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

/** 2026-10-24 (boss: host-mute must stick): set/clear the HOST-mute flag
    on a seat. Only the room owner/admins may call this (the client gates
    it; the RTDB rules enforce it). Never called by the seat holder's own
    mic button — that path writes `muted` only, so it can never clear a
    host mute. */
export async function setSeatHostMute(
  roomId: string,
  seatIndex: number,
  hostMuted: boolean,
): Promise<void> {
  const seatRef = ref(database, `rooms/${roomId}/seats/${seatIndex}`);
  const snap = await get(seatRef).catch(() => null);
  if (!snap?.exists()) return; // Don't create phantom seats
  await update(seatRef, { hostMuted });
}

/** Read a seat's host-mute flag once (minimized-bar mic guard). */
export async function getSeatHostMuted(
  roomId: string,
  seatIndex: number,
): Promise<boolean> {
  const snap = await get(ref(database, `rooms/${roomId}/seats/${seatIndex}`)).catch(() => null);
  return snap?.exists() ? (snap.val() as { hostMuted?: boolean }).hostMuted === true : false;
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
  // 2026-10-19 (IMO port Phase 1): write numeric roleLevel alongside string role
  const roleLevel = role === 'host' ? 9000 : role === 'admin' ? 8000 : 7000;
  await update(seatRef, { role, roleLevel });
}

/** Remove a member from a seat (kick). If demoteUid is provided, the user's
 * room-admin grant is revoked atomically in the same multi-path update, so a
 * kicked admin can never retain moderation powers. */
export async function removeSeat(
  roomId: string,
  seatIndex: number,
  demoteUid?: string,
): Promise<void> {
  const seatRef = ref(database, `rooms/${roomId}/seats/${seatIndex}`);
  onDisconnect(seatRef).cancel().catch(() => {/* non-critical */});
  if (demoteUid) {
    // Atomic: seat removal + admin revoke succeed or fail together.
    // 2026-10-12 review fix: also clear the stale 'admin' role label on the
    // audience record — seated users keep their audience record, and the
    // owner's self-heal would otherwise resurrect admin powers for a
    // departed admin by re-adding them to the registry.
    // 2026-10-12 review fix #2: also sync roomMembers/{roomId}/{uid}/role —
    // Room Info reads roles from there; a kicked admin would otherwise still
    // appear under "Admin" until rejoin. Note roomMembers lives at DB root.
    // 2026-10-13 (HIGH fix): audience role-path শুধু তখনই লিখো যখন audience
    // রেকর্ড আসলেই আছে — নইলে `{role:'member'}`-শুধু phantom audience node
    // তৈরি হয়, যা Live Audience-তে ভূতের row দেখাত।
    const audSnap = await get(
      ref(database, `rooms/${roomId}/audience/${demoteUid}`),
    ).catch(() => null);
    const paths: Record<string, unknown> = {
      [`rooms/${roomId}/seats/${seatIndex}`]: null,
      [`rooms/${roomId}/admins/${demoteUid}`]: null,
      [`roomMembers/${roomId}/${demoteUid}/role`]: 'member',
      // 2026-10-19 (IMO port Phase 1): numeric roleLevel follows the demotion
      [`roomMembers/${roomId}/${demoteUid}/roleLevel`]: 7000,
    };
    if (audSnap && audSnap.exists()) {
      paths[`rooms/${roomId}/audience/${demoteUid}/role`] = 'member';
    }
    await update(ref(database), paths);
  } else {
    await remove(seatRef);
  }
  _updateCounts(roomId).catch(() => {}); // best-effort
}

/**
 * Grant room-admin powers (2026-10-12). Writes to the rooms/$roomId/admins
 * registry — the source of truth the security rules check. Must be paired
 * with setSeatRole(..., 'admin') so the seat label matches the powers.
 * Only the room owner (or platform admin) can grant.
 */
export async function grantRoomAdmin(roomId: string, uid: string): Promise<void> {
  await set(ref(database, `rooms/${roomId}/admins/${uid}`), true);
}

/**
 * Revoke room-admin powers. Paired with setSeatRole(..., 'member').
 * Only the room owner (or platform admin) can revoke directly; room admins
 * may only trigger this implicitly via kick (removeSeat with demoteUid).
 */
export async function revokeRoomAdmin(roomId: string, uid: string): Promise<void> {
  await remove(ref(database, `rooms/${roomId}/admins/${uid}`));
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
  data: { name?: string; topic?: string; description?: string; isPublic?: boolean; isLocked?: boolean; coverImageUrl?: string; themeId?: string; hashedPin?: string },
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
  // 2026-10-19 (IMO port Phase 1): numeric roleLevel alongside string role
  await update(ref(database, `rooms/${roomId}/audience/${userId}`), {
    role,
    roleLevel: role === 'admin' ? 8000 : 7000,
  });
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

/** Waiter cancels their own seat request (needs rules: requester may delete own request — see report). */
export async function cancelSeatRequest(
  roomId: string,
  requestId: string,
): Promise<void> {
  await remove(ref(database, `roomSeatRequests/${roomId}/${requestId}`));
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
  /**
   * 2026-10-15 (Sumon): noble rank index (0-9) of the joiner — for PER-RANK
   * entry effects. Computed by the SENDER from their real noble state;
   * receivers render the rank-specific variant. Absent = non-noble.
   * (Replaces the old boolean fancyEntry.)
   */
  nobleRankIndex?: number;
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

// ─── Gift Animation Broadcast (2026-10-10) ───────────────────────────────────
// When a gift is sent, broadcast it so ALL participants see the fly animation.

export type RoomGiftEvent = {
  giftId: string;
  giftName?: string;
  emoji: string;
  coins: number;
  animationUrl?: string | null;
  animationType?: string | null;
  // 2026-10-23: static poster shown while the (large) animation downloads,
  // so a send is never invisible.
  thumbnailUrl?: string | null;
  // 2026-10-17 (Sumon): Server-driven video size.
  videoSize?: number | null;
  videoFullscreen?: boolean | null;
  fromUid: string;
  fromName: string;
  fromAvatar?: string | null;
  toUid: string;
  toName: string;
  toAvatar?: string | null;
  ts: number;
};

/**
 * Broadcast a gift animation event to all participants.
 * Also increments the room's totalDiamonds (2026-10-11) — drives Trending ranking.
 */
export async function sendRoomGiftEvent(
  roomId: string,
  event: Omit<RoomGiftEvent, 'ts'>,
): Promise<void> {
  const giftRef = push(ref(database, `rooms/${roomId}/giftEvents`));
  await set(giftRef, { ...event, ts: Date.now() });
  // Trending ranking signal: accumulate diamonds sent in this room.
  // Fire-and-forget — the animation matters more than the counter.
  runTransaction(
    ref(database, `rooms/${roomId}/info/totalDiamonds`),
    (current) => (typeof current === 'number' ? current : 0) + (event.coins || 0),
  ).catch(() => {/* non-critical */});
}

/**
 * Subscribe to gift animation events.
 */
export function subscribeRoomGiftEvents(
  roomId: string,
  callback: (event: RoomGiftEvent | null) => void,
): () => void {
  const q = query(ref(database, `rooms/${roomId}/giftEvents`), limitToLast(1));
  return onValue(q, (snap) => {
    if (!snap.exists()) { callback(null); return; }
    let latest: RoomGiftEvent | null = null;
    snap.forEach((child) => {
      latest = child.val() as RoomGiftEvent;
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
 * 2026-10-12 (Sumon): also bumps rooms/{roomId}/info/pinVersion — clients
 * cache the verified version, so a PIN change forces everyone to re-enter
 * the NEW pin (old sessions stop working).
 * 2026-10-12 review fix: SINGLE atomic multi-path update — if the PIN hash
 * and version bump aren't all-or-nothing, a blip could change the PIN
 * without bumping the version, leaving old sessions valid.
 */
export async function storeRoomPin(roomId: string, hashedPin: string): Promise<void> {
  const { increment } = await import('firebase/database');
  const now = Date.now();
  await update(ref(database), {
    [`roomPins/${roomId}/hashedPin`]: hashedPin,
    [`roomPins/${roomId}/updatedAt`]: now,
    [`rooms/${roomId}/info/pinVersion`]: increment(1),
    // 2026-10-12 (Sumon bug): setting a PIN must also mark the room as
    // private — otherwise isPublic stays true and the PIN gate is skipped.
    [`rooms/${roomId}/info/isPublic`]: false,
  });
}

/**
 * Verify a hashed PIN for a private room.
 * Returns true when the PIN hash matches, false when the PIN is wrong.
 * THROWS on transport failure (no token, no api base, network error,
 * non-OK HTTP) so callers never misreport "Incorrect PIN" for a
 * connectivity problem. (2026-10-12 review fix.)
 *
 * Uses server-side verification via /api/rooms/verify-pin (deployed 2026-10-06).
 * Direct Firebase read no longer works for non-owners (rules hardened).
 */
export async function verifyRoomPin(roomId: string, hashedPin: string): Promise<boolean> {
  const idToken = await auth.currentUser?.getIdToken().catch(() => null);
  const apiBase = tryGetApiBase();
  if (!idToken) throw new Error('Not signed in — cannot verify PIN.');
  if (!apiBase) throw new Error('Server unreachable — cannot verify PIN.');
  let res: Response;
  try {
    res = await fetch(`${apiBase}/api/rooms/verify-pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ roomId, hashedPin }),
    });
  } catch (e) {
    throw new Error(`Network error while verifying PIN: ${getErrorCause(e)}`);
  }
  if (!res.ok) throw new Error(`PIN verification failed (server ${res.status}).`);
  const data = await res.json().catch(() => null);
  return data?.ok === true;
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
      audSnap.forEach((child) => {
        // 2026-10-22: seated users keep an audience entry (for chat access)
        // and are already counted in memberCount — never double-count them
        // as listeners. (Mirrors the server sync-counts dedupe.)
        const uid = child.key ?? (child.val() as { userId?: string })?.userId;
        if (uid && seenUserIds.has(uid)) return;
        listenerCount++;
      });
    }

    // liveCount = everyone in the room (seated + audience) — for room list/trending.
    // memberCount stays seated-only for Room Info (per Sumon 2026-10-12).
    const liveCount = memberCount + listenerCount;
    await update(ref(database, `rooms/${roomId}/info`), {
      memberCount,
      listenerCount,
      liveCount,
      memberPreviews: memberPreviews.slice(0, 6),
      isTrending: liveCount >= 5,
    });
  } catch {
    // Non-critical — count will be corrected by next seat/audience change
  }
}

/** Joined member record from the roomMembers reverse index. */
export type JoinedMember = {
  uid: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt: number;
  /** Display name written into the record at join time (handleJoinRoom).
   *  Fallback source for members whose users/{uid} profile is thin
   *  (no name/email) — without it they render as "User" in Room Info. */
  name?: string;
};

// ─── PIN Session Cache (2026-10-13) ──────────────────────────────────────────
// আগে এই ক্যাশ VoiceRoomScreen-এর ভেতরে ছিল — VoiceRoomHome-এর PIN dialog
// সফল হলেও in-screen gate আবার PIN চাইত (double PIN prompt)। এখন শেয়ার্ড
// মডিউলে রাখা, যাতে দুই স্ক্রিন একই সেশন-ক্যাশ দেখে।
// কী = `${uid}:${roomId}` → যাচাইকৃত pinVersion। PIN বদলালে (pinVersion bump)
// পুরনো সেশন অকার্যকর হয়ে যায়।
const pinVerifiedSessions = new Map<string, number>();

function pinSessionKey(uid: string, roomId: string): string {
  return `${uid}:${roomId}`;
}

/** এই সেশনে এই pinVersion-এর জন্য PIN যাচাই হয়েছে কি? */
export function isPinVerifiedForSession(
  uid: string,
  roomId: string,
  pinVersion: number,
): boolean {
  return pinVerifiedSessions.get(pinSessionKey(uid, roomId)) === pinVersion;
}

/** এই সেশনে PIN যাচাই সম্পন্ন হিসেবে চিহ্নিত করো। */
export function setPinVerifiedForSession(
  uid: string,
  roomId: string,
  pinVersion: number,
): void {
  pinVerifiedSessions.set(pinSessionKey(uid, roomId), pinVersion);
}

/**
 * Subscribe to ALL joined members of a room (2026-10-11 Issue #5).
 * Uses the `roomMembers/{roomId}` reverse index — covers everyone who ever
 * joined, not just those currently live in the room. The Room Info member
 * list shows these (owner → admin → members), per Sumon's spec.
 */
export function subscribeRoomMembers(
  roomId: string,
  callback: (members: JoinedMember[]) => void,
): () => void {
  return onValue(ref(database, `roomMembers/${roomId}`), (snap) => {
    const members: JoinedMember[] = [];
    if (snap.exists()) {
      snap.forEach((child) => {
        const v = child.val() as { role?: string; joinedAt?: number; name?: string } | null;
        if (child.key) {
          const recName = typeof v?.name === 'string' ? v.name.trim() : '';
          members.push({
            uid: child.key,
            role: (v?.role === 'owner' || v?.role === 'admin') ? v.role : 'member',
            joinedAt: v?.joinedAt ?? 0,
            ...(recName ? { name: recName } : {}),
          });
        }
      });
    }
    callback(members);
  }, () => {
    callback([]);
  });
}
