import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import { View, Text, ScrollView, FlatList, Alert, Pressable, Modal, TextInput, Image, Animated, StyleSheet } from 'react-native';
import PremiumLoader from '@/src/components/PremiumLoader';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Participant, BlockRecord } from '../types/room';
import { uploadRoomCover } from '@/src/services/cloudinaryService';
import { alertPermissionPermanentlyDenied } from '@/src/utils/permissionAlert';
import { subscribeRoomMembers, type JoinedMember } from '../services/firebaseRoomService';
import { submitRoomReport } from '@/src/services/reportService';
import { getUser } from '@/src/services/userService';

/* ─────────────────────────── Room Info Panel (imo-style, 2026-10-27) ──
 * Dark panel, exactly like the boss's imo screenshots: collapsing room
 * card, Room Details | Member tabs, member list with color role badges.
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
  /** Precomputed for this row so memo props stay primitive. */
  isBlocked: boolean;
  onVisitProfile?: (uid: string, name: string) => void;
  onSetAdmin: (uid: string) => void;
  onBlock: (uid: string) => void;
  onUnblock: (uid: string) => void;
};

// Memoized: with stable item identities (see displayMembers useMemo) a panel
// re-render (e.g. collapse flip) must NOT re-render row contents mid-scroll —
// that re-render churn was one cause of the visible text shaking.
const MemberRow = memo(function MemberRow({ m, live, isMe, isOwner, isAdmin, rowIsOwner,
  isBlocked, onVisitProfile, onSetAdmin, onBlock, onUnblock }: MemberRowProps) {
  const { t } = useTranslation();
  const lastSeen = useMemberLastSeen(m.id);
  // Role badge = status-icon COLOR (boss rule 2026-10-27, CORRECTED):
  // GOLD = room owner ONLY (uid === ownerId, or role 'host' from the
  // roleOf pipeline). Badges are NEVER consulted here — noble grants
  // landing in the badges node made every row gold, which read as
  // "everyone shown as owner". BLUE = admin, GREY = regular member.
  const roleColor = (rowIsOwner || m.role === 'host') ? GOLD
    : (m.role === 'admin' ? BLUE : GREY);
  // "..." ONLY on grey member rows, and ONLY where a real action exists:
  // owner can Set as Admin; owner/admin can Block/Unblock. The owner row
  // never gets "..." (as in imo); a plain member viewing another member
  // gets no "..." at all (never a dead menu).
  const canSetAdmin = isOwner && !isMe;
  const canBlock = !isMe && (isOwner || isAdmin);
  const showDots = !rowIsOwner && m.role === 'member' && (canSetAdmin || canBlock);

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
      style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 11,
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
            if (canSetAdmin) {
              buttons.push({ text: t('voiceRoom.info.setAdmin', { defaultValue: 'Set as Admin' }),
                onPress: () => onSetAdmin(m.id) });
            }
            buttons.push(isBlocked
              ? { text: t('voiceRoom.info.unblock', { defaultValue: 'Unblock' }),
                  onPress: () => onUnblock(m.id) }
              : { text: t('voiceRoom.info.roomBlock', { defaultValue: 'Room Block' }),
                  style: 'destructive', onPress: () => onBlock(m.id) });
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

/* ─────────────────────────── Room Info Modal ─────────────────────────── */
export function RoomInfoModal({ visible, onClose, allMembers, roomTopic,
  roomName, onChangeRoomName, roomImageUri, onChangeRoomImage, roomId, description,
  isOwner, isAdmin, ownerId, onDisband, onVisitProfile,
  myUid, myName, blockedRecs,
  onOpenSettings, onOpenStore, onOpenInvite, onOpenRequests, onJoinRoom, onUnjoinRoom,
  onSetAdmin, onBlock, onUnblock }: {
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
  blockedRecs: BlockRecord[];
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
  onBlock: (uid: string) => void;
  onUnblock: (uid: string) => void;
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

  // Memoized: previously this IIFE rebuilt NEW Participant objects on
  // EVERY panel render, so every row re-rendered on every state change
  // (collapse flip, profile load, subscription emission) — mid-scroll
  // re-renders of all rows were a prime jitter source.
  const displayMembers: Participant[] = useMemo(() => {
    if (joinedMembers.length === 0) return allMembers;
    const effective: JoinedMember[] = [...joinedMembers];
    if (ownerId && !effective.some((m) => m.uid === ownerId)) {
      effective.push({ uid: ownerId, role: 'owner', joinedAt: 0 });
    }
    const roleOf = (m: JoinedMember) => (ownerId && m.uid === ownerId ? 'owner' : m.role);
    const roleRank = (r: string) => r === 'owner' ? 0 : r === 'admin' ? 1 : 2;
    return effective
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

  const liveIds = useMemo(() => new Set(allMembers.map((p) => p.id)), [allMembers]);
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

  // ── Panel state: tab, collapse-on-scroll, "..." menu, incremental list ──
  const [tab, setTab] = useState<'member' | 'details'>('member');
  const [collapsed, setCollapsed] = useState(false);
  const [cardH, setCardH] = useState(120);
  const [menuOpen, setMenuOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(30);
  const scrollY = useRef(new Animated.Value(0)).current;
  const flatRef = useRef<FlatList<Participant>>(null);
  const scrollRef = useRef<ScrollView>(null);
  // Collapse flip guard: the old listener called setCollapsed on EVERY
  // scroll frame, re-rendering the whole panel (and every row) per frame
  // while scrolling — the main cause of the shaking text. Now the state
  // flips at most twice per scroll pass (collapsed <-> expanded).
  const collapsedRef = useRef(false);

  useEffect(() => {
    const id = scrollY.addListener(({ value }: { value: number }) => {
      const next = value > 80;
      if (next !== collapsedRef.current) {
        collapsedRef.current = next;
        setCollapsed(next);
      }
    });
    return () => { scrollY.removeListener(id); };
  }, [scrollY]);
  useEffect(() => {
    if (visible) { setVisibleCount(30); scrollY.setValue(0); collapsedRef.current = false; setCollapsed(false); setMenuOpen(false); }
  }, [visible, roomId, scrollY]);

  const cardHeight = scrollY.interpolate({
    inputRange: [0, cardH], outputRange: [cardH, 0], extrapolate: 'clamp' });
  const cardOpacity = scrollY.interpolate({
    inputRange: [0, cardH * 0.7], outputRange: [1, 0], extrapolate: 'clamp' });

  function onScroll(e: { nativeEvent: { contentOffset: { y: number } } }) {
    scrollY.setValue(e.nativeEvent.contentOffset.y);
  }
  function switchTab(next: 'member' | 'details') {
    setTab(next);
    scrollY.setValue(0);
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
      live={liveIds.has(item.id)}
      isMe={item.id === myUid}
      isOwner={isOwner === true}
      isAdmin={isAdmin === true}
      rowIsOwner={ownerId !== undefined && item.id === ownerId}
      isBlocked={blockedRecs.some((r) => r.id === item.id && r.isActive && r.action === 'room-block')}
      onVisitProfile={onVisitProfile}
      onSetAdmin={onSetAdmin}
      onBlock={onBlock}
      onUnblock={onUnblock}
    />
  ), [liveIds, myUid, isOwner, isAdmin, ownerId, blockedRecs,
    onVisitProfile, onSetAdmin, onBlock, onUnblock]);

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

  function TabButton({ id, label }: { id: 'member' | 'details'; label: string }) {
    const selected = tab === id;
    return (
      <Pressable onPress={() => switchTab(id)} style={{ flex: 1, alignItems: 'center', paddingVertical: 12 }}>
        <Text style={{ color: selected ? TEXT : DIM, fontSize: 17, fontWeight: selected ? '700' : '400' }}>
          {label}
        </Text>
        <View style={{ height: 3, width: 28, borderRadius: 2, marginTop: 8,
          backgroundColor: selected ? TEXT : 'transparent' }} />
      </Pressable>
    );
  }

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
          paddingTop: 14, paddingBottom: 6, gap: 10 }}>
          <Pressable onPress={onClose} hitSlop={8}>
            <Feather name="chevron-down" size={24} color={TEXT} />
          </Pressable>
          {collapsed && (
            <>
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
            </>
          )}
          {!collapsed && <View style={{ flex: 1 }} />}
          {viewerIsOwnerOrAdmin && (
            <Pressable onPress={onOpenSettings} hitSlop={8}>
              <Feather name="settings" size={24} color={TEXT} />
            </Pressable>
          )}
          <Pressable onPress={() => setMenuOpen((v) => !v)} hitSlop={8}>
            <Feather name="more-horizontal" size={24} color={TEXT} />
          </Pressable>
        </View>

        {/* ── Collapsing room card (expanded state only) ── */}
        <Animated.View style={{ height: cardHeight, opacity: cardOpacity, overflow: 'hidden' }}>
          <View
            onLayout={(e) => {
              const h = e.nativeEvent.layout.height;
              if (h > 0 && h !== cardH) setCardH(h);
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
                  <Text numberOfLines={1} style={{ color: TEXT, fontSize: 18, fontWeight: '800' }}>
                    {roomName}
                  </Text>
                  <Feather name="chevron-right" size={18} color={DIM} />
                </Pressable>
              ) : (
                <Text numberOfLines={1} style={{ color: TEXT, fontSize: 18, fontWeight: '800' }}>
                  {roomName}
                </Text>
              )}
              {/* Shrink-wrapped row + single-line ID: previously the ID
                  Text wrapped to two lines inside the full-width row, so
                  its box spanned the whole middle column and the copy
                  icon landed far-right at the card edge. Now the row hugs
                  its content and the copy icon sits right after the ID,
                  exactly like imo. */}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 6,
                alignSelf: 'flex-start' }}>
                <Text numberOfLines={1} style={{ color: SUB, fontSize: 13, flexShrink: 1 }}>
                  {t('voiceRoom.info.roomId')} : {roomId}
                </Text>
                <Pressable onPress={copyRoomId} hitSlop={8}>
                  <Feather name="copy" size={14} color={SUB} />
                </Pressable>
              </View>
            </View>
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
          </View>
        </Animated.View>

        {/* ── Tabs (fixed under the header) ── */}
        <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: DIVIDER,
          marginTop: 4 }}>
          <TabButton id="details" label={t('voiceRoom.info.roomDetails', { defaultValue: 'Room Details' })} />
          <TabButton id="member" label={t('voiceRoom.info.memberTab', { defaultValue: 'Member' })} />
        </View>

        {/* ── Tab content ── */}
        <View style={{ flex: 1 }}>
          {tab === 'details' ? (
            <ScrollView
              ref={scrollRef}
              style={{ flex: 1 }}
              onScroll={onScroll}
              scrollEventThrottle={16}
              contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 20 }}
            >
              {viewerIsOwnerOrAdmin && (
                <Pressable
                  onPress={onOpenSettings}
                  style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14 }}
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
                  {displayMembers.length}
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
              {/* Owner-only Disband (deliberate deviation, reported): the
                  old panel's Disband button was the ONLY disband path;
                  imo's screenshots show none, but deleting the capability
                  would break owner functionality. */}
              {isOwner === true && (
                <Pressable
                  onPress={() => {
                    Alert.alert(
                      t('voiceRoom.info.disbandTitle', { defaultValue: 'Disband Room' }),
                      t('voiceRoom.info.disbandMsg', { defaultValue: 'This will permanently delete the room for everyone. Are you sure?' }),
                      [
                        { text: t('voiceRoom.info.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
                        { text: t('voiceRoom.info.disbandConfirm', { defaultValue: 'Disband' }),
                          style: 'destructive', onPress: () => { onClose(); onDisband?.(); } },
                      ],
                    );
                  }}
                  style={{ paddingVertical: 14 }}
                >
                  <Text style={{ color: RED, fontSize: 16, fontWeight: '700' }}>
                    {t('voiceRoom.info.disbandRoom', { defaultValue: 'Disband Room' })}
                  </Text>
                </Pressable>
              )}
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
              // Live presence changes must still reach memoized rows.
              extraData={liveIds}
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
              contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12 }}
              ListHeaderComponent={
                <View>
                  {viewerIsOwnerOrAdmin && (
                    <Pressable
                      onPress={onOpenRequests}
                      style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14,
                        borderBottomWidth: 1, borderBottomColor: DIVIDER }}
                    >
                      <Feather name="users" size={20} color={TEXT} style={{ marginRight: 14 }} />
                      <Text style={{ flex: 1, color: TEXT, fontSize: 16 }}>
                        {t('voiceRoom.info.memberRequest', { defaultValue: 'Member request' })}
                      </Text>
                      <Feather name="chevron-right" size={20} color={DIM} />
                    </Pressable>
                  )}
                  <Pressable
                    onPress={onOpenInvite}
                    style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14,
                      borderBottomWidth: 1, borderBottomColor: DIVIDER }}
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
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
              gap: 8, borderWidth: 1, borderColor: '#444444', borderRadius: 14, paddingVertical: 14 }}>
              <Feather name="user" size={18} color={TEXT} />
              <Text style={{ color: TEXT, fontSize: 16, fontWeight: '700' }}>
                {t('voiceRoom.info.joined', { defaultValue: 'Joined' })}
              </Text>
            </View>
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
              shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 12, elevation: 8 }}>
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
                    paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: DIVIDER }}>
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
