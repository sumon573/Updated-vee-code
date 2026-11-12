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
import { TrophyIcon } from '@/src/components/TrophyIcon';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScrollView as GHScrollView, FlatList } from 'react-native-gesture-handler';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import * as Location from 'expo-location';
import { get, ref } from 'firebase/database';
import { database } from '@/src/config/firebase';
import { getErrorCause } from '@/src/utils/errorDisplay';
import ScalePress from '@/components/ScalePress';
import RoomCard, { type StripRole } from '../components/RoomCard';
import RoomListItem from '../components/RoomListItem';
import { ActiveFollowingsBar, ActiveFollowingsSheet, loadActiveFollowings, type ActiveFollowing } from '../components/ActiveFollowingsSheet';
// Glass P1b: Candidate A "Pod Glass" (see src/design/GLASS_RULES.md).
// Translucent fill only — no expo-blur, static, one layer per surface.
import { GlassView } from '@/src/design/GlassView';
import { resolveGlassTheme, type RoomThemeInput } from '@/src/design/glassTokens';
import RoomCreationModal from './RoomCreationModal';
import { LeaderboardModal } from './LeaderboardModal';
import {
  subscribeActiveRooms,
  subscribeMyRoomsCombined,
  subscribePrivateActiveRooms,
  subscribeSelfRoomLeft, stripSelfFromRoom, removeSeat, leaveAudience,
  verifyRoomPin,
  setPinVerifiedForSession,
  type RoomInfo } from '../services/firebaseRoomService';
import { prefetchLivekitToken, destroyPersistedVoiceRoomEngineAsync } from '../useLivekitVoiceRoom';
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
import { getMinimizedRoom, setMinimizedRoom, type MinimizedRoom } from '@/src/store/minimizedRoom';
import { clearPersistedActiveRoom } from '@/src/store/activeRoom';
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

// Glass P1b — Home is a light screen (imo-light, bg #FFFFFF): resolve
// once at module scope. Values are imo-light from ROOM_THEMES
// (src/features/voice-room/constants/theme.ts): white bg → +0.08 fill
// boost, no scrim (calm backdrop, not a scene). Candidate B below is
// ONLY for the sticky Recommended header, where room covers scroll
// beneath it while stuck.
const HOME_GLASS_THEME: RoomThemeInput = {
  id: 'imo-light',
  bg: '#FFFFFF',
  surface: '#F1F5F9',
  onBg: '#111827',
  onBgSub: '#64748B',
  accent: '#05b5fa',
};
const HOME_GLASS = resolveGlassTheme(HOME_GLASS_THEME, false);
const HOME_GLASS_STICKY = resolveGlassTheme(HOME_GLASS_THEME, false, 'B');

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
    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 0, marginBottom: 14 }}>
      <Text numberOfLines={1} ellipsizeMode="tail" style={{ flex: 1, color: C.text, fontSize: 20, fontWeight: '900' }}>{title}</Text>
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

// 2026-10-30 (boss: Create Room label goes, box stays lightly premium):
// the "Create Room" text under the tile is removed entirely; the 68x68 box
// keeps its size, position and tap (create flow), and the plain dashed look
// is replaced by a subtle premium finish: soft violet tint, solid hairline
// border, faint shadow. The "+" stays as the create cue. No new text.
function CreateRoomTile({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <View style={{ width: 82, marginRight: 8 }}>
        {/* Glass P1b: card tile (radius 16 = token card radius); the violet
            hairline is kept via accentBorder, the plus stays centred. */}
        <GlassView variant="card" resolved={HOME_GLASS} accentBorder="rgba(139,92,246,0.30)" style={{ width: 68, height: 68 }}>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Feather name="plus" size={24} color={C.glow} />
          </View>
        </GlassView>
      </View>
    </Pressable>
  );
}

function CategoryChip({
  label, icon, active, onPress }: {
  label: string;
  icon: ComponentProps<typeof Feather>['name'];
  active?: boolean;
  onPress: () => void;
}) {
  // 2026-10-31 (boss: imo-identical pills): solid black active, light-gray
  // inactive, no border, no scale press — completely flat like imo.
  return (
    <Pressable onPress={onPress}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingHorizontal: 14, paddingVertical: 8, marginHorizontal: 4,
        borderRadius: 999,
        backgroundColor: active ? '#000000' : '#F2F2F7',
      }}>
        <Feather name={icon} size={13} color={active ? '#fff' : C.muted} />
        <Text style={{ color: active ? '#fff' : C.muted, fontSize: 13, fontWeight: '700' }}>
          {label}
        </Text>
      </View>
    </Pressable>
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
  // 2026-10-30 (boss: voice page full display, no shell bar here):
  // the page's own scroll padding reserves only the OS gesture zone.
  const insets = useSafeAreaInsets();

  // My Rooms — owned by me (seeded from cache: tab switches render
  // instantly, no loader flash — live subscriptions refresh underneath).
  const cachedSeed = memoryCachedVoiceRooms?.uid === user?.uid ? memoryCachedVoiceRooms : null;
  const [myRooms,   setMyRooms]   = useState<RoomInfo[]>(() => cachedSeed?.myRooms ?? []);
  const [myLoading, setMyLoading] = useState(() => !cachedSeed);

  // All public rooms — for Recommended section
  const [allRooms,  setAllRooms]  = useState<RoomInfo[]>(() => cachedSeed?.allRooms ?? []);
  const [recLoading, setRecLoading] = useState(() => !cachedSeed);

  // Phase D (CDN room directory, 2026-10-28): public rooms came from the
  // edge (3s edge cache, 60s tier cache) instead of a full Firebase rooms
  // query + 2 live subscriptions per room. Private rooms NEVER touch the
  // public CDN — they still come from Firebase below.
  // 2026-11-01 (boss: Trending realtime): the live Firebase feed is now
  // PRIMARY and the edge directory is only its seed/fallback — the old
  // "directoryFailed flips the gate" fallback model is retired. Later poll
  // failures keep the last good list.
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

  // Pull-to-refresh tick (declared here — BEFORE the pass2 effect below,
  // whose dep array reads it; it was declared after the effect, which is
  // a use-before-declaration error). Bumped by handleRefresh to re-run
  // the room-feed subscribes on pull-to-refresh.
  const [refreshTick, setRefreshTick] = useState(0);

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

  // 2026-11-11 (boss, room role badge): each strip tile shows the current
  // user's role in that room (👤 gold = owner, blue = admin, grey =
  // member) and the strip sorts owner → admin → member.
  // — Owner is free: room.ownerId === user.uid (RoomInfo carries it).
  // — Admin comes from the admins registry (rooms/{rid}/admins/{uid}) — the
  //   source of truth (subscribeRoomAdmins reads the same node). userRooms
  //   role is written at join time and NEVER updated on grant/revoke, so it
  //   is stale and is NOT used here.
  // — One-shot get()s only, for non-owned strip rooms (the joined list is
  //   capped at 20): no new subscription, no poll, no timer. Re-resolves on
  //   pull-to-refresh (refreshTick) so a grant/revoke is picked up.
  // — Skipped in pass2 home mode (Firebase is offline there): owner-gold
  //   still shows (ownerId is in the tier data); non-owned rooms show no
  //   badge until Firebase is back. Recorded limitation.
  // — Unknown role shows NO badge and sorts as member (rank 2): the tile
  //   can only move UP when its admin status resolves — never a wrong badge.
  const [adminOf, setAdminOf] = useState<Record<string, boolean>>({});
  const myRoomIdsKey = useMemo(() => myRooms.map((r) => r.id).join(','), [myRooms]);
  useEffect(() => {
    if (pass2HomeActive || !user?.uid) return;
    const uid = user.uid;
    const unknown = myRooms
      .filter((r) => r.ownerId !== uid && !(r.id in adminOf))
      .map((r) => r.id);
    if (unknown.length === 0) return;
    let cancelled = false;
    (async () => {
      const next: Record<string, boolean> = {};
      for (const id of unknown) {
        try {
          const snap = await get(ref(database, `rooms/${id}/admins/${uid}`));
          next[id] = snap.exists() && snap.val() === true;
        } catch {
          // Leave unknown — no badge until it resolves.
        }
      }
      if (!cancelled && Object.keys(next).length > 0) {
        setAdminOf((prev) => ({ ...prev, ...next }));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myRoomIdsKey, refreshTick, pass2HomeActive, user?.uid]);

  // Role per strip room (owner is immediate; admin/member once the
  // one-shot check resolves; unknown = no entry = no badge).
  const stripRoles = useMemo(() => {
    const m = new Map<string, StripRole>();
    for (const r of myRooms) {
      if (user?.uid && r.ownerId === user.uid) m.set(r.id, 'owner');
      else if (r.id in adminOf) m.set(r.id, adminOf[r.id] ? 'admin' : 'member');
    }
    return m;
  }, [myRooms, adminOf, user?.uid]);

  // The strip, sorted by role: owner first, then admin, then member.
  // Same ranks as RoomInfoModal roleRank (owner 0, admin 1, member 2).
  // Stable sort — within a role the existing order is kept (owned:
  // createdAt desc; joined: joinedAt desc). The "+" create tile is not a
  // room and stays first (it is rendered before this list).
  const sortedMyRooms = useMemo(() => {
    const rank = (id: string) => {
      const r = stripRoles.get(id);
      return r === 'owner' ? 0 : r === 'admin' ? 1 : 2;
    };
    return [...myRooms].sort((a, b) => rank(a.id) - rank(b.id));
  }, [myRooms, stripRoles]);

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

  // 2026-11-01 (boss: switch-room popup): while minimized in one room,
  // tapping a DIFFERENT room asks first instead of joining directly.
  const [pendingSwitchRoom, setPendingSwitchRoom] = useState<RoomInfo | null>(null);
  const [pendingSwitchFrom, setPendingSwitchFrom] = useState<MinimizedRoom | null>(null);
  // Handle room card press — show PIN dialog for private rooms
  const proceedToRoom = async (room: RoomInfo) => {
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
  const handleRoomPress = async (room: RoomInfo) => {
    const min = getMinimizedRoom();
    if (min) {
      if (min.id === room.id) {
        // Same room: restore path — already a member, no PIN, no popup.
        goToRoom(room.id, user?.displayName ?? user?.uid);
        return;
      }
      // Different room while minimized: ask first, never join directly.
      setPendingSwitchFrom(min);
      setPendingSwitchRoom(room);
      return;
    }
    await proceedToRoom(room);
  };
  handleRoomPressRef.current = handleRoomPress;

  // 2026-11-01 (boss: switch-room popup): Yes = the PROVEN
  // MinimizedRoomBar.handleClose clean-leave sequence for the OLD room,
  // then proceed to the pending room. (No Haptics / router.replace here:
  // this screen IS home already, and navigation follows via proceedToRoom.)
  const confirmSwitchRoom = () => {
    const target = pendingSwitchRoom;
    const from = pendingSwitchFrom;
    setPendingSwitchRoom(null);
    setPendingSwitchFrom(null);
    if (!target || !from) return;
    // 2026-11-07 (Area A): await the FULL teardown before entering
    // the new room. The old fire-and-forget destroy + immediate
    // proceedToRoom joined the target while this engine was still
    // leaving, so both rooms played at once.
    void (async () => {
      try {
        await destroyPersistedVoiceRoomEngineAsync();
      } catch { /* non-critical — presence cleanup below still runs */ }
      if (from.mySeatIdx >= 0) {
        removeSeat(from.id, from.mySeatIdx).catch(() => {});
        // Seated users keep an audience record — clean it or it ghosts.
        leaveAudience(from.id, from.myUid).catch(() => {});
      } else {
        leaveAudience(from.id, from.myUid).catch(() => {});
      }
      clearPersistedActiveRoom().catch(() => {});
      setMinimizedRoom(null);
      void proceedToRoom(target);
    })();
  };
  const cancelSwitchRoom = () => {
    setPendingSwitchRoom(null);
    setPendingSwitchFrom(null);
  };

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
  // 2026-11-07 (Voice Room Home fix — stuck refresh icon): the native
  // Android SwipeRefreshLayout spinner cannot handle a true→false flip
  // inside a few milliseconds. Firebase onValue delivers the cached
  // roomList / userRooms snapshot immediately on re-subscribe, so
  // finishRefresh ran ~ms after handleRefresh and the spinner's show
  // animation never completed, leaving it stuck visible over the
  // carousel. Enforce a minimum visible duration (MIN_REFRESH_MS) so
  // the spinner always animates in fully before it is hidden. Same
  // one-shot setTimeout mechanism already used for the 8s safety —
  // no new timer/interval/poll.
  const MIN_REFRESH_MS = 700;
  const MAX_REFRESH_MS = 8000;
  // 2026-11-09 (boss: refresh circle STUCK on home, 18:19 screenshot):
  // the 2026-11-07 MIN-700ms fix only stretches the JS true→false flip.
  // It cannot fix the two ways the circle still sticks:
  // (1) NATIVE WEDGE — the hide flip lands while a pull-drag is still
  // in flight (a second pull inside the 700ms window, or the circle
  // mid-return-animation): Android SwipeRefreshLayout loses that flip
  // and the circle freezes in pull position (static white circle +
  // black reload arrow) while JS `refreshing` is ALREADY false and no
  // timer is pending — nothing in JS can ever clear it.
  // 2026-11-09 F2: the 2026-11-09 key-bump "cure" (bump a key on every
  // hide so the native spinner is recreated fresh) is REMOVED — it was
  // the wedge, not the cure. The bump destroys the SwipeRefreshLayout
  // (and, per RN 0.81.5 ScrollView.js Android wrapping, its child
  // ScrollView) under a live gesture; the replacement never saw
  // ACTION_DOWN, so it has no release path and the circle freezes
  // forever. Hide is now a plain setRefreshing(false) (the
  // pre-2026-11-09 known-good hide); the plain flip recovers on
  // finger-up per stock androidx. See vee-refresh-invest3/DIAGNOSIS.md.
  // (2) SINGLE SHARED TIMER — the MIN-delay branch cancels the 8s
  // safety, leaving the one hide timer as the only guard. Cure: an
  // independent one-shot watchdog (own ref, never touched by
  // clearRefreshTimer) that force-hides at 10s. No new interval/poll.
  const WATCHDOG_REFRESH_MS = 10000;
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  const refreshStartRef = useRef(0);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshHideScheduledRef = useRef(false);
  const clearRefreshTimer = () => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }
  };
  const clearRefreshWatchdog = () => {
    if (refreshWatchdogRef.current) {
      clearTimeout(refreshWatchdogRef.current);
      refreshWatchdogRef.current = null;
    }
  };
  const finishRefresh = useCallback(() => {
    if (!refreshingRef.current) return;
    const elapsed = Date.now() - refreshStartRef.current;
    const remaining = MIN_REFRESH_MS - elapsed;
    if (remaining > 0) {
      // Too soon — the native spinner has not had time to animate in.
      // Re-schedule the hide for when the minimum has elapsed (this
      // supersedes the 8s safety timer, which is cancelled here).
      if (!refreshHideScheduledRef.current) {
        refreshHideScheduledRef.current = true;
        clearRefreshTimer();
        refreshTimerRef.current = setTimeout(() => {
          refreshHideScheduledRef.current = false;
          finishRefresh();
        }, remaining);
      }
      return;
    }
    clearRefreshTimer();
    clearRefreshWatchdog();
    refreshHideScheduledRef.current = false;
    refreshingRef.current = false;
    // F2 (2026-11-09): plain hide only — no remount. The key bump that
    // used to live here destroyed the native layout mid-drag and froze
    // the circle forever; the plain flip recovers on finger-up.
    setRefreshing(false);
  }, []);
  const handleRefresh = useCallback(() => {
    if (refreshingRef.current) {
      // F2d (2026-11-09): re-entrant pull while already refreshing —
      // re-arm the hide to 700ms after THIS pull so it cannot land
      // mid-second-drag. Reset the start, clear the scheduled hide,
      // and let finishRefresh's MIN branch reschedule at +700ms.
      refreshStartRef.current = Date.now();
      refreshHideScheduledRef.current = false;
      finishRefresh();
      return;
    }
    refreshingRef.current = true;
    refreshStartRef.current = Date.now();
    refreshHideScheduledRef.current = false;
    setRefreshing(true);
    setRefreshTick((n) => n + 1);
    clearRefreshTimer();
    clearRefreshWatchdog();
    refreshTimerRef.current = setTimeout(finishRefresh, MAX_REFRESH_MS);
    // 2026-11-09: independent watchdog — its own ref, so the MIN-delay
    // branch above can never cancel it. Fires finishRefresh (elapsed
    // is past MIN by then, so it hides immediately + remounts).
    refreshWatchdogRef.current = setTimeout(finishRefresh, WATCHDOG_REFRESH_MS);
  }, [finishRefresh]);
  // Clear any pending refresh timeout on unmount (no stale setState).
  useEffect(() => () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    if (refreshWatchdogRef.current) clearTimeout(refreshWatchdogRef.current);
  }, []);

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
  // 2026-11-01 (boss: Trending realtime): the live Firebase feed is the
  // PRIMARY public source — one listener, counts update on join/leave
  // instantly. The edge directory is only a seed until the live feed
  // first delivers (or after it errors); the 15s poll tick recomputes
  // through this same step and can never overwrite live data with
  // tier-cached data. Live feeds are NEVER veiled (they update on leave
  // in real time); the batch40 self-veil applies to tier payloads only.
  // During pass2 home mode this is a no-op — the tier lists own allRooms.
  const liveRoomsRef = useRef<RoomInfo[]>([]);
  const liveDeliveredRef = useRef(false);
  const userUidRef = useRef<string | undefined>(user?.uid);
  userUidRef.current = user?.uid;
  const pass2HomeActiveRef = useRef(pass2HomeActive);
  pass2HomeActiveRef.current = pass2HomeActive;
  const recomputeAllRooms = useCallback(() => {
    if (pass2HomeActiveRef.current) return;
    const pub = liveDeliveredRef.current ? liveRoomsRef.current : directoryRoomsRef.current;
    const mergedRaw = mergeDirectoryRooms(pub, privateRoomsRef.current);
    const uid = userUidRef.current;
    const merged = (!liveDeliveredRef.current && uid) ? mergedRaw.map((r) => stripSelfFromRoom(r, uid)) : mergedRaw;
    // Fix #23: identical visible content → no set, no cache churn.
    if (roomsSignature(merged) === allRoomsSigRef.current) return;
    allRoomsSigRef.current = roomsSignature(merged);
    setAllRooms(merged);
    setRecLoading(false);
    cacheRooms(uid ?? '', myRoomsRef.current, merged);
  }, [mergeDirectoryRooms, roomsSignature, cacheRooms]);

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

  // 2026-10-31 (boss: stale avatar + count after exit, PERMANENT):
  // the moment a true leave fires, strip self from both lists at once
  // (plus the persisted cache) — no waiting for the next 15s poll or
  // the 60s tier refresh. The directory poll keeps the veil for 90s
  // (see the directory load above) so a tier-cached payload cannot
  // re-add self; a re-join clears the marker (see VoiceRoomScreen).
  useEffect(() => {
    if (!user?.uid) return;
    const uid = user.uid;
    return subscribeSelfRoomLeft((m) => {
      if (m.uid !== uid) return;
      const strip = (r: RoomInfo): RoomInfo => (r.id === m.roomId ? stripSelfFromRoom(r, uid) : r);
      const nextAll = allRoomsRef.current.map(strip);
      const nextMy = myRoomsRef.current.map(strip);
      allRoomsSigRef.current = roomsSignature(nextAll);
      setAllRooms(nextAll);
      setMyRooms(nextMy);
      cacheRooms(uid, nextMy, nextAll);
    });
  }, [user?.uid, roomsSignature]);

  // Directory feed: public rooms from the edge. Polls every 15s
  // (2026-10-30: Trending real-time — halves the poll-phase lag; the
  // edge 3s cache absorbs the rate and Fix #23 dedupes identical
  // payloads, so no re-render churn and no extra origin load).
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
        if (cancelled) return;
        // 2026-11-01 (boss: stuck refresh spinner): a malformed payload
        // used to return without stopping the spinner — finish it here.
        if (!Array.isArray((json as any)?.rooms)) { finishRefresh(); return; }
        const mapped = ((json as any).rooms as any[]).map(normalizeDirectoryRoom).filter((r): r is RoomInfo => r !== null);
        mapped.sort((a, b) => b.createdAt - a.createdAt);
        directoryRoomsRef.current = mapped;
        directoryIdsRef.current = new Set(mapped.map((r) => r.id));
        directoryEverOkRef.current = true;
        setDirectoryOk(true);
        recLiveRef.current = true;
        // 2026-11-01 (boss: Trending realtime): the poll tick recomputes
        // through the shared step — while the live feed has delivered it
        // cannot overwrite live data with tier-cached data.
        recomputeAllRooms();
        finishRefresh();
      } catch {
        // 2026-11-01 (boss: stuck refresh spinner): a failed poll used to
        // leave the spinner hanging until the 8s timeout — finish it here.
        if (!cancelled) finishRefresh();
        if (!cancelled && !directoryEverOkRef.current) setDirectoryFailed(true);
      }
    };
    load();
    timer = setInterval(load, 15000);
    return () => { cancelled = true; if (timer) clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTick]);

  // Private rooms in directory mode (never on the public CDN).
  // 2026-11-01 (boss: Trending realtime): no longer waits for
  // directoryOk — the live feed is primary, so private rooms join the
  // shared recompute as soon as their own feed delivers.
  useEffect(() => {
    if (pass2HomeActive) return; // pass2 REST lists own this feed
    const unsub = subscribePrivateActiveRooms((rooms) => {
      privateRoomsRef.current = rooms;
      recomputeAllRooms();
    }, () => {
      // Feed error: keep the last list, never wipe.
    });
    return unsub;
  }, [pass2HomeActive, recomputeAllRooms]);

  // 2026-11-01 (boss: Trending realtime): the live Firebase feed is now
  // the PRIMARY public directory source — one listener, counts update on
  // join/leave instantly. The edge poll is only a seed until this feed
  // first delivers (or after it errors).
  useEffect(() => {
    if (pass2HomeActive) return; // pass2 mode: cache + directory retry, never Firebase fallback
    const unsub = subscribeActiveRooms((rooms) => {
      liveDeliveredRef.current = true;
      liveRoomsRef.current = rooms;
      recLiveRef.current = true;
      recomputeAllRooms();
      finishRefresh();
    }, () => {
      // Feed error: fall back to the directory seed, never wipe — and do
      // NOT mark the feed live, so the empty-state text stays suppressed
      // until a real feed confirms the list is truly empty.
      liveDeliveredRef.current = false;
      recomputeAllRooms();
      finishRefresh();
    });
    return unsub;
  }, [refreshTick, pass2HomeActive, recomputeAllRooms]);

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
    // 2026-10-30 (boss: Trending sometimes not showing): liveCount is a
    // swept value, so a snapshot can carry liveCount 0 for a room whose
    // members are already seated (sweep pending) — the old single-signal
    // test dropped such rooms from every tab. Accept EITHER occupancy
    // signal from the same snapshot; a room with zero in every signal
    // still hides, so the live-only rule is intact. Ranking untouched.
    const onlyLive = (rooms: RoomInfo[]) => rooms.filter(r => r.active !== false && (liveAudience(r) > 0 || (r.memberCount ?? 0) + (r.listenerCount ?? 0) > 0));
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

  // ── 2026-10-31 (boss: room page EXACTLY like imo) ─────────────────────
  // Room | Explore tabs (Explore = discovery without the My Rooms strip,
  // until the boss specifies Explore content) + Active Followings pill.
  const [pageTab, setPageTab] = useState<'room' | 'explore'>('room');
  const [followingsOpen, setFollowingsOpen] = useState(false);
  const [activeFollowings, setActiveFollowings] = useState<ActiveFollowing[]>([]);
  // 2026-11-09 (pill mount-race): the load below snapshots roomsByIdRef
  // once at home mount; if the room lists have not arrived yet it sees
  // zero roomIds and loadActiveFollowings early-returns []. Nothing ever
  // re-ran it, so a following in a room stayed invisible. roomsLoaded
  // flips false -> true when the lists first arrive and re-runs the load
  // once (guarded by pillRoomsRerunDoneRef, so later room-list churn
  // never re-runs it — no polling, no subscription, no loop: setting
  // activeFollowings cannot change roomsLoaded).
  const roomsLoaded = allRooms.length + myRooms.length > 0;
  const pillRoomsRerunDoneRef = useRef(false);
  const pillLoadedUidRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    // Part 2b: skipped in pass2 home mode — the loaders read Firebase
    // and would serve stale cache while offline; the bar hides
    // automatically since the list stays empty (the sheet opens only
    // from the bar). Full parity needs a tier "active followings"
    // endpoint (per-room audience would need a poller /watch per
    // room — expensive).
    if (pass2HomeActive) { setActiveFollowings([]); return; }
    if (!user?.uid) return;
    // A new signed-in user gets a fresh one-shot re-run allowance.
    if (pillLoadedUidRef.current !== user.uid) {
      pillLoadedUidRef.current = user.uid;
      pillRoomsRerunDoneRef.current = false;
    }
    // Already loaded (or re-run) with rooms present — skip. The mount
    // load with an empty list does NOT set the flag, so the
    // rooms-arrived run below still happens exactly once.
    if (roomsLoaded && pillRoomsRerunDoneRef.current) return;
    if (roomsLoaded) pillRoomsRerunDoneRef.current = true;
    let cancelled = false;
    loadActiveFollowings(user.uid, [...roomsByIdRef.current.keys()])
      .then((list) => { if (!cancelled) setActiveFollowings(list); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [user?.uid, pass2HomeActive, roomsLoaded]);

  // FlatList model (chat-list pattern): data items keep sticky indices
  // stable by construction — myrooms = 0, recheader = 1 (sticky), rooms = 2+.
  type HomeItem = {
    key: string;
    type: 'myrooms' | 'recheader' | 'room' | 'nearbyLoading' | 'nearbyDenied' | 'empty';
    room?: RoomInfo;
    distanceKm?: number;
  };
  const homeItems = useMemo<HomeItem[]>(() => {
    const items: HomeItem[] = [];
    if (pageTab === 'room') items.push({ key: 'myrooms', type: 'myrooms' });
    items.push({ key: 'recheader', type: 'recheader' });
    if (activeTab === 'nearby' && locationLoading) {
      items.push({ key: 'nearby-loading', type: 'nearbyLoading' });
    } else if (activeTab === 'nearby' && locationDenied) {
      items.push({ key: 'nearby-denied', type: 'nearbyDenied' });
    } else if (recommended.length > 0) {
      for (const r of recommended) {
        const distanceKm = activeTab === 'nearby' && userLocation && r.location
          ? haversineKm(userLocation.lat, userLocation.lng, r.location.lat, r.location.lng)
          : undefined;
        items.push({ key: 'room-' + r.id, type: 'room', room: r, distanceKm });
      }
    } else if (!recLoading && recLiveRef.current) {
      items.push({ key: 'empty', type: 'empty' });
    }
    return items;
  }, [pageTab, activeTab, locationLoading, locationDenied, recommended, recLoading, userLocation]);
  const homeSticky = pageTab === 'room' ? [1] : [0];

  return (
    <View style={{ flex: 1 }}>
      {/* Fix #23: clip off-screen native views while scrolling — the
          Recommended list is long and non-virtualized, so mounting every
          card at once was the main scroll cost. Images are memory-disk
          cached, so clipped cards repaint instantly on scroll-back. */}
      {/* 2026-10-31 (boss: imo-identical header): Room | Explore tabs stay
          fixed above the list; trophy + search + close move here from the
          old My Rooms header row (imo has no My Rooms title row). */}
      {/* Glass P1b: nav bar (Candidate A). borderRadius 0 — this bar is
          flush to the screen edge, not a floating pill. */}
      <GlassView variant="nav" resolved={HOME_GLASS} style={{ borderRadius: 0 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 }}>
        <Pressable onPress={() => setPageTab('room')} hitSlop={6} style={{ marginRight: 20, alignItems: 'center' }}>
          <Text style={{ color: pageTab === 'room' ? '#000000' : '#8E8E93', fontSize: 17, fontWeight: pageTab === 'room' ? '800' : '600' }}>Room</Text>
          <View style={{ height: 3, width: 24, borderRadius: 2, backgroundColor: pageTab === 'room' ? '#2196F3' : 'transparent', marginTop: 4 }} />
        </Pressable>
        <Pressable onPress={() => setPageTab('explore')} hitSlop={6} style={{ alignItems: 'center' }}>
          <Text style={{ color: pageTab === 'explore' ? '#000000' : '#8E8E93', fontSize: 17, fontWeight: pageTab === 'explore' ? '800' : '600' }}>Explore</Text>
          <View style={{ height: 3, width: 24, borderRadius: 2, backgroundColor: pageTab === 'explore' ? '#2196F3' : 'transparent', marginTop: 4 }} />
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => setLeaderboardOpen(true)} hitSlop={8} style={{ padding: 8 }}>
          <TrophyIcon size={24} />
        </Pressable>
        {/* 2026-11-02 (boss: marked screenshot): clean person icon between
            trophy and search, evenly spaced, polished circled-user look.
            Tap opens the GPT premium profile menu (/profile/menu).
            The Me tab keeps the old profile page unchanged. */}
        <Pressable onPress={() => router.push('/profile/menu')} hitSlop={8} style={{ padding: 8, marginHorizontal: 2 }}>
          <View style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 1.5, borderColor: C.text, alignItems: 'center', justifyContent: 'center' }}>
            <Feather name="user" size={15} color={C.text} />
          </View>
        </Pressable>
        <Pressable onPress={() => setRoomSearchOpen(true)} hitSlop={8} style={{ padding: 8 }}>
          <Feather name="search" size={22} color={C.text} />
        </Pressable>
        {onClose && (
          <Pressable onPress={onClose} hitSlop={8} style={{ width: 34, height: 34, borderRadius: 17, marginLeft: 2, backgroundColor: 'rgba(0,0,0,0.06)', alignItems: 'center', justifyContent: 'center' }}>
            <Feather name="x" size={18} color={C.text} />
          </Pressable>
        )}
      </View>
      </GlassView>
      {/* 2026-10-31 (boss: chat-list/contacts scroll here): the page scroll
          is a virtualized FlatList (chat-list pattern) — the old GHScrollView
          mounted every Recommended card at once, which was the scroll jank.
          No getItemLayout: card heights vary (topic / member rows), and
          FlatList still virtualizes without it. removeClippedSubviews stays
          OFF: it can unstick sticky headers on Android. */}
      {/* 2026-10-31 (scroll fix): GH FlatList + nestedScrollEnabled -
          the RN FlatList did not scroll inside HomePager's Pan
          GestureDetector (chats/contacts use GH FlatList and scroll);
          the flex:1 wrapper mirrors the chats page structure. */}
      <FlatList
        style={{ flex: 1 }}
        data={homeItems}
        keyExtractor={(item) => item.key}
        stickyHeaderIndices={homeSticky}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={false}
        nestedScrollEnabled={true}
        initialNumToRender={12}
        maxToRenderPerBatch={8}
        updateCellsBatchingPeriod={50}
        windowSize={10}
        contentContainerStyle={{ paddingBottom: insets.bottom + 16 + (activeFollowings.length > 0 ? 60 : 0) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        renderItem={({ item }) => {
          if (item.type === 'myrooms') {
            return (
              <View>
                <GHScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingBottom: 0, paddingTop: 12, paddingHorizontal: 16 }}
                  scrollEventThrottle={16}
                  bounces={false}
                  onScrollBeginDrag={onLockParentScroll}
                  onScrollEndDrag={onUnlockParentScroll}
                  onMomentumScrollEnd={onUnlockParentScroll}
                >
                  <CreateRoomTile onPress={() => setCreateModalOpen(true)} />
                  {sortedMyRooms.map((r) => (
                    <View key={r.id} style={{ marginRight: 10 }}>
                      <RoomCard room={voiceRoomOf(r)} liveCount={liveAudienceOf(r)} onPress={pressFor(r.id)} role={stripRoles.get(r.id)} />
                    </View>
                  ))}
                </GHScrollView>
                {myRooms.length === 0 && !myLoading && (
                  // Glass P1b: panel (was a flat #F2F2F7 surface).
                  <GlassView variant="panel" resolved={HOME_GLASS} style={{ marginBottom: 8, marginHorizontal: 16 }}>
                    <View style={{ alignItems: 'center', padding: 18 }}>
                      <Feather name="mic" size={24} color={C.muted} />
                      <Text style={{ color: C.muted, fontSize: 13, marginTop: 8, textAlign: 'center' }}>
                        {t('voiceRoom.home.noMyRooms')}
                      </Text>
                    </View>
                  </GlassView>
                )}
              </View>
            );
          }
          if (item.type === 'recheader') {
            return (
              // Glass P1b: sticky header — Candidate B (not A): room covers
              // scroll beneath it while stuck, so it takes the heavier
              // frost for readability. Chips inside stay plain (never
              // nest GlassView) and keep their flat imo look.
              <GlassView variant="panel" resolved={HOME_GLASS_STICKY} style={{ borderRadius: 0 }}>
              <View style={{ paddingHorizontal: 16 }}>
                <SectionTitle title={t('voiceRoom.home.recommended')} />
                {/* 2026-10-31 (batch47 full display): chips window full-bleed (-16 cancels parent padding) + content padding 12 + chip margin 4 = first/last chip visual at 16; mid-scroll clips at screen edges like the top row. */}
                <GHScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingBottom: 14, paddingHorizontal: 12 }}
                  scrollEventThrottle={16}
                  bounces={false}
                  style={{ marginHorizontal: -16 }}
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
                </View>
              </GlassView>
            );
          }
          if (item.type === 'room' && item.room) {
            return (
              <View style={{ paddingHorizontal: 16 }}>
              <RoomListItem
                room={voiceRoomOf(item.room)}
                liveCount={liveAudienceOf(item.room)}
                distanceKm={item.distanceKm}
                onPress={pressFor(item.room.id)}
                hideLiveBadge
                resolved={HOME_GLASS}
              />
              </View>
            );
          }
          if (item.type === 'nearbyLoading') {
            return (
              <View style={{ alignItems: 'center', paddingVertical: 28 }}>
                <PremiumLoader size="medium" />
                <Text style={{ color: C.muted, fontSize: 13, marginTop: 10 }}>
                  {t('voiceRoom.home.gettingLocation')}
                </Text>
              </View>
            );
          }
          if (item.type === 'nearbyDenied') {
            return (
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
            );
          }
          return (<EmptySection message={t('voiceRoom.home.noCategoryRooms')} />);
        }}
      />
      {activeFollowings.length > 0 && (
        <View style={{ position: 'absolute', left: 16, right: 16, bottom: insets.bottom + 70 }}>
          <ActiveFollowingsBar active={activeFollowings} onPress={() => setFollowingsOpen(true)} />
        </View>
      )}
      <ActiveFollowingsSheet
        visible={followingsOpen}
        onClose={() => setFollowingsOpen(false)}
        myUid={user?.uid}
        // 2026-11-09 (boss: pill showed 3 avatars, sheet said "No active
        // followings"): the pill's presence snapshot is one-shot at home
        // mount, so the sheet's fresh load re-syncs it on every open.
        onActiveLoaded={(list) => setActiveFollowings(list)}
        roomIds={[...allRooms, ...myRooms].map((r) => r.id)}
        onJoinRoom={(roomId) => {
          setFollowingsOpen(false);
          const fresh = roomsByIdRef.current.get(roomId);
          if (fresh) void handleRoomPressRef.current(fresh);
          else {
            const min = getMinimizedRoom();
            if (min && min.id !== roomId) {
              // Unknown ID: no RoomInfo to PIN-check (today's path joins
              // directly), so the popup routes straight to goToRoom on Yes.
              setPendingSwitchFrom(min);
              setPendingSwitchRoom({ id: roomId, name: roomId, isPublic: true } as RoomInfo);
            } else {
              goToRoom(roomId, user?.displayName ?? user?.uid);
            }
          }
        }}
      />

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
              {/* Glass P1b: search bar pill (was flat #F0F0F0). */}
              <GlassView variant="panel" resolved={HOME_GLASS} style={{ borderRadius: 24 }}>
              <View style={{
                flexDirection: 'row',
                alignItems: 'center',
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
              </GlassView>
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
                    resolved={HOME_GLASS}
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
            {/* Glass P1b: modal over the dimmed backdrop (A2 rule — the
                0.7 backdrop stays); violet hairline kept via accentBorder. */}
            <GlassView variant="modal" resolved={HOME_GLASS} accentBorder="rgba(139,92,246,0.35)">
              <View style={{ padding: 28 }}>
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
            </GlassView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* 2026-11-01 (boss: switch-room popup): minimized in one room,
          tapped another — ask first, never join directly. */}
      <Modal
        visible={!!pendingSwitchRoom}
        animationType="fade"
        transparent
        onRequestClose={cancelSwitchRoom}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 24 }}
          onPress={cancelSwitchRoom}
        >
          <Pressable style={{ width: '100%', maxWidth: 360 }} onPress={() => {}}>
            {/* Glass P1b: modal over the dimmed backdrop (A2 rule); violet
                hairline kept via accentBorder. */}
            <GlassView variant="modal" resolved={HOME_GLASS} accentBorder="rgba(139,92,246,0.35)">
              <View style={{ padding: 28 }}>
              <Text style={{ color: '#000000', fontSize: 18, fontWeight: '900', marginBottom: 12 }}>
                Switch to this room?
              </Text>
              <Text style={{ color: '#8E8E93', fontSize: 14, marginBottom: 20 }}>
                You are in "{pendingSwitchFrom?.name}". Switch to "{pendingSwitchRoom?.name}"?
              </Text>
              <Pressable
                onPress={confirmSwitchRoom}
                style={{ backgroundColor: '#7C3AED', borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginBottom: 10 }}
              >
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '900' }}>Yes</Text>
              </Pressable>
              <Pressable
                onPress={cancelSwitchRoom}
                style={{ backgroundColor: '#F2F2F7', borderRadius: 14, paddingVertical: 14, alignItems: 'center' }}
              >
                <Text style={{ color: '#000000', fontSize: 16, fontWeight: '900' }}>No</Text>
              </Pressable>
              </View>
            </GlassView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Room Creation Modal */}
      <RoomCreationModal
        visible={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onRoomCreated={(roomId) => {
          setCreateModalOpen(false);
          // 2026-11-01 (boss: switch popup covers create-room too):
          // minimized in another room -> ask first, never join directly.
          // Name falls back to the id (same as the followings unknown-ID
          // path); the room was just created, so no directory entry yet.
          const min = getMinimizedRoom();
          if (min && min.id !== roomId) {
            setPendingSwitchFrom(min);
            setPendingSwitchRoom({ id: roomId, name: roomId, isPublic: true } as RoomInfo);
            return;
          }
          goToRoom(roomId, user?.displayName ?? user?.uid);
        }}
      />
    </View>
  );
}
