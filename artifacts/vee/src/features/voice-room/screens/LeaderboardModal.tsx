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
import { useState, useEffect, useMemo } from 'react';
import { View, Text, Modal, Pressable, FlatList, TouchableOpacity, Image } from 'react-native';
import PremiumLoader from '@/src/components/PremiumLoader';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { get, ref, query, orderByChild, limitToLast, onValue } from 'firebase/database';
import { auth, database } from '@/src/config/firebase';
import { subscribeActiveRooms, type RoomInfo } from '../services/firebaseRoomService';
import { getCurrentWeekId } from '@/src/utils/weekId';

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
  if (n >= 1_000_000_000) return `${parseFloat((n / 1_000_000_000).toFixed(1))}b`;
  if (n >= 1_000_000) return `${parseFloat((n / 1_000_000).toFixed(1))}m`;
  if (n >= 1_000) return `${parseFloat((n / 1_000).toFixed(1))}k`;
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
  const weekId = useMemo(() => getCurrentWeekId(), []);
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
     stale, so the leaderboard never trusts it for ranking or display. */
  const [liveCounts, setLiveCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!visible || rooms.length === 0) return;
    let cancelled = false;
    const unsubs: Array<() => void> = [];
    const counts: Record<string, number> = {};
    const push = () => { if (!cancelled) setLiveCounts({ ...counts }); };
    // Seed from stored values so the list never flashes empty/wrong.
    const seeded = [...rooms]
      .sort((a, b) => (b.liveCount ?? b.memberCount ?? 0) - (a.liveCount ?? a.memberCount ?? 0))
      .slice(0, 40);
    seeded.forEach((r) => { counts[r.id] = r.liveCount ?? r.memberCount ?? 0; });
    push();
    seeded.forEach((room) => {
      let seatsSnap: any = null;
      let audSnap: any = null;
      const recompute = () => {
        const seen = new Set<string>();
        let seated = 0;
        seatsSnap.forEach((ch: any) => {
          const uid = ch.val()?.userId as string | undefined;
          if (uid && !seen.has(uid)) { seen.add(uid); seated++; }
        });
        const aud = audSnap.exists() ? audSnap.numChildren() : 0;
        counts[room.id] = seated + aud;
        push();
      };
      const tryCompute = () => { if (seatsSnap && audSnap) recompute(); };
      unsubs.push(onValue(ref(database, `rooms/${room.id}/seats`), (s) => { seatsSnap = s; tryCompute(); }));
      unsubs.push(onValue(ref(database, `rooms/${room.id}/audience`), (s) => { audSnap = s; tryCompute(); }));
    });
    return () => { cancelled = true; unsubs.forEach((u) => u()); };
  }, [visible, rooms]);

  /* Rooms ranked by REAL live count. Top Live = genuinely occupied rooms only,
     so the LIVE badge never shows on an empty room (Sumon 2026-10-16). */
  const rankedRooms = useMemo(() => {
    // 2026-10-16 (Sumon): Top Rooms = ONLY rooms with real members.
    // Empty rooms (0 members) are not "top" — filter them out so the
    // leaderboard is always REAL, never showing fake/empty rankings.
    return rooms
      .map((r) => ({ ...r, realCount: liveCounts[r.id] ?? r.liveCount ?? r.memberCount ?? 0 }))
      .filter((r) => r.realCount > 0)
      .sort((a, b) => b.realCount - a.realCount)
      .slice(0, 30);
  }, [rooms, liveCounts]);
  const liveRankedRooms = useMemo(() => rankedRooms.filter((r) => r.realCount > 0), [rankedRooms]);

  // ── Top Senders — REAL weekly data ─────────────────────────────────────────
  const [senders, setSenders] = useState<LeaderboardEntry[]>([]);
  const [sendersLoading, setSendersLoading] = useState(true);

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

  // ── My own weekly stats (for the pinned "Your Rank" bar) ───────────────────
  const [mySent, setMySent] = useState<number | null>(null);
  const [myEarned, setMyEarned] = useState<number | null>(null);

  useEffect(() => {
    if (!visible || !myUid) return;
    let cancelled = false;
    (async () => {
      try {
        const [sSnap, rSnap] = await Promise.all([
          get(ref(database, `leaderboard_senders/${weekId}/${myUid}/weeklySent`)),
          get(ref(database, `leaderboard/${weekId}/${myUid}/weeklyEarned`)),
        ]);
        if (cancelled) return;
        setMySent(sSnap.exists() && typeof sSnap.val() === 'number' ? sSnap.val() : 0);
        setMyEarned(rSnap.exists() && typeof rSnap.val() === 'number' ? rSnap.val() : 0);
      } catch {
        if (!cancelled) { setMySent(0); setMyEarned(0); }
      }
    })();
    return () => { cancelled = true; };
  }, [visible, myUid, weekId]);

  const liveRooms = liveRankedRooms;

  // ── My rank per tab ────────────────────────────────────────────────────────
  const mySenderRank = useMemo(() => {
    const i = senders.findIndex(e => e.uid === myUid);
    if (i >= 0) return i + 1;
    return (mySent ?? 0) > 0 ? 31 : 0; // 31 = "30+" (outside loaded top-30)
  }, [senders, myUid, mySent]);

  const myReceiverRank = useMemo(() => {
    const i = receivers.findIndex(e => e.uid === myUid);
    if (i >= 0) return i + 1;
    return (myEarned ?? 0) > 0 ? 31 : 0;
  }, [receivers, myUid, myEarned]);

  const myRoomRank = useMemo(() => {
    if (!myUid) return 0;
    const i = rankedRooms.findIndex(r => r.ownerId === myUid);
    return i >= 0 ? i + 1 : 0;
  }, [rankedRooms, myUid]);

  const myLiveRank = useMemo(() => {
    if (!myUid) return 0;
    const i = liveRankedRooms.findIndex(r => r.ownerId === myUid);
    return i >= 0 ? i + 1 : 0;
  }, [liveRankedRooms, myUid]);

  const myName = auth.currentUser?.displayName || 'Vee User';
  const myPhoto = auth.currentUser?.photoURL ?? undefined;

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
    return (
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingVertical: top3 ? 14 : 11, paddingHorizontal: top3 ? 12 : 0,
        borderRadius: top3 ? 16 : 0,
        backgroundColor: top3 ? TINT_BG[rank - 1] : 'transparent',
        borderWidth: top3 ? 1 : 0, borderColor: top3 ? TINT_BD[rank - 1] : 'transparent',
        borderBottomWidth: 1, borderBottomColor: top3 ? TINT_BD[rank - 1] : C.surface,
        marginBottom: top3 ? 8 : 0 }}>
        <RankBadge rank={rank} />
        <DPAvatar name={item.name} photoURL={item.photoURL} size={top3 ? 48 : 42} ring={top3 ? TINT_TX[rank - 1] : undefined} />
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ color: C.text, fontSize: top3 ? 16 : 15, fontWeight: top3 ? '800' : '700', flexShrink: 1 }} numberOfLines={1}>
              {item.name}
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
      </View>
    );
  };

  const renderRoomRow = (item: RoomInfo & { realCount?: number }, index: number, showLive: boolean) => {
    const rank = index + 1;
    const top3 = rank <= 3;
    const isMine = item.ownerId === myUid;
    return (
      <View style={{
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
      </View>
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
      <View style={{ flex: 1 }}>
        <Text style={{ color: C.gold, fontSize: 10, fontWeight: '800', letterSpacing: 1 }}>
          {t('leaderboard.yourRank', { defaultValue: 'YOUR RANK' })}
        </Text>
        <Text style={{ color: C.text, fontSize: 15, fontWeight: '800' }} numberOfLines={1}>{myName}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ color: C.text, fontSize: 16, fontWeight: '800' }}>
          {stat !== null ? `💎${fmtCompact(stat)}` : '–'}
        </Text>
        <Text style={{ color: C.muted, fontSize: 11 }}>{rank > 0 ? statLabel : emptyHint}</Text>
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
            <View style={{
              alignSelf: 'flex-start', backgroundColor: C.goldBg, borderRadius: 10,
              paddingHorizontal: 8, paddingVertical: 3, marginTop: 4,
              borderWidth: 1, borderColor: C.goldBd }}>
              <Text style={{ color: C.gold, fontSize: 11, fontWeight: '800' }}>
                ✨ {t('leaderboard.thisWeek', { defaultValue: 'This Week' })}
              </Text>
            </View>
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
          roomsLoading
            ? loading
            : <FlatList
                data={rankedRooms}
                keyExtractor={(item) => item.id}
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12 }}
                ListEmptyComponent={
                  <EmptyState icon="home" message={t('leaderboard.noData', { defaultValue: 'No rooms yet' })} />
                }
                ListFooterComponent={yourRankBar(
                  myRoomRank, null,
                  t('leaderboard.members', { defaultValue: 'members' }),
                  t('leaderboard.noRoomRanked', { defaultValue: 'Own a room to rank' }),
                )}
                renderItem={({ item, index }) => renderRoomRow(item, index, false)}
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
                  t('leaderboard.noRoomRanked', { defaultValue: 'Own a room to rank' }),
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
                    message={t('leaderboard.noSenders', { defaultValue: 'No gift senders yet this week' })}
                    hint={t('leaderboard.sendersHint', { defaultValue: 'Send gifts in voice rooms to climb the ranks!' })}
                  />
                }
                ListFooterComponent={yourRankBar(
                  mySenderRank, mySent,
                  t('leaderboard.diamondsSent', { defaultValue: 'diamonds sent' }),
                  t('leaderboard.sendersHint', { defaultValue: 'Send gifts to rank!' }),
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
                    message={t('leaderboard.noReceivers', { defaultValue: 'No gift receivers yet this week' })}
                    hint={t('leaderboard.receiversHint', { defaultValue: 'Receive gifts in voice rooms to climb the ranks!' })}
                  />
                }
                ListFooterComponent={yourRankBar(
                  myReceiverRank, myEarned,
                  t('leaderboard.diamondsEarned', { defaultValue: 'diamonds earned' }),
                  t('leaderboard.receiversHint', { defaultValue: 'Receive gifts to rank!' }),
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
