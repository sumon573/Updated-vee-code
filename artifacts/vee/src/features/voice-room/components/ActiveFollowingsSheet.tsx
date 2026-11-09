/**
 * ActiveFollowingsSheet + ActiveFollowingsBar — imo-style live-friends strip.
 *
 * 2026-10-31 (boss: room page EXACTLY like imo): imo's Room page carries a
 * black bottom pill showing followed + inbox friends who are in live rooms
 * right now; tapping it opens this sheet. Active section = followed users
 * and inbox (DM) friends currently inside a live room (tap a row to join
 * that room). Recommended section = inbox friends not yet followed, with
 * + Follow (writes the real follow edge) and X dismiss (session-only).
 * Empty active state mirrors imo: outline person + "No active followings".
 * No demo rows ever: every row comes from following/userChats/rooms reads.
 */
import { useState, useEffect, useRef, useMemo } from 'react';
import { View, Text, Modal, Pressable, FlatList, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { get, ref } from 'firebase/database';
import { database } from '@/src/config/firebase';
import { followUser } from '@/src/services/followService';
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
 * Live friends: candidates present in a room's audience or seats.
 * roomIds come from the Room page's own room list (never a full rooms
 * read — that would pull every room's chat history too).
 */
export async function loadActiveFollowings(myUid: string, roomIds: string[]): Promise<ActiveFollowing[]> {
  const { followed, inbox } = await loadCandidateUids(myUid);
  const candidates = new Set<string>([...followed, ...inbox]);
  if (candidates.size === 0 || roomIds.length === 0) return [];
  const presence = new Map<string, string>();
  await Promise.all(
    roomIds.map(async (rid) => {
      try {
        const [audSnap, seatsSnap] = await Promise.all([
          get(ref(database, `rooms/${rid}/audience`)),
          get(ref(database, `rooms/${rid}/seats`)),
        ]);
        if (audSnap.exists()) {
          audSnap.forEach((c) => {
            if (c.key && candidates.has(c.key) && !presence.has(c.key)) presence.set(c.key, rid);
          });
        }
        if (seatsSnap.exists()) {
          seatsSnap.forEach((c) => {
            const s = c.val() as { userId?: string };
            if (s?.userId && candidates.has(s.userId) && !presence.has(s.userId)) presence.set(s.userId, rid);
          });
        }
      } catch {
        // Room gone or unreadable — skip it.
      }
    }),
  );
  if (presence.size === 0) return [];
  const out: ActiveFollowing[] = [];
  await Promise.all(
    [...presence.entries()].map(async ([uid, rid]) => {
      try {
        const [mini, infoSnap] = await Promise.all([
          readUserMini(uid),
          get(ref(database, `rooms/${rid}/info`)),
        ]);
        const info = (infoSnap.val() ?? {}) as { name?: string };
        out.push({
          uid,
          name: mini?.displayName ?? mini?.name ?? 'User',
          photoURL: mini?.photoURL,
          roomId: rid,
          roomName: info.name ?? 'Room',
        });
      } catch {
        // Skip unreadable rows.
      }
    }),
  );
  return out;
}

/** Inbox friends not yet followed (capped, for the Recommended section). */
export async function loadRecommendedFriends(myUid: string): Promise<RecommendedFriend[]> {
  const { followed, inbox } = await loadCandidateUids(myUid);
  const seen = new Set<string>();
  const targets: string[] = [];
  for (const uid of inbox) {
    if (uid === myUid || followed.has(uid) || seen.has(uid)) continue;
    seen.add(uid);
    targets.push(uid);
    if (targets.length >= 30) break;
  }
  const out: RecommendedFriend[] = [];
  await Promise.all(
    targets.map(async (uid) => {
      const mini = await readUserMini(uid);
      if (mini) out.push({ uid, name: mini.displayName ?? mini.name ?? 'User', photoURL: mini.photoURL });
    }),
  );
  return out;
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
    Promise.all([loadActiveFollowings(myUid, roomIds), loadRecommendedFriends(myUid)])
      .then(([a, r]) => {
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

  // 2026-11-09 (boss): a Recommended friend who IS in a voice room right
  // now gets the heartbeat voice icon next to their name (same meaning as
  // in the Active rows); anyone not in a room gets no icon.
  const activeUidSet = useMemo(() => new Set(active.map((a) => a.uid)), [active]);

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
                  {active.length === 0 ? (
                    <View style={{ alignItems: 'center', paddingVertical: 36 }}>
                      <Feather name="user" size={64} color="#C7C7CC" />
                      <Text style={{ color: '#8E8E93', fontSize: 16, marginTop: 12 }}>No active followings</Text>
                    </View>
                  ) : (
                    active.map((a) => (
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
                    ))
                  )}
                  <View style={{ height: 8, backgroundColor: '#F2F2F7' }} />
                  <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10 }}>
                    <Text style={{ flex: 1, color: '#8E8E93', fontSize: 15 }}>Recommended</Text>
                    <Pressable onPress={() => setShowRecommended((v) => !v)} hitSlop={8}>
                      <Feather name={showRecommended ? 'chevron-up' : 'chevron-down'} size={20} color="#8E8E93" />
                    </Pressable>
                  </View>
                </View>
              }
              renderItem={({ item }) => (
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10 }}>
                  <Avatar name={item.name} photoURL={item.photoURL} size={52} />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text numberOfLines={1} style={{ flexShrink: 1, color: '#000000', fontSize: 16, fontWeight: '700' }}>
                        {item.name}
                      </Text>
                      {activeUidSet.has(item.uid) && (
                        <HeartbeatVoiceBars color="#000000" maxHeight={11} barWidth={2} gap={2} />
                      )}
                    </View>
                    <Text style={{ color: '#8E8E93', fontSize: 13, marginTop: 2 }}>Your Vee friend</Text>
                  </View>
                  <Pressable
                    onPress={() => void handleFollow(item.uid)}
                    style={({ pressed }) => ({
                      borderWidth: 1,
                      borderColor: '#2196F3',
                      borderRadius: 8,
                      paddingHorizontal: 12,
                      paddingVertical: 6,
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
              )}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}
