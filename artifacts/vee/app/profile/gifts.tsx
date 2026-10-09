/**
 * Gift Display — imo-style gift collection screen.
 *
 * Shows the current user's received gifts: a "Gift Display" tab with the
 * full collection grid (sortable by quantity or coin value) plus an
 * "Inactive Gifts" section for gifts no longer in the catalog, and a
 * "Gift Board" tab ranking top contributors by gifts sent.
 *
 * All data is real: aggregated from the user's wallet transaction history
 * (same source as the profile Gifts section). No demo content.
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Image,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuth } from '@/src/context/AuthContext';
import {
  subscribeUser,
  getUser,
  type VeeUser,
} from '@/src/services/userService';
import {
  subscribeTransactionHistory,
  type WalletTransaction,
} from '@/src/features/wallet/walletService';

// Light-mode colors (same tokens as profile/index.tsx)
const C = {
  bg: '#FFFFFF',
  text: '#000000',
  muted: '#8E8E93',
  mutedLight: '#C7C7CC',
  border: '#E5E5EA',
  card: '#F2F2F7',
  blue: '#007AFF',
  blueLight: '#E3F2FD',
  gold: '#F59E0B',
} as const;

/**
 * Canonical gift catalog — MUST match the api-server GIFT_CATALOG and
 * GiftsModal.tsx exactly: 1:💝 10, 2:🌹 25, 3:🎁 50, 4:💎 100,
 * 5:🏆 200, 6:🚀 500, 7:👑 1000, 8:🎆 2000.
 */
const GIFT_CATALOG: Record<string, { emoji: string; coins: number }> = {
  '1': { emoji: '💝', coins: 10 },
  '2': { emoji: '🌹', coins: 25 },
  '3': { emoji: '🎁', coins: 50 },
  '4': { emoji: '💎', coins: 100 },
  '5': { emoji: '🏆', coins: 200 },
  '6': { emoji: '🚀', coins: 500 },
  '7': { emoji: '👑', coins: 1000 },
  '8': { emoji: '🎆', coins: 2000 },
};

type SortMode = 'quantity' | 'value';
type Tab = 'display' | 'board';

interface Contributor {
  uid: string;
  count: number;
}

function initials(name: string): string {
  const c = name.trim().charAt(0);
  return c ? c.toUpperCase() : '?';
}

export default function GiftDisplayScreen() {
  const { user } = useAuth();
  const uid = user?.uid;

  const [profile, setProfile] = useState<VeeUser | null>(null);
  const [txs, setTxs] = useState<WalletTransaction[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<Tab>('display');
  const [sortMode, setSortMode] = useState<SortMode>('quantity');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [sortMenuTop, setSortMenuTop] = useState(0);
  const sortBtnRef = useRef<View>(null);
  const [contributors, setContributors] = useState<Record<string, VeeUser | null>>({});

  // Open the sort dropdown anchored under the sort button (real position).
  const openSortMenu = useCallback(() => {
    const fallback = () => setSortMenuOpen(true);
    try {
      sortBtnRef.current?.measureInWindow((_x, y, _w, h) => {
        setSortMenuTop(y + h + 6);
        setSortMenuOpen(true);
      });
    } catch {
      fallback();
    }
  }, []);

  // ── Profile + transactions ──────────────────────────────────────────────
  useEffect(() => {
    if (!uid) {
      setLoaded(true);
      return;
    }
    const offUser = subscribeUser(uid, setProfile);
    const offTxs = subscribeTransactionHistory(uid, (list) => {
      setTxs(list);
      setLoaded(true);
    });
    return () => {
      offUser();
      offTxs();
    };
  }, [uid]);

  // ── Aggregations (real data only) ───────────────────────────────────────
  const receivedTxs = useMemo(
    () => txs.filter((t) => t && t.type === 'gift_received' && typeof t.giftId === 'string' && t.giftId.length > 0),
    [txs],
  );

  const giftCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of receivedTxs) {
      counts[t.giftId] = (counts[t.giftId] ?? 0) + 1;
    }
    return counts;
  }, [receivedTxs]);

  const catalogEntries = useMemo(
    () =>
      Object.entries(giftCounts)
        .filter(([giftId]) => GIFT_CATALOG[giftId])
        .sort((a, b) => {
          if (sortMode === 'value') {
            return GIFT_CATALOG[b[0]].coins * b[1] - GIFT_CATALOG[a[0]].coins * a[1];
          }
          return b[1] - a[1]; // quantity desc
        }),
    [giftCounts, sortMode],
  );

  const inactiveEntries = useMemo(
    () =>
      Object.entries(giftCounts)
        .filter(([giftId]) => !GIFT_CATALOG[giftId])
        .sort((a, b) => b[1] - a[1]),
    [giftCounts],
  );

  const totalGifts = useMemo(
    () => Object.values(giftCounts).reduce((s, c) => s + c, 0),
    [giftCounts],
  );

  const totalCoins = useMemo(
    () =>
      Object.entries(giftCounts).reduce(
        (s, [giftId, c]) => s + (GIFT_CATALOG[giftId] ? GIFT_CATALOG[giftId].coins * c : 0),
        0,
      ),
    [giftCounts],
  );

  // Contributors: aggregate by sender uid. The api-server writes `fromUid`;
  // fall back to the typed `counterpartUid` for any legacy shape.
  const contributorList = useMemo<Contributor[]>(() => {
    const counts: Record<string, number> = {};
    for (const t of receivedTxs) {
      const raw = t as unknown as { fromUid?: unknown };
      const sender =
        (typeof raw.fromUid === 'string' && raw.fromUid.length > 0 ? raw.fromUid : null) ??
        (typeof t.counterpartUid === 'string' && t.counterpartUid.length > 0 ? t.counterpartUid : null);
      if (sender && sender !== uid) {
        counts[sender] = (counts[sender] ?? 0) + 1;
      }
    }
    return Object.entries(counts)
      .map(([senderUid, count]) => ({ uid: senderUid, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);
  }, [receivedTxs, uid]);

  // ── Fetch contributor profiles (cached, top 20 max) ─────────────────────
  useEffect(() => {
    let cancelled = false;
    const missing = contributorList.filter((c) => !(c.uid in contributors));
    if (missing.length === 0) return;
    (async () => {
      const results = await Promise.all(
        missing.map(async (c) => {
          try {
            return { uid: c.uid, user: await getUser(c.uid) };
          } catch {
            return { uid: c.uid, user: null };
          }
        }),
      );
      if (cancelled) return;
      setContributors((prev) => {
        const next = { ...prev };
        for (const r of results) next[r.uid] = r.user;
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [contributorList, contributors]);

  const displayName = profile?.name || user?.displayName || 'User';
  const photoURL = profile?.photoURL || user?.photoURL;

  const renderGiftCell = useCallback(
    ([giftId, count]: [string, number], dimmed: boolean) => (
      <View key={giftId} style={{ width: '25%', padding: 4, alignItems: 'center', opacity: dimmed ? 0.45 : 1 }}>
        <View
          style={{
            width: '100%',
            aspectRatio: 1,
            backgroundColor: C.card,
            borderRadius: 16,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 36 }}>{GIFT_CATALOG[giftId]?.emoji ?? '🎁'}</Text>
        </View>
        <Text style={{ fontSize: 13, color: C.text, marginTop: 4, fontWeight: '600' }}>x{count}</Text>
      </View>
    ),
    [],
  );

  if (!loaded) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={C.blue} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      {/* ── Header ── */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 }}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={{ padding: 8, marginRight: 4 }}>
          <Feather name="arrow-left" size={24} color={C.text} />
        </Pressable>
        {photoURL ? (
          <Image source={{ uri: photoURL }} style={{ width: 80, height: 80, borderRadius: 40 }} />
        ) : (
          <View
            style={{
              width: 80,
              height: 80,
              borderRadius: 40,
              backgroundColor: C.blueLight,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 32, fontWeight: '800', color: C.blue }}>{initials(displayName)}</Text>
          </View>
        )}
        <View style={{ marginLeft: 14, flex: 1 }}>
          <Text style={{ fontSize: 22, fontWeight: '800', color: C.text }} numberOfLines={1}>
            {displayName}
          </Text>
          <Text style={{ fontSize: 26, fontWeight: '900', color: C.gold, marginTop: 2 }}>
            🎁 {totalGifts}
          </Text>
          <Text style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>
            💎 {totalCoins.toLocaleString()} coins received
          </Text>
        </View>
      </View>

      {/* ── Tabs ── */}
      <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
        <View
          style={{
            flexDirection: 'row',
            backgroundColor: C.card,
            borderRadius: 12,
            padding: 4,
          }}
        >
          {(['display', 'board'] as Tab[]).map((t) => {
            const active = tab === t;
            return (
              <Pressable
                key={t}
                onPress={() => setTab(t)}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: 9,
                  backgroundColor: active ? '#FFFFFF' : 'transparent',
                  alignItems: 'center',
                  shadowColor: active ? '#000' : 'transparent',
                  shadowOpacity: active ? 0.08 : 0,
                  shadowRadius: 4,
                  elevation: active ? 2 : 0,
                }}
              >
                <Text
                  style={{
                    fontSize: 15,
                    fontWeight: active ? '700' : '500',
                    color: active ? C.text : C.muted,
                  }}
                >
                  {t === 'display' ? 'Gift Display' : 'Gift Board'}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {tab === 'display' ? (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>
          {/* ── Other Gifts + sort ── */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 16,
              paddingTop: 16,
              paddingBottom: 8,
            }}
          >
            <Text style={{ fontSize: 17, fontWeight: '600', color: C.text }}>Other Gifts</Text>
            <Pressable
              ref={sortBtnRef}
              onPress={openSortMenu}
              style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingLeft: 8 }}
              hitSlop={8}
            >
              <Text style={{ fontSize: 14, color: C.muted, marginRight: 4 }}>
                {sortMode === 'quantity' ? 'By quantity' : 'By value'}
              </Text>
              <Feather name="chevron-down" size={16} color={C.muted} />
            </Pressable>
          </View>

          {catalogEntries.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12 }}>
              {catalogEntries.map((e) => renderGiftCell(e, false))}
            </View>
          ) : (
            <View style={{ paddingHorizontal: 16, paddingVertical: 24, alignItems: 'center' }}>
              <Text style={{ fontSize: 15, color: C.muted }}>No gifts received yet</Text>
            </View>
          )}

          {/* ── Inactive Gifts ── */}
          {inactiveEntries.length > 0 && (
            <>
              <Text
                style={{
                  fontSize: 17,
                  fontWeight: '600',
                  color: C.text,
                  paddingHorizontal: 16,
                  paddingTop: 20,
                  paddingBottom: 8,
                }}
              >
                Inactive Gifts
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12 }}>
                {inactiveEntries.map((e) => renderGiftCell(e, true))}
              </View>
            </>
          )}
        </ScrollView>
      ) : (
        /* ── Gift Board ── */
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>
          {contributorList.length > 0 ? (
            <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
              {contributorList.map((c, i) => {
                const u = contributors[c.uid];
                const name = u?.name || 'User';
                const avatar = u?.photoURL;
                return (
                  <View
                    key={c.uid}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      backgroundColor: C.card,
                      borderRadius: 14,
                      padding: 12,
                      marginBottom: 8,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 16,
                        fontWeight: '800',
                        color: i < 3 ? C.gold : C.muted,
                        width: 28,
                        textAlign: 'center',
                      }}
                    >
                      {i + 1}
                    </Text>
                    {avatar ? (
                      <Image source={{ uri: avatar }} style={{ width: 44, height: 44, borderRadius: 22 }} />
                    ) : (
                      <View
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 22,
                          backgroundColor: C.blueLight,
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Text style={{ fontSize: 18, fontWeight: '800', color: C.blue }}>
                          {initials(name)}
                        </Text>
                      </View>
                    )}
                    <Text
                      style={{ flex: 1, fontSize: 16, fontWeight: '600', color: C.text, marginLeft: 12 }}
                      numberOfLines={1}
                    >
                      {name}
                    </Text>
                    <Text style={{ fontSize: 14, fontWeight: '600', color: C.muted }}>x{c.count} gifts</Text>
                  </View>
                );
              })}
            </View>
          ) : (
            <View style={{ paddingHorizontal: 16, paddingVertical: 48, alignItems: 'center' }}>
              <Text style={{ fontSize: 40, marginBottom: 12 }}>🎁</Text>
              <Text style={{ fontSize: 16, fontWeight: '600', color: C.text }}>No contributors yet</Text>
              <Text style={{ fontSize: 13, color: C.muted, marginTop: 6, textAlign: 'center' }}>
                When people send you gifts in voice rooms, they will appear here.
              </Text>
            </View>
          )}
        </ScrollView>
      )}

      {/* Sort dropdown — real menu anchored under the sort button; tap outside to close */}
      <Modal
        visible={sortMenuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSortMenuOpen(false)}
      >
        <Pressable style={{ flex: 1 }} onPress={() => setSortMenuOpen(false)}>
          <View
            style={{
              position: 'absolute',
              top: sortMenuTop,
              right: 16,
              backgroundColor: '#FFFFFF',
              borderRadius: 12,
              borderWidth: 1,
              borderColor: C.border,
              shadowColor: '#000',
              shadowOpacity: 0.12,
              shadowRadius: 8,
              elevation: 4,
              minWidth: 140,
            }}
          >
            {(['quantity', 'value'] as SortMode[]).map((m) => (
              <Pressable
                key={m}
                onPress={() => {
                  setSortMode(m);
                  setSortMenuOpen(false);
                }}
                style={{ paddingHorizontal: 14, paddingVertical: 11 }}
              >
                <Text
                  style={{
                    fontSize: 14,
                    fontWeight: sortMode === m ? '700' : '400',
                    color: sortMode === m ? C.blue : C.text,
                  }}
                >
                  {m === 'quantity' ? 'By quantity' : 'By value'}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}
