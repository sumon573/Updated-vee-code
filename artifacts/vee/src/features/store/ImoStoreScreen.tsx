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

import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, Pressable, Image, Modal,
  ActivityIndicator, Alert, Dimensions,
} from 'react-native';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/src/context/AuthContext';
import { subscribeWalletBalance } from '@/src/features/wallet/walletService';
import { fmtDiamonds } from '@/src/utils/format';
import {
  fetchStoreCatalog, PERSONAL_CATEGORIES, ROOM_CATEGORIES,
  validityLabel,
  type StoreCatalogItem, type StoreTab, type StoreItemType,
} from './storeCatalog';
import {
  getOwnedItems, getEquippedItem, purchaseStoreItem,
  equipStoreItem, unequipStoreItem,
  purchaseRoomStoreItem, getMyOwnedRooms,
  isExpired,
  type OwnedStoreItem, type EquippedItem, type OwnedRoom,
} from './storeService';
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
      <Text style={{ fontSize: size }}>💎</Text>
      <Text style={{ color: C.text, fontSize: size, fontWeight: '800', marginLeft: 3 }}>
        {value.toLocaleString()}
      </Text>
    </View>
  );
}

/* ── Personal item card (IMO style) ── */
function ItemCard({
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
function ShortIdCard({
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
      <Text style={{ color: C.text, fontSize: 12, fontWeight: '700', marginTop: 8 }} numberOfLines={1}>
        {label}
      </Text>
      <Price value={price} />
    </Pressable>
  );
}

/* ── Background card (IMO tall image card) ── */
function BackgroundCard({
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
            <Text style={{ fontSize: 12 }}>💎</Text>
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
  const [idKind, setIdKind] = useState<'account' | 'room'>('account');
  const [roomId, setRoomId] = useState<string>('');
  const [myRooms, setMyRooms] = useState<OwnedRoom[]>([]);
  const [owned, setOwned] = useState<OwnedStoreItem | null>(null);
  const [equipped, setEquipped] = useState<EquippedItem | null>(null);
  const [idTaken, setIdTaken] = useState<boolean | null>(null);

  const item: StoreCatalogItem | null = preview?.kind === 'catalog' ? preview.item : null;
  const isRoomItem = !!item && (item.type === 'roomBackground' || item.type === 'micDecor');

  // Load ownership / rooms when the sheet opens
  useEffect(() => {
    if (!preview || !uid) return;
    setBusy(false);
    setIdTaken(null);
    let cancelled = false;
    (async () => {
      if (preview.kind === 'catalog' && preview.item) {
        const it = preview.item;
        if (it.type === 'roomBackground' || it.type === 'micDecor') {
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
        const taken = await isShortIdAvailable('users', preview.item.id).then((a) => !a).catch(() => null);
        if (!cancelled) setIdTaken(taken);
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

  if (!preview) return null;

  const doBuyCatalog = async () => {
    if (!item || busy) return;
    setBusy(true);
    try {
      const res = isRoomItem
        ? await purchaseRoomStoreItem(uid, item, roomId)
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
      setBusy(false);
    }
  };

  const doEquipToggle = async () => {
    if (!item || !owned || busy) return;
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
      setBusy(false);
    }
  };

  const doBuyShortId = async (specific: ShortIdItem | null) => {
    if (busy) return;
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
    // Room background owned state: node IS the equip — show Using/Remove
    // (handled by parent refresh; buy button hidden when already set)
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
          disabled={preview.kind === 'shortId' && idTaken === true}
          style={{
            backgroundColor: C.black, borderRadius: 16, paddingVertical: 15,
            alignItems: 'center', marginTop: 14,
            opacity: preview.kind === 'shortId' && idTaken === true ? 0.4 : 1,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ fontSize: 17 }}>💎</Text>
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
          onPress={(e) => e.stopPropagation()}
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
          <Text style={{ fontSize: 15 }}>💎</Text>
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
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: 4, paddingBottom: 32 }}
        >
          {categories.map(renderCategory)}
        </ScrollView>
      )}

      <PreviewSheet preview={preview} onClose={() => setPreview(null)} uid={uid} onChanged={refresh} />
    </View>
  );
}

export default ImoStoreScreen;
