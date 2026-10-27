import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import { View, Text, ScrollView, FlatList, Alert, Pressable, Modal, TextInput, Image, StyleSheet } from 'react-native';
import PremiumLoader from '@/src/components/PremiumLoader';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Participant } from '../types/room';
import { uploadRoomCover } from '@/src/services/cloudinaryService';
import { alertPermissionPermanentlyDenied } from '@/src/utils/permissionAlert';
import { subscribeRoomMembers, type JoinedMember } from '../services/firebaseRoomService';
import { formatMembersCount } from '../screens/VoiceRoomHelpers';
import { submitRoomReport } from '@/src/services/reportService';
import { getUser } from '@/src/services/userService';

/* ─────────────────────────── Room Info Panel (imo-style, 2026-10-27) ──
 * Dark panel, exactly like the boss's imo screenshots: room card that
 * scrolls away natively inside the tab content, Room Details | Member
 * tabs, member list with color role badges.
 * HARD NO-DEMO LAW: every value comes from real data or a real flow.
 * Rows with no real source are OMITTED (Member's Group, Followers) and
 * reported — never faked. Room Level has no Vee system yet, so it shows
 * the documented starting default Lv.1 (never imo's Lv.7).
 * ─────────────────────────────────────────────────────────────────────── */

// imo panel palette (dark, like the screenshots)
const PANEL_BG = '#000000';
const CARD_BG = '#1C1C1E';
const ROW_BG = '#1C1C1E';
const TEXT = '#FFFFFF';
const SUB = '#9C9C9C';
const DIM = '#8A8A8A';
const DIVIDER = 'rgba(255,255,255,0.09)';
const GOLD = '#FFB300'; // Room owner ONLY (boss rule 2026-10-27: never badges)
const BLUE = '#42A5F5'; // admin

// Member row height is FIXED (avatar 44 + vertical padding 22 + hairline
// divider) so getItemLayout never re-measures and rows never shift height
// while scrolling. Name is single-line (see MemberRow) to guarantee this.
const GREY = '#8A8A8E'; // regular member
const MEMBER_ROW_HEIGHT = 66 + StyleSheet.hairlineWidth;
const GREEN = '#22C55E';
const RED = '#FF453A';

// Row-level cache: one-shot lastSeen reads per uid, so scrolling back never
// refetches. (No honor cache: the role icon no longer reads badges at all.)
const lastSeenCache = new Map<string, number | null>();

/** Raw lastSeen (users/{uid}/lastSeen) — only a NUMBER counts. Anything else
 * (e.g. an unresolved server timestamp) means "unknown": no status text is
 * shown, never a fabricated "Active N days ago". Semantics: lastSeen is
 * written on sign-in/profile writes, NOT room activity — live presence
 * (the "Active" override) comes from the live participant list instead. */
function useMemberLastSeen(uid: string): number | null | undefined {
  const [v, setV] = useState<number | null | undefined>(() => lastSeenCache.get(uid));
  useEffect(() => {
    if (lastSeenCache.has(uid)) { setV(lastSeenCache.get(uid) ?? null); return; }
    let cancelled = false;
    (async () => {
      try {
        const { get, ref } = await import('firebase/database');
        const { database } = await import('@/src/config/firebase');
        const snap = await get(ref(database, `users/${uid}/lastSeen`));
        const val = snap.val();
        const num = typeof val === 'number' ? val : null;
        if (!cancelled) { lastSeenCache.set(uid, num); setV(num); }
      } catch { if (!cancelled) { lastSeenCache.set(uid, null); setV(null); } }
    })();
    return () => { cancelled = true; };
  }, [uid]);
  return v;
}

type MemberRowProps = {
  m: Participant;
  live: boolean;
  isMe: boolean;
  isOwner: boolean;
  isAdmin: boolean;
  /** True when THIS row is the room owner (uid === ownerId). */
  rowIsOwner: boolean;
  onVisitProfile?: (uid: string, name: string) => void;
  onSetAdmin: (uid: string) => void;
  onDismissAdmin: (uid: string) => void;
  onRemoveMember: (uid: string) => void;
};

// Memoized: with stable item identities (see displayMembers useMemo) a panel
// re-render (e.g. collapse flip) must NOT re-render row contents mid-scroll —
// that re-render churn was one cause of the visible text shaking.
const MemberRow = memo(function MemberRow({ m, live, isMe, isOwner, isAdmin, rowIsOwner,
  onVisitProfile, onSetAdmin, onDismissAdmin, onRemoveMember }: MemberRowProps) {
  const { t } = useTranslation();
  const lastSeen = useMemberLastSeen(m.id);
  // Role badge = status-icon COLOR (boss rule 2026-10-27, CORRECTED):
  // GOLD = room owner ONLY (uid === ownerId, or role 'host' from the
  // roleOf pipeline). Badges are NEVER consulted here — noble grants
  // landing in the badges node made every row gold, which read as
  // "everyone shown as owner". BLUE = admin, GREY = regular member.
  const roleColor = (rowIsOwner || m.role === 'host') ? GOLD
    : (m.role === 'admin' ? BLUE : GREY);
  // "..." menu matrix (boss spec 2026-10-27 — SUPERSEDES the grey-only rule):
  // viewer OWNER: "..." on every non-owner row — admin row: Dismiss Admin
  //   only; member row: Remove from room + Set as admin. Viewer ADMIN:
  //   "..." ONLY on member rows, Remove from room only. Viewer MEMBER: no
  //   "..." anywhere. Nobody gets "..." on their own row or the owner row.
  // Room Block/Unblock was REMOVED from this menu (replaced by Remove
  // from room); seat-sheet Block for seated users is untouched.
  const isTargetOwner = rowIsOwner || m.role === 'host';
  const isTargetAdmin = !isTargetOwner && m.role === 'admin';
  const isTargetMember = !isTargetOwner && !isTargetAdmin;
  const showDots = !isMe && !isTargetOwner
    && ((isOwner && (isTargetAdmin || isTargetMember)) || (isAdmin && isTargetMember));

  let status: string | null = null;
  if (live) {
    status = 'Active';
  } else if (typeof lastSeen === 'number') {
    const days = Math.floor((Date.now() - lastSeen) / 86400000);
    status = days >= 1 ? `Active ${days} day${days > 1 ? 's' : ''} ago` : 'Active';
  }

  return (
    <Pressable
      onPress={() => onVisitProfile?.(m.id, m.name)}
      style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 11, paddingHorizontal: 20,
        borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: DIVIDER }}
    >
      <View style={{ width: 44, height: 44, borderRadius: 22,
        backgroundColor: m.color + '33', alignItems: 'center', justifyContent: 'center',
        marginRight: 12, overflow: 'hidden' }}>
        {m.photoURL
          ? <Image source={{ uri: m.photoURL }} style={{ width: 44, height: 44, borderRadius: 22 }} />
          : <Text style={{ color: m.color, fontSize: 15, fontWeight: '800' }}>{m.initials}</Text>
        }
      </View>
      <View style={{ flex: 1 }}>
        {/* Real nickname ONLY — "Op Assistant" / star prefixes in imo are
            nickname text, never badges; nothing is added here. */}
        <Text numberOfLines={1} ellipsizeMode="tail"
          style={{ color: TEXT, fontSize: 16, fontWeight: '600' }}>{m.name}</Text>
        {status && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3, gap: 5 }}>
            <Feather name="user" size={12} color={roleColor} />
            <Text style={{ color: DIM, fontSize: 13 }}>{status}</Text>
          </View>
        )}
      </View>
      {showDots && (
        <Pressable
          hitSlop={10}
          onPress={() => {
            const buttons: { text: string; style?: 'destructive' | 'cancel'; onPress?: () => void }[] = [];
            const askRemove = () => {
              Alert.alert(
                t('voiceRoom.info.removeTitle', { defaultValue: 'Remove from room' }),
                t('voiceRoom.info.removeMsg', { defaultValue: 'Remove this member from the room? They can join again anytime.' }),
                [
                  { text: t('voiceRoom.info.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
                  { text: t('voiceRoom.info.removeFromRoom', { defaultValue: 'Remove from room' }),
                    style: 'destructive', onPress: () => onRemoveMember(m.id) },
                ],
              );
            };
            if (isOwner && isTargetAdmin) {
              buttons.push({ text: t('voiceRoom.info.dismissAdmin', { defaultValue: 'Dismiss Admin' }),
                onPress: () => onDismissAdmin(m.id) });
            }
            if (isTargetMember) {
              buttons.push({ text: t('voiceRoom.info.removeFromRoom', { defaultValue: 'Remove from room' }),
                style: 'destructive', onPress: askRemove });
              if (isOwner) {
                buttons.push({ text: t('voiceRoom.info.setAdmin', { defaultValue: 'Set as Admin' }),
                  onPress: () => onSetAdmin(m.id) });
              }
            }
            buttons.push({ text: t('voiceRoom.info.cancel', { defaultValue: 'Cancel' }), style: 'cancel' });
            Alert.alert(m.name, undefined, buttons);
          }}
        >
          <Feather name="more-horizontal" size={20} color={DIM} />
        </Pressable>
      )}
    </Pressable>
  );
});

/** Equality for joined-member snapshots: RTDB subscriptions emit a fresh
 * array on any room change, but unchanged content must keep its identity
 * or every row re-renders (jitter source). */
function sameJoined(a: JoinedMember[], b: JoinedMember[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].uid !== b[i].uid || a[i].role !== b[i].role ||
        a[i].joinedAt !== b[i].joinedAt || (a[i].name || '') !== (b[i].name || '')) return false;
  }
  return true;
}

// Module level (was defined inside the component, so every panel render
// remounted the tab buttons mid-scroll). Props only — no closure state.
function TabButton({ id, label, selected, onPress }: { id: 'member' | 'details'; label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ flex: 1, alignItems: 'center', paddingVertical: 12 }}>
      <Text style={{ color: selected ? TEXT : DIM, fontSize: 17, fontWeight: selected ? '700' : '400' }}>
        {label}
      </Text>
      <View style={{ height: 3, width: 28, borderRadius: 2, marginTop: 8,
        backgroundColor: selected ? TEXT : 'transparent' }} />
    </Pressable>
  );
}

/* ─────────────────────────── Room Info Modal ─────────────────────────── */
export function RoomInfoModal({ visible, onClose, allMembers, roomTopic,
  roomName, onChangeRoomName, roomImageUri, onChangeRoomImage, roomId, description,
  isOwner, isAdmin, ownerId, onDisband, onVisitProfile,
  myUid, myName,
  onOpenSettings, onOpenStore, onOpenInvite, onOpenRequests, onJoinRoom, onUnjoinRoom,
  onSetAdmin, onDismissAdmin, onRemoveMember }: {
  visible: boolean; onClose: () => void;
  allMembers: Participant[];
  /** Room description text (may be empty). */
  description?: string;
  roomTopic: string;
  roomName: string; onChangeRoomName: (name: string) => void;
  roomImageUri: string | null;
  /** Called with the Cloudinary URL after upload. */
  onChangeRoomImage: (cloudUrl: string) => void;
  roomId: string;
  /** Whether the current user is the room owner. */
  isOwner?: boolean;
  /** Whether the current user is a room admin. */
  isAdmin?: boolean;
  /** Room owner's user ID — shown even if not currently in the room. */
  ownerId?: string;
  /** Called when the owner confirms "Disband Room". */
  onDisband?: () => void;
  /** Called when a member row is tapped — navigates to their profile. */
  onVisitProfile?: (uid: string, name: string) => void;
  myUid: string; myName: string;
  /** Opens the existing Room Settings modal (gear / Management Center / Edit). */
  onOpenSettings: () => void;
  /** Opens the existing Store route. */
  onOpenStore: () => void;
  /** Opens the existing room Invite modal. */
  onOpenInvite: () => void;
  /** Opens the existing seat-request queue modal. */
  onOpenRequests: () => void;
  /** Existing join handler (writes the member record). */
  onJoinRoom: () => void;
  /** Existing full-leave handler (membership removal + session exit). */
  onUnjoinRoom: () => void;
  onSetAdmin: (uid: string) => void;
  onDismissAdmin: (uid: string) => void;
  onRemoveMember: (uid: string) => void;
}) {
  const { t } = useTranslation();
  const [ownerInfo, setOwnerInfo] = useState<{ name: string; photoURL?: string } | null>(null);

  // JOINED MEMBERS: same pipeline as before (roomMembers + live, owner →
  // admin → members by join time). The panel re-presents this data only.
  const [joinedMembers, setJoinedMembers] = useState<JoinedMember[]>([]);
  const [joinedProfiles, setJoinedProfiles] = useState<Record<string, { name: string; photoURL?: string }>>({});
  const joinedProfilesRef = useRef<Record<string, { name: string; photoURL?: string }>>({});
  useEffect(() => {
    if (!visible || !roomId) return;
    return subscribeRoomMembers(roomId, (next) => {
      setJoinedMembers((prev) => (sameJoined(prev, next) ? prev : next));
    });
  }, [visible, roomId]);
  useEffect(() => {
    const uids = new Set(joinedMembers.map((m) => m.uid));
    if (ownerId) uids.add(ownerId);
    if (uids.size === 0) return;
    let cancelled = false;
    (async () => {
      const results = await Promise.all(
        [...uids].map(async (uid) => {
          try {
            const p = await getUser(uid);
            if (!p) return null;
            const fallbackName = p.name || (p.email ? p.email.split('@')[0] : null) || 'User';
            return [uid, { name: fallbackName, photoURL: p.photoURL || undefined }] as const;
          } catch { return null; }
        }),
      );
      if (cancelled) return;
      const map: Record<string, { name: string; photoURL?: string }> = {};
      for (const r of results) { if (r) map[r[0]] = r[1]; }
      // Skip the setState when profiles are unchanged: a fresh map object
      // would otherwise rebuild displayMembers and re-render every row.
      const prevMap = joinedProfilesRef.current;
      const prevKeys = Object.keys(prevMap);
      const nextKeys = Object.keys(map);
      const sameProfiles = prevKeys.length === nextKeys.length && nextKeys.every((k) =>
        prevMap[k] && prevMap[k].name === map[k].name &&
        (prevMap[k].photoURL || undefined) === (map[k].photoURL || undefined));
      if (!sameProfiles) { joinedProfilesRef.current = map; setJoinedProfiles(map); }
    })();
    return () => { cancelled = true; };
  }, [joinedMembers, ownerId]);

  // IDENTITY-PRESERVING members (2026-10-27 shake fix): the pipeline
  // below rebuilds Participant objects, but a row's object is REUSED
  // whenever its rendered fields (name, initials, color, photoURL, role)
  // are unchanged — so a live-room voice tick (speaking/muted churn in
  // allMembers) no longer re-renders every row mid-scroll. speaking/muted
  // are deliberately ignored: this panel never renders them. (The old
  // useMemo alone did NOT fix this: it still recomputed on every
  // allMembers identity change and handed memo() fresh objects, so every
  // row re-rendered constantly — the previous fix's diagnosis stopped
  // one step short.)
  const prevDisplayRef = useRef<Participant[]>([]);
  const displayMembers: Participant[] = useMemo(() => {
    const prevById = new Map(prevDisplayRef.current.map((p) => [p.id, p]));
    const reuse = (items: Participant[]) => items.map((item) => {
      const prev = prevById.get(item.id);
      if (prev && prev.name === item.name && prev.initials === item.initials &&
          prev.color === item.color && (prev.photoURL || undefined) === (item.photoURL || undefined) &&
          prev.role === item.role) return prev;
      return item;
    });
    if (joinedMembers.length === 0) {
      const next = reuse(allMembers);
      prevDisplayRef.current = next;
      return next;
    }
    const effective: JoinedMember[] = [...joinedMembers];
    if (ownerId && !effective.some((m) => m.uid === ownerId)) {
      effective.push({ uid: ownerId, role: 'owner', joinedAt: 0 });
    }
    const roleOf = (m: JoinedMember) => (ownerId && m.uid === ownerId ? 'owner' : m.role);
    const roleRank = (r: string) => r === 'owner' ? 0 : r === 'admin' ? 1 : 2;
    const mapped = effective
      .sort((a, b) => {
        const rd = roleRank(roleOf(a)) - roleRank(roleOf(b));
        if (rd !== 0) return rd;
        return a.joinedAt - b.joinedAt;
      })
      .map((m) => {
        const prof = joinedProfiles[m.uid];
        const live = allMembers.find((p) => p.id === m.uid);
        const profName = prof?.name && prof.name !== 'User' ? prof.name : null;
        const name = profName || m.name || live?.name || prof?.name || 'User';
        return {
          id: m.uid,
          name,
          initials: (name || 'U').charAt(0).toUpperCase(),
          color: live?.color ?? '#7C3AED',
          photoURL: prof?.photoURL || live?.photoURL,
          speaking: live?.speaking ?? false,
          muted: live?.muted ?? true,
          role: (roleOf(m) === 'owner' ? 'host' : roleOf(m)) as Participant['role'] } as Participant;
      });
    const next = reuse(mapped);
    prevDisplayRef.current = next;
    return next;
  }, [joinedMembers, joinedProfiles, allMembers, ownerId]);


  useEffect(() => {
    const ownerInList = allMembers.find((m: Participant) => m.role === 'host');
    if (ownerInList || !ownerId) return;
    let cancelled = false;
    (async () => {
      try {
        const { get, ref } = await import('firebase/database');
        const { database } = await import('@/src/config/firebase');
        const snap = await get(ref(database, `users/${ownerId}`));
        if (!cancelled && snap.exists()) {
          const data = snap.val() as { name?: string; photoURL?: string };
          setOwnerInfo({
            name: data.name || 'Room Owner',
            photoURL: data.photoURL });
        }
      } catch { /* non-critical */ }
    })();
    return () => { cancelled = true; };
  }, [allMembers, ownerId]);

  // Live-id set + row callbacks live in REFS: parent re-renders (voice
  // ticks) hand new array/function identities every time, and any of
  // those reaching memoized rows defeats memo() mid-scroll. Rows read
  // the ref at render time, so their props stay referentially stable
  // unless a row's own data actually changed.
  const liveIdsRef = useRef<Set<string>>(new Set());
  liveIdsRef.current = new Set(allMembers.map((p) => p.id));
  const handlersRef = useRef({ onVisitProfile, onSetAdmin, onDismissAdmin, onRemoveMember });
  handlersRef.current = { onVisitProfile, onSetAdmin, onDismissAdmin, onRemoveMember };
  const stableVisit = useCallback((uid: string, name: string) => handlersRef.current.onVisitProfile?.(uid, name), []);
  const stableSetAdmin = useCallback((uid: string) => handlersRef.current.onSetAdmin(uid), []);
  const stableDismissAdmin = useCallback((uid: string) => handlersRef.current.onDismissAdmin(uid), []);
  const stableRemoveMember = useCallback((uid: string) => handlersRef.current.onRemoveMember(uid), []);
  const isMember = isOwner === true || isAdmin === true ||
    displayMembers.some((m) => m.id === myUid);
  const viewerIsOwnerOrAdmin = isOwner === true || isAdmin === true;

  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(roomName);
  const [uploadingImage, setUploadingImage] = useState(false);
  // Name/image editing stays OWNER-only (rules deny admin writes to info).
  const canEdit = isOwner === true;
  useEffect(() => { if (!editingName) setNameInput(roomName); }, [roomName, editingName]);

  async function pickRoomImage() {
    if (!canEdit) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      const title = t('voiceRoom.info.permissionRequired');
      const msg = t('voiceRoom.info.permissionMsg');
      if (perm.canAskAgain === false) alertPermissionPermanentlyDenied(title, msg);
      else Alert.alert(title, msg);
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true, aspect: [1, 1], quality: 0.85 });
    if (result.canceled || !result.assets[0]) return;
    const localUri = result.assets[0].uri;
    setUploadingImage(true);
    try {
      const uploaded = await uploadRoomCover(localUri);
      onChangeRoomImage(uploaded.url);
    } catch {
      Alert.alert(
        t('voiceRoom.info.uploadError', 'Upload failed'),
        t('voiceRoom.info.uploadErrorMsg', 'Could not upload the image. Please try again.'),
      );
    } finally {
      setUploadingImage(false);
    }
  }

  function commitName() {
    if (!canEdit) { setEditingName(false); return; }
    const trimmed = nameInput.trim();
    if (trimmed.length >= 2) onChangeRoomName(trimmed);
    else setNameInput(roomName);
    setEditingName(false);
  }

  // ── Panel state: tab, collapse, "..." menu, incremental list ──
  // COLLAPSE MODEL (2026-10-27, shake fix): the room card lives INSIDE
  // the active tab's scroll content and scrolls away with the finger on
  // the native thread — NO height/opacity animation is driven from
  // scroll events, so scrolling can never re-lay-out the list, resize
  // its viewport, or re-render rows. The ONLY scroll-linked state is the
  // collapsed flip below (guarded: at most one setState per threshold
  // crossing), which toggles opacity/pointerEvents only — opacity never
  // affects layout. The fixed tabs overlay + compact header appear
  // exactly when the card has scrolled fully out (scrollY >= cardH).
  const [tab, setTab] = useState<'member' | 'details'>('member');
  const [collapsed, setCollapsed] = useState(false);
  // Collapse threshold = measured card height (default 108 = 72 cover +
  // 28 vertical padding + 8 top margin). Lives in a REF, not state: the
  // measurement must never trigger a re-render (that feedback loop was
  // part of the old shake).
  const cardHRef = useRef(108);
  const [menuOpen, setMenuOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(30);
  const flatRef = useRef<FlatList<Participant>>(null);
  const scrollRef = useRef<ScrollView>(null);
  const collapsedRef = useRef(false);

  useEffect(() => {
    if (visible) { setVisibleCount(30); collapsedRef.current = false; setCollapsed(false); setMenuOpen(false); }
  }, [visible, roomId]);

  function onScroll(e: { nativeEvent: { contentOffset: { y: number } } }) {
    const next = e.nativeEvent.contentOffset.y >= cardHRef.current;
    if (next !== collapsedRef.current) {
      collapsedRef.current = next;
      setCollapsed(next);
    }
  }
  function switchTab(next: 'member' | 'details') {
    setTab(next);
    collapsedRef.current = false;
    setCollapsed(false);
    setMenuOpen(false);
    flatRef.current?.scrollToOffset({ offset: 0, animated: false });
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }

  const visibleMembers = useMemo(
    () => displayMembers.slice(0, visibleCount),
    [displayMembers, visibleCount]);

  const renderMember = useCallback(({ item }: { item: Participant }) => (
    <MemberRow
      m={item}
      live={liveIdsRef.current.has(item.id)}
      isMe={item.id === myUid}
      isOwner={isOwner === true}
      isAdmin={isAdmin === true}
      rowIsOwner={ownerId !== undefined && item.id === ownerId}
      onVisitProfile={stableVisit}
      onSetAdmin={stableSetAdmin}
      onDismissAdmin={stableDismissAdmin}
      onRemoveMember={stableRemoveMember}
    />
  ), [myUid, isOwner, isAdmin, ownerId,
    stableVisit, stableSetAdmin, stableDismissAdmin, stableRemoveMember]);


  async function copyRoomId() {
    try {
      await Clipboard.setStringAsync(roomId);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Alert.alert(t('voiceRoom.info.copyIdTitle', { defaultValue: 'Room ID copied' }), roomId);
    } catch { /* clipboard unavailable — nothing to show */ }
  }

  function askUnjoin() {
    setMenuOpen(false);
    Alert.alert(
      t('voiceRoom.info.unjoinTitle', { defaultValue: 'Unjoin room' }),
      t('voiceRoom.info.unjoinMsg', { defaultValue: 'Leave this room and remove your membership? You can join again anytime.' }),
      [
        { text: t('voiceRoom.info.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
        { text: t('voiceRoom.info.unjoin', { defaultValue: 'Unjoin' }), style: 'destructive',
          onPress: () => onUnjoinRoom() },
      ],
    );
  }

  function askDisband() {
    Alert.alert(
      t('voiceRoom.info.disbandTitle', { defaultValue: 'Disband Room' }),
      t('voiceRoom.info.disbandMsg', { defaultValue: 'This will permanently delete the room for everyone. Are you sure?' }),
      [
        { text: t('voiceRoom.info.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
        { text: t('voiceRoom.info.disbandConfirm', { defaultValue: 'Disband' }),
          style: 'destructive', onPress: () => { onClose(); onDisband?.(); } },
      ],
    );
  }

  function askReport() {
    setMenuOpen(false);
    Alert.alert(
      t('voiceRoom.info.reportTitle', { defaultValue: 'Report this room' }),
      t('voiceRoom.info.reportMsg', { defaultValue: 'Report this room to moderators for review?' }),
      [
        { text: t('voiceRoom.info.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
        { text: t('voiceRoom.info.report', { defaultValue: 'Report' }),
          onPress: async () => {
            try {
              await submitRoomReport({ reporterUid: myUid, reporterName: myName, roomId, roomName });
              Alert.alert(t('voiceRoom.info.reportSuccess', { defaultValue: 'Report submitted. Thank you.' }));
            } catch {
              Alert.alert(t('voiceRoom.screen.error'),
                t('voiceRoom.info.reportError', { defaultValue: 'Could not submit the report. Please try again.' }));
            }
          } },
      ],
    );
  }


  // Tabs row (shared): rendered BOTH as the fixed overlay (below) and
  // inside the active tab's scroll content. Same component, same styles,
  // so the collapsed handoff is pixel-identical.
  const tabsRow = (
    <View style={{ flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: DIVIDER }}>
      <TabButton id="details" label={t('voiceRoom.info.roomDetails', { defaultValue: 'Room Details' })} selected={tab === 'details'} onPress={() => switchTab('details')} />
      <TabButton id="member" label={t('voiceRoom.info.memberTab', { defaultValue: 'Member' })} selected={tab === 'member'} onPress={() => switchTab('member')} />
    </View>
  );

  // Room card (rendered INSIDE the active tab's scroll content, never
  // above it): this is what makes the collapse native — the card scrolls
  // away with the finger instead of being shrunk by a JS-driven height
  // animation that re-laid-out the whole panel on every scroll frame.
  const roomCard = (
          <View
            onLayout={(e) => {
              // Measured ONLY as the collapse threshold (compact-header
              // + tabs-overlay flip point). It lives in a ref and never
              // feeds layout, so measurement can never loop into a
              // re-render: the old setCardH state was part of the shake.
              const h = e.nativeEvent.layout.height;
              if (h > 0) cardHRef.current = h + 8;
            }}
            style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: CARD_BG,
              borderRadius: 16, marginHorizontal: 16, marginTop: 8, padding: 14, gap: 12 }}
          >
            <Pressable onPress={pickRoomImage} disabled={uploadingImage || !canEdit}>
              <View style={{ width: 72, height: 72, borderRadius: 12, overflow: 'hidden',
                backgroundColor: '#2C2C2E', alignItems: 'center', justifyContent: 'center' }}>
                {uploadingImage
                  ? <PremiumLoader size="medium" />
                  : roomImageUri
                    ? <Image source={{ uri: roomImageUri }} style={{ width: 72, height: 72 }} />
                    : <Text style={{ color: TEXT, fontSize: 28, fontWeight: '800' }}>
                        {(roomName || '?').charAt(0).toUpperCase()}
                      </Text>
                }
              </View>
              {/* Owner-only camera badge (retained: this is the ONLY
                  name/cover edit path; imo's card has none — deviation
                  reported, not hidden). */}
              {canEdit && !uploadingImage && (
                <View style={{ position: 'absolute', bottom: 2, right: 2,
                  width: 22, height: 22, borderRadius: 11, backgroundColor: '#FFFFFF',
                  alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="camera" size={12} color="#000000" />
                </View>
              )}
            </Pressable>
            <View style={{ flex: 1 }}>
              {editingName ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <TextInput
                    value={nameInput}
                    onChangeText={setNameInput}
                    autoFocus
                    style={{ color: TEXT, fontSize: 18, fontWeight: '800',
                      borderBottomWidth: 1.5, borderBottomColor: '#555555',
                      minWidth: 100, paddingBottom: 2 }}
                    onSubmitEditing={commitName}
                    maxLength={30}
                  />
                  <Pressable onPress={commitName} hitSlop={8}>
                    <Feather name="check" size={20} color={TEXT} />
                  </Pressable>
                  <Pressable onPress={() => { setNameInput(roomName); setEditingName(false); }} hitSlop={8}>
                    <Feather name="x" size={18} color={DIM} />
                  </Pressable>
                </View>
              ) : canEdit ? (
                <Pressable
                  onPress={() => { setNameInput(roomName); setEditingName(true); }}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                >
                  <Text numberOfLines={1} style={{ color: TEXT, fontSize: 18, fontWeight: '800', flexShrink: 1 }}>
                    {roomName}
                  </Text>
                  <Feather name="chevron-right" size={18} color={DIM} />
                </Pressable>
              ) : (
                <Text numberOfLines={1} style={{ color: TEXT, fontSize: 18, fontWeight: '800', flexShrink: 1 }}>
                  {roomName}
                </Text>
              )}
              {/* ID NEVER truncates (boss 2026-10-27): flexShrink 0, so
                  the full numeric ID + copy icon always show (imo shows
                  its full VoiceClub ID); the room NAME truncates instead
                  (flexShrink 1 above). Copy icon sits right after the ID. */}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 6,
                alignSelf: 'flex-start' }}>
                <Text numberOfLines={1} style={{ color: SUB, fontSize: 13, flexShrink: 0 }}>
                  {t('voiceRoom.info.roomId')} : {roomId}
                </Text>
                <Pressable onPress={copyRoomId} hitSlop={8}>
                  <Feather name="copy" size={14} color={SUB} />
                </Pressable>
              </View>
            </View>
          </View>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={onClose} />
      {/* Definite height (NOT maxHeight): the flex:1 tab content and its
          lists need a bounded parent, otherwise the list grows to full
          content height, gets clipped at the panel edge, and cannot scroll. */}
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0,
        backgroundColor: PANEL_BG, borderTopLeftRadius: 20, borderTopRightRadius: 20,
        height: '88%' }}>
        {/* ── Panel header: chevron | (collapsed: DP + name) | gear + ... ── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16,
          paddingTop: 14, paddingBottom: 6, gap: 10, height: 48 }}>
          <Pressable onPress={onClose} hitSlop={8}>
            <Feather name="chevron-down" size={24} color={TEXT} />
          </Pressable>
          {/* Always mounted: the compact header appears/disappears by
              opacity ONLY, so the collapsed flip can never shift layout
              (no mount/unmount, no height change) mid-scroll. The block
              holds flex:1 in both states, so Store/gear/... never move. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1,
            opacity: collapsed ? 1 : 0 }}>
            <View style={{ width: 28, height: 28, borderRadius: 6, overflow: 'hidden',
              backgroundColor: CARD_BG, alignItems: 'center', justifyContent: 'center' }}>
              {roomImageUri
                ? <Image source={{ uri: roomImageUri }} style={{ width: 28, height: 28 }} />
                : <Text style={{ color: TEXT, fontSize: 12, fontWeight: '800' }}>
                    {(roomName || '?').charAt(0).toUpperCase()}
                  </Text>
              }
            </View>
            <Text numberOfLines={1} style={{ flex: 1, color: TEXT, fontSize: 16, fontWeight: '700' }}>
              {roomName}
            </Text>
          </View>
          {/* Store moved here from the room card (boss 2026-10-27): the
              card pill squeezed the room name; the header pill frees the
              full card width for the name. Same route, same label. */}
          <Pressable
            onPress={onOpenStore}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 5,
              backgroundColor: '#2C2C2E', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 }}
          >
            <Feather name="shopping-bag" size={12} color={TEXT} />
            <Text style={{ color: TEXT, fontSize: 13, fontWeight: '700' }}>
              {t('voiceRoom.info.store', { defaultValue: 'Store' })}
            </Text>
          </Pressable>
          {viewerIsOwnerOrAdmin && (
            <Pressable onPress={onOpenSettings} hitSlop={8}>
              <Feather name="settings" size={24} color={TEXT} />
            </Pressable>
          )}
          <Pressable onPress={() => setMenuOpen((v) => !v)} hitSlop={8}>
            <Feather name="more-horizontal" size={24} color={TEXT} />
          </Pressable>
        </View>

        {/* ── Fixed tabs overlay: appears (opacity ONLY, never layout)
            exactly when the card has scrolled fully out of the list, so
            tab switching stays available while scrolled. The in-content
            tabs row below is identical and sits at exactly this spot
            when scrollY == cardH, so the handoff is seamless — no double
            tabs, no jump. Absolute: takes no flow space, so the list
            frame never moves or resizes. ── */}
        <View pointerEvents={collapsed ? 'auto' : 'none'}
          style={{ position: 'absolute', top: 48, left: 0, right: 0, zIndex: 5,
            backgroundColor: PANEL_BG, opacity: collapsed ? 1 : 0 }}>
          {tabsRow}
        </View>

        {/* ── Tab content ── */}
        <View style={{ flex: 1 }}>
          {tab === 'details' ? (
            <ScrollView
              ref={scrollRef}
              style={{ flex: 1 }}
              onScroll={onScroll}
              scrollEventThrottle={16}
              contentContainerStyle={{ paddingBottom: 20 }}
            >
              {roomCard}
              {tabsRow}
              <View style={{ paddingHorizontal: 20, paddingTop: 20 }}>
              {viewerIsOwnerOrAdmin && (
                <Pressable
                  onPress={onOpenSettings}
                  style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14,
                    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: DIVIDER }}
                >
                  <Text style={{ flex: 1, color: TEXT, fontSize: 17 }}>
                    {t('voiceRoom.info.managementCenter', { defaultValue: 'Room Management Center' })}
                  </Text>
                  <Feather name="chevron-right" size={20} color={DIM} />
                </Pressable>
              )}
              <View style={{ marginBottom: 28 }}>
                <Text style={{ color: TEXT, fontSize: 15, marginBottom: 8 }}>
                  {t('voiceRoom.info.roomLevel', { defaultValue: 'Room Level' })}
                </Text>
                {/* No room-level system exists in Vee yet: Lv.1 is the
                    documented starting default for every room (never
                    imo's Lv.7, never a per-room invented value). */}
                <Text style={{ color: TEXT, fontSize: 34, fontWeight: '700' }}>Lv.1</Text>
              </View>
              <View style={{ marginBottom: 28 }}>
                <Text style={{ color: TEXT, fontSize: 15, marginBottom: 8 }}>
                  {t('voiceRoom.info.members')}
                </Text>
                <Text style={{ color: TEXT, fontSize: 34, fontWeight: '700' }}>
                  {formatMembersCount(displayMembers.length)}
                </Text>
              </View>
              {(!!roomTopic || isOwner === true) && (
                <View style={{ marginBottom: 28 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                    <Text style={{ flex: 1, color: TEXT, fontSize: 15 }}>
                      {t('voiceRoom.info.topic', { defaultValue: 'Topic' })}
                    </Text>
                    {isOwner === true && (
                      <Pressable onPress={onOpenSettings} hitSlop={8}
                        style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={{ color: DIM, fontSize: 14 }}>
                          {t('voiceRoom.info.edit', { defaultValue: 'Edit' })}
                        </Text>
                        <Feather name="chevron-right" size={16} color={DIM} />
                      </Pressable>
                    )}
                  </View>
                  {!!roomTopic && (
                    <Text style={{ color: TEXT, fontSize: 15, lineHeight: 21 }}>{roomTopic}</Text>
                  )}
                </View>
              )}
              {(!!description || isOwner === true) && (
                <View style={{ marginBottom: 28 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                    <Text style={{ flex: 1, color: TEXT, fontSize: 15 }}>
                      {t('voiceRoom.info.description', { defaultValue: 'Description' })}
                    </Text>
                    {isOwner === true && (
                      <Pressable onPress={onOpenSettings} hitSlop={8}
                        style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={{ color: DIM, fontSize: 14 }}>
                          {t('voiceRoom.info.edit', { defaultValue: 'Edit' })}
                        </Text>
                        <Feather name="chevron-right" size={16} color={DIM} />
                      </Pressable>
                    )}
                  </View>
                  {!!description && (
                    <Text style={{ color: TEXT, fontSize: 15, lineHeight: 21 }}>{description}</Text>
                  )}
                </View>
              )}
              </View>
            </ScrollView>
          ) : (
            <FlatList
              ref={flatRef}
              style={{ flex: 1 }}
              data={visibleMembers}
              keyExtractor={(m) => m.id}
              // Fixed row height: VirtualizedList never re-measures rows
              // mid-scroll (re-measuring was a jitter source). Rows are
              // guaranteed MEMBER_ROW_HEIGHT by the single-line name +
              // fixed avatar + fixed padding (see MemberRow).
              getItemLayout={(_data, index) => ({
                length: MEMBER_ROW_HEIGHT,
                offset: MEMBER_ROW_HEIGHT * index,
                index,
              })}
              // No extraData: live presence flows through the data prop
              // itself (liveIds derive from allMembers, a displayMembers
              // dep), and memoized rows re-render only when their own
              // props change — an extraData churn would defeat that.
              showsVerticalScrollIndicator={false}
              onScroll={onScroll}
              scrollEventThrottle={16}
              initialNumToRender={30}
              maxToRenderPerBatch={20}
              windowSize={10}
              onEndReached={() => {
                if (visibleCount < displayMembers.length) {
                  setVisibleCount((c) => Math.min(c + 30, displayMembers.length));
                }
              }}
              onEndReachedThreshold={0.5}
              contentContainerStyle={{ paddingBottom: 12 }}
              ListHeaderComponent={
                <View>
                  {roomCard}
                  {tabsRow}
                  <View style={{ paddingHorizontal: 20 }}>
                  {viewerIsOwnerOrAdmin && (
                    <Pressable
                      onPress={onOpenRequests}
                      style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14,
                        borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: DIVIDER }}
                    >
                      <View style={{ width: 28, marginRight: 14, alignItems: 'center', justifyContent: 'center' }}>
                        <Feather name="users" size={20} color={TEXT} />
                        <View style={{ position: 'absolute', right: 0, bottom: 0, width: 14, height: 14,
                          borderRadius: 7, backgroundColor: PANEL_BG, alignItems: 'center', justifyContent: 'center' }}>
                          <Feather name="plus" size={10} color={TEXT} />
                        </View>
                      </View>
                      <Text style={{ flex: 1, color: TEXT, fontSize: 16 }}>
                        {t('voiceRoom.info.memberRequest', { defaultValue: 'Member request' })}
                      </Text>
                      <Feather name="chevron-right" size={20} color={DIM} />
                    </Pressable>
                  )}
                  <Pressable
                    onPress={onOpenInvite}
                    style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14,
                      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: DIVIDER }}
                  >
                    <View style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 1.5,
                      borderColor: TEXT, alignItems: 'center', justifyContent: 'center', marginRight: 14 }}>
                      <Feather name="plus" size={16} color={TEXT} />
                    </View>
                    <Text style={{ color: TEXT, fontSize: 16 }}>
                      {t('voiceRoom.info.addMembers', { defaultValue: 'Add Members' })}
                    </Text>
                  </Pressable>
                  </View>
                </View>
              }
              renderItem={renderMember}
            />
          )}
        </View>

        {/* ── Persistent bottom Joined toggle ── */}
        <View style={{ paddingHorizontal: 16, paddingVertical: 14 }}>
          {!isMember ? (
            <Pressable
              onPress={onJoinRoom}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                gap: 8, backgroundColor: GREEN, borderRadius: 14, paddingVertical: 14 }}
            >
              <Feather name="user-plus" size={18} color="#FFFFFF" />
              <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '800' }}>
                {t('voiceRoom.info.join', { defaultValue: 'Join' })}
              </Text>
            </Pressable>
          ) : isOwner === true ? (
            <Pressable
              onPress={askDisband}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                gap: 8, borderWidth: 1, borderColor: RED, borderRadius: 14, paddingVertical: 14 }}
            >
              <Feather name="trash-2" size={18} color={RED} />
              <Text style={{ color: RED, fontSize: 16, fontWeight: '700' }}>
                {t('voiceRoom.info.disband', { defaultValue: 'Disband' })}
              </Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={askUnjoin}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                gap: 8, borderWidth: 1, borderColor: '#444444', borderRadius: 14, paddingVertical: 14 }}
            >
              <Feather name="user" size={18} color={TEXT} />
              <Text style={{ color: TEXT, fontSize: 16, fontWeight: '700' }}>
                {t('voiceRoom.info.joined', { defaultValue: 'Joined' })}
              </Text>
            </Pressable>
          )}
        </View>

        {/* ── Panel-header "..." dropdown (dark, anchored top-right) ── */}
        {menuOpen && (
          <>
            <Pressable
              onPress={() => setMenuOpen(false)}
              style={{ position: 'absolute', top: 56, left: 0, right: 0, bottom: 0, zIndex: 20 }}
            />
            <View style={{ position: 'absolute', top: 52, right: 12, width: 200,
              backgroundColor: CARD_BG, borderRadius: 14, paddingVertical: 6, zIndex: 21,
              borderWidth: StyleSheet.hairlineWidth, borderColor: DIVIDER }}>
              <Pressable onPress={askReport}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 16 }}>
                <Feather name="alert-triangle" size={20} color={TEXT} />
                <Text style={{ color: TEXT, fontSize: 16 }}>
                  {t('voiceRoom.info.report', { defaultValue: 'Report' })}
                </Text>
              </Pressable>
              {isMember && isOwner !== true && (
                <Pressable onPress={askUnjoin}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13,
                    paddingHorizontal: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: DIVIDER }}>
                  <Feather name="log-out" size={20} color={TEXT} />
                  <Text style={{ color: TEXT, fontSize: 16 }}>
                    {t('voiceRoom.info.unjoin', { defaultValue: 'Unjoin' })}
                  </Text>
                </Pressable>
              )}
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}
