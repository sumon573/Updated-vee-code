/**
 * VoiceRoomHome — My Rooms + Recommended Rooms
 *
 * Issue 9:  "Voice Rooms" renamed to "My Rooms"; shows only rooms the
 *           current user owns. Firebase-queried via subscribeMyRooms.
 * Issue 10: "Recommended Rooms" section added below, with category tabs:
 *           Trending | Nearby | Game | Music | Talk | Study | New
 *           All rooms come from Firebase (subscribeActiveRooms) — no mock data.
 */
import type { ComponentProps } from 'react';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { View, Text, Alert, Modal, TextInput, Pressable, Linking, RefreshControl } from 'react-native';
import PremiumLoader from '@/src/components/PremiumLoader';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView as GHScrollView } from 'react-native-gesture-handler';
import { ScrollView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as Location from 'expo-location';
import { get, ref } from 'firebase/database';
import { database } from '@/src/config/firebase';
import { getErrorCause } from '@/src/utils/errorDisplay';
import ScalePress from '@/components/ScalePress';
import RoomCard from '../components/RoomCard';
import RoomListItem from '../components/RoomListItem';
import RoomCreationModal from './RoomCreationModal';
import { LeaderboardModal } from './LeaderboardModal';
import {
  subscribeActiveRooms,
  subscribeMyRoomsCombined,
  verifyRoomPin,
  setPinVerifiedForSession,
  type RoomInfo } from '../services/firebaseRoomService';
import { prefetchLivekitToken } from '../useLivekitVoiceRoom';
import {
  getVoiceBreadcrumb,
  clearVoiceBreadcrumb } from '../utils/voiceCrashBreadcrumb';
import { VoiceRoom } from '../types/room';
import { useLiveAudienceCounts } from '../hooks/useLiveAudienceCounts';
import { useAuth } from '@/src/context/AuthContext';
import * as Crypto from 'expo-crypto';

/** Fix 6: Haversine distance in km between two lat/lng points */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (v: number) => v * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const NEARBY_MAX_KM = 10;
const NEARBY_MIN_KM = 0.5;

const C = {
  text: '#000000',
  muted: '#8E8E93',
  primary: '#7C3AED',
  glow: '#8B5CF6',
  border: '#E5E5EA',
  chipBg: 'rgba(139,92,246,0.14)',
  chipBgActive: '#7C3AED',
  surface: '#F2F2F7' } as const;

// 2026-10-26 (boss: no loader + superfast voice tab): cached-first rooms.
// The module cache survives tab switches (component unmounts) within the
// session; AsyncStorage survives cold starts. Live subscriptions still
// refresh underneath. Disk writes are throttled (30s) — member counts
// change on every join/leave, and the list must never churn the disk.
// Cache is keyed by uid, so it can never leak across accounts.
const ROOMS_CACHE_KEY = 'vee_cached_voice_rooms_v1';
type CachedVoiceRooms = { uid: string; myRooms: RoomInfo[]; allRooms: RoomInfo[]; savedAt: number };
let memoryCachedVoiceRooms: CachedVoiceRooms | null = null;

// "Recommended" tabs — match the new RoomCategory type
type RecommendedTab = 'trending' | 'nearby' | 'game' | 'music' | 'talk' | 'study' | 'new';

const RECOMMENDED_TABS: {
  key: RecommendedTab;
  label: string;
  icon: ComponentProps<typeof Feather>['name'];
}[] = [
  { key: 'trending', label: 'Trending', icon: 'trending-up' },
  { key: 'nearby',   label: 'Nearby',   icon: 'map-pin' },
  { key: 'game',     label: 'Game',     icon: 'zap' },
  { key: 'music',    label: 'Music',    icon: 'music' },
  { key: 'talk',     label: 'Talk',     icon: 'message-circle' },
  { key: 'study',    label: 'Study',    icon: 'book-open' },
  { key: 'new',      label: 'New',      icon: 'star' },
];

/** Convert Firebase RoomInfo → VoiceRoom type expected by RoomCard/RoomListItem */
function toVoiceRoom(r: RoomInfo): VoiceRoom {
  return {
    id: r.id,
    name: r.name,
    topic: r.topic,
    themeColor: r.themeColor,
    memberCount: r.memberCount,
    maxMembers: r.maxMembers,
    isLive: r.isLive,
    isTrending: r.isTrending,
    category: r.category as VoiceRoom['category'],
    tags: r.tags,
    ownerId: r.ownerId,
    ownerName: r.ownerName,
    allowGifts: r.allowGifts,
    createdAt: r.createdAt,
    memberPreviews: r.memberPreviews,
    coverImageUrl: r.coverImageUrl,
    isPublic: r.isPublic };
}

function goToRoom(id: string, userName?: string) {
  // 2026-10-26 (boss: super-fast room entry): warm the LiveKit token at TAP
  // time, not at screen mount — the token round trip runs during the
  // navigation transition instead of after it. Same (roomId, userName) key
  // VoiceRoomScreen uses, so its mount prefetch hits this cache (45s TTL).
  if (userName) prefetchLivekitToken(id, userName);
  router.push({ pathname: '/voice-room', params: { roomId: id } });
}

// handled by handleRoomPress in component body
// ─── Shared sub-components ──────────────────────────────────────────────────

function SectionTitle({ title, onSeeAll }: { title: string; onSeeAll?: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 24, marginBottom: 14 }}>
      <Text style={{ flex: 1, color: C.text, fontSize: 20, fontWeight: '900' }}>{title}</Text>
      {onSeeAll && (
        <ScalePress onPress={onSeeAll}>
          <View style={{
            flexDirection: 'row', alignItems: 'center',
            backgroundColor: 'rgba(139,92,246,0.12)',
            borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6,
            borderWidth: 1, borderColor: 'rgba(139,92,246,0.25)',
            gap: 4 }}>
            <Text style={{ color: C.muted, fontSize: 12, fontWeight: '700' }}>
              {t('voiceRoom.home.seeAll')}
            </Text>
            <Feather name="chevron-right" size={14} color={C.muted} />
          </View>
        </ScalePress>
      )}
    </View>
  );
}

function CreateRoomTile({ onPress }: { onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <ScalePress onPress={onPress}>
      <View style={{ width: 82, marginRight: 8 }}>
        <View style={{
          width: 68, height: 68, borderRadius: 16,
          backgroundColor: '#F2F2F7',
          borderWidth: 1.5, borderColor: 'rgba(139,92,246,0.55)',
          borderStyle: 'dashed',
          alignItems: 'center', justifyContent: 'center' }}>
          <Feather name="plus" size={24} color={C.glow} />
        </View>
        <Text style={{
          color: C.text, fontSize: 13, fontWeight: '800',
          marginTop: 6, textAlign: 'center' }}>
          {t('voiceRoom.home.createRoom')}
        </Text>
      </View>
    </ScalePress>
  );
}

function CategoryChip({
  label, icon, active, onPress }: {
  label: string;
  icon: ComponentProps<typeof Feather>['name'];
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <ScalePress onPress={onPress}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingHorizontal: 14, paddingVertical: 8, marginHorizontal: 4,
        borderRadius: 999,
        backgroundColor: active ? C.chipBgActive : C.chipBg,
        borderWidth: 1,
        borderColor: active ? C.glow : 'rgba(139,92,246,0.25)' }}>
        <Feather name={icon} size={13} color={active ? '#fff' : C.muted} />
        <Text style={{ color: active ? '#fff' : C.muted, fontSize: 13, fontWeight: '700' }}>
          {label}
        </Text>
      </View>
    </ScalePress>
  );
}

function EmptySection({ message }: { message: string }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: 28 }}>
      <Feather name="mic-off" size={30} color={C.muted} />
      <Text style={{ color: C.muted, fontSize: 14, marginTop: 10 }}>{message}</Text>
    </View>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

type VoiceRoomHomeProps = {
  /** Disables the parent horizontal pager while the user drags a nested horizontal list. */
  onLockParentScroll?: () => void;
  onUnlockParentScroll?: () => void;
  /** When hosted in a modal, renders the close (✕) button in the header row. */
  onClose?: () => void;
};

export default function VoiceRoomHome({
  onLockParentScroll,
  onUnlockParentScroll,
  onClose }: VoiceRoomHomeProps = {}) {
  const { user } = useAuth();
  const { t } = useTranslation();

  // My Rooms — owned by me (seeded from cache: tab switches render
  // instantly, no loader flash — live subscriptions refresh underneath).
  const cachedSeed = memoryCachedVoiceRooms?.uid === user?.uid ? memoryCachedVoiceRooms : null;
  const [myRooms,   setMyRooms]   = useState<RoomInfo[]>(() => cachedSeed?.myRooms ?? []);
  const [myLoading, setMyLoading] = useState(() => !cachedSeed);

  // All public rooms — for Recommended section
  const [allRooms,  setAllRooms]  = useState<RoomInfo[]>(() => cachedSeed?.allRooms ?? []);
  const [recLoading, setRecLoading] = useState(() => !cachedSeed);

  // REAL-TIME live audience (2026-10-11 Issue #1): cached info counts can go
  // stale, so compute the true live count from actual seats+audience nodes.
  // Entering the room counts — seat NOT required.
  const liveCounts = useLiveAudienceCounts([...allRooms, ...myRooms].map(r => r.id));
  const liveAudienceOf = useCallback((r: RoomInfo): number => {
    const real = liveCounts[r.id];
    if (real !== undefined) return real;
    return (r.memberCount ?? 0) + (r.listenerCount ?? 0);
  }, [liveCounts]);

  // Perf (2026-10-22 audit): stable per-room VoiceRoom objects + press
  // handlers, so memoized RoomCard/RoomListItem rows only re-render when
  // their room's visible data actually changes — not on every heartbeat.
  const voiceRoomCacheRef = useRef(new Map<string, { sig: string; vr: VoiceRoom }>());
  const voiceRoomOf = (r: RoomInfo): VoiceRoom => {
    const sig = [r.name, r.topic, r.themeColor, r.memberCount, r.maxMembers,
      r.isLive, r.isTrending, r.category, r.ownerId, r.ownerName, r.allowGifts,
      r.createdAt, r.coverImageUrl, r.isPublic,
      JSON.stringify(r.memberPreviews ?? [])].join('|');
    const hit = voiceRoomCacheRef.current.get(r.id);
    if (hit && hit.sig === sig) return hit.vr;
    const vr = toVoiceRoom(r);
    voiceRoomCacheRef.current.set(r.id, { sig, vr });
    return vr;
  };

  const [activeTab, setActiveTab] = useState<RecommendedTab>('trending');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  // Room ID search (Sumon 2026-10-12)
  const [roomSearchOpen, setRoomSearchOpen] = useState(false);
  const [roomSearchQuery, setRoomSearchQuery] = useState('');

  // Crash diagnostic: if the previous session died while entering a voice
  // room, the breadcrumb survives (a clean unmount clears it). Report the
  // exact stage once so the crash can be pinpointed, then clear it.
  useEffect(() => {
    let cancelled = false;
    getVoiceBreadcrumb().then((crumb) => {
      if (cancelled || !crumb) return;
      clearVoiceBreadcrumb();
      const when = new Date(crumb.ts).toLocaleString();
      Alert.alert(
        t('voiceRoom.home.voiceCrashTitle'),
        t('voiceRoom.home.voiceCrashMsg', {
          roomId: crumb.roomId,
          stage: crumb.stage,
          when }),
      );
    }).catch(() => {});
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Private room PIN dialog
  const [pinDialogRoom, setPinDialogRoom] = useState<RoomInfo | null>(null);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [pinVerifying, setPinVerifying] = useState(false);
  // Stable per-room press handlers for memoized cards (2026-10-22 audit):
  // the closure resolves the FRESH room record at tap time, so PIN/owner
  // logic always sees current data while the handler identity never changes.
  const roomsByIdRef = useRef(new Map<string, RoomInfo>());
  roomsByIdRef.current = new Map([...allRooms, ...myRooms].map(r => [r.id, r]));
  const handleRoomPressRef = useRef<(room: RoomInfo) => Promise<void>>(async () => {});
  const pressCacheRef = useRef(new Map<string, () => void>());
  const pressFor = (roomId: string): (() => void) => {
    let fn = pressCacheRef.current.get(roomId);
    if (!fn) {
      fn = () => {
        const fresh = roomsByIdRef.current.get(roomId);
        if (fresh) void handleRoomPressRef.current(fresh);
      };
      pressCacheRef.current.set(roomId, fn);
    }
    return fn;
  };

  // Handle room card press — show PIN dialog for private rooms
  const handleRoomPress = async (room: RoomInfo) => {
    // Private rooms require PIN (isPublic === false OR undefined/missing = private by default for safety)
    if (room.isPublic !== true) {
      // Owner bypasses PIN — they created the room and already know it
      if (user?.uid === room.ownerId) {
        goToRoom(room.id, user?.displayName ?? user?.uid);
        return;
      }
      setPinDialogRoom(room);
      setPinInput('');
      setPinError('');
    } else {
      goToRoom(room.id, user?.displayName ?? user?.uid);
    }
  };
  handleRoomPressRef.current = handleRoomPress;

  const handlePinSubmit = async () => {
    if (!pinDialogRoom) return;
    if (pinInput.length !== 4 || !/^\d{4}$/.test(pinInput)) {
      setPinError('Please enter a 4-digit numeric PIN.');
      return;
    }
    setPinVerifying(true);
    try {
      const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, pinInput);
      const ok = await verifyRoomPin(pinDialogRoom.id, hashed);
      if (ok) {
        const roomId = pinDialogRoom.id;
        // 2026-10-13: সেশন PIN ক্যাশে মার্ক করো — VoiceRoomScreen-এর in-screen
        // gate যেন আবার PIN না চায় (আগে double prompt হতো)।
        try {
          const verSnap = await get(ref(database, `rooms/${roomId}/info/pinVersion`));
          const ver = typeof verSnap.val() === 'number' ? (verSnap.val() as number) : 0;
          if (user?.uid) setPinVerifiedForSession(user.uid, roomId, ver);
        } catch { /* non-critical — worst case the in-screen gate re-prompts */ }
        setPinDialogRoom(null);
        setPinInput('');
        setPinError('');
        goToRoom(roomId, user?.displayName ?? user?.uid);
      } else {
        setPinError('Incorrect PIN. Please try again.');
      }
    } catch (e) {
      // 2026-10-13 (Sumon-এর নিয়ম): আসল কারণ দেখাও, generic message নয়
      setPinError(`Verification failed: ${getErrorCause(e)}`);
    } finally {
      setPinVerifying(false);
    }
  };


  // Fix 6: Geolocation for "Nearby" tab
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationDenied, setLocationDenied] = useState(false);
  const locationRequestedRef = useRef(false);

  // 2026-10-20 (boss): pull-to-refresh, exactly like the chat screen — a pull
  // re-subscribes both room feeds (fresh Firebase snapshots) and the spinner
  // stops on the first fresh snapshot (8s safety timeout mirrors chat).
  const [refreshing, setRefreshing] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const refreshingRef = useRef(false);
  const finishRefresh = () => {
    if (refreshingRef.current) {
      refreshingRef.current = false;
      setRefreshing(false);
    }
  };
  const handleRefresh = () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    setRefreshTick((n) => n + 1);
    setTimeout(finishRefresh, 8000);
  };

  // Subscribe to my rooms: created rooms first, then rooms I've joined
  // (most-recently-joined first) — persists even after minimizing or
  // fully exiting a room, so it's always findable again here.
  // 2026-10-26 (cached-first): each feed marks its own live arrival, so
  // the disk-cache seed below never overwrites fresh live data.
  const myLiveRef = useRef(false);
  const recLiveRef = useRef(false);
  const myRoomsRef = useRef(myRooms);
  const allRoomsRef = useRef(allRooms);
  useEffect(() => { myRoomsRef.current = myRooms; }, [myRooms]);
  useEffect(() => { allRoomsRef.current = allRooms; }, [allRooms]);
  const lastCacheWriteRef = useRef(0);
  const cacheRooms = useCallback((uid: string, my: RoomInfo[], all: RoomInfo[]) => {
    if (!uid) return;
    memoryCachedVoiceRooms = { uid, myRooms: my, allRooms: all, savedAt: Date.now() };
    const now = Date.now();
    if (now - lastCacheWriteRef.current < 30000) return;
    lastCacheWriteRef.current = now;
    AsyncStorage.setItem(ROOMS_CACHE_KEY, JSON.stringify(memoryCachedVoiceRooms)).catch(() => {});
  }, []);
  // Cold start: disk cache seeds each list ONLY until its own live feed
  // arrives — the tab renders instantly with zero loader, then refreshes.
  useEffect(() => {
    if (!user?.uid) return;
    if (memoryCachedVoiceRooms?.uid === user.uid) return; // already seeded
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(ROOMS_CACHE_KEY);
        if (cancelled || !raw) return;
        const parsed = JSON.parse(raw) as CachedVoiceRooms;
        if (parsed?.uid !== user.uid || !Array.isArray(parsed.myRooms) || !Array.isArray(parsed.allRooms)) return;
        memoryCachedVoiceRooms = parsed;
        if (!myLiveRef.current) { setMyRooms(parsed.myRooms); setMyLoading(false); }
        if (!recLiveRef.current) { setAllRooms(parsed.allRooms); setRecLoading(false); }
      } catch { /* ignore — live feeds still load */ }
    })();
    return () => { cancelled = true; };
  }, [user?.uid]);
  useEffect(() => {
    if (!user?.uid) { setMyLoading(false); return; }
    const unsub = subscribeMyRoomsCombined(user.uid, (rooms) => {
      myLiveRef.current = true;
      setMyRooms(rooms);
      setMyLoading(false);
      cacheRooms(user.uid, rooms, allRoomsRef.current);
      finishRefresh();
    });
    return unsub;
  }, [user?.uid, refreshTick]);

  // Subscribe to all active public rooms
  useEffect(() => {
    const unsub = subscribeActiveRooms((rooms) => {
      recLiveRef.current = true;
      setAllRooms(rooms);
      setRecLoading(false);
      cacheRooms(user?.uid ?? '', myRoomsRef.current, rooms);
      finishRefresh();
    }, () => {
      // Feed error: keep the cached list (never wipe it with []), and do
      // NOT mark the feed live — the empty-state text stays suppressed
      // until a real feed confirms the list is truly empty.
      finishRefresh();
    });
    return unsub;
  }, [refreshTick]);

  // Fix 6: Request location permission when "Nearby" tab is selected
  useEffect(() => {
    if (activeTab !== 'nearby') return;
    if (userLocation || locationDenied || locationRequestedRef.current) return;
    locationRequestedRef.current = true;
    setLocationLoading(true);
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setLocationDenied(true);
          setLocationLoading(false);
          return;
        }
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced });
        setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      } catch {
        setLocationDenied(true);
      }
      setLocationLoading(false);
    })();
  }, [activeTab, userLocation, locationDenied]);

  // Filter recommended rooms by active tab.
  // Perf (2026-10-22 audit): memoized — previously this filter+sort ran
  // inline on EVERY render, and liveCounts state changes (every room
  // heartbeat) re-rendered the whole screen.
  const recommended = useMemo(() => {
    // LIVE-AUDIENCE DEFINITION (2026-10-11): a room is "active" only when it
    // has > 0 live audience (seats + listeners, real-time). Sumon's rule:
    // rooms with NO live audience appear in NO category — only truly live
    // rooms are listed.
    const liveAudience = liveAudienceOf;
    const onlyLive = (rooms: RoomInfo[]) => rooms.filter(r => liveAudience(r) > 0);
    // TRENDING RANK (2026-10-11): most live audience first, then most diamonds
    // sent. Global — every user worldwide sees the same Firebase-driven order.
    const byTrendingRank = (rooms: RoomInfo[]) =>
      [...rooms].sort((a, b) => {
        const audDiff = liveAudience(b) - liveAudience(a);
        if (audDiff !== 0) return audDiff;
        return (b.totalDiamonds ?? 0) - (a.totalDiamonds ?? 0);
      });
    // ACTIVITY SORT (2026-10-09): every other tab ranks by live activity.
    const byActivity = (rooms: RoomInfo[]) =>
      [...rooms].sort((a, b) => {
        const liveDiff = Number(b.isLive ?? false) - Number(a.isLive ?? false);
        if (liveDiff !== 0) return liveDiff;
        return liveAudience(b) - liveAudience(a);
      });
    if (activeTab === 'new') {
      // "New" = live rooms created in the last 2 hours, sorted newest first
      const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
      return onlyLive(allRooms)
        .filter(r => r.createdAt >= twoHoursAgo)
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    }
    if (activeTab === 'trending') {
      // 2026-10-11: trending = ONLY live rooms, ranked by audience then diamonds.
      return byTrendingRank(onlyLive(allRooms));
    }
    // Nearby (2026-10-11): REAL owner distance 500m–10km. Only rooms whose
    // owner is within this range appear; the distance shows on the card.
    if (activeTab === 'nearby') {
      if (!userLocation) return []; // awaiting location permission
      return byActivity(onlyLive(allRooms).filter(r => {
        if (!r.location) return false;
        const km = haversineKm(
          userLocation.lat, userLocation.lng,
          r.location.lat,  r.location.lng,
        );
        return km >= NEARBY_MIN_KM && km <= NEARBY_MAX_KM;
      }));
    }
    // For all other tabs, match by category — still activity-sorted, live only
    return byActivity(onlyLive(allRooms).filter(r => r.category === activeTab));
  }, [allRooms, activeTab, liveAudienceOf, userLocation]);

  return (
    <>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />
        }
      >
            {/* ═══ MY ROOMS ═══ (2026-10-26: NO loader, ever — the shell +
                cached lists render instantly; live feeds refresh underneath) */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 24, marginBottom: 14 }}>
              <Text style={{ flex: 1, color: C.text, fontSize: 20, fontWeight: '900' }}>{t('voiceRoom.home.myRooms')}</Text>
              {/* Room ID search (Sumon 2026-10-12) */}
              <Pressable onPress={() => setRoomSearchOpen(true)} hitSlop={8} style={{ padding: 8 }}>
                <Feather name="search" size={22} color={C.text} />
              </Pressable>
              {/* 2026-10-23 (Sumon): close sits IN the header row, right of
                  the search icon, neatly fitted — no more floating corner
                  button over the status bar. */}
              {onClose && (
                <Pressable onPress={onClose} hitSlop={8} style={{
                  width: 34, height: 34, borderRadius: 17, marginLeft: 2,
                  backgroundColor: 'rgba(0,0,0,0.06)',
                  alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="x" size={18} color={C.text} />
                </Pressable>
              )}
            </View>

            <GHScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 8 }}
              scrollEventThrottle={16}
              bounces={false}
              onScrollBeginDrag={onLockParentScroll}
              onScrollEndDrag={onUnlockParentScroll}
              onMomentumScrollEnd={onUnlockParentScroll}
            >
              {/* Create room tile always first */}
              <CreateRoomTile onPress={() => setCreateModalOpen(true)} />

              {myRooms.map((r) => (
                <View key={r.id} style={{ marginRight: 10 }}>
                  <RoomCard room={voiceRoomOf(r)} liveCount={liveAudienceOf(r)} onPress={pressFor(r.id)} />
                </View>
              ))}
            </GHScrollView>

            {myRooms.length === 0 && !myLoading && (
              <View style={{
                backgroundColor: C.surface, borderRadius: 14,
                padding: 18, marginBottom: 8, alignItems: 'center' }}>
                <Feather name="mic" size={24} color={C.muted} />
                <Text style={{ color: C.muted, fontSize: 13, marginTop: 8, textAlign: 'center' }}>
                  {t('voiceRoom.home.noMyRooms')}
                </Text>
              </View>
            )}

            {/* ═══ LEADERBOARD ENTRY POINT ═══ */}
            <ScalePress onPress={() => setLeaderboardOpen(true)}>
              <View style={{
                flexDirection: 'row', alignItems: 'center',
                backgroundColor: 'rgba(245,158,11,0.07)',
                borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12,
                marginBottom: 4,
                borderWidth: 1, borderColor: 'rgba(245,158,11,0.22)',
                gap: 12 }}>
                <Text style={{ fontSize: 22 }}>🏆</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#F59E0B', fontSize: 14, fontWeight: '900' }}>
                    {t('leaderboard.title')}
                  </Text>
                  <Text style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>
                    {t('leaderboard.topRooms')} · {t('leaderboard.topEarners')}
                  </Text>
                </View>
                <Feather name="chevron-right" size={18} color="#F59E0B" />
              </View>
            </ScalePress>

            {/* ═══ RECOMMENDED ROOMS ═══ */}
            <SectionTitle title={t('voiceRoom.home.recommended')} />

            {/* Category tabs */}
            <GHScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 14 }}
              scrollEventThrottle={16}
              bounces={false}
              style={{ marginHorizontal: -4 }}
              onScrollBeginDrag={onLockParentScroll}
              onScrollEndDrag={onUnlockParentScroll}
              onMomentumScrollEnd={onUnlockParentScroll}
            >
              {RECOMMENDED_TABS.map((tab) => (
                <CategoryChip
                  key={tab.key}
                  label={tab.label}
                  icon={tab.icon}
                  active={activeTab === tab.key}
                  onPress={() => setActiveTab(tab.key)}
                />
              ))}
            </GHScrollView>

            {/* Room list for active tab */}
            {/* Fix 6: Show location states for nearby tab */}
            {activeTab === 'nearby' && locationLoading && (
              <View style={{ alignItems: 'center', paddingVertical: 28 }}>
                <PremiumLoader size="medium" />
                <Text style={{ color: C.muted, fontSize: 13, marginTop: 10 }}>
                  {t('voiceRoom.home.gettingLocation')}
                </Text>
              </View>
            )}
            {activeTab === 'nearby' && !locationLoading && locationDenied && (
              <View style={{ alignItems: 'center', paddingVertical: 28 }}>
                <Feather name="map-pin" size={30} color={C.muted} />
                <Text style={{ color: C.muted, fontSize: 14, marginTop: 10, textAlign: 'center' }}>
                  {t('voiceRoom.home.locationDenied')}
                </Text>
                <Text style={{ color: C.muted, fontSize: 12, marginTop: 4, textAlign: 'center', opacity: 0.8 }}>
                  {t('voiceRoom.home.locationDeniedSettingsHint')}
                </Text>
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                  <Pressable
                    onPress={() => {
                      // Retry: allow the permission effect to run again
                      locationRequestedRef.current = false;
                      setLocationDenied(false);
                    }}
                    style={{ paddingHorizontal: 18, paddingVertical: 10, borderRadius: 20, backgroundColor: 'rgba(139,92,246,0.18)' }}
                  >
                    <Text style={{ color: C.glow, fontSize: 13, fontWeight: '700' }}>
                      {t('voiceRoom.home.locationRetry')}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => Linking.openSettings().catch(() => {})}
                    style={{ paddingHorizontal: 18, paddingVertical: 10, borderRadius: 20, backgroundColor: '#F2F2F7' }}
                  >
                    <Text style={{ color: '#000000', fontSize: 13, fontWeight: '700' }}>
                      {t('voiceRoom.home.locationOpenSettings')}
                    </Text>
                  </Pressable>
                </View>
              </View>
            )}
            {!(activeTab === 'nearby' && (locationLoading || locationDenied)) && (
              recommended.length > 0
                ? recommended.map((r) => {
                    // Nearby: compute REAL owner distance for the card (2026-10-11)
                    const distanceKm = activeTab === 'nearby' && userLocation && r.location
                      ? haversineKm(userLocation.lat, userLocation.lng, r.location.lat, r.location.lng)
                      : undefined;
                    return (
                      <RoomListItem
                        key={r.id}
                        room={voiceRoomOf(r)}
                        liveCount={liveAudienceOf(r)}
                        distanceKm={distanceKm}
                        onPress={pressFor(r.id)}
                      />
                    );
                  })
                : (!recLoading && recLiveRef.current ? <EmptySection message={t('voiceRoom.home.noCategoryRooms')} /> : null)
            )}
      </ScrollView>

      {/* Leaderboard Modal */}
      <LeaderboardModal
        visible={leaderboardOpen}
        onClose={() => setLeaderboardOpen(false)}
      />

      {/* Room ID Search Modal (Sumon 2026-10-12) */}
      <Modal
        visible={roomSearchOpen}
        animationType="slide"
        onRequestClose={() => { setRoomSearchOpen(false); setRoomSearchQuery(''); }}
      >
        <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
          <SafeAreaView style={{ flex: 1 }}>
            {/* IMO-style search bar */}
            <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}>
              <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: '#F0F0F0',
                borderRadius: 24,
                paddingHorizontal: 16,
                paddingVertical: 10 }}>
                <Pressable onPress={() => { setRoomSearchOpen(false); setRoomSearchQuery(''); }} style={{ marginRight: 8 }}>
                  <Feather name="arrow-left" size={22} color="#616161" />
                </Pressable>
                <TextInput
                  placeholder="Search by Room ID"
                  value={roomSearchQuery}
                  onChangeText={setRoomSearchQuery}
                  autoFocus
                  style={{ flex: 1, fontSize: 16, color: '#212121' }}
                  placeholderTextColor="#9E9E9E"
                />
                {roomSearchQuery.length > 0 && (
                  <Pressable onPress={() => setRoomSearchQuery('')}>
                    <Feather name="x-circle" size={20} color="#9E9E9E" />
                  </Pressable>
                )}
              </View>
            </View>
            {/* Search results - filter by Room ID only */}
            <ScrollView style={{ flex: 1, paddingHorizontal: 16 }}>
              {(() => {
                const q = roomSearchQuery.trim().toLowerCase();
                if (!q) return (
                  <Text style={{ color: C.muted, textAlign: 'center', marginTop: 40 }}>
                    Enter a Room ID to search
                  </Text>
                );
                const all = [...myRooms, ...allRooms];
                const matches = all.filter(r => r.id.toLowerCase().includes(q));
                if (matches.length === 0) return (
                  <Text style={{ color: C.muted, textAlign: 'center', marginTop: 40 }}>
                    No rooms found with ID "{roomSearchQuery}"
                  </Text>
                );
                return matches.map(room => (
                  <RoomListItem
                    key={room.id}
                    room={voiceRoomOf(room)}
                    onPress={() => {
                      setRoomSearchOpen(false);
                      setRoomSearchQuery('');
                      handleRoomPress(room);
                    }}
                  />
                ));
              })()}
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>

      {/* PIN Dialog for Private Rooms */}
      <Modal
        visible={!!pinDialogRoom}
        animationType="fade"
        transparent
        onRequestClose={() => { setPinDialogRoom(null); setPinInput(''); setPinError(''); }}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 24 }}
          onPress={() => { setPinDialogRoom(null); setPinInput(''); setPinError(''); }}
        >
          <Pressable style={{ width: '100%', maxWidth: 360 }} onPress={() => {}}>
            <View style={{
              backgroundColor: '#FFFFFF', borderRadius: 24, padding: 28,
              borderWidth: 1.5, borderColor: 'rgba(139,92,246,0.35)',
              shadowColor: '#8B5CF6', shadowOpacity: 0.15, shadowRadius: 20 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 18, gap: 10 }}>
                <Feather name="lock" size={20} color="#F59E0B" />
                <Text style={{ color: '#000000', fontSize: 18, fontWeight: '900', flex: 1 }} numberOfLines={1}>
                  {pinDialogRoom?.name}
                </Text>
              </View>
              <Text style={{ color: '#8E8E93', fontSize: 14, marginBottom: 20 }}>
                Enter the 4-digit PIN to join this private room.
              </Text>
              <TextInput
                style={{
                  backgroundColor: 'rgba(139,92,246,0.1)',
                  borderRadius: 14, borderWidth: 1.5,
                  borderColor: pinError ? '#FF4B4B' : 'rgba(139,92,246,0.35)',
                  color: '#000000', fontSize: 26, fontWeight: '800',
                  textAlign: 'center', letterSpacing: 14,
                  paddingVertical: 14, marginBottom: 8 }}
                placeholder="••••"
                placeholderTextColor="#C7C7CC"
                value={pinInput}
                onChangeText={(txt) => {
                  const digits = txt.replace(/[^0-9]/g, '').slice(0, 4);
                  setPinInput(digits);
                  if (pinError) setPinError('');
                }}
                keyboardType="number-pad"
                maxLength={4}
                secureTextEntry
                autoFocus
              />
              {pinError ? (
                <Text style={{ color: '#FF4B4B', fontSize: 13, textAlign: 'center', marginBottom: 16 }}>{pinError}</Text>
              ) : (
                <Text style={{ color: '#C7C7CC', fontSize: 12, textAlign: 'center', marginBottom: 16 }}>Numbers only</Text>
              )}
              <Pressable
                onPress={handlePinSubmit}
                disabled={pinVerifying}
                style={{
                  backgroundColor: pinVerifying ? '#C7C7CC' : '#7C3AED',
                  borderRadius: 14, paddingVertical: 14,
                  alignItems: 'center',
                  opacity: pinVerifying ? 0.7 : 1 }}
              >
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '900' }}>
                  {pinVerifying ? 'Verifying…' : 'Join Room'}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Room Creation Modal */}
      <RoomCreationModal
        visible={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onRoomCreated={(roomId) => {
          setCreateModalOpen(false);
          goToRoom(roomId, user?.displayName ?? user?.uid);
        }}
      />
    </>
  );
}
