/**
 * ActiveFollowingsSheet + ActiveFollowingsBar — imo-style live-friends strip.
 *
 * 2026-10-31 (boss: room page EXACTLY like imo): imo's Room page carries a
 * black bottom pill showing followed + inbox friends who are in live rooms
 * right now; tapping it opens this sheet. Active section = followed users
 * and inbox (DM) friends currently inside a live room (tap a row to join
 * that room).
 * 2026-11-09 (boss: "Following গুলো না থাকলে recommendations গুলো যেনো
 * দেখায়, ফাঁকা যেনো না থাকে — যেসব আইডি popular, খুব active এরকম"):
 * Recommended is NO LONGER the inbox list. It is the popular / very-active
 * ranking — occupants of currently-live rooms first (by room occupancy,
 * then follower count), filled from this week's gift leaderboards — and it
 * is the MAIN content when Active is empty. There is no "No active
 * followings" empty state anywhere in this sheet: when nothing can be
 * loaded at all the sheet shows the loading state instead of an empty
 * state. No demo rows ever: every row comes from rooms / followers /
 * leaderboard reads. One-shot get()s on open only — no timers, polls or
 * subscriptions. The Active sweep is shared with Recommended (one sweep
 * per open, not two).
 */
import { useState, useEffect, useRef } from 'react';
import { View, Text, Modal, Pressable, FlatList, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { get, ref, query, orderByChild, limitToLast } from 'firebase/database';
import { database } from '@/src/config/firebase';
import { followUser } from '@/src/services/followService';
import { getCurrentWeekId } from '@/src/utils/weekId';
import HeartbeatVoiceBars from './HeartbeatVoiceBars';

export type ActiveFollowing = {
  uid: string;
  name: string;
  photoURL?: string;
  roomId: string;
  roomName: string;
};

export type RecommendedFriend = {
  uid: string;
  name: string;
  photoURL?: string;
  /** Set when the user is in a live room right now — row taps to join it. */
  roomId?: string;
  roomName?: string;
  /** Where the row came from: live-room occupant, or weekly board fill. */
  source?: 'live' | 'sender' | 'receiver';
};

type UserMini = { displayName?: string; name?: string; photoURL?: string };

async function readUserMini(uid: string): Promise<UserMini | null> {
  try {
    const snap = await get(ref(database, `users/${uid}`));
    if (!snap.exists()) return null;
    return snap.val() as UserMini;
  } catch {
    return null;
  }
}

/** Followed uids + inbox (DM participant) uids for one user. */
async function loadCandidateUids(myUid: string): Promise<{ followed: Set<string>; inbox: string[] }> {
  const followed = new Set<string>();
  const inbox: string[] = [];
  try {
    const [followingSnap, chatsSnap] = await Promise.all([
      get(ref(database, `following/${myUid}`)),
      get(ref(database, `userChats/${myUid}`)),
    ]);
    if (followingSnap.exists()) {
      followingSnap.forEach((c) => {
        if (c.key && c.key !== myUid) followed.add(c.key);
      });
    }
    if (chatsSnap.exists()) {
      chatsSnap.forEach((c) => {
        const v = c.val() as { participantId?: string };
        if (v?.participantId && v.participantId !== myUid) inbox.push(v.participantId);
      });
    }
  } catch {
    // Reads fail open: empty lists, never a crash.
  }
  return { followed, inbox };
}

/**
 * One shared per-open sweep of every room's live presence.
 * Audience entries count only with a fresh heartbeat (<150s, same rule as
 * useLiveAudienceCounts) — stale entries are ghosts of crashed sessions.
 * Seats count as live (a seat is held only while the user is in the room).
 * Each uid is assigned to its HIGHEST-occupancy live room (a user in two
 * rooms ranks under the busier one). Room names are read only for rooms
 * that actually have live occupants (usually a handful, not all 127).
 */
const FRESH_HEARTBEAT_MS = 150_000;
const RECOMMENDED_CAP = 30;
const FOLLOWER_SHORTLIST = 10;

type RoomSweep = {
  /** uid -> roomId, highest-occupancy room wins. */
  presence: Map<string, string>;
  /** roomId -> live occupants (fresh audience ∪ seats). */
  occupancy: Map<string, number>;
  /** roomId -> room name (only rooms with live occupants). */
  roomNames: Map<string, string>;
};

async function sweepLiveRooms(roomIds: string[]): Promise<RoomSweep> {
  const perRoom = new Map<string, Set<string>>();
  await Promise.all(
    roomIds.map(async (rid) => {
      try {
        const [audSnap, seatsSnap] = await Promise.all([
          get(ref(database, `rooms/${rid}/audience`)),
          get(ref(database, `rooms/${rid}/seats`)),
        ]);
        const live = new Set<string>();
        if (audSnap.exists()) {
          const now = Date.now();
          audSnap.forEach((c) => {
            const a = c.val() as { userId?: string; ts?: number } | null;
            if (a && typeof a.ts === 'number' && now - a.ts < FRESH_HEARTBEAT_MS) {
              live.add(a.userId ?? (c.key as string));
            }
          });
        }
        if (seatsSnap.exists()) {
          seatsSnap.forEach((c) => {
            const s = c.val() as { userId?: string } | null;
            if (s?.userId) live.add(s.userId);
          });
        }
        if (live.size > 0) perRoom.set(rid, live);
      } catch {
        // Room gone or unreadable — skip it.
      }
    }),
  );
  const occupancy = new Map<string, number>();
  const presence = new Map<string, string>();
  for (const [rid, uids] of perRoom) {
    occupancy.set(rid, uids.size);
    for (const uid of uids) {
      const prev = presence.get(uid);
      if (!prev || (occupancy.get(prev) ?? 0) < uids.size) presence.set(uid, rid);
    }
  }
  const roomNames = new Map<string, string>();
  await Promise.all(
    [...perRoom.keys()].map(async (rid) => {
      try {
        const infoSnap = await get(ref(database, `rooms/${rid}/info`));
        const info = (infoSnap.val() ?? {}) as { name?: string };
        roomNames.set(rid, info.name ?? 'Room');
      } catch {
        roomNames.set(rid, 'Room');
      }
    }),
  );
  return { presence, occupancy, roomNames };
}

/** Enrich presence uids that belong to `candidates` into Active rows. */
async function deriveActive(candidates: Set<string>, sweep: RoomSweep): Promise<ActiveFollowing[]> {
  const rows = await Promise.all(
    [...sweep.presence.entries()]
      .filter(([uid]) => candidates.has(uid))
      .map(async ([uid, rid]) => {
        try {
          const mini = await readUserMini(uid);
          if (!mini) return null;
          return {
            uid,
            name: mini.displayName ?? mini.name ?? 'User',
            photoURL: mini.photoURL,
            roomId: rid,
            roomName: sweep.roomNames.get(rid) ?? 'Room',
          } as ActiveFollowing;
        } catch {
          return null;
        }
      }),
  );
  return rows.filter((r): r is ActiveFollowing => r !== null);
}

/**
 * Live friends: candidates present in a room's audience or seats.
 * roomIds come from the Room page's own room list (never a full rooms
 * read — that would pull every room's chat history too).
 */
export async function loadActiveFollowings(myUid: string, roomIds: string[]): Promise<ActiveFollowing[]> {
  const { followed, inbox } = await loadCandidateUids(myUid);
  const candidates = new Set<string>([...followed, ...inbox]);
  if (candidates.size === 0 || roomIds.length === 0) return [];
  const sweep = await sweepLiveRooms(roomIds);
  return deriveActive(candidates, sweep);
}

/** One weekly gift board, best first (limitToLast returns ascending). */
async function readBoard(
  path: string,
  scoreKey: string,
  source: 'sender' | 'receiver',
): Promise<{ uid: string; name?: string; photoURL?: string; source: 'sender' | 'receiver' }[]> {
  try {
    const snap = await get(query(ref(database, path), orderByChild(scoreKey), limitToLast(30)));
    if (!snap.exists()) return [];
    const val = (snap.val() ?? {}) as Record<string, { name?: string; photoURL?: string } & Record<string, unknown>>;
    type BoardRow = { uid: string; name?: string; photoURL?: string; source: 'sender' | 'receiver'; score: number };
    const scored: BoardRow[] = Object.entries(val).map(([uid, v]) => ({
      uid,
      name: v?.name,
      photoURL: v?.photoURL,
      source,
      score: typeof v?.[scoreKey] === 'number' ? (v[scoreKey] as number) : 0,
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.map(({ uid, name, photoURL, source: s }) => ({ uid, name, photoURL, source: s }));
  } catch {
    return [];
  }
}

/**
 * Fill the remaining Recommended slots from this week's gift boards
 * (senders first, then receivers). Falls back to the prior week when the
 * current week is near-empty (fewer than 5 usable uids — early in the
 * week, before the boards fill up). Deduped, self / already-followed /
 * already-listed excluded, enriched via users/{uid} (board name/photo
 * as fallback — board rows always carry a name).
 */
async function loadLeaderboardFill(
  myUid: string,
  followed: Set<string>,
  listed: Set<string>,
  limit: number,
): Promise<RecommendedFriend[]> {
  const currentWeek = getCurrentWeekId();
  const priorWeek = getCurrentWeekId(new Date(Date.now() - 7 * 24 * 3600 * 1000));
  const takeWeek = async (weekId: string) => {
    const [senders, receivers] = await Promise.all([
      readBoard(`leaderboard_senders/${weekId}`, 'weeklySent', 'sender'),
      readBoard(`leaderboard/${weekId}`, 'weeklyEarned', 'receiver'),
    ]);
    return [...senders, ...receivers];
  };
  type BoardEntry = { uid: string; name?: string; photoURL?: string; source: 'sender' | 'receiver' };
  const usable = (rows: BoardEntry[]): BoardEntry[] =>
    rows.filter((r) => r.uid !== myUid && !followed.has(r.uid) && !listed.has(r.uid));
  let pool = usable(await takeWeek(currentWeek));
  if (pool.length < 5) {
    const prior = usable(await takeWeek(priorWeek));
    const seen = new Set(pool.map((r) => r.uid));
    for (const r of prior) {
      if (!seen.has(r.uid)) {
        seen.add(r.uid);
        pool.push(r);
      }
    }
  }
  const chosen = pool.slice(0, limit);
  const rows = await Promise.all(
    chosen.map(async (c) => {
      const mini = await readUserMini(c.uid);
      const name = mini?.displayName ?? mini?.name ?? c.name;
      if (!name) return null;
      return {
        uid: c.uid,
        name,
        photoURL: mini?.photoURL ?? c.photoURL,
        source: c.source,
      } as RecommendedFriend;
    }),
  );
  return rows.filter((r): r is RecommendedFriend => r !== null);
}

/**
 * Popular / very-active ranking (2026-11-09 boss order — replaces the old
 * inbox-only Recommended list):
 *  1. Occupants of currently-live rooms, by their room's live occupancy
 *     desc, then by follower count desc. Follower counts come from the
 *     LIVE followers/{uid} child count (never the stale users/{uid}/
 *     followers field) and are read only for the top-10 shortlist.
 *  2. Remaining slots filled from this week's leaderboard_senders +
 *     leaderboard top entries (prior week as fallback when near-empty).
 * Capped at 30, same cap as the old list.
 */
async function deriveRecommended(
  myUid: string,
  followed: Set<string>,
  sweep: RoomSweep,
): Promise<RecommendedFriend[]> {
  const occupants = [...sweep.presence.entries()]
    .filter(([uid]) => uid !== myUid && !followed.has(uid))
    .sort((a, b) => (sweep.occupancy.get(b[1]) ?? 0) - (sweep.occupancy.get(a[1]) ?? 0));
  const shortlist = occupants.slice(0, FOLLOWER_SHORTLIST);
  const followerCounts = new Map<string, number>();
  await Promise.all(
    shortlist.map(async ([uid]) => {
      try {
        const snap = await get(ref(database, `followers/${uid}`));
        followerCounts.set(uid, snap.exists() ? Object.keys(snap.val() ?? {}).length : 0);
      } catch {
        followerCounts.set(uid, 0);
      }
    }),
  );
  shortlist.sort(
    (a, b) =>
      (sweep.occupancy.get(b[1]) ?? 0) - (sweep.occupancy.get(a[1]) ?? 0) ||
      (followerCounts.get(b[0]) ?? 0) - (followerCounts.get(a[0]) ?? 0),
  );
  const ordered = [...shortlist, ...occupants.slice(FOLLOWER_SHORTLIST)];
  const occupantRows = (
    await Promise.all(
      ordered.slice(0, RECOMMENDED_CAP).map(async ([uid, rid]) => {
        const mini = await readUserMini(uid);
        if (!mini) return null;
        return {
          uid,
          name: mini.displayName ?? mini.name ?? 'User',
          photoURL: mini.photoURL,
          roomId: rid,
          roomName: sweep.roomNames.get(rid) ?? 'Room',
          source: 'live',
        } as RecommendedFriend;
      }),
    )
  ).filter((r): r is RecommendedFriend => r !== null);
  const listed = new Set(occupantRows.map((r) => r.uid));
  const out: RecommendedFriend[] = [...occupantRows];
  if (out.length < RECOMMENDED_CAP) {
    out.push(...(await loadLeaderboardFill(myUid, followed, listed, RECOMMENDED_CAP - out.length)));
  }
  return out;
}

/** Popular / very-active Recommended list (single sweep when roomIds given). */
export async function loadRecommendedFriends(myUid: string, roomIds: string[] = []): Promise<RecommendedFriend[]> {
  const [{ followed }, sweep] = await Promise.all([loadCandidateUids(myUid), sweepLiveRooms(roomIds)]);
  return deriveRecommended(myUid, followed, sweep);
}

/**
 * One load for the whole sheet: ONE candidate read + ONE room sweep,
 * deriving both Active and Recommended from the same data (the old code
 * ran the Active sweep and the Recommended loader as two independent
 * loads). One-shot get()s only — no listeners, no timers.
 */
export async function loadSheetData(
  myUid: string,
  roomIds: string[],
): Promise<{ active: ActiveFollowing[]; recommended: RecommendedFriend[] }> {
  const [{ followed, inbox }, sweep] = await Promise.all([loadCandidateUids(myUid), sweepLiveRooms(roomIds)]);
  const [active, recommended] = await Promise.all([
    deriveActive(new Set<string>([...followed, ...inbox]), sweep),
    deriveRecommended(myUid, followed, sweep),
  ]);
  return { active, recommended };
}

function Avatar({ name, photoURL, size }: { name: string; photoURL?: string; size: number }) {
  if (photoURL) {
    return (
      <Image
        source={{ uri: photoURL }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        contentFit="cover"
        cachePolicy="memory-disk"
      />
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: '#8E8E93',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: '#fff', fontSize: size * 0.4, fontWeight: '800' }}>
        {(name || '?').charAt(0)}
      </Text>
    </View>
  );
}

/** Black pill bar (imo): live friends' avatars + live waveform. Null when none live.
 * 2026-11-09 (boss, marked screenshots: pill too big): COMPACT — height
 * 52→44, avatars 32→26, padding 14→10, waveform scaled ~0.8, and the pill
 * hugs its content at the bottom-right (alignSelf flex-end) instead of
 * stretching full width. Still ≥44dp touch height, same black pill, same
 * content/tap/position (bottom). */
export function ActiveFollowingsBar({ active, onPress }: { active: ActiveFollowing[]; onPress: () => void }) {
  if (active.length === 0) return null;
  return (
    <Pressable
      onPress={onPress}
      style={{
        height: 44,
        alignSelf: 'flex-end',
        borderRadius: 999,
        backgroundColor: '#000000',
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {active.slice(0, 4).map((a, i) => (
          <View
            key={a.uid}
            style={{
              marginLeft: i === 0 ? 0 : -8,
              borderWidth: 1.5,
              borderColor: '#000000',
              borderRadius: 13,
              overflow: 'hidden',
            }}
          >
            <Avatar name={a.name} photoURL={a.photoURL} size={26} />
          </View>
        ))}
      </View>
      {/* 2026-11-09 (boss): voice bars beat like a heartbeat (lub-dub),
          native-driver transform only — no layout, no heat. */}
      <View style={{ marginLeft: 10 }}>
        <HeartbeatVoiceBars color="#FFFFFF" maxHeight={13} barWidth={3} gap={2} />
      </View>
    </Pressable>
  );
}

export function ActiveFollowingsSheet({
  visible,
  onClose,
  myUid,
  roomIds,
  onJoinRoom,
  onActiveLoaded,
}: {
  visible: boolean;
  onClose: () => void;
  myUid?: string;
  roomIds: string[];
  onJoinRoom: (roomId: string) => void;
  /**
   * 2026-11-09 (boss: pill showed 3 avatars, sheet said "No active
   * followings"): the pill loads presence ONCE at home mount and never
   * refreshes, so it goes stale while the sheet loads fresh on every open.
   * The sheet reports its fresh list back here so the pill is re-synced
   * to the truth on every open — one read burst, no polling, no extra
   * reads (it reuses this sheet's own load).
   */
  onActiveLoaded?: (active: ActiveFollowing[]) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState<ActiveFollowing[]>([]);
  const [recommended, setRecommended] = useState<RecommendedFriend[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [showRecommended, setShowRecommended] = useState(true);
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const onActiveLoadedRef = useRef(onActiveLoaded);
  onActiveLoadedRef.current = onActiveLoaded;
  // Load once per open: parent room lists change identity on every live
  // update, and a reload mid-open would flash the spinner + reset rows.
  const loadedForOpenRef = useRef(false);

  useEffect(() => {
    if (!visible) {
      loadedForOpenRef.current = false;
      return;
    }
    if (loadedForOpenRef.current || !myUid) return;
    loadedForOpenRef.current = true;
    let cancelled = false;
    setLoading(true);
    // One shared load: Active + Recommended from a single room sweep.
    loadSheetData(myUid, roomIds)
      .then(({ active: a, recommended: r }) => {
        if (cancelled) return;
        setActive(a);
        onActiveLoadedRef.current?.(a);
        setRecommended(r);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, myUid, roomIds]);

  const visibleRecommended = recommended.filter((r) => !dismissed.has(r.uid));

  // 2026-11-09 (boss): no empty state anywhere in this sheet.
  // When Active is empty the Recommended section IS the sheet's content.
  // Only when nothing at all could be loaded (no rooms live, boards
  // empty, reads failed) the sheet keeps the loading state — never an
  // empty icon/text, never a fake row.
  const nothingToShow = !loading && active.length === 0 && visibleRecommended.length === 0;

  async function handleFollow(uid: string) {
    if (!myUid || busyUid) return;
    setBusyUid(uid);
    try {
      await followUser(myUid, uid);
      setRecommended((prev) => prev.filter((r) => r.uid !== uid));
      // 2026-11-09 (boss: after following, they must appear in the list
      // above): re-derive Active from FRESH presence. The old code only
      // patched the stale list — its "re-derive below" never existed — so
      // someone who joined a room while the sheet was open never appeared
      // above. One user-initiated reload, no polling. If they are not in
      // a room they correctly stay out of Active (it is an in-room list).
      const fresh = await loadActiveFollowings(myUid, roomIds);
      setActive(fresh);
      onActiveLoadedRef.current?.(fresh);
    } catch {
      // Follow failed — row stays, user can retry.
    } finally {
      setBusyUid(null);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          onPress={onClose}
          style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)' }}
        />
        <View
          style={{
            backgroundColor: '#FFFFFF',
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            maxHeight: '85%',
            overflow: 'hidden',
          }}
        >
          <View style={{ alignItems: 'center', paddingTop: 10 }}>
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: '#E5E5EA' }} />
          </View>
          <Text style={{ color: '#000000', fontSize: 20, fontWeight: '800', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10 }}>
            Active Followings
          </Text>
          <View style={{ height: 1, backgroundColor: '#F2F2F7' }} />
          {loading ? (
            <View style={{ alignItems: 'center', paddingVertical: 40 }}>
              <ActivityIndicator size="large" color="#8E8E93" />
            </View>
          ) : (
            <FlatList
              data={showRecommended ? visibleRecommended : []}
              keyExtractor={(item) => item.uid}
              style={{ flex: 1 }}
              showsVerticalScrollIndicator={false}
              removeClippedSubviews
              windowSize={10}
              maxToRenderPerBatch={10}
              initialNumToRender={15}
              updateCellsBatchingPeriod={50}
              ListHeaderComponent={
                <View>
                  {active.map((a) => (
                    <Pressable
                      key={a.uid}
                      onPress={() => {
                        onClose();
                        onJoinRoom(a.roomId);
                      }}
                      style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10 }}
                    >
                      <Avatar name={a.name} photoURL={a.photoURL} size={48} />
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text numberOfLines={1} style={{ flexShrink: 1, color: '#000000', fontSize: 16, fontWeight: '700' }}>
                            {a.name}
                          </Text>
                          {/* 2026-11-09 (boss): heartbeat voice icon next
                              to the name — this person IS in a voice room. */}
                          <HeartbeatVoiceBars color="#000000" maxHeight={11} barWidth={2} gap={2} />
                        </View>
                        <Text numberOfLines={1} style={{ color: '#8E8E93', fontSize: 13, marginTop: 2 }}>
                          in {a.roomName}
                        </Text>
                      </View>
                      <Feather name="chevron-right" size={18} color="#C7C7CC" />
                    </Pressable>
                  ))}
                  {nothingToShow ? (
                    <View style={{ alignItems: 'center', paddingVertical: 36 }}>
                      <ActivityIndicator size="large" color="#8E8E93" />
                      <Text style={{ color: '#8E8E93', fontSize: 14, marginTop: 12, textAlign: 'center', paddingHorizontal: 32 }}>
                        Couldn&apos;t load recommendations right now
                      </Text>
                    </View>
                  ) : (
                    <View>
                      <View style={{ height: 8, backgroundColor: '#F2F2F7' }} />
                      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10 }}>
                        <Text style={{ flex: 1, color: '#8E8E93', fontSize: 15 }}>Recommended</Text>
                        <Pressable onPress={() => setShowRecommended((v) => !v)} hitSlop={8}>
                          <Feather name={showRecommended ? 'chevron-up' : 'chevron-down'} size={20} color="#8E8E93" />
                        </Pressable>
                      </View>
                    </View>
                  )}
                </View>
              }
              renderItem={({ item }) => {
                // In-room rows tap to join (same as an Active row); the
                // Follow / X buttons stay tappable on their own.
                const inRoom = !!item.roomId;
                return (
                  <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10 }}>
                    <Pressable
                      onPress={() => {
                        if (!inRoom || !item.roomId) return;
                        onClose();
                        onJoinRoom(item.roomId);
                      }}
                      style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}
                    >
                      <Avatar name={item.name} photoURL={item.photoURL} size={52} />
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <Text numberOfLines={1} style={{ flexShrink: 1, color: '#000000', fontSize: 16, fontWeight: '700' }}>
                            {item.name}
                          </Text>
                          {inRoom && (
                            <HeartbeatVoiceBars color="#000000" maxHeight={11} barWidth={2} gap={2} />
                          )}
                        </View>
                        <Text numberOfLines={1} style={{ color: '#8E8E93', fontSize: 13, marginTop: 2 }}>
                          {inRoom
                            ? `in ${item.roomName}`
                            : item.source === 'sender'
                              ? 'Top gift sender this week'
                              : item.source === 'receiver'
                                ? 'Top gift receiver this week'
                                : 'Popular on Vee'}
                        </Text>
                      </View>
                      {inRoom && <Feather name="chevron-right" size={18} color="#C7C7CC" />}
                    </Pressable>
                    <Pressable
                      onPress={() => void handleFollow(item.uid)}
                      style={({ pressed }) => ({
                        borderWidth: 1,
                        borderColor: '#2196F3',
                        borderRadius: 8,
                        paddingHorizontal: 12,
                        paddingVertical: 6,
                        marginLeft: 8,
                        opacity: pressed || busyUid === item.uid ? 0.6 : 1,
                      })}
                    >
                      <Text style={{ color: '#2196F3', fontSize: 14, fontWeight: '700' }}>
                        {busyUid === item.uid ? '...' : '+ Follow'}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setDismissed((prev) => new Set(prev).add(item.uid))}
                      hitSlop={8}
                      style={{ marginLeft: 12 }}
                    >
                      <Feather name="x" size={18} color="#8E8E93" />
                    </Pressable>
                  </View>
                );
              }}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}
