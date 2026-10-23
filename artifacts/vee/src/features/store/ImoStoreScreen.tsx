/**
 * ImoStoreScreen — IMO-হুবহু Diamond Store (2026-10-16, Sumon).
 *
 * Layout (IMO reference):
 *  - Header: ← Store + diamond balance pill (💎 + blue + → Top Up)
 *  - Segmented: Personal | Room
 *  - Personal: Mic Sticker, Avatar Frame, Entry Effect, Profile Skin, Sound Ripple
 *  - Room: Top Short IDs, Background, Mic Decor
 *  - Each category: header + ›, horizontal card row
 *  - Card: image, name, ★ badge, 💎 price, lock/check badge
 *  - Tap card → preview bottom sheet (big image, name, validity, black buy btn)
 *
 * Server-driven: designs come from `store_catalog` (admin). Shelves may be
 * empty — categories show a "Coming soon" placeholder until designs land.
 */

import { memo, useEffect, useState, useCallback, useMemo, useRef  } from 'react';
import {
  View, Text, ScrollView,
  FlatList, Pressable, Image, Modal,
  ActivityIndicator, Alert, Dimensions,
} from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/src/context/AuthContext';
import { DiamondIcon } from '@/src/components/DiamondIcon';
import { subscribeWalletBalance } from '@/src/features/wallet/walletService';
import { fmtDiamonds } from '@/src/features/voice-room/utils/format';
import {
  fetchStoreCatalog, PERSONAL_CATEGORIES, ROOM_CATEGORIES,
  validityLabel,
  type StoreCatalogItem, type StoreTab, type StoreItemType,
} from './storeCatalog';
import {
  getOwnedItems, getEquippedItem, purchaseStoreItem,
  equipStoreItem, unequipStoreItem,
  purchaseRoomStoreItem, getMyOwnedRooms,
  getRoomStoreDecorState, removeRoomBackground, removeRoomMicDecor,
  purchaseHandshakeForPair, fetchPairHandshakeOnce,
  isExpired,
  type OwnedStoreItem, type EquippedItem, type OwnedRoom,
} from './storeService';
import {
  subscribeMyIntimacies, fetchPeerProfile, intimacyLevelFor,
  type IntimacyEntry,
} from '@/src/features/voice-room/services/intimacyService';
import { HANDSHAKE_DESIGNS } from '@/src/features/voice-room/components/handshakeDesigns';
import {
  SHORT_ID_CATALOG, RANDOM_SHORT_ID_PRICE,
  type ShortIdItem,
} from './shortIdCatalog';
import {
  purchaseShortId, claimRandomShortId, isShortIdAvailable,
  type ShortIdKind,
} from './shortIdService';

const C = {
  bg: '#FFFFFF',
  headerBg: '#E8F4FD',
  text: '#111111',
  muted: '#8E8E93',
  faint: '#C7C7CC',
  border: '#EFEFEF',
  cardBorder: '#E8E8E8',
  blue: '#007AFF',
  black: '#111111',
  cream: '#FFFCF3',
  gold: '#FFD700',
  goldDark: '#B8860B',
  green: '#22C55E',
  orange: '#FF9500',
} as const;

const SCREEN_W = Dimensions.get('window').width;
const CARD_W = 112;

/* ── Star badge (IMO: ★5 black/gold pill, ★4 orange pill) ── */
function StarBadge({ star }: { star?: number }) {
  if (!star) return null;
  const bg = star >= 5 ? '#111111' : C.orange;
  return (
    <View style={{
      backgroundColor: bg, borderRadius: 8, paddingHorizontal: 5,
      paddingVertical: 2, marginLeft: 4, flexDirection: 'row', alignItems: 'center',
    }}>
      <Text style={{ color: star >= 5 ? C.gold : '#fff', fontSize: 9, fontWeight: '900' }}>
        ★{star}
      </Text>
    </View>
  );
}

/* ── Lock / owned badge (bottom-right of card) ── */
function OwnBadge({ owned, using }: { owned: boolean; using: boolean }) {
  if (using) {
    return (
      <View style={{
        position: 'absolute', right: 6, bottom: 6, width: 22, height: 22,
        borderRadius: 11, backgroundColor: C.green, alignItems: 'center', justifyContent: 'center',
      }}>
        <Feather name="check" size={12} color="#fff" />
      </View>
    );
  }
  if (owned) {
    return (
      <View style={{
        position: 'absolute', right: 6, bottom: 6, width: 22, height: 22,
        borderRadius: 11, backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center',
      }}>
        <Feather name="check" size={12} color="#fff" />
      </View>
    );
  }
  return (
    <View style={{
      position: 'absolute', right: 6, bottom: 6, width: 22, height: 22,
      borderRadius: 11, backgroundColor: '#6B7280', alignItems: 'center', justifyContent: 'center',
    }}>
      <Feather name="lock" size={11} color="#fff" />
    </View>
  );
}

function Price({ value, size = 13 }: { value: number; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 3 }}>
      <DiamondIcon size={size} />
      <Text style={{ color: C.text, fontSize: size, fontWeight: '800', marginLeft: 3 }}>
        {value.toLocaleString()}
      </Text>
    </View>
  );
}

/* ── Personal item card (IMO style) ── */
function ItemCardInner({
  item, owned, using, onPress,
}: {
  item: StoreCatalogItem; owned: boolean; using: boolean; onPress: () => void;
}) {
  return (
    <Pressable
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress(); }}
      style={{
        width: CARD_W, backgroundColor: '#fff', borderRadius: 16,
        borderWidth: 1, borderColor: C.cardBorder, padding: 8,
        marginRight: 10, alignItems: 'center',
      }}
    >
      <Image
        source={{ uri: item.imageUrl }}
        style={{ width: 88, height: 88, borderRadius: 12 }}
        resizeMode="cover"
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 7, maxWidth: '100%' }}>
        <Text style={{ color: C.text, fontSize: 12.5, fontWeight: '700' }} numberOfLines={1}>
          {item.name}
        </Text>
        <StarBadge star={item.star} />
      </View>
      <Price value={item.price} />
      <OwnBadge owned={owned} using={using} />
    </Pressable>
  );
}

/* ── Short ID card (IMO gold pill style) ── */
function ShortIdCardInner({
  id, label, price, onPress,
}: {
  id: string; label: string; price: number; onPress: () => void;
}) {
  return (
    <Pressable
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress(); }}
      style={{
        width: CARD_W + 16, backgroundColor: '#fff', borderRadius: 16,
        borderWidth: 1, borderColor: C.cardBorder, padding: 10,
        marginRight: 10, alignItems: 'center',
      }}
    >
      {id === '🎲' ? (
        <View style={{
          width: 64, height: 64, borderRadius: 32,
          backgroundColor: '#7E57C2', alignItems: 'center', justifyContent: 'center',
          shadowColor: '#7E57C2', shadowOpacity: 0.4, shadowRadius: 8,
          shadowOffset: { width: 0, height: 3 },
        }}>
          <Text style={{ color: '#fff', fontSize: 28, fontWeight: '900' }}>?</Text>
          <View style={{
            position: 'absolute', top: 6, right: 10,
            width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff', opacity: 0.9,
          }} />
          <View style={{
            position: 'absolute', bottom: 8, left: 10,
            width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff', opacity: 0.7,
          }} />
          <Text style={{
            position: 'absolute', bottom: -2, right: 4,
            color: '#fff', fontSize: 10, opacity: 0.9,
          }}>✦</Text>
        </View>
      ) : (
        <View style={{
          backgroundColor: '#1A1A1A', borderRadius: 20, paddingHorizontal: 14,
          paddingVertical: 9, borderWidth: 2, borderColor: C.gold,
          shadowColor: C.gold, shadowOpacity: 0.4, shadowRadius: 6,
          shadowOffset: { width: 0, height: 2 },
        }}>
          <Text style={{ color: C.gold, fontSize: 16, fontWeight: '900', letterSpacing: 1 }}>
            ✨{id}✨
          </Text>
        </View>
      )}
      <Text style={{ color: C.text, fontSize: 12, fontWeight: '700', marginTop: 8 }} numberOfLines={1}>
        {label}
      </Text>
      <Price value={price} />
    </Pressable>
  );
}

/* ── Background card (IMO tall image card) ── */
function BackgroundCardInner({
  item, owned, using, onPress,
}: {
  item: StoreCatalogItem; owned: boolean; using: boolean; onPress: () => void;
}) {
  return (
    <Pressable
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onPress(); }}
      style={{
        width: 128, height: 168, borderRadius: 18, overflow: 'hidden',
        marginRight: 10, backgroundColor: '#eee',
      }}
    >
      <Image source={{ uri: item.imageUrl }} style={{ width: 128, height: 168 }} resizeMode="cover" />
      <View style={{
        position: 'absolute', left: 0, right: 0, bottom: 0, padding: 8,
        backgroundColor: 'rgba(0,0,0,0.35)',
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ color: '#fff', fontSize: 13, fontWeight: '800' }} numberOfLines={1}>
            {item.name}
          </Text>
          <StarBadge star={item.star} />
        </View>
        {using ? (
          <Text style={{ color: C.green, fontSize: 12, fontWeight: '800', marginTop: 2 }}>Using</Text>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
            <DiamondIcon size={12} />
            <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800', marginLeft: 3 }}>
              {item.price.toLocaleString()}
            </Text>
          </View>
        )}
      </View>
      <OwnBadge owned={owned} using={using} />
    </Pressable>
  );
}

/* ── Coming-soon placeholder ── */
const ItemCard = memo(ItemCardInner);
const ShortIdCard = memo(ShortIdCardInner);
const BackgroundCard = memo(BackgroundCardInner);

function ComingSoonCard() {
  return (
    <View style={{
      width: CARD_W, borderRadius: 16, borderWidth: 1.5,
      borderColor: C.border, borderStyle: 'dashed', padding: 12,
      marginRight: 10, alignItems: 'center', justifyContent: 'center', minHeight: 150,
      backgroundColor: '#FAFAFA',
    }}>
      <Feather name="clock" size={22} color={C.faint} />
      <Text style={{ color: C.muted, fontSize: 11, fontWeight: '600', marginTop: 8, textAlign: 'center' }}>
        Coming soon
      </Text>
    </View>
  );
}

/* ═══════════ Preview bottom sheet ═══════════ */
type PreviewState =
  | { kind: 'catalog'; item: StoreCatalogItem }
  | { kind: 'shortId'; item: ShortIdItem }
  | { kind: 'randomId' }
  | null;

function PreviewSheet({
  preview, onClose, uid, onChanged,
}: {
  preview: PreviewState;
  onClose: () => void;
  uid: string;
  onChanged: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  // 2026-10-16 (Sumon): Synchronous guard — React state updates are async,
  // so two rapid taps can both see busy=false. The ref closes that window
  // and prevents double-charge.
  const busyRef = useRef(false);
  const [idKind, setIdKind] = useState<'account' | 'room'>('account');
  const [roomId, setRoomId] = useState<string>('');
  const [myRooms, setMyRooms] = useState<OwnedRoom[]>([]);
  const [owned, setOwned] = useState<OwnedStoreItem | null>(null);
  const [equipped, setEquipped] = useState<EquippedItem | null>(null);
  const [idTaken, setIdTaken] = useState<boolean | null>(null);
  // 2026-10-16 verification fix: room-item Using state per selected room.
  const [roomUsing, setRoomUsing] = useState(false);

  const item: StoreCatalogItem | null = preview?.kind === 'catalog' ? preview.item : null;
  const isRoomItem = !!item && (item.type === 'roomBackground' || item.type === 'micDecor');
  // 2026-10-20 (Sumon): Mic Handshake items are bought FOR A PAIR — the
  // buyer picks one of their intimacy relations in this sheet.
  const isHandshakeItem = !!item && item.type === 'micHandshake';
  const [peers, setPeers] = useState<(IntimacyEntry & { name: string; photoURL: string | null })[]>([]);
  const [peerUid, setPeerUid] = useState<string>('');
  const [pairStatus, setPairStatus] = useState<string>('');

  // Load ownership / rooms when the sheet opens
  useEffect(() => {
    if (!preview || !uid) return;
    setBusy(false);
    setIdTaken(null);
    let cancelled = false;
    (async () => {
      if (preview.kind === 'catalog' && preview.item) {
        const it = preview.item;
        if (it.type === 'micHandshake') {
          // Load my intimacy relations once (first live snapshot), with
          // display names/photos for the picker.
          const entries = await new Promise<IntimacyEntry[]>((resolve) => {
            let done = false;
            const unsub = subscribeMyIntimacies(uid, (list) => {
              if (done) return;
              done = true;
              unsub();
              resolve(list.filter((e) => e.value > 0));
            });
            setTimeout(() => { if (!done) { done = true; unsub(); resolve([]); } }, 6000);
          });
          const withProfiles = await Promise.all(entries.map(async (e) => {
            const p = await fetchPeerProfile(e.otherUid).catch(() => ({ name: '', photoURL: null }));
            return { ...e, name: p.name || 'User', photoURL: p.photoURL };
          }));
          if (!cancelled) {
            setPeers(withProfiles);
            setPeerUid(withProfiles[0]?.otherUid ?? '');
          }
        } else if (it.type === 'roomBackground' || it.type === 'micDecor') {
          const rooms = await getMyOwnedRooms(uid);
          if (!cancelled) {
            setMyRooms(rooms);
            setRoomId(rooms[0]?.id ?? '');
          }
        } else {
          const [o, e] = await Promise.all([
            getOwnedItems(uid, it.type).then((m) => m[it.id] ?? null),
            getEquippedItem(uid, it.type),
          ]);
          if (!cancelled) {
            setOwned(o && !isExpired(o) ? o : null);
            setEquipped(e && e.itemId === it.id ? e : null);
          }
        }
      } else if (preview.kind === 'shortId') {
        const rooms = await getMyOwnedRooms(uid);
        if (!cancelled) {
          setMyRooms(rooms);
          setRoomId(rooms[0]?.id ?? '');
        }
      } else if (preview.kind === 'randomId') {
        const rooms = await getMyOwnedRooms(uid);
        if (!cancelled) {
          setMyRooms(rooms);
          setRoomId(rooms[0]?.id ?? '');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [preview, uid]);

  // Mic Handshake: live pair status for the picked friend.
  useEffect(() => {
    if (!isHandshakeItem || !peerUid) { setPairStatus(''); return; }
    let cancelled = false;
    (async () => {
      const hs = await fetchPairHandshakeOnce(uid, peerUid);
      if (cancelled) return;
      if (!hs) { setPairStatus(''); return; }
      const d = HANDSHAKE_DESIGNS[hs.designKey];
      const days = Math.max(0, Math.ceil((hs.expiresAt - Date.now()) / 86400000));
      setPairStatus(`Active: ${d?.name || hs.designKey} · ${days}d left`);
    })();
    return () => { cancelled = true; };
  }, [isHandshakeItem, peerUid, uid]);

  // 2026-10-16 verification fix: availability must follow the For Account /
  // For Room toggle — a room ID can be taken while the user ID is free.
  useEffect(() => {
    if (!preview || preview.kind !== 'shortId') {
      setIdTaken(null);
      return;
    }
    const sid = (preview as { item: ShortIdItem }).item.id;
    const kind: ShortIdKind = idKind === 'account' ? 'users' : 'rooms';
    let cancelled = false;
    setIdTaken(null);
    (async () => {
      const taken = await isShortIdAvailable(kind, sid).then((a) => !a).catch(() => null);
      if (!cancelled) setIdTaken(taken);
    })();
    return () => { cancelled = true; };
  }, [preview, idKind]);

  // 2026-10-16 verification fix: refresh Using state when the picked room changes.
  useEffect(() => {
    if (!preview || preview.kind !== 'catalog' || !isRoomItem || !roomId) {
      setRoomUsing(false);
      return;
    }
    const it = (preview as { item: StoreCatalogItem }).item;
    let cancelled = false;
    (async () => {
      const st = await getRoomStoreDecorState(roomId);
      if (cancelled) return;
      setRoomUsing(
        it.type === 'roomBackground'
          ? st.backgroundItemId === it.id
          : st.micDecorItemId === it.id,
      );
    })();
    return () => { cancelled = true; };
  }, [preview, roomId, isRoomItem]);

  if (!preview) return null;

  const doBuyCatalog = async () => {
    if (!item || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const res = isRoomItem
        ? await purchaseRoomStoreItem(uid, item, roomId)
        : isHandshakeItem
          ? await purchaseHandshakeForPair(uid, item, peerUid)
          : await purchaseStoreItem(uid, item);
      if (!res.success) {
        Alert.alert('Store', res.error ?? 'Purchase failed');
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onChanged();
      onClose();
      Alert.alert('Store', 'Purchase successful!');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const doEquipToggle = async () => {
    if (!item || !owned || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      if (equipped) {
        await unequipStoreItem(uid, item.type);
      } else {
        const res = await equipStoreItem(uid, item.type, owned);
        if (!res.success) {
          Alert.alert('Store', res.error ?? 'Could not equip');
          return;
        }
      }
      onChanged();
      onClose();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const doBuyShortId = async (specific: ShortIdItem | null) => {
    if (busyRef.current) return;
    busyRef.current = true;
    const kind: ShortIdKind = idKind === 'account' ? 'users' : 'rooms';
    if (kind === 'rooms' && !roomId) {
      Alert.alert('Store', 'Select a room first');
      return;
    }
    setBusy(true);
    try {
      const res = specific
        ? await purchaseShortId(kind, specific.id, kind === 'rooms' ? roomId : undefined)
        : await (async () => {
            const r = await claimRandomShortId(kind, kind === 'rooms' ? roomId : uid);
            return r.success
              ? { success: true as const }
              : { success: false as const, error: r.error };
          })();
      if (!res.success) {
        Alert.alert('Store', (res as any).error ?? 'Purchase failed');
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onChanged();
      onClose();
      Alert.alert('Store', specific ? `ID ${specific.id} is yours!` : 'Random ID claimed!');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  // Sheet header content per kind
  const renderHeader = () => {
    if (preview.kind === 'catalog' && item) {
      return (
        <>
          <Image source={{ uri: item.imageUrl }} style={{ width: 128, height: 128, borderRadius: 20 }} resizeMode="cover" />
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 14 }}>
            <Text style={{ color: C.text, fontSize: 20, fontWeight: '800' }}>{item.name}</Text>
            <StarBadge star={item.star} />
          </View>
          <Text style={{ color: C.text, fontSize: 14, marginTop: 8, fontWeight: '600' }}>
            Unlock: 🕐 {validityLabel(item.validityDays)}
          </Text>
        </>
      );
    }
    if (preview.kind === 'shortId') {
      const s = preview.item;
      return (
        <>
          <View style={{
            backgroundColor: '#1A1A1A', borderRadius: 24, paddingHorizontal: 26,
            paddingVertical: 14, borderWidth: 2.5, borderColor: C.gold,
          }}>
            <Text style={{ color: C.gold, fontSize: 26, fontWeight: '900', letterSpacing: 2 }}>✨{s.id}✨</Text>
          </View>
          <Text style={{ color: C.text, fontSize: 20, fontWeight: '800', marginTop: 14 }}>{s.label}</Text>
          <Text style={{ color: C.muted, fontSize: 13, marginTop: 6 }}>Permanent • Shows on your profile</Text>
        </>
      );
    }
    return (
      <>
        <Text style={{ fontSize: 64 }}>🎲</Text>
        <Text style={{ color: C.text, fontSize: 20, fontWeight: '800', marginTop: 10 }}>Random 4-digit ID</Text>
        <Text style={{ color: C.muted, fontSize: 13, marginTop: 6 }}>Get a random available ID instantly</Text>
      </>
    );
  };

  const renderActions = () => {
    if (busy) {
      return <ActivityIndicator size="large" color={C.text} style={{ marginVertical: 12 }} />;
    }
    // Owned personal item → Use / ✓ Using
    if (preview.kind === 'catalog' && item && owned && !isRoomItem) {
      return (
        <Pressable
          onPress={doEquipToggle}
          style={{
            backgroundColor: equipped ? C.green : C.blue, borderRadius: 16,
            paddingVertical: 15, alignItems: 'center', marginTop: 18,
          }}
        >
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800' }}>
            {equipped ? '✓ Using' : 'Use'}
          </Text>
        </Pressable>
      );
    }
    // 2026-10-16 verification fix: room item already active on the picked
    // room → show Using + Remove instead of the buy button.
    if (preview.kind === 'catalog' && item && isRoomItem && roomUsing) {
      return (
        <>
          <RoomAndKindPicker
            idKind="room"
            setIdKind={setIdKind}
            myRooms={myRooms}
            roomId={roomId}
            setRoomId={setRoomId}
            showKindToggle={false}
          />
          <View style={{
            backgroundColor: C.green, borderRadius: 16,
            paddingVertical: 15, alignItems: 'center', marginTop: 14,
          }}>
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800' }}>✓ Using</Text>
          </View>
          <Pressable
            onPress={async () => {
              if (busyRef.current) return;
              busyRef.current = true;
              setBusy(true);
              try {
                if (item.type === 'roomBackground') await removeRoomBackground(uid, roomId);
                else await removeRoomMicDecor(uid, roomId);
                setRoomUsing(false);
                onChanged();
              } finally {
                busyRef.current = false;
                setBusy(false);
              }
            }}
            style={{ paddingVertical: 12, alignItems: 'center', marginTop: 4 }}
          >
            <Text style={{ color: '#FF3B30', fontSize: 14, fontWeight: '700' }}>Remove</Text>
          </Pressable>
        </>
      );
    }
    const price = preview.kind === 'catalog' && item
      ? item.price
      : preview.kind === 'shortId'
        ? preview.item.price
        : RANDOM_SHORT_ID_PRICE;
    return (
      <>
        {(isRoomItem || preview.kind === 'shortId' || preview.kind === 'randomId') && (
          <RoomAndKindPicker
            idKind={preview.kind === 'catalog' ? 'room' : idKind}
            setIdKind={setIdKind}
            myRooms={myRooms}
            roomId={roomId}
            setRoomId={setRoomId}
            showKindToggle={preview.kind !== 'catalog'}
          />
        )}
        {isHandshakeItem && (
          <View style={{ marginTop: 12 }}>
            <Text style={{ color: C.muted, fontSize: 13, fontWeight: '700', marginBottom: 8 }}>
              Choose your pair — a friend you share intimacy with
            </Text>
            {peers.length === 0 ? (
              <Text style={{ color: C.muted, fontSize: 13 }}>
                No intimacy relations yet. Send a diamond gift to someone in a voice room first.
              </Text>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {peers.map((p) => {
                    const active = peerUid === p.otherUid;
                    return (
                      <Pressable
                        key={p.pairKey}
                        onPress={() => setPeerUid(p.otherUid)}
                        style={{
                          flexDirection: 'row', alignItems: 'center', gap: 7,
                          paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999,
                          backgroundColor: active ? '#e8f7ff' : '#F4F5F5',
                          borderWidth: active ? 1.5 : 0, borderColor: '#009dff',
                        }}>
                        {p.photoURL
                          ? <Image source={{ uri: p.photoURL }} style={{ width: 26, height: 26, borderRadius: 13 }} />
                          : <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: '#dbeafe' }} />}
                        <Text style={{ color: C.text, fontSize: 13, fontWeight: '700' }}>{p.name}</Text>
                        <Text style={{ color: '#ff5da2', fontSize: 11, fontWeight: '800' }}>
                          Lv.{intimacyLevelFor(p.value).id}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
            )}
            {pairStatus ? (
              <Text style={{ color: '#059669', fontSize: 12.5, fontWeight: '700', marginTop: 8 }}>{pairStatus}</Text>
            ) : null}
          </View>
        )}
        {preview.kind === 'shortId' && idTaken === true && (
          <Text style={{ color: C.muted, fontSize: 13, textAlign: 'center', marginTop: 10, fontWeight: '700' }}>
            This ID is already taken
          </Text>
        )}
        <Pressable
          onPress={() => {
            if (preview.kind === 'catalog') doBuyCatalog();
            else if (preview.kind === 'shortId') {
              if (idTaken === true) return;
              doBuyShortId(preview.item);
            } else doBuyShortId(null);
          }}
          disabled={(preview.kind === 'shortId' && idTaken === true) || (isHandshakeItem && !peerUid)}
          style={{
            backgroundColor: C.black, borderRadius: 16, paddingVertical: 15,
            alignItems: 'center', marginTop: 14,
            opacity: (preview.kind === 'shortId' && idTaken === true) || (isHandshakeItem && !peerUid) ? 0.4 : 1,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <DiamondIcon size={17} />
            <Text style={{ color: '#fff', fontSize: 17, fontWeight: '800', marginLeft: 6 }}>
              {price.toLocaleString()}
            </Text>
          </View>
        </Pressable>
      </>
    );
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}
        onPress={onClose}
      >
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: C.cream, borderTopLeftRadius: 24, borderTopRightRadius: 24,
            paddingHorizontal: 24, paddingTop: 18,
            paddingBottom: Math.max(insets.bottom, 16) + 10, alignItems: 'center',
          }}
        >
          <View style={{ width: 44, height: 5, borderRadius: 3, backgroundColor: '#E0DCCF', marginBottom: 16 }} />
          {renderHeader()}
          <View style={{ width: '100%' }}>{renderActions()}</View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/* ── Room picker + For Account/For Room toggle ── */
function RoomAndKindPicker({
  idKind, setIdKind, myRooms, roomId, setRoomId, showKindToggle,
}: {
  idKind: 'account' | 'room';
  setIdKind: (k: 'account' | 'room') => void;
  myRooms: OwnedRoom[];
  roomId: string;
  setRoomId: (id: string) => void;
  showKindToggle: boolean;
}) {
  return (
    <View style={{ marginTop: 14 }}>
      {showKindToggle && (
        <View style={{ flexDirection: 'row', backgroundColor: '#EFEFEF', borderRadius: 12, padding: 4, marginBottom: 10 }}>
          {(['account', 'room'] as const).map((k) => (
            <Pressable
              key={k}
              onPress={() => setIdKind(k)}
              style={{
                flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center',
                backgroundColor: idKind === k ? '#fff' : 'transparent',
                shadowColor: idKind === k ? '#000' : 'transparent',
                shadowOpacity: idKind === k ? 0.08 : 0, shadowRadius: 4,
                shadowOffset: { width: 0, height: 1 },
              }}
            >
              <Text style={{ color: idKind === k ? C.text : C.muted, fontWeight: '800', fontSize: 13 }}>
                {k === 'account' ? 'For Account' : 'For Room'}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      {(!showKindToggle || idKind === 'room') && (
        <>
          {myRooms.length === 0 ? (
            <Text style={{ color: C.muted, fontSize: 13, textAlign: 'center', fontWeight: '600' }}>
              You need your own room for this
            </Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {myRooms.map((r) => (
                <Pressable
                  key={r.id}
                  onPress={() => setRoomId(r.id)}
                  style={{
                    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, marginRight: 8,
                    backgroundColor: roomId === r.id ? C.text : '#fff',
                    borderWidth: 1.5, borderColor: roomId === r.id ? C.text : C.cardBorder,
                  }}
                >
                  <Text style={{
                    color: roomId === r.id ? '#fff' : C.text,
                    fontWeight: '800', fontSize: 13,
                  }} numberOfLines={1}>
                    {r.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </>
      )}
    </View>
  );
}

/* ═══════════ Main screen ═══════════ */
export function ImoStoreScreen() {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const uid = user?.uid ?? '';
  const [tab, setTab] = useState<StoreTab>('personal');
  const [catalog, setCatalog] = useState<StoreCatalogItem[]>([]);
  const [ownedMap, setOwnedMap] = useState<Record<string, Record<string, OwnedStoreItem>>>({});
  const [equippedMap, setEquippedMap] = useState<Record<string, EquippedItem | null>>({});
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<PreviewState>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (!uid) return;
    const unsub = subscribeWalletBalance(uid, setBalance);
    return unsub;
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const items = await fetchStoreCatalog();
      if (cancelled) return;
      setCatalog(items);
      // Load ownership for personal types present in the catalog
      const types = [...new Set(items.filter((i) => i.tab === 'personal').map((i) => i.type))];
      const owned: Record<string, Record<string, OwnedStoreItem>> = {};
      const equipped: Record<string, EquippedItem | null> = {};
      await Promise.all(types.map(async (t) => {
        const [o, e] = await Promise.all([getOwnedItems(uid, t as StoreItemType), getEquippedItem(uid, t as StoreItemType)]);
        owned[t] = o;
        equipped[t] = e;
      }));
      if (cancelled) return;
      setOwnedMap(owned);
      setEquippedMap(equipped);
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, refreshKey]);

  const categories = tab === 'personal' ? PERSONAL_CATEGORIES : ROOM_CATEGORIES;

  const itemsFor = useCallback((category: string): StoreCatalogItem[] => {
    return catalog.filter((i) => i.tab === tab && i.category === category);
  }, [catalog, tab]);

  const isOwned = useCallback((item: StoreCatalogItem) => {
    const o = ownedMap[item.type]?.[item.id];
    return !!o && !isExpired(o);
  }, [ownedMap]);

  const isUsing = useCallback((item: StoreCatalogItem) => {
    return equippedMap[item.type]?.itemId === item.id;
  }, [equippedMap]);

  const renderCategory = (category: string) => {
    const items = itemsFor(category);
    return (
      <View key={category} style={{ marginBottom: 22 }}>
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          paddingHorizontal: 16, marginBottom: 10,
        }}>
          <Text style={{ color: C.text, fontSize: 17, fontWeight: '800' }}>{category}</Text>
          <Feather name="chevron-right" size={20} color={C.faint} />
        </View>
        {category === 'Top Short IDs' ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16 }}>
            <ShortIdCard
              id="🎲" label="Random ID" price={RANDOM_SHORT_ID_PRICE}
              onPress={() => setPreview({ kind: 'randomId' })}
            />
            {SHORT_ID_CATALOG.map((s) => (
              <ShortIdCard
                key={s.id} id={s.id} label={s.label} price={s.price}
                onPress={() => setPreview({ kind: 'shortId', item: s })}
              />
            ))}
          </ScrollView>
        ) : items.length === 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16 }}>
            <ComingSoonCard />
          </ScrollView>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16 }}>
            {items.map((it) => category === 'Background' ? (
              <BackgroundCard
                key={it.id} item={it}
                owned={isOwned(it)} using={isUsing(it)}
                onPress={() => setPreview({ kind: 'catalog', item: it })}
              />
            ) : (
              <ItemCard
                key={it.id} item={it}
                owned={isOwned(it)} using={isUsing(it)}
                onPress={() => setPreview({ kind: 'catalog', item: it })}
              />
            ))}
          </ScrollView>
        )}
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Header */}
      <View style={{
        backgroundColor: C.headerBg, paddingTop: insets.top + 8,
        paddingHorizontal: 16, paddingBottom: 14,
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Pressable onPress={() => router.back()} hitSlop={12} style={{ marginRight: 12 }}>
            <Feather name="arrow-left" size={24} color={C.text} />
          </Pressable>
          <Text style={{ color: C.text, fontSize: 22, fontWeight: '800' }}>Store</Text>
        </View>
        <View style={{
          flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
          borderRadius: 20, paddingLeft: 12, paddingRight: 4, paddingVertical: 4,
          shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 6,
          shadowOffset: { width: 0, height: 2 },
        }}>
          <DiamondIcon size={15} />
          <Text style={{ color: C.text, fontSize: 15, fontWeight: '800', marginLeft: 4 }}>
            {fmtDiamonds(balance)}
          </Text>
          <Pressable
            onPress={() => router.push('/profile/topup' as any)}
            style={{
              width: 28, height: 28, borderRadius: 14, backgroundColor: C.blue,
              alignItems: 'center', justifyContent: 'center', marginLeft: 8,
            }}
          >
            <Feather name="plus" size={16} color="#fff" />
          </Pressable>
        </View>
      </View>

      {/* Personal | Room */}
      <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
        <View style={{ flexDirection: 'row', backgroundColor: '#F1F1F3', borderRadius: 16, padding: 4 }}>
          {(['personal', 'room'] as StoreTab[]).map((t) => (
            <Pressable
              key={t}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setTab(t); }}
              style={{
                flex: 1, paddingVertical: 11, borderRadius: 13, alignItems: 'center',
                backgroundColor: tab === t ? '#fff' : 'transparent',
                shadowColor: tab === t ? '#000' : 'transparent',
                shadowOpacity: tab === t ? 0.1 : 0, shadowRadius: 6,
                shadowOffset: { width: 0, height: 2 }, elevation: tab === t ? 2 : 0,
              }}
            >
              <Text style={{
                color: tab === t ? C.text : C.muted,
                fontWeight: '800', fontSize: 15, textTransform: 'capitalize',
              }}>
                {t}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Categories */}
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={C.blue} />
        </View>
      ) : (
        <FlatList
          data={categories}
          keyExtractor={(c) => c}
          renderItem={({ item }) => renderCategory(item)}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: 4, paddingBottom: 32 }}
          windowSize={5}
          initialNumToRender={3}
          maxToRenderPerBatch={3}
        />
      )}

      <PreviewSheet preview={preview} onClose={() => setPreview(null)} uid={uid} onChanged={refresh} />
    </View>
  );
}

export default ImoStoreScreen;
