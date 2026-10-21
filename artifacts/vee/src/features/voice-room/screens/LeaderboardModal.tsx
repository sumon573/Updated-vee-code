/**
 * LeaderboardModal — Real weekly rankings, premium luxury finish (2026-10-15)
 *
 * Four tabs, ALL real data, ranked:
 *   • Top Rooms     — active rooms sorted by live member count
 *   • Top Live      — currently live rooms, by members
 *   • Top Senders   — most diamonds sent as gifts THIS WEEK (leaderboard_senders/{weekId})
 *   • Top Receivers — most diamonds earned from gifts THIS WEEK (leaderboard/{weekId})
 *
 * Gift sends record weekly stats (walletService.recordWeeklyLeaderboardStats),
 * so the user tabs are genuinely live — no demo content.
 * A pinned "Your Rank" bar shows the viewer's own rank with DP + name.
 * Light mode. Rankings update live via Firebase subscriptions.
 */
import { useState, useEffect, useMemo, useRef } from 'react';
import { View, Text, Modal, Pressable, FlatList, TouchableOpacity, Image } from 'react-native';
import PremiumLoader from '@/src/components/PremiumLoader';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { ref, query, orderByChild, limitToLast, startAfter, onValue, get } from 'firebase/database';
import { auth, database } from '@/src/config/firebase';
import { subscribeActiveRooms, type RoomInfo } from '../services/firebaseRoomService';
import { getCurrentWeekId } from '@/src/utils/weekId';
import { useLiveUserProfile } from '@/src/hooks/useLiveUserProfile';
import { router } from 'expo-router';

// ─── Light premium palette ───────────────────────────────────────────────────

const C = {
  bg:      '#FFFFFF',
  text:    '#000000',
  muted:   '#8E8E93',
  primary: '#7C3AED',
  glow:    '#8B5CF6',
  border:  '#E5E5EA',
  surface: '#F2F2F7',
  gold:    '#F59E0B',
  goldBg:  '#FFFBEB',
  goldBd:  '#FDE68A',
  silver:  '#94A3B8',
  silverBg: '#F8FAFC',
  bronze:  '#B45309',
  bronzeBg: '#FFF7ED',
  green:   '#22C55E' } as const;

// ─── Types ────────────────────────────────────────────────────────────────────

type LeaderboardEntry = {
  uid: string;
  name: string;
  photoURL?: string;
  weeklySent?: number;
  weeklyEarned?: number;
};

type Tab = 'rooms' | 'live' | 'senders' | 'receivers';

/** Compact diamond amounts: 1250 → "1.2k", 10992450 → "11m" (Sumon, 2026-10-13). */
function fmtCompact(n: number): string {
  // 2026-10-19 polish: round-then-carry — 999999 must render "1m", never
  // "1000k". Thresholds sit half a unit below each boundary so toFixed(1)
  // can never round up to 1000 of the current unit.
  if (n >= 999_500_000) return `${parseFloat((n / 1_000_000_000).toFixed(1))}b`;
  if (n >= 999_500) return `${parseFloat((n / 1_000_000).toFixed(1))}m`;
  if (n >= 999.5) return `${parseFloat((n / 1_000).toFixed(1))}k`;
  return `${n}`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const TINT_BG = [C.goldBg, C.silverBg, C.bronzeBg] as const;
const TINT_BD = [C.goldBd, '#E2E8F0', '#FDBA74'] as const;
const TINT_TX = [C.gold, C.silver, C.bronze] as const;
/* 2026-10-16 (Sumon): NO demo medal emojis — real metallic rank badges. */
const RANK_SOLID = ['#F59E0B', '#94A3B8', '#B45309'] as const;

function RankBadge({ rank }: { rank: number }) {
  const top3 = rank <= 3;
  return (
    <View style={{
      width: top3 ? 40 : 34, height: top3 ? 40 : 34, borderRadius: top3 ? 20 : 17,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: top3 ? RANK_SOLID[rank - 1] : C.surface,
      borderWidth: top3 ? 1.5 : 0, borderColor: top3 ? TINT_BD[rank - 1] : 'transparent',
      marginRight: 12,
      shadowColor: top3 ? RANK_SOLID[rank - 1] : 'transparent',
      shadowOpacity: top3 ? 0.35 : 0, shadowRadius: top3 ? 6 : 0, elevation: top3 ? 3 : 0 }}>
      {top3
        ? <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '900' }}>{rank}</Text>
        : <Text style={{ color: C.muted, fontSize: 13, fontWeight: '800' }}>{rank}</Text>
      }
    </View>
  );
}

function DPAvatar({ name, photoURL, size, ring }: {
  name: string; photoURL?: string; size: number; ring?: string;
}) {
  return (
    <View style={{
      width: size + 4, height: size + 4, borderRadius: (size + 4) / 2,
      alignItems: 'center', justifyContent: 'center',
      borderWidth: ring ? 2 : 0, borderColor: ring ?? 'transparent',
      marginRight: 12 }}>
      {photoURL ? (
        <Image source={{ uri: photoURL }} style={{ width: size, height: size, borderRadius: size / 2 }} />
      ) : (
        <View style={{
          width: size, height: size, borderRadius: size / 2,
          backgroundColor: C.primary + '1A', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: C.primary, fontSize: size * 0.38, fontWeight: '800' }}>
            {(name?.[0] ?? '?').toUpperCase()}
          </Text>
        </View>
      )}
    </View>
  );
}

function EmptyState({ icon, message, hint }: { icon: React.ComponentProps<typeof Feather>['name']; message: string; hint?: string }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 56, paddingHorizontal: 40 }}>
      <View style={{
        width: 72, height: 72, borderRadius: 36, backgroundColor: C.goldBg,
        alignItems: 'center', justifyContent: 'center', marginBottom: 16,
        borderWidth: 1, borderColor: C.goldBd }}>
        <Feather name={icon} size={30} color={C.gold} />
      </View>
      <Text style={{ color: C.text, fontSize: 15, fontWeight: '700', textAlign: 'center' }}>{message}</Text>
      {!!hint && (
        <Text style={{ color: C.muted, fontSize: 13, marginTop: 6, textAlign: 'center' }}>{hint}</Text>
      )}
    </View>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function LeaderboardModal({
  visible,
  onClose }: {
  visible: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('rooms');
  // 2026-10-21 (boss: "ager history kichui nai"): the boards used to be
  // hard-locked to the current week, so last week's rankings existed in
  // the database but were unreachable in the app. Senders/Receivers now
  // have a This Week / Last Week switch; Rooms/Live are always live.
  const [weekOffset, setWeekOffset] = useState(0);
  useEffect(() => { if (visible) setWeekOffset(0); }, [visible]);
  // Recomputed whenever the modal (re)opens so a session left mounted over
  // the UTC week boundary never reads/writes a dead week bucket.
  const weekId = useMemo(
    () => getCurrentWeekId(weekOffset === 0 ? new Date() : new Date(Date.now() - 7 * 24 * 3600 * 1000)),
    [visible, weekOffset],
  );
  const myUid = auth.currentUser?.uid ?? null;

  // ── Top Rooms (live subscription) ──────────────────────────────────────────
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(true);

  useEffect(() => {
    if (!visible) return;
    setRoomsLoading(true);
    const unsub = subscribeActiveRooms((allRooms) => {
      setRooms(allRooms);
      setRoomsLoading(false);
    });
    return unsub;
  }, [visible]);

  /* 2026-10-16 (Sumon): REAL live counts — ground truth read straight from
     rooms/{id}/seats + rooms/{id}/audience. Stored info.memberCount can go
     stale, so the leaderboard never trusts it for ranking or display.
     2026-10-19 perf: DELTA-MANAGED subscriptions. The old effect tore down
     and recreated all ~80 listeners on every rooms-array rebuild (any room
     churn). Now subscriptions are keyed by room id in a ref: only rooms
     entering the top-80 set are subscribed, only rooms leaving it are
     unsubscribed. Ground-truth semantics unchanged. */
  const [liveCounts, setLiveCounts] = useState<Record<string, number>>({});
  // 2026-10-19 polish: Top Live must differ from Top Rooms — it ranks rooms
  // by SEATED members (people on mic = genuinely live content), not total
  // members. Tracked alongside liveCounts in the same subscriptions.
  const [seatedCounts, setSeatedCounts] = useState<Record<string, number>>({});
  const liveSubsRef = useRef(new Map<string, () => void>());
  const liveCountsRef = useRef<Record<string, number>>({});
  const seatedCountsRef = useRef<Record<string, number>>({});

  const teardownLiveCounts = () => {
    liveSubsRef.current.forEach((u) => { try { u(); } catch { /* noop */ } });
    liveSubsRef.current.clear();
    liveCountsRef.current = {};
    seatedCountsRef.current = {};
  };

  useEffect(() => {
    if (!visible || rooms.length === 0) {
      if (liveSubsRef.current.size > 0) {
        teardownLiveCounts();
        setLiveCounts({});
        setSeatedCounts({});
      }
      return;
    }
    const subs = liveSubsRef.current;
    const counts = liveCountsRef.current;
    // Same top-80 seeding as before (widened from 40 on 2026-10-20 so more active rooms carry ground-truth counts) — only the subscription management changed.
    const seeded = [...rooms]
      .sort((a, b) => (b.liveCount ?? b.memberCount ?? 0) - (a.liveCount ?? a.memberCount ?? 0))
      .slice(0, 80);
    const wanted = new Set(seeded.map((r) => r.id));
    // Unsubscribe rooms that fell out of the set.
    subs.forEach((unsub, id) => {
      if (!wanted.has(id)) {
        try { unsub(); } catch { /* noop */ }
        subs.delete(id);
        delete counts[id];
        delete seatedCountsRef.current[id];
      }
    });
    const push = () => {
      setLiveCounts({ ...counts });
      setSeatedCounts({ ...seatedCountsRef.current });
    };
    let seededAny = false;
    // Seed newly-added rooms from stored values so the list never flashes
    // empty/wrong before the first ground-truth snapshot lands.
    seeded.forEach((r) => {
      if (!(r.id in counts)) {
        counts[r.id] = r.liveCount ?? r.memberCount ?? 0;
        seededAny = true;
      }
    });
    // Subscribe only rooms we don't already track.
    seeded.forEach((room) => {
      if (subs.has(room.id)) return;
      let seatsSnap: any = null;
      let audSnap: any = null;
      const recompute = () => {
        if (!subs.has(room.id)) return; // unsubscribed meanwhile — drop stale callback
        const seen = new Set<string>();
        let seated = 0;
        seatsSnap.forEach((ch: any) => {
          const uid = ch.val()?.userId as string | undefined;
          if (uid && !seen.has(uid)) { seen.add(uid); seated++; }
        });
        // 2026-10-20 (boss): audience counts only LIVE entries (fresh
        // heartbeat <150s) — ghost entries never inflate a room's count.
        let aud = 0;
        if (audSnap.exists()) {
          const now = Date.now();
          audSnap.forEach((ch: any) => {
            const a = ch.val() as { ts?: number } | null;
            if (typeof a?.ts === 'number' && now - a.ts < 150_000) aud++;
          });
        }
        counts[room.id] = seated + aud;
        seatedCountsRef.current[room.id] = seated;
        push();
      };
      const tryCompute = () => { if (seatsSnap && audSnap) recompute(); };
      const u1 = onValue(ref(database, `rooms/${room.id}/seats`), (s) => { seatsSnap = s; tryCompute(); });
      const u2 = onValue(ref(database, `rooms/${room.id}/audience`), (s) => { audSnap = s; tryCompute(); });
      subs.set(room.id, () => { u1(); u2(); });
    });
    if (seededAny) push();
    // NOTE: intentionally no per-run teardown — subscriptions are
    // delta-managed above. Unmount teardown is in the effect below.
  }, [visible, rooms]);

  // Unmount safety: never leak the delta-managed subscriptions.
  useEffect(() => () => { teardownLiveCounts(); }, []);

  /* 2026-10-21 (boss's choice): Top Rooms is the WEEKLY GIFT board now
     (leaderboard_rooms/{weekId}, below) — the old live-occupancy ranking
     moved to Top Live only, which ranks rooms with ≥1 SEATED member by
     seated count (2026-10-16/19: LIVE badge never on an empty room). */
  const liveRankedRooms = useMemo(() => {
    return rooms
      // 2026-10-20 FIX: rows must DISPLAY the number they are ranked by.
      // renderRoomRow prints realCount, so for Top Live realCount = the
      // SEATED count (ground truth) — previously it fell back to the stored
      // memberCount, a stale total that did not match the ranking.
      .map((r) => ({ ...r, seatedCount: seatedCounts[r.id] ?? 0, realCount: seatedCounts[r.id] ?? 0 }))
      .filter((r) => r.seatedCount > 0)
      .sort((a, b) => b.seatedCount - a.seatedCount)
      .slice(0, 30);
  }, [rooms, seatedCounts]);

  // ── Top Senders — REAL weekly data ─────────────────────────────────────────
  const [senders, setSenders] = useState<LeaderboardEntry[]>([]);
  const [sendersLoading, setSendersLoading] = useState(true);
  // 2026-10-17 (Sumon): realtime user profiles for real DPs — leaderboard data
  // can be stale, so enrich each entry with live users/{uid} profile.
  const [userProfiles, setUserProfiles] = useState<Record<string, { name?: string; photoURL?: string }>>({});

  useEffect(() => {
    if (!visible || tab !== 'senders') return;
    setSendersLoading(true);
    const q = query(ref(database, `leaderboard_senders/${weekId}`), orderByChild('weeklySent'), limitToLast(30));
    const unsub = onValue(q, (snap) => {
      if (!snap.exists()) {
        setSenders([]);
        setSendersLoading(false);
        return;
      }
      const list: LeaderboardEntry[] = [];
      snap.forEach((child) => {
        const v = child.val() as { name?: string; photoURL?: string; weeklySent?: number };
        list.push({
          uid: child.key!,
          name: v.name || 'Vee User',
          photoURL: v.photoURL,
          weeklySent: typeof v.weeklySent === 'number' ? v.weeklySent : 0 });
      });
      list.sort((a, b) => (b.weeklySent ?? 0) - (a.weeklySent ?? 0));
      setSenders(list);
      setSendersLoading(false);
    }, () => {
      setSenders([]);
      setSendersLoading(false);
    });
    return unsub;
  }, [visible, tab, weekId]);

  // ── Top Receivers — REAL weekly data ───────────────────────────────────────
  const [receivers, setReceivers] = useState<LeaderboardEntry[]>([]);
  const [receiversLoading, setReceiversLoading] = useState(true);

  useEffect(() => {
    if (!visible || tab !== 'receivers') return;
    setReceiversLoading(true);
    const q = query(ref(database, `leaderboard/${weekId}`), orderByChild('weeklyEarned'), limitToLast(30));
    const unsub = onValue(q, (snap) => {
      if (!snap.exists()) {
        setReceivers([]);
        setReceiversLoading(false);
        return;
      }
      const list: LeaderboardEntry[] = [];
      snap.forEach((child) => {
        const v = child.val() as { name?: string; photoURL?: string; weeklyEarned?: number };
        list.push({
          uid: child.key!,
          name: v.name || 'Vee User',
          photoURL: v.photoURL,
          weeklyEarned: typeof v.weeklyEarned === 'number' ? v.weeklyEarned : 0 });
      });
      list.sort((a, b) => (b.weeklyEarned ?? 0) - (a.weeklyEarned ?? 0));
      setReceivers(list);
      setReceiversLoading(false);
    }, () => {
      setReceivers([]);
      setReceiversLoading(false);
    });
    return unsub;
  }, [visible, tab, weekId]);

  // 2026-10-17 (Sumon): realtime user profiles — fetch live name/photoURL for
  // all visible leaderboard UIDs so DPs are always real and current.
  // 2026-10-19 perf: DELTA-MANAGED. The old effect tore down and recreated
  // all ~60 users/{uid} listeners on every senders/receivers array rebuild
  // (weekly-stats updates). Now a ref-held Map tracks live subscriptions:
  // only new UIDs are subscribed, only departed UIDs are unsubscribed.
  const profileSubsRef = useRef(new Map<string, () => void>());
  useEffect(() => {
    if (!visible) {
      if (profileSubsRef.current.size > 0) {
        profileSubsRef.current.forEach((u) => { try { u(); } catch { /* noop */ } });
        profileSubsRef.current.clear();
      }
      return;
    }
    const uids = new Set<string>();
    for (const s of senders) uids.add(s.uid);
    for (const r of receivers) uids.add(r.uid);
    const subs = profileSubsRef.current;
    // Unsubscribe UIDs no longer on the board.
    subs.forEach((unsub, uid) => {
      if (!uids.has(uid)) {
        try { unsub(); } catch { /* noop */ }
        subs.delete(uid);
      }
    });
    // Subscribe only new UIDs.
    for (const uid of uids) {
      if (subs.has(uid)) continue;
      const unsub = onValue(ref(database, `users/${uid}`), (snap) => {
        const v = snap.val();
        if (v) {
          setUserProfiles((prev) => ({
            ...prev,
            [uid]: {
              name: typeof v.name === 'string' && v.name.trim() ? v.name.trim() : undefined,
              photoURL: typeof v.photoURL === 'string' && v.photoURL ? v.photoURL : undefined,
            },
          }));
        }
      });
      subs.set(uid, unsub);
    }
    // NOTE: intentionally no per-run teardown — delta-managed above.
  }, [visible, senders, receivers]);

  // Unmount safety: never leak the delta-managed subscriptions.
  useEffect(() => () => {
    profileSubsRef.current.forEach((u) => { try { u(); } catch { /* noop */ } });
    profileSubsRef.current.clear();
  }, []);

  // ── My own weekly stats (for the pinned "Your Rank" bar) ───────────────────
  // 2026-10-20 FIX: REALTIME listeners — the old code used a one-shot get(),
  // so the pinned bar froze at whatever the values were when the modal
  // opened and never moved while gifts flowed.
  const [mySent, setMySent] = useState<number | null>(null);
  const [myEarned, setMyEarned] = useState<number | null>(null);

  useEffect(() => {
    if (!visible || !myUid) return;
    const u1 = onValue(ref(database, `leaderboard_senders/${weekId}/${myUid}/weeklySent`), (s) => {
      setMySent(s.exists() && typeof s.val() === 'number' ? s.val() : 0);
    }, () => setMySent(0));
    const u2 = onValue(ref(database, `leaderboard/${weekId}/${myUid}/weeklyEarned`), (s) => {
      setMyEarned(s.exists() && typeof s.val() === 'number' ? s.val() : 0);
    }, () => setMyEarned(0));
    return () => { u1(); u2(); };
  }, [visible, myUid, weekId]);

  const liveRooms = liveRankedRooms;

  // ── My rank per tab ────────────────────────────────────────────────────────
  // 2026-10-20 FIX (boss: REAL data only): the old code returned a literal
  // 31 ("30+") for anyone outside the loaded top-30 — a PLACEHOLDER rank,
  // not a measurement. True rank = 1 + (number of users this week whose
  // stat is strictly greater than mine), counted live with a startAfter
  // query on the same board the tab displays.
  const [mySenderRank, setMySenderRank] = useState(0);
  const [myReceiverRank, setMyReceiverRank] = useState(0);

  useEffect(() => {
    if (!visible || tab !== 'senders' || !myUid || mySent === null) return;
    if (mySent <= 0) { setMySenderRank(0); return; }
    const q = query(
      ref(database, `leaderboard_senders/${weekId}`),
      orderByChild('weeklySent'),
      startAfter(mySent),
    );
    return onValue(q, (snap) => {
      let above = 0;
      snap.forEach(() => { above++; });
      setMySenderRank(above + 1);
    }, () => { /* keep last known rank on error */ });
  }, [visible, tab, myUid, mySent, weekId]);

  useEffect(() => {
    if (!visible || tab !== 'receivers' || !myUid || myEarned === null) return;
    if (myEarned <= 0) { setMyReceiverRank(0); return; }
    const q = query(
      ref(database, `leaderboard/${weekId}`),
      orderByChild('weeklyEarned'),
      startAfter(myEarned),
    );
    return onValue(q, (snap) => {
      let above = 0;
      snap.forEach(() => { above++; });
      setMyReceiverRank(above + 1);
    }, () => { /* keep last known rank on error */ });
  }, [visible, tab, myUid, myEarned, weekId]);

  // ── Top Rooms — WEEKLY gift board (2026-10-21, boss's choice) ───────────
  // leaderboard_rooms/{weekId}/{roomId}.weeklyReceived, written by
  // walletService.recordWeeklyRoomGiftStat on every in-room gift.
  const [weekRooms, setWeekRooms] = useState<{ roomId: string; weeklyReceived: number }[]>([]);
  const [weekRoomsLoading, setWeekRoomsLoading] = useState(true);

  useEffect(() => {
    if (!visible || tab !== 'rooms') return;
    setWeekRoomsLoading(true);
    const q = query(ref(database, `leaderboard_rooms/${weekId}`), orderByChild('weeklyReceived'), limitToLast(30));
    const unsub = onValue(q, (snap) => {
      const list: { roomId: string; weeklyReceived: number }[] = [];
      snap.forEach((child) => {
        const v = child.val() as { weeklyReceived?: number };
        list.push({ roomId: child.key!, weeklyReceived: typeof v.weeklyReceived === 'number' ? v.weeklyReceived : 0 });
      });
      list.sort((a, b) => b.weeklyReceived - a.weeklyReceived);
      setWeekRooms(list);
      setWeekRoomsLoading(false);
    }, () => { setWeekRooms([]); setWeekRoomsLoading(false); });
    return unsub;
  }, [visible, tab, weekId]);

  // Room display info (name / cover / owner) for the weekly rows: prefer
  // the live rooms list, else a one-time rooms/{id}/info read — a weekly
  // top room may not be live right now, so it is not always in `rooms`.
  const [weekRoomInfo, setWeekRoomInfo] = useState<Record<string, { name: string; coverImageUrl?: string; ownerId?: string; ownerName?: string }>>({});
  const weekRoomInfoTriedRef = useRef(new Set<string>());
  useEffect(() => {
    if (!visible) return;
    for (const wr of weekRooms) {
      if (weekRoomInfoTriedRef.current.has(wr.roomId)) continue;
      weekRoomInfoTriedRef.current.add(wr.roomId);
      const live = rooms.find((r) => r.id === wr.roomId);
      if (live) {
        setWeekRoomInfo((prev) => ({ ...prev, [wr.roomId]: { name: live.name, coverImageUrl: live.coverImageUrl, ownerId: live.ownerId, ownerName: live.ownerName } }));
        continue;
      }
      get(ref(database, `rooms/${wr.roomId}/info`)).then((snap) => {
        if (!snap.exists()) return;
        const v = snap.val() as { name?: string; coverImageUrl?: string; ownerId?: string; ownerName?: string };
        setWeekRoomInfo((prev) => ({ ...prev, [wr.roomId]: { name: v.name || 'Vee Room', coverImageUrl: v.coverImageUrl, ownerId: v.ownerId, ownerName: v.ownerName } }));
      }).catch(() => {});
    }
  }, [visible, weekRooms, rooms]);

  const rankedWeekRooms = useMemo(() => weekRooms.map((wr) => {
    const info = weekRoomInfo[wr.roomId];
    const live = rooms.find((r) => r.id === wr.roomId);
    return {
      id: wr.roomId,
      name: info?.name || live?.name || 'Vee Room',
      coverImageUrl: info?.coverImageUrl || live?.coverImageUrl,
      ownerId: info?.ownerId || live?.ownerId,
      ownerName: info?.ownerName || live?.ownerName,
      weeklyReceived: wr.weeklyReceived,
    };
  }), [weekRooms, weekRoomInfo, rooms]);

  // My best room's weekly total + TRUE rank (same startAfter counting as
  // the user boards — never a placeholder).
  const myRoomIdsKey = useMemo(
    () => rooms.filter((r) => r.ownerId === myUid).map((r) => r.id).sort().join(','),
    [rooms, myUid],
  );
  const [myRoomReceived, setMyRoomReceived] = useState<number | null>(null);
  useEffect(() => {
    if (!visible || !myUid) return;
    const ids = myRoomIdsKey ? myRoomIdsKey.split(',') : [];
    if (ids.length === 0) { setMyRoomReceived(0); return; }
    const vals: Record<string, number> = {};
    const unsubs = ids.map((id) => onValue(ref(database, `leaderboard_rooms/${weekId}/${id}/weeklyReceived`), (snap) => {
      vals[id] = snap.exists() && typeof snap.val() === 'number' ? snap.val() : 0;
      setMyRoomReceived(Math.max(0, ...Object.values(vals)));
    }, () => {}));
    return () => { unsubs.forEach((u) => u()); };
  }, [visible, myUid, weekId, myRoomIdsKey]);

  const [myRoomWeekRank, setMyRoomWeekRank] = useState(0);
  useEffect(() => {
    if (!visible || tab !== 'rooms' || !myUid || myRoomReceived === null) return;
    if (myRoomReceived <= 0) { setMyRoomWeekRank(0); return; }
    const q = query(
      ref(database, `leaderboard_rooms/${weekId}`),
      orderByChild('weeklyReceived'),
      startAfter(myRoomReceived),
    );
    return onValue(q, (snap) => {
      let above = 0;
      snap.forEach(() => { above++; });
      setMyRoomWeekRank(above + 1);
    }, () => { /* keep last known rank on error */ });
  }, [visible, tab, myUid, myRoomReceived, weekId]);

  const myLiveRank = useMemo(() => {
    if (!myUid) return 0;
    const i = liveRankedRooms.findIndex(r => r.ownerId === myUid);
    return i >= 0 ? i + 1 : 0;
  }, [liveRankedRooms, myUid]);

  // 2026-10-21: the pinned bar used to claim "Own a room to rank" even for
  // users who DO own rooms (their rooms just weren't live at that moment).
  // Say the true thing instead.
  const iOwnARoom = useMemo(
    () => !!myUid && rooms.some((r) => r.ownerId === myUid),
    [rooms, myUid],
  );
  const roomRankHint = iOwnARoom
    ? t('leaderboard.roomNotLive', { defaultValue: "Your room isn't live right now" })
    : t('leaderboard.noRoomRanked', { defaultValue: 'Own a room to rank' });
  const myRoomWeekHint = !iOwnARoom
    ? t('leaderboard.noRoomRanked', { defaultValue: 'Own a room to rank' })
    : weekOffset === 0
      ? t('leaderboard.noRoomGiftsMine', { defaultValue: 'No gifts in your room yet this week' })
      : t('leaderboard.noRoomGiftsMineLastWeek', { defaultValue: 'No gifts in your room last week' });

  // 2026-10-19 polish: the pinned bar must show the viewer's LIVE profile
  // from users/{myUid} — auth.currentUser's displayName/photoURL go stale
  // (e.g. after an in-app profile edit) while the leaderboard rows are live.
  // Falls back to the auth snapshot, then 'Vee User'.
  const myLiveProfile = useLiveUserProfile(myUid);
  const myName = myLiveProfile.name || auth.currentUser?.displayName || 'Vee User';
  const myPhoto = myLiveProfile.avatar || auth.currentUser?.photoURL || undefined;

  const tabs: { key: Tab; label: string; icon: React.ComponentProps<typeof Feather>['name'] }[] = [
    { key: 'rooms',     label: t('leaderboard.topRooms', { defaultValue: 'Top Rooms' }),         icon: 'home' },
    { key: 'live',      label: t('leaderboard.topLive', { defaultValue: 'Top Live' }),           icon: 'radio' },
    { key: 'senders',   label: t('leaderboard.topSenders', { defaultValue: 'Top Senders' }),      icon: 'gift' },
    { key: 'receivers', label: t('leaderboard.topReceivers', { defaultValue: 'Top Receivers' }), icon: 'award' },
  ];

  // ── Row renderers ──────────────────────────────────────────────────────────

  const renderUserRow = (item: LeaderboardEntry, index: number, stat: number, statLabel: string) => {
    const rank = index + 1;
    const top3 = rank <= 3;
    const isMe = item.uid === myUid;
    // 2026-10-17 (Sumon): realtime profile — live name/DP from users/{uid}
    const liveProfile = userProfiles[item.uid];
    const displayName = liveProfile?.name || item.name;
    const displayPhoto = liveProfile?.photoURL || item.photoURL;
    return (
      <Pressable
        onPress={() => {
          onClose();
          router.push({ pathname: '/user-profile', params: { uid: item.uid, name: displayName } } as Parameters<typeof router.push>[0]);
        }}
        style={{
        flexDirection: 'row', alignItems: 'center',
        paddingVertical: top3 ? 14 : 11, paddingHorizontal: top3 ? 12 : 0,
        borderRadius: top3 ? 16 : 0,
        backgroundColor: top3 ? TINT_BG[rank - 1] : 'transparent',
        borderWidth: top3 ? 1 : 0, borderColor: top3 ? TINT_BD[rank - 1] : 'transparent',
        borderBottomWidth: 1, borderBottomColor: top3 ? TINT_BD[rank - 1] : C.surface,
        marginBottom: top3 ? 8 : 0 }}>
        <RankBadge rank={rank} />
        <DPAvatar name={displayName} photoURL={displayPhoto} size={top3 ? 48 : 42} ring={top3 ? TINT_TX[rank - 1] : undefined} />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ color: C.text, fontSize: top3 ? 16 : 15, fontWeight: top3 ? '800' : '700', flexShrink: 1 }} numberOfLines={1}>
              {displayName}
            </Text>
            {isMe && (
              <View style={{ backgroundColor: C.primary, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 6 }}>
                <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>
                  {t('leaderboard.you', { defaultValue: 'YOU' })}
                </Text>
              </View>
            )}
          </View>
          <Text style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>{statLabel}</Text>
        </View>
        <View style={{ alignItems: 'flex-end', marginLeft: 10, flexShrink: 0 }}>
          <Text style={{ color: top3 ? TINT_TX[rank - 1] : C.primary, fontSize: top3 ? 19 : 17, fontWeight: '800' }}>
            💎{fmtCompact(stat)}
          </Text>
        </View>
      </Pressable>
    );
  };

  const renderRoomRow = (item: RoomInfo & { realCount?: number }, index: number, showLive: boolean) => {
    const rank = index + 1;
    const top3 = rank <= 3;
    const isMine = item.ownerId === myUid;
    return (
      <Pressable
        onPress={() => {
          onClose();
          router.push({ pathname: '/voice-room', params: { roomId: item.id } } as never);
        }}
        style={{
        flexDirection: 'row', alignItems: 'center',
        paddingVertical: top3 ? 14 : 12, paddingHorizontal: top3 ? 12 : 0,
        borderRadius: top3 ? 16 : 0,
        backgroundColor: top3 ? TINT_BG[rank - 1] : 'transparent',
        borderWidth: top3 ? 1 : 0, borderColor: top3 ? TINT_BD[rank - 1] : 'transparent',
        borderBottomWidth: 1, borderBottomColor: top3 ? TINT_BD[rank - 1] : C.surface,
        marginBottom: top3 ? 8 : 0 }}>
        <RankBadge rank={rank} />
        {/* 2026-10-16 (Sumon): room profile DP — real cover image. */}
        <DPAvatar name={item.name} photoURL={item.coverImageUrl} size={top3 ? 48 : 42} ring={top3 ? TINT_TX[rank - 1] : undefined} />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ color: C.text, fontSize: top3 ? 16 : 15, fontWeight: top3 ? '800' : '700', flexShrink: 1 }} numberOfLines={1}>
              {item.name}
            </Text>
            {showLive && (
              <View style={{ backgroundColor: '#FEE2E2', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 6 }}>
                <Text style={{ color: '#EF4444', fontSize: 10, fontWeight: '800' }}>LIVE</Text>
              </View>
            )}
            {isMine && (
              <View style={{ backgroundColor: C.gold, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 6 }}>
                <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>
                  {t('leaderboard.you', { defaultValue: 'YOU' })}
                </Text>
              </View>
            )}
          </View>
          <Text style={{ color: C.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
            {item.ownerName ?? ''}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', marginLeft: 10, flexShrink: 0 }}>
          <Text style={{ color: top3 ? TINT_TX[rank - 1] : C.primary, fontSize: top3 ? 19 : 18, fontWeight: '800' }}>
            {(item.realCount ?? item.memberCount ?? 0)}
          </Text>
          <Text style={{ color: C.muted, fontSize: 11 }}>
            {t('leaderboard.members', { defaultValue: 'members' })}
          </Text>
        </View>
      </Pressable>
    );
  };

  const renderWeekRoomRow = (item: { id: string; name: string; coverImageUrl?: string; ownerId?: string; ownerName?: string; weeklyReceived: number }, index: number) => {
    const rank = index + 1;
    const top3 = rank <= 3;
    const isMine = item.ownerId === myUid;
    return (
      <Pressable
        onPress={() => {
          onClose();
          router.push({ pathname: '/voice-room', params: { roomId: item.id } } as never);
        }}
        style={{
        flexDirection: 'row', alignItems: 'center',
        paddingVertical: top3 ? 14 : 12, paddingHorizontal: top3 ? 12 : 0,
        borderRadius: top3 ? 16 : 0,
        backgroundColor: top3 ? TINT_BG[rank - 1] : 'transparent',
        borderWidth: top3 ? 1 : 0, borderColor: top3 ? TINT_BD[rank - 1] : 'transparent',
        borderBottomWidth: 1, borderBottomColor: top3 ? TINT_BD[rank - 1] : C.surface,
        marginBottom: top3 ? 8 : 0 }}>
        <RankBadge rank={rank} />
        <DPAvatar name={item.name} photoURL={item.coverImageUrl} size={top3 ? 48 : 42} ring={top3 ? TINT_TX[rank - 1] : undefined} />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ color: C.text, fontSize: top3 ? 16 : 15, fontWeight: top3 ? '800' : '700', flexShrink: 1 }} numberOfLines={1}>
              {item.name}
            </Text>
            {isMine && (
              <View style={{ backgroundColor: C.gold, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 6 }}>
                <Text style={{ color: '#fff', fontSize: 10, fontWeight: '800' }}>
                  {t('leaderboard.you', { defaultValue: 'YOU' })}
                </Text>
              </View>
            )}
          </View>
          <Text style={{ color: C.muted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
            {item.ownerName ?? ''}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', marginLeft: 10, flexShrink: 0 }}>
          <Text style={{ color: top3 ? TINT_TX[rank - 1] : C.primary, fontSize: top3 ? 19 : 18, fontWeight: '800' }}>
            💎{fmtCompact(item.weeklyReceived)}
          </Text>
          <Text style={{ color: C.muted, fontSize: 11 }}>
            {t('leaderboard.diamondsReceived', { defaultValue: 'diamonds received' })}
          </Text>
        </View>
      </Pressable>
    );
  };

  // ── Pinned "Your Rank" bar ─────────────────────────────────────────────────
  const yourRankBar = (
    rank: number, stat: number | null, statLabel: string, emptyHint: string,
  ) => (
    <View style={{
      marginTop: 12, marginBottom: 20,
      borderRadius: 18, padding: 14,
      backgroundColor: C.goldBg, borderWidth: 1.5, borderColor: C.goldBd,
      flexDirection: 'row', alignItems: 'center',
      shadowColor: C.gold, shadowOpacity: 0.18, shadowRadius: 10, elevation: 4 }}>
      <View style={{
        width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff',
        alignItems: 'center', justifyContent: 'center', marginRight: 12,
        borderWidth: 1.5, borderColor: C.gold }}>
        <Text style={{ color: C.gold, fontSize: 15, fontWeight: '900' }}>
          {rank > 0 ? (rank > 30 ? '30+' : `#${rank}`) : '–'}
        </Text>
      </View>
      <DPAvatar name={myName} photoURL={myPhoto} size={40} />
      {/* 2026-10-21 fix (boss screenshot): the right column was unconstrained,
          so a long empty-hint ("Your room isn't live right now") took its full
          one-line intrinsic width and starved the flex:1 name column down to
          ~1 character — "YOUR RANK" wrapped letter-by-letter and the name
          ellipsized to "…". Cap + shrink the right column, let the hint wrap
          to 2 lines right-aligned, and pin the label to a single line. */}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: C.gold, fontSize: 10, fontWeight: '800', letterSpacing: 1 }} numberOfLines={1}>
          {t('leaderboard.yourRank', { defaultValue: 'YOUR RANK' })}
        </Text>
        <Text style={{ color: C.text, fontSize: 15, fontWeight: '800' }} numberOfLines={1}>{myName}</Text>
      </View>
      <View style={{ alignItems: 'flex-end', flexShrink: 1, marginLeft: 10, maxWidth: '52%' }}>
        <Text style={{ color: C.text, fontSize: 16, fontWeight: '800' }} numberOfLines={1}>
          {stat !== null ? `💎${fmtCompact(stat)}` : '–'}
        </Text>
        <Text style={{ color: C.muted, fontSize: 11, textAlign: 'right' }} numberOfLines={2}>{rank > 0 ? statLabel : emptyHint}</Text>
      </View>
    </View>
  );

  const loading = (
    <View style={{ paddingVertical: 48, alignItems: 'center' }}>
      <PremiumLoader size="medium" />
    </View>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }}
        onPress={onClose}
      />
      <View style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        backgroundColor: C.bg,
        borderTopLeftRadius: 26, borderTopRightRadius: 26,
        maxHeight: '90%',
        shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 20,
        elevation: 10 }}>
        <View style={{
          width: 40, height: 4, borderRadius: 2, backgroundColor: C.border,
          alignSelf: 'center', marginTop: 12 }} />

        {/* ── Premium header ── */}
        <View style={{
          flexDirection: 'row', alignItems: 'center',
          paddingHorizontal: 20, paddingTop: 14, paddingBottom: 12 }}>
          <View style={{
            width: 44, height: 44, borderRadius: 22, backgroundColor: C.goldBg,
            alignItems: 'center', justifyContent: 'center', marginRight: 12,
            borderWidth: 1.5, borderColor: C.goldBd }}>
            <Feather name="award" size={22} color={C.gold} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.text, fontSize: 21, fontWeight: '900', letterSpacing: 0.3 }}>
              {t('leaderboard.title', { defaultValue: 'Leaderboard' })}
            </Text>
            {(tab === 'senders' || tab === 'receivers' || tab === 'rooms') ? (
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>
                {([0, 1] as const).map((off) => {
                  const activeWeek = weekOffset === off;
                  return (
                    <Pressable
                      key={off}
                      onPress={() => setWeekOffset(off)}
                      style={{
                        backgroundColor: activeWeek ? C.gold : C.goldBg, borderRadius: 10,
                        paddingHorizontal: 8, paddingVertical: 3,
                        borderWidth: 1, borderColor: C.goldBd }}>
                      <Text style={{ color: activeWeek ? '#fff' : C.gold, fontSize: 11, fontWeight: '800' }}>
                        {off === 0
                          ? `✨ ${t('leaderboard.thisWeek', { defaultValue: 'This Week' })}`
                          : t('leaderboard.lastWeek', { defaultValue: 'Last Week' })}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <View style={{
                alignSelf: 'flex-start', backgroundColor: C.goldBg, borderRadius: 10,
                paddingHorizontal: 8, paddingVertical: 3, marginTop: 4,
                borderWidth: 1, borderColor: C.goldBd }}>
                <Text style={{ color: C.gold, fontSize: 11, fontWeight: '800' }}>
                  ● {t('leaderboard.liveNow', { defaultValue: 'Live Now' })}
                </Text>
              </View>
            )}
          </View>
          <Pressable onPress={onClose} hitSlop={14}>
            <Feather name="x" size={22} color={C.muted} />
          </Pressable>
        </View>

        {/* Tabs — 2x2 grid for 4 categories */}
        <View style={{
          flexDirection: 'row', flexWrap: 'wrap',
          paddingHorizontal: 20, marginBottom: 12, gap: 8 }}>
          {tabs.map(({ key, label, icon }) => {
            const active = tab === key;
            return (
              <TouchableOpacity
                key={key}
                onPress={() => setTab(key)}
                style={{
                  flexDirection: 'row', alignItems: 'center',
                  paddingVertical: 10, paddingHorizontal: 16, borderRadius: 20,
                  backgroundColor: active ? C.primary : C.surface,
                  borderWidth: active ? 0 : 1, borderColor: active ? 'transparent' : C.border,
                  gap: 6,
                  shadowColor: active ? C.primary : 'transparent',
                  shadowOpacity: active ? 0.3 : 0, shadowRadius: active ? 8 : 0,
                  elevation: active ? 3 : 0 }}
              >
                <Feather name={icon} size={14} color={active ? '#fff' : C.muted} />
                <Text style={{
                  color: active ? '#fff' : C.muted,
                  fontSize: 13, fontWeight: '800' }}>
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* ── Top Rooms ── */}
        {tab === 'rooms' && (
          weekRoomsLoading
            ? loading
            : <FlatList
                data={rankedWeekRooms}
                keyExtractor={(item) => item.id}
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12 }}
                ListEmptyComponent={
                  <EmptyState
                    icon="home"
                    message={weekOffset === 0
                      ? t('leaderboard.noRoomGifts', { defaultValue: 'No room gifts yet this week' })
                      : t('leaderboard.noRoomGiftsLastWeek', { defaultValue: 'No room gifts last week' })}
                    hint={weekOffset === 0
                      ? t('leaderboard.roomGiftsHint', { defaultValue: 'Gifts sent in voice rooms rank the room here' })
                      : undefined}
                  />
                }
                ListFooterComponent={yourRankBar(
                  myRoomWeekRank, myRoomReceived,
                  t('leaderboard.diamondsReceived', { defaultValue: 'diamonds received' }),
                  myRoomWeekHint,
                )}
                renderItem={({ item, index }) => renderWeekRoomRow(item, index)}
              />
        )}

        {/* ── Top Live ── */}
        {tab === 'live' && (
          roomsLoading
            ? loading
            : <FlatList
                data={liveRankedRooms}
                keyExtractor={(item) => item.id}
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12 }}
                ListEmptyComponent={
                  <EmptyState icon="radio" message={t('leaderboard.noLive', { defaultValue: 'No live rooms right now' })} />
                }
                ListFooterComponent={yourRankBar(
                  myLiveRank, null,
                  t('leaderboard.members', { defaultValue: 'members' }),
                  roomRankHint,
                )}
                renderItem={({ item, index }) => renderRoomRow(item, index, true)}
              />
        )}

        {/* ── Top Senders ── */}
        {tab === 'senders' && (
          sendersLoading
            ? loading
            : <FlatList
                data={senders}
                keyExtractor={(item) => item.uid}
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12 }}
                ListEmptyComponent={
                  <EmptyState
                    icon="gift"
                    message={weekOffset === 0
                      ? t('leaderboard.noSenders', { defaultValue: 'No gift senders yet this week' })
                      : t('leaderboard.noSendersLastWeek', { defaultValue: 'No gift senders last week' })}
                    hint={weekOffset === 0
                      ? t('leaderboard.sendersHint', { defaultValue: 'Send gifts in voice rooms to climb the ranks!' })
                      : undefined}
                  />
                }
                ListFooterComponent={yourRankBar(
                  mySenderRank, mySent,
                  t('leaderboard.diamondsSent', { defaultValue: 'diamonds sent' }),
                  weekOffset === 0
                    ? t('leaderboard.sendersHint', { defaultValue: 'Send gifts to rank!' })
                    : t('leaderboard.noSendsLastWeek', { defaultValue: 'No gifts sent last week' }),
                )}
                renderItem={({ item, index }) => renderUserRow(
                  item, index, item.weeklySent ?? 0,
                  t('leaderboard.diamondsSent', { defaultValue: 'diamonds sent' }),
                )}
              />
        )}

        {/* ── Top Receivers ── */}
        {tab === 'receivers' && (
          receiversLoading
            ? loading
            : <FlatList
                data={receivers}
                keyExtractor={(item) => item.uid}
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12 }}
                ListEmptyComponent={
                  <EmptyState
                    icon="award"
                    message={weekOffset === 0
                      ? t('leaderboard.noReceivers', { defaultValue: 'No gift receivers yet this week' })
                      : t('leaderboard.noReceiversLastWeek', { defaultValue: 'No gift receivers last week' })}
                    hint={weekOffset === 0
                      ? t('leaderboard.receiversHint', { defaultValue: 'Receive gifts in voice rooms to climb the ranks!' })
                      : undefined}
                  />
                }
                ListFooterComponent={yourRankBar(
                  myReceiverRank, myEarned,
                  t('leaderboard.diamondsEarned', { defaultValue: 'diamonds earned' }),
                  weekOffset === 0
                    ? t('leaderboard.receiversHint', { defaultValue: 'Receive gifts to rank!' })
                    : t('leaderboard.noEarnedLastWeek', { defaultValue: 'No gifts received last week' }),
                )}
                renderItem={({ item, index }) => renderUserRow(
                  item, index, item.weeklyEarned ?? 0,
                  t('leaderboard.diamondsEarned', { defaultValue: 'diamonds earned' }),
                )}
              />
        )}
      </View>
    </Modal>
  );
}
