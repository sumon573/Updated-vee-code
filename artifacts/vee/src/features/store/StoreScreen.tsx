/**
 * StoreScreen — Diamond store for Short IDs and DP Frames (2026-10-09).
 *
 * Tabs: Short ID | Frames
 * - Short ID: 13 suggested premium IDs + random, for users and rooms.
 * - Frames: DP frames (designs coming — structure ready).
 *
 * Purchase flow: check diamond balance → deduct via server → claim ID.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, Pressable, ActivityIndicator, Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import {
  SHORT_ID_CATALOG, RANDOM_SHORT_ID_PRICE, TIER_COLORS, TIER_NAMES,
  ShortIdItem,
} from './shortIdCatalog';
import {
  claimShortId, claimRandomShortId, isShortIdAvailable,
} from './shortIdService';
import { getBalance } from '@/src/features/wallet/walletService';
import { auth } from '@/src/config/firebase';

const C = {
  bg: '#FFFFFF',
  primary: '#7C3AED',
  glow: '#8B5CF6',
  text: '#000000',
  muted: '#8E8E93',
  mutedDim: '#C7C7CC',
  border: '#E5E5EA',
  surface: '#F2F2F7',
  gold: '#FFD700',
  green: '#22C55E',
  red: '#EF4444',
} as const;

type StoreTab = 'shortid' | 'frames';
type IdKind = 'user' | 'room';

async function deductDiamonds(amount: number): Promise<boolean> {
  // Deduct via the server wallet API (server-side balance is authoritative).
  try {
    const fbUser = auth.currentUser;
    if (!fbUser) return false;
    const idToken = await fbUser.getIdToken();
    const { getApiBase } = await import('@/src/utils/platform');
    const res = await fetch(`${getApiBase()}/wallet/spend`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ amount, reason: 'store_purchase' }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function StoreScreen() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [tab, setTab] = useState<StoreTab>('shortid');
  const [idKind, setIdKind] = useState<IdKind>('user');
  const [balance, setBalance] = useState(0);
  const [buying, setBuying] = useState<string | null>(null);
  const [takenIds, setTakenIds] = useState<Set<string>>(new Set());
  const [myShortId, setMyShortId] = useState<string | null>(null);

  const myUid = user?.uid;

  const refresh = useCallback(async () => {
    try {
      const bal = await getBalance();
      setBalance(bal);
    } catch { /* non-critical */ }
    // Check which catalog IDs are taken
    const taken = new Set<string>();
    await Promise.all(
      SHORT_ID_CATALOG.map(async (item) => {
        const avail = await isShortIdAvailable(
          idKind === 'user' ? 'users' : 'rooms',
          item.id,
        ).catch(() => true);
        if (!avail) taken.add(item.id);
      }),
    );
    setTakenIds(taken);
    // Load my current short ID
    if (myUid) {
      try {
        const { get, ref } = await import('firebase/database');
        const { database } = await import('@/src/config/firebase');
        const snap = await get(ref(database, `users/${myUid}/shortId`));
        if (snap.exists()) setMyShortId(snap.val() as string);
      } catch { /* non-critical */ }
    }
  }, [idKind, myUid]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleBuyId = async (item: ShortIdItem) => {
    if (!myUid || buying) return;
    if (balance < item.price) {
      Alert.alert(t('store.notEnough'), t('store.notEnoughMsg'));
      return;
    }
    Alert.alert(
      t('store.confirmBuy', { id: item.id }),
      t('store.confirmBuyMsg', { price: item.price.toLocaleString() }),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: t('store.buy'),
          onPress: async () => {
            setBuying(item.id);
            try {
              // 1. Deduct diamonds first
              const deducted = await deductDiamonds(item.price);
              if (!deducted) {
                Alert.alert(t('store.error'), t('store.deductFailed'));
                return;
              }
              // 2. Claim the ID (atomic transaction)
              const ownerId = myUid; // for rooms, we'd need room selection
              const result = await claimShortId(
                idKind === 'user' ? 'users' : 'rooms',
                item.id,
                ownerId,
              );
              if (!result.success) {
                Alert.alert(t('store.error'), t('store.claimFailed'));
                // TODO: refund diamonds via server
                return;
              }
              Alert.alert(t('store.success'), t('store.idClaimed', { id: item.id }));
              refresh();
            } finally {
              setBuying(null);
            }
          },
        },
      ],
    );
  };

  const handleBuyRandom = async () => {
    if (!myUid || buying) return;
    if (balance < RANDOM_SHORT_ID_PRICE) {
      Alert.alert(t('store.notEnough'), t('store.notEnoughMsg'));
      return;
    }
    setBuying('random');
    try {
      const deducted = await deductDiamonds(RANDOM_SHORT_ID_PRICE);
      if (!deducted) {
        Alert.alert(t('store.error'), t('store.deductFailed'));
        return;
      }
      const result = await claimRandomShortId(
        idKind === 'user' ? 'users' : 'rooms',
        myUid,
      );
      if (!result.success) {
        Alert.alert(t('store.error'), result.error ?? t('store.claimFailed'));
        return;
      }
      Alert.alert(t('store.success'), t('store.idClaimed', { id: result.shortId }));
      refresh();
    } finally {
      setBuying(null);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      {/* Tab bar */}
      <View style={{ flexDirection: 'row', marginBottom: 16, backgroundColor: C.surface, borderRadius: 14, padding: 4 }}>
        {(['shortid', 'frames'] as StoreTab[]).map((tb) => (
          <Pressable
            key={tb}
            onPress={() => setTab(tb)}
            style={{
              flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center',
              backgroundColor: tab === tb ? C.primary : 'transparent',
            }}
          >
            <Text style={{
              color: tab === tb ? '#fff' : C.muted,
              fontWeight: '800', fontSize: 14,
            }}>
              {tb === 'shortid' ? `🆔 ${t('store.shortId')}` : `🖼️ ${t('store.frames')}`}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === 'shortid' ? (
        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Balance + my ID */}
          <View style={{
            backgroundColor: C.surface, borderRadius: 16, padding: 16,
            marginBottom: 16, flexDirection: 'row', alignItems: 'center',
            justifyContent: 'space-between',
          }}>
            <View>
              <Text style={{ color: C.muted, fontSize: 12 }}>{t('store.balance')}</Text>
              <Text style={{ color: C.text, fontSize: 20, fontWeight: '900' }}>
                💎 {balance.toLocaleString()}
              </Text>
            </View>
            {myShortId && (
              <View style={{
                backgroundColor: C.gold, borderRadius: 12, paddingHorizontal: 14,
                paddingVertical: 8, alignItems: 'center',
              }}>
                <Text style={{ color: '#000', fontSize: 10, fontWeight: '700' }}>
                  {t('store.myId')}
                </Text>
                <Text style={{ color: '#000', fontSize: 18, fontWeight: '900' }}>
                  {myShortId}
                </Text>
              </View>
            )}
          </View>

          {/* User / Room selector */}
          <View style={{ flexDirection: 'row', marginBottom: 16, backgroundColor: C.surface, borderRadius: 12, padding: 4 }}>
            {(['user', 'room'] as IdKind[]).map((k) => (
              <Pressable
                key={k}
                onPress={() => setIdKind(k)}
                style={{
                  flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center',
                  backgroundColor: idKind === k ? '#fff' : 'transparent',
                }}
              >
                <Text style={{ color: idKind === k ? C.text : C.muted, fontWeight: '700', fontSize: 13 }}>
                  {k === 'user' ? t('store.forAccount') : t('store.forRoom')}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Random ID */}
          <Pressable
            onPress={handleBuyRandom}
            disabled={buying !== null}
            style={{
              backgroundColor: C.green, borderRadius: 16, padding: 16,
              marginBottom: 16, flexDirection: 'row', alignItems: 'center',
              justifyContent: 'space-between', opacity: buying ? 0.6 : 1,
            }}
          >
            <View>
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: '900' }}>
                🎲 {t('store.randomId')}
              </Text>
              <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 2 }}>
                {t('store.randomIdSub')}
              </Text>
            </View>
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>
              💎 {RANDOM_SHORT_ID_PRICE.toLocaleString()}
            </Text>
          </Pressable>

          {/* Catalog */}
          {SHORT_ID_CATALOG.map((item) => {
            const taken = takenIds.has(item.id);
            const isBuying = buying === item.id;
            return (
              <View
                key={item.id}
                style={{
                  backgroundColor: '#fff', borderRadius: 16, padding: 14,
                  marginBottom: 10, flexDirection: 'row', alignItems: 'center',
                  borderWidth: 1.5, borderColor: TIER_COLORS[item.tier],
                  opacity: taken ? 0.5 : 1,
                }}
              >
                <View style={{
                  width: 56, height: 56, borderRadius: 14,
                  backgroundColor: TIER_COLORS[item.tier],
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Text style={{ color: '#fff', fontSize: 15, fontWeight: '900' }}>
                    {item.id}
                  </Text>
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={{ color: C.text, fontSize: 15, fontWeight: '800' }}>
                    {item.label}
                  </Text>
                  <Text style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>
                    {TIER_NAMES[item.tier]} • 💎 {item.price.toLocaleString()}
                  </Text>
                </View>
                {taken ? (
                  <Text style={{ color: C.muted, fontSize: 12, fontWeight: '700' }}>
                    {t('store.sold')}
                  </Text>
                ) : isBuying ? (
                  <ActivityIndicator color={C.primary} />
                ) : (
                  <Pressable
                    onPress={() => handleBuyId(item)}
                    style={{
                      backgroundColor: C.primary, borderRadius: 10,
                      paddingHorizontal: 16, paddingVertical: 8,
                    }}
                  >
                    <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>
                      {t('store.buy')}
                    </Text>
                  </Pressable>
                )}
              </View>
            );
          })}
        </ScrollView>
      ) : (
        /* Frames tab — designs coming from Sumon */
        <View style={{ alignItems: 'center', paddingTop: 60 }}>
          <Feather name="image" size={48} color={C.mutedDim} />
          <Text style={{ color: C.muted, fontSize: 15, fontWeight: '700', marginTop: 16 }}>
            {t('store.framesComing')}
          </Text>
          <Text style={{ color: C.mutedDim, fontSize: 13, marginTop: 6, textAlign: 'center', paddingHorizontal: 30 }}>
            {t('store.framesComingSub')}
          </Text>
        </View>
      )}
    </View>
  );
}
