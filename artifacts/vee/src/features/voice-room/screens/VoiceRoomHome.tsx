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
import { View, Text, Alert, Modal, TextInput, Pressable, Linking } from 'react-native';
import PremiumLoader from '@/src/components/PremiumLoader';
import { TrophyIcon } from '@/src/components/TrophyIcon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScrollView as GHScrollView, RefreshControl } from 'react-native-gesture-handler';
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
  subscribePrivateActiveRooms,
  verifyRoomPin,
  setPinVerifiedForSession,
  type RoomInfo } from '../services/firebaseRoomService';
import { prefetchLivekitToken } from '../useLivekitVoiceRoom';
import {
  getVoiceBreadcrumb,
  clearVoiceBreadcrumb } from '../utils/voiceCrashBreadcrumb';
import { VoiceRoom } from '../types/room';
import { useAuth } from '@/src/context/AuthContext';
import {
  fetchPass2Flags,
  subscribePass2HomeLists,
  type Pass2Flags } from '../services/pass2RestService';
import {
  enterPass2Mode,
  exitPass2Mode } from '../services/pass2SessionMode';
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
          marginTop: 6 }}>
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

  // Phase D (CDN room directory, 2026-10-28): public rooms come from the
  // edge (3s edge cache, 60s tier cache) instead of a full Firebase rooms
  // query + 2 live subscriptions per room. Private rooms NEVER touch the
  // public CDN — they still come from Firebase below. If the directory
  // fails, the Firebase all-rooms feed is the fallback (directoryFailed
  // flips the gate). Later poll failures keep the last good list.
  const DIRECTORY_URL = 'https://vee-edge.sumon118858.workers.dev/rooms/directory';
  const [directoryOk, setDirectoryOk] = useState(false);
  const [directoryFailed, setDirectoryFailed] = useState(false);
  const directoryRoomsRef = useRef<RoomInfo[]>([]);
  const privateRoomsRef = useRef<RoomInfo[]>([]);
  const directoryIdsRef = useRef<Set<string>>(new Set());
  const directoryEverOkRef = useRef(false);
  const mergeDirectoryRooms = useCallback((pub: RoomInfo[], priv: RoomInfo[]): RoomInfo[] => {
    const seen = new Set<string>();
    const merged: RoomInfo[] = [];
    for (const r of [...pub, ...priv]) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      merged.push(r);
    }
    merged.sort((a, b) => b.createdAt - a.createdAt);
    return merged;
  }, []);
  // Fix #23 (smoothness): the directory poll re-fetched + re-set the whole
  // list every 30s even when NOTHING changed — every poll re-rendered the
  // entire page mid-scroll. Skip the set (and the cache write) when the
  // visible content is identical; real changes still flow immediately.
  // Sentinel '__none__' (not '') so a legitimately empty list still sets.
  const allRoomsSigRef = useRef<string>('__none__');
  const roomsSignature = useCallback((rooms: RoomInfo[]): string => {
    return rooms.map((r) => [
      r.id, r.active, r.liveCount, r.memberCount, r.listenerCount,
      r.name, r.topic, r.coverImageUrl, r.isLive, r.themeColor,
      r.createdAt, r.isPublic,
      JSON.stringify(r.memberPreviews ?? []),
    ].join('|')).join(';');
  }, []);
  const normalizeDirectoryRoom = useCallback((raw: any): RoomInfo | null => {
    if (!raw || typeof raw.id !== 'string') return null;
    // Fix #29: the directory serves closed rooms too (active:false +
    // closedAt, with a stale liveCount of 1 from one ghost listener).
    // They must never enter the list — the Recommended filter alone
    // cannot catch them because it keys on liveCount.
    if (raw.active === false) return null;
    return {
      ...(raw as RoomInfo),
      id: raw.id,
      memberPreviews: Array.isArray(raw.memberPreviews) ? raw.memberPreviews : [],
      tags: Array.isArray(raw.tags) ? raw.tags : [],
      memberCount: typeof raw.memberCount === 'number' ? raw.memberCount : 0,
      listenerCount: typeof raw.listenerCount === 'number' ? raw.listenerCount : 0,
      liveCount: typeof raw.liveCount === 'number' ? raw.liveCount : 0,
      createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
    } as RoomInfo;
  }, []);
  // Pass2 (DESIGN.md §3.6): useLiveAudienceCounts is DELETED — it held 2
  // listeners per directory card. The directory liveCount IS the count
  // (memberCount + listenerCount by sync-counts construction); rooms
  // without a liveCount fall back to that sum. No per-card subscription
  // remains anywhere on this screen.
  const liveAudienceOf = useCallback((r: RoomInfo): number => {
    if (typeof r.liveCount === 'number') return r.liveCount;
    return (r.memberCount ?? 0) + (r.listenerCount ?? 0);
  }, []);

  // Pass2 home mode (flag-gated, inert when off): private + mine come
  // from the tier (30s REST) instead of Firebase subscribes, and the
  // subscribeActiveRooms fallback never runs — cache + directory retry
  // cover directory outages. Fallback flips the flag off for the stay
  // (§3.10), which resubscribes today's Firebase path.
  const [pass2HomeFlags, setPass2HomeFlags] = useState<Pass2Flags | null>(null);
  const pass2HomeActive =
    pass2HomeFlags?.enabled === true && pass2HomeFlags?.home === true;
  useEffect(() => {
    let cancelled = false;
    fetchPass2Flags().then((f) => { if (!cancelled) setPass2HomeFlags(f); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    if (!pass2HomeActive || !user?.uid) return;
    // NOTE: goOffline() is session-global, so while home pass2 is active
    // an UNCONVERTED surface opened from home (DM, stories, profile
    // sheets) would queue its SDK calls instead of serving them. Drills
    // must not open unconverted surfaces mid-mode; full home 0-slot
    // waits on DM/profile conversion (same staged limitation as the
    // room modals — see the build report).
    enterPass2Mode('home', { offline: true });
    const unsub = subscribePass2HomeLists((lists) => {
      myLiveRef.current = true;
      setMyRooms(lists.mineRooms);
      setMyLoading(false);
      privateRoomsRef.current = lists.privateRooms;
      const merged = mergeDirectoryRooms(directoryRoomsRef.current, lists.privateRooms);
      setAllRooms(merged);
      cacheRooms(user.uid, lists.mineRooms, merged);
      finishRefresh();
    }, () => {
      // Fallback: sticky for the stay — Firebase effects resubscribe.
      setPass2HomeFlags((f) => (f ? { ...f, home: false } : f));
    });
    return () => {
      unsub();
      exitPass2Mode('home');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pass2HomeActive, user?.uid, refreshTick]);

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
        // Fix #29: never seed a closed room from disk, even briefly —
        // the live feeds filter them, so the seed must too.
        const seededMy = parsed.myRooms.filter((r) => r.active !== false);
        const seededAll = parsed.allRooms.filter((r) => r.active !== false);
        if (!myLiveRef.current) { setMyRooms(seededMy); setMyLoading(false); }
        if (!recLiveRef.current) { setAllRooms(seededAll); setRecLoading(false); }
      } catch { /* ignore — live feeds still load */ }
    })();
    return () => { cancelled = true; };
  }, [user?.uid]);
  useEffect(() => {
    if (!user?.uid) { setMyLoading(false); return; }
    if (pass2HomeActive) return; // pass2 REST lists own this feed
    const unsub = subscribeMyRoomsCombined(user.uid, (rooms) => {
      myLiveRef.current = true;
      setMyRooms(rooms);
      setMyLoading(false);
      cacheRooms(user.uid, rooms, allRoomsRef.current);
      finishRefresh();
    });
    return unsub;
  }, [user?.uid, refreshTick, pass2HomeActive]);

  // Directory feed: public rooms from the edge. Polls every 30s; the
  // tier serves its 60s cache, so origin load stays ~1 refresh/min no
  // matter how many phones poll.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const load = async () => {
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), 5000);
        const res = await fetch(DIRECTORY_URL, { signal: ctrl.signal });
        clearTimeout(to);
        if (!res.ok) throw new Error('directory ' + res.status);
        const json = await res.json();
        if (cancelled || !Array.isArray((json as any)?.rooms)) return;
        const mapped = ((json as any).rooms as any[]).map(normalizeDirectoryRoom).filter((r): r is RoomInfo => r !== null);
        mapped.sort((a, b) => b.createdAt - a.createdAt);
        directoryRoomsRef.current = mapped;
        directoryIdsRef.current = new Set(mapped.map((r) => r.id));
        directoryEverOkRef.current = true;
        const merged = mergeDirectoryRooms(mapped, privateRoomsRef.current);
        recLiveRef.current = true;
        // Fix #23: identical poll result → no set, no re-render, no cache
        // churn. The refresh spinner still stops via finishRefresh().
        if (roomsSignature(merged) === allRoomsSigRef.current) {
          finishRefresh();
          return;
        }
        allRoomsSigRef.current = roomsSignature(merged);
        setAllRooms(merged);
        setRecLoading(false);
        setDirectoryOk(true);
        cacheRooms(user?.uid ?? '', myRoomsRef.current, merged);
        finishRefresh();
      } catch {
        if (!cancelled && !directoryEverOkRef.current) setDirectoryFailed(true);
      }
    };
    load();
    timer = setInterval(load, 30000);
    return () => { cancelled = true; if (timer) clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick]);

  // Private rooms in directory mode (never on the public CDN).
  useEffect(() => {
    if (!directoryOk) return;
    if (pass2HomeActive) return; // pass2 REST lists own this feed
    const unsub = subscribePrivateActiveRooms((rooms) => {
      privateRoomsRef.current = rooms;
      const merged = mergeDirectoryRooms(directoryRoomsRef.current, rooms);
      setAllRooms(merged);
      cacheRooms(user?.uid ?? '', myRoomsRef.current, merged);
    }, () => {
      // Feed error: keep the last list, never wipe.
    });
    return unsub;
  }, [directoryOk, pass2HomeActive]);

  // Subscribe to all active public rooms (fallback: runs only while the
  // directory has neither succeeded nor failed yet — i.e. never once the
  // directory is up, and always when it is down).
  useEffect(() => {
    if (directoryOk || !directoryFailed) return;
    if (pass2HomeActive) return; // pass2 mode: cache + directory retry, never Firebase fallback
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
  }, [refreshTick, directoryOk, directoryFailed, pass2HomeActive]);

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
    // Fix #29: liveCount alone is NOT enough — closed rooms carry a stale
    // liveCount of 1 (one ghost listener in the directory snapshot).
    // active:false rooms are excluded from every tab. (Missing flag is
    // NOT treated as closed — only explicit active:false is dropped.)
    const onlyLive = (rooms: RoomInfo[]) => rooms.filter(r => r.active !== false && liveAudience(r) > 0);
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
      {/* Fix #23: clip off-screen native views while scrolling — the
          Recommended list is long and non-virtualized, so mounting every
          card at once was the main scroll cost. Images are memory-disk
          cached, so clipped cards repaint instantly on scroll-back. */}
      <GHScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews
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
                <TrophyIcon size={28} />
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
                        hideLiveBadge
                      />
                    );
                  })
                : (!recLoading && recLiveRef.current ? <EmptySection message={t('voiceRoom.home.noCategoryRooms')} /> : null)
            )}
      </GHScrollView>

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
            <GHScrollView style={{ flex: 1, paddingHorizontal: 16 }}>
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
            </GHScrollView>
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
