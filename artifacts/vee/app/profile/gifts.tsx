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
 *
 * 2026-10-19: restyled to IMO Me-tab design language (#F4F5F5 bg, white
 * cards, 56dp title bar). LEGACY_GIFT_ID_MAP kept verbatim — all logic
 * unchanged.
 */
import { memo, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { View, Text, ScrollView, Pressable, Modal, FlatList } from 'react-native';
import { Image } from 'expo-image';
import PremiumLoader from '@/src/components/PremiumLoader';
import { DiamondIcon } from '@/src/components/DiamondIcon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@/src/context/AuthContext';
import {
  subscribeUser,
  getUser,
  type VeeUser } from '@/src/services/userService';
import {
  subscribeTransactionHistory,
  type WalletTransaction } from '@/src/features/wallet/walletService';
import { ref, get, onValue } from 'firebase/database';
import { database } from '@/src/config/firebase';

// IMO BIUI light tokens (2026-10-19, Me-tab spec): bg #f4f5f5, white cards,
// primary text #25292d, secondary #788187. Boss button standard #E3F2FD/#007AFF kept.
const C = {
  bg: '#F4F5F5',
  card: '#FFFFFF',
  tile: '#F4F5F5',
  text: '#25292D',
  muted: '#788187',
  mutedLight: '#C7C7CC',
  border: '#F0F1F2',
  blue: '#007AFF',
  blueLight: '#E3F2FD',
  green: '#34C759',
  goldBg: '#FFF8E6',
  goldBorder: '#F5D67B',
  goldText: '#B8860B',
  gold: '#F59E0B' } as const;

// IMO card container: white, 12dp radius, 15dp side margins
const cardStyle = { backgroundColor: C.card, marginHorizontal: 15, marginTop: 12, borderRadius: 12 } as const;

// ─── IMO title bar: 56dp, back ‹ left, centered 17sp semibold, no gear ───
function TitleBar({ title }: { title: string }) {
  return (
    <View style={{ height: 56, backgroundColor: C.card, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 }}>
      <Pressable onPress={() => router.back()} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }} hitSlop={8}>
        <Feather name="chevron-left" size={24} color={C.text} />
      </Pressable>
      <Text style={{ flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600', color: C.text }} numberOfLines={1}>
        {title}
      </Text>
      <View style={{ width: 40 }} />
    </View>
  );
}

/**
 * Canonical gift catalog — MUST match the api-server GIFT_CATALOG and
 * GiftsModal.tsx exactly: 1:💝 10, 2:🌹 25, 3:🎁 50, 4:💎 100,
 * 5:🏆 200, 6:🚀 500, 7:👑 1000, 8:🎆 2000.
 */
const GIFT_CATALOG: Record<string, { emoji: string; coins: number; name: string }> = {
  '1': { emoji: '💝', coins: 10, name: 'Heart' },
  '2': { emoji: '🌹', coins: 25, name: 'Rose' },
  '3': { emoji: '🎁', coins: 50, name: 'Gift' },
  '4': { emoji: '💎', coins: 100, name: 'Diamond' },
  '5': { emoji: '🏆', coins: 200, name: 'Trophy' },
  '6': { emoji: '🚀', coins: 500, name: 'Rocket' },
  '7': { emoji: '👑', coins: 1000, name: 'Crown' },
  '8': { emoji: '🎆', coins: 2000, name: 'Firework' } };

/**
 * 2026-10-18 (Sumon): PERMANENT legacy gift ID mapping.
 * Old numeric gift IDs (1-8) automatically resolve to new string IDs.
 * Works for ALL users (current + future) — no data migration ever needed.
 * Legacy counts merge into canonical IDs so display stays clean.
 */
const LEGACY_GIFT_ID_MAP: Record<string, string> = {
  '1': 'heart',       // Heart 10💎
  '2': 'pink-rose',   // Rose 25💎
  '3': 'pink-rose',   // Gift Box 50💎 (rose image)
  '4': 'winter-dream', // Diamond 100💎
  '5': 'golden-crown', // Trophy 200💎
  '6': 'blossom-dream', // Rocket 500💎
  '7': 'golden-crown', // Crown 1000💎
  '8': 'dream-rider',  // Firework 2000💎
};

/** Resolve a gift ID through the legacy map to its canonical string ID. */
function resolveGiftId(giftId: string): string {
  return LEGACY_GIFT_ID_MAP[giftId] || giftId;
}

type SortMode = 'quantity' | 'value';
type Tab = 'display' | 'board';

interface Contributor {
  uid: string;
  count: number;
  /** Total diamonds sent (price x count) — the ranking key (P2-3). */
  value: number;
}

function initials(name: string): string {
  const c = name.trim().charAt(0);
  return c ? c.toUpperCase() : '?';
}


/* Perf (2026-10-22 audit): memoized contributor row for the virtualized
   Gift Board list (was an unbounded .map() inside a ScrollView). */
const ContributorRow = memo(function ContributorRow({
  rank, name, avatar, count, last,
}: {
  rank: number;
  name: string;
  avatar?: string;
  count: number;
  last: boolean;
}) {
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10 }}>
        <Text
          style={{
            fontSize: 16, fontWeight: '800',
            color: rank < 3 ? C.gold : C.mutedLight,
            width: 28, textAlign: 'center' }}
        >
          {rank + 1}
        </Text>
        {avatar ? (
          <Image source={{ uri: avatar }} style={{ width: 44, height: 44, borderRadius: 22 }} cachePolicy="memory-disk" />
        ) : (
          <View
            style={{
              width: 44, height: 44, borderRadius: 22,
              backgroundColor: C.blueLight,
              alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ fontSize: 18, fontWeight: '800', color: C.blue }}>
              {initials(name)}
            </Text>
          </View>
        )}
        <Text style={{ flex: 1, fontSize: 16, color: C.text, marginLeft: 12 }} numberOfLines={1}>
          {name}
        </Text>
        <Text style={{ fontSize: 14, color: C.muted }}>x{count} gifts</Text>
      </View>
      {!last && (
        <View style={{ height: 0.5, backgroundColor: C.border, marginLeft: 84 }} />
      )}
    </View>
  );
});

export default function GiftDisplayScreen() {
  const { user } = useAuth();
  const { uid: paramUid } = useLocalSearchParams<{ uid?: string }>();
  // When viewing another user's profile, show THEIR gifts
  const uid = paramUid ?? user?.uid;
  const isMe = !paramUid || paramUid === user?.uid;

  const [profile, setProfile] = useState<VeeUser | null>(null);
  const [txs, setTxs] = useState<WalletTransaction[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<Tab>('display');
  const [sortMode, setSortMode] = useState<SortMode>('quantity');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  // 2026-10-15 (Sumon): imo-style tap-to-preview — gift big image + name + diamond price + x count
  const [previewGift, setPreviewGift] = useState<{ giftId: string; count: number } | null>(null);
  const [sortMenuTop, setSortMenuTop] = useState(0);
  const sortBtnRef = useRef<View>(null);
  const [contributors, setContributors] = useState<Record<string, VeeUser | null>>({});
  // 2026-10-15 (Sumon): lifetime gift counts — permanent, not limited to 50 txs.
  const [lifetimeCounts, setLifetimeCounts] = useState<Record<string, number>>({});
  // 2026-10-17 (Sumon): Server-driven gift catalog — new gifts from Firebase show in display.
  const [serverCatalog, setServerCatalog] = useState<Record<string, { name: string; coins: number; thumbnailUrl?: string }>>({});

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
    // 2026-10-15 (Sumon): subscribe lifetime gift counts (permanent aggregate).
    let offCounts: (() => void) | undefined;
    import('@/src/features/wallet/walletService').then(({ subscribeGiftCounts, healGiftCounts }) => {
      // 2026-10-16 (Sumon): Heal server counts from tx history on first load.
      // Ensures gift counts are server-sourced and survive app updates.
      healGiftCounts(uid).catch(() => {});
      offCounts = subscribeGiftCounts(uid, setLifetimeCounts);
    }).catch(() => {});
    return () => {
      offUser();
      offTxs();
      offCounts?.();
    };
  }, [uid]);

  // 2026-10-17 (Sumon): Load server-driven gift catalog from Firebase.
  // New gifts (like Pink Love) appear in display instead of "inactive".
  // 2026-10-17 (Sumon): realtime server gift catalog — new gifts appear instantly
  useEffect(() => {
    const unsub = onValue(ref(database, 'gift_catalog'), (snap) => {
      const catalog: Record<string, { name: string; coins: number; thumbnailUrl?: string }> = {};
      if (snap.exists()) {
        snap.forEach((child) => {
          const v = child.val();
          // Accept price OR coins (both are written by admin)
          const price = typeof v?.price === 'number' ? v.price : (typeof v?.coins === 'number' ? v.coins : null);
          if (v && v.name && price !== null) {
            catalog[child.key as string] = {
              name: v.name,
              coins: price,
              thumbnailUrl: v.thumbnailUrl || v.animationUrl,
            };
          }
        });
      }
      setServerCatalog(catalog);
    }, (e) => {
      // 2026-10-19 polish: a dead catalog listener must not leave the gift
      // display empty — fall back to the hardcoded catalog (mergedCatalog
      // below already prefers server entries when present).
      console.warn('[gifts] gift_catalog listener error:', (e as Error)?.message || e);
      setServerCatalog({});
    });
    return () => unsub();
  }, []);

  // Merged catalog: server gifts + hardcoded (server takes precedence).
  const mergedCatalog = useMemo(() => {
    const merged: Record<string, { emoji?: string; coins: number; name: string; thumbnailUrl?: string }> = {};
    for (const [id, g] of Object.entries(GIFT_CATALOG)) {
      merged[id] = { emoji: g.emoji, coins: g.coins, name: g.name };
    }
    for (const [id, g] of Object.entries(serverCatalog)) {
      merged[id] = { coins: g.coins, name: g.name, thumbnailUrl: g.thumbnailUrl };
    }
    return merged;
  }, [serverCatalog]);

  // ── Aggregations (real data only) ───────────────────────────────────────
  const receivedTxs = useMemo(
    () => txs.filter((t) => t && t.type === 'gift_received' && typeof t.giftId === 'string' && t.giftId.length > 0),
    [txs],
  );

  const giftCounts = useMemo(() => {
    // 2026-10-15 (Sumon): prefer lifetime aggregate (accurate forever).
    // Fall back to tx counting for users with no aggregate yet (legacy).
    let raw: Record<string, number>;
    if (Object.keys(lifetimeCounts).length > 0) {
      raw = lifetimeCounts;
    } else {
      raw = {};
      for (const t of receivedTxs) {
        raw[t.giftId] = (raw[t.giftId] ?? 0) + 1;
      }
    }
    // 2026-10-18 (Sumon): PERMANENT — merge legacy numeric IDs into canonical
    // string IDs. A user with {1: 2, heart: 1} shows as {heart: 3}.
    const merged: Record<string, number> = {};
    for (const [id, count] of Object.entries(raw)) {
      const canonical = resolveGiftId(id);
      merged[canonical] = (merged[canonical] ?? 0) + count;
    }
    return merged;
  }, [receivedTxs, lifetimeCounts]);

  const catalogEntries = useMemo(
    () =>
      Object.entries(giftCounts)
        .filter(([giftId]) => mergedCatalog[giftId])
        .sort((a, b) => {
          if (sortMode === 'value') {
            return mergedCatalog[b[0]].coins * b[1] - mergedCatalog[a[0]].coins * a[1];
          }
          return b[1] - a[1]; // quantity desc
        }),
    [giftCounts, sortMode, mergedCatalog],
  );

  const inactiveEntries = useMemo(
    () =>
      Object.entries(giftCounts)
        .filter(([giftId]) => !mergedCatalog[giftId])
        .sort((a, b) => b[1] - a[1]),
    [giftCounts, mergedCatalog],
  );

  const totalGifts = useMemo(
    () => Object.values(giftCounts).reduce((s, c) => s + c, 0),
    [giftCounts],
  );

  const totalCoins = useMemo(
    () =>
      Object.entries(giftCounts).reduce(
        (s, [giftId, c]) => s + (mergedCatalog[giftId] ? mergedCatalog[giftId].coins * c : 0),
        0,
      ),
    [giftCounts],
  );

  // Contributors: aggregate by sender uid. The api-server writes `fromUid`;
  // fall back to the typed `counterpartUid` for any legacy shape.
  // P2-3 (2026-10-12): rank by total diamond VALUE (price x count), not raw
  // gift count — a single 2000-diamond gift outranks ten 10-diamond gifts.
  const contributorList = useMemo<Contributor[]>(() => {
    const agg: Record<string, { count: number; value: number }> = {};
    for (const t of receivedTxs) {
      const raw = t as unknown as { fromUid?: unknown };
      const sender =
        (typeof raw.fromUid === 'string' && raw.fromUid.length > 0 ? raw.fromUid : null) ??
        (typeof t.counterpartUid === 'string' && t.counterpartUid.length > 0 ? t.counterpartUid : null);
      if (sender && sender !== uid) {
        const entry = agg[sender] ?? { count: 0, value: 0 };
        entry.count += 1;
        entry.value += Math.abs(typeof t.diamonds === 'number' ? t.diamonds : 0);
        agg[sender] = entry;
      }
    }
    return Object.entries(agg)
      .map(([senderUid, { count, value }]) => ({ uid: senderUid, count, value }))
      .sort((a, b) => b.value - a.value || b.count - a.count)
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

  const displayName = profile?.name || (isMe ? user?.displayName : (profile?.email ? profile.email.split('@')[0] : null)) || 'User';
  const photoURL = profile?.photoURL || (isMe ? user?.photoURL : undefined);

  const renderGiftCell = useCallback(
    ([giftId, count]: [string, number], dimmed: boolean) => {
      const info = mergedCatalog[giftId];
      return (
      <Pressable
        key={giftId}
        onPress={() => setPreviewGift({ giftId, count })}
        style={{ width: '25%', padding: 4, alignItems: 'center', opacity: dimmed ? 0.45 : 1 }}
      >
        <View
          style={{
            width: '100%',
            aspectRatio: 1,
            backgroundColor: C.tile,
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center' }}
        >
          {info?.thumbnailUrl ? (
            <Image source={{ uri: info.thumbnailUrl }} style={{ width: 48, height: 48, borderRadius: 8 }} contentFit="contain" cachePolicy="memory-disk" recyclingKey={giftId} />
          ) : (
            <Text style={{ fontSize: 36 }}>{info?.emoji ?? '🎁'}</Text>
          )}
        </View>
        <Text style={{ fontSize: 13, color: C.text, marginTop: 4, fontWeight: '600' }}>x{count}</Text>
      </Pressable>
      );
    },
    [mergedCatalog],
  );

  const previewInfo = previewGift ? mergedCatalog[previewGift.giftId] : undefined;

  if (!loaded) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
        <PremiumLoader size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <TitleBar title="Gifts" />

      {/* ── Summary card: DP + name + totals ── */}
      <View style={[cardStyle, { flexDirection: 'row', alignItems: 'center', padding: 15 }]}>
        {photoURL ? (
          <Image source={{ uri: photoURL }} style={{ width: 64, height: 64, borderRadius: 32 }} />
        ) : (
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 32,
              backgroundColor: C.blueLight,
              alignItems: 'center',
              justifyContent: 'center' }}
          >
            <Text style={{ fontSize: 26, fontWeight: '800', color: C.blue }}>{initials(displayName)}</Text>
          </View>
        )}
        <View style={{ marginLeft: 14, flex: 1 }}>
          <Text style={{ fontSize: 17, fontWeight: '600', color: C.text }} numberOfLines={1}>
            {displayName}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
            <Text style={{ fontSize: 13, color: C.muted }}>
              🎁 {totalGifts} gifts ·{' '}
            </Text>
            <DiamondIcon size={13} />
            <Text style={{ fontSize: 13, color: C.muted }}>
              {' '}{totalCoins.toLocaleString()} coins received
            </Text>
          </View>
        </View>
      </View>

      {/* ── Tabs ── */}
      <View style={[cardStyle, { padding: 4 }]}>
        <View style={{ flexDirection: 'row' }}>
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
                  backgroundColor: active ? C.blueLight : 'transparent',
                  alignItems: 'center' }}
              >
                <Text
                  style={{
                    fontSize: 15,
                    fontWeight: active ? '700' : '500',
                    color: active ? C.blue : C.muted }}
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
          {/* ── Gift collection card ── */}
          <View style={[cardStyle, { paddingBottom: 12 }]}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingHorizontal: 15,
                paddingTop: 14,
                paddingBottom: 6 }}
            >
              <Text style={{ fontSize: 16, fontWeight: '600', color: C.text }}>Gift Display</Text>
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
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 11 }}>
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
                    fontSize: 16,
                    fontWeight: '600',
                    color: C.text,
                    paddingHorizontal: 15,
                    paddingTop: 14,
                    paddingBottom: 6 }}
                >
                  Inactive Gifts
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 11 }}>
                  {inactiveEntries.map((e) => renderGiftCell(e, true))}
                </View>
              </>
            )}
          </View>
        </ScrollView>
      ) : (
        /* ── Gift Board ── */
        <View style={{ flex: 1, paddingBottom: 32 }}>
          <FlatList
            data={contributorList}
            keyExtractor={(c) => c.uid}
            renderItem={({ item, index }) => {
              const u = contributors[item.uid];
              // Name fallback: DB name → email prefix → 'User'.
              // (Google/Gmail users may have empty DB name.)
              const name = u?.name || (u?.email ? u.email.split('@')[0] : null) || 'User';
              return (
                <ContributorRow
                  rank={index}
                  name={name}
                  avatar={u?.photoURL || undefined}
                  count={item.count}
                  last={index === contributorList.length - 1}
                />
              );
            }}
            ListEmptyComponent={
              <View style={{ paddingVertical: 48, paddingHorizontal: 32, alignItems: 'center' }}>
                <Text style={{ fontSize: 40, marginBottom: 12 }}>🎁</Text>
                <Text style={{ fontSize: 16, fontWeight: '600', color: C.text }}>No contributors yet</Text>
                <Text style={{ fontSize: 13, color: C.muted, marginTop: 6, textAlign: 'center' }}>
                  When people send you gifts in voice rooms, they will appear here.
                </Text>
              </View>
            }
            showsVerticalScrollIndicator={false}
            windowSize={9}
            initialNumToRender={20}
            maxToRenderPerBatch={20}
            style={{
              backgroundColor: C.card, marginHorizontal: 15, marginTop: 12, borderRadius: 12,
              flexGrow: 0, maxHeight: '100%', overflow: 'hidden',
            }}
            contentContainerStyle={{ paddingVertical: 4, paddingHorizontal: 15 }}
          />
        </View>
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
              backgroundColor: C.card,
              borderRadius: 12,
              borderWidth: 0.5,
              borderColor: C.border,
              shadowColor: '#000',
              shadowOpacity: 0.12,
              shadowRadius: 8,
              elevation: 4,
              minWidth: 140 }}
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
                    color: sortMode === m ? C.blue : C.text }}
                >
                  {m === 'quantity' ? 'By quantity' : 'By value'}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      {/* ── Gift preview bottom sheet (imo-style): big image + name + diamond price + x count ── */}
      <Modal
        visible={!!previewGift}
        transparent
        animationType="slide"
        onRequestClose={() => setPreviewGift(null)}
      >
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
          <Pressable
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            onPress={() => setPreviewGift(null)}
          />
          <View
            style={{
              backgroundColor: C.card,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              paddingTop: 10,
              paddingBottom: 36,
              paddingHorizontal: 24,
              alignItems: 'center' }}
          >
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, marginBottom: 18 }} />
            {previewInfo?.thumbnailUrl ? (
              <Image source={{ uri: previewInfo.thumbnailUrl }} style={{ width: 160, height: 160, borderRadius: 16 }} resizeMode="contain" />
            ) : (
              <Text style={{ fontSize: 96 }}>{previewInfo?.emoji ?? '🎁'}</Text>
            )}
            <Text style={{ fontSize: 18, fontWeight: '700', color: C.text, marginTop: 12 }}>
              {previewInfo?.name ?? 'Inactive gift'}
            </Text>
            {previewInfo && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 }}>
                <DiamondIcon size={16} />
                <Text style={{ fontSize: 16, fontWeight: '700', color: C.goldText }}>
                  {previewInfo.coins} diamonds
                </Text>
              </View>
            )}
            {previewGift && (
              <Text style={{ fontSize: 14, color: C.muted, marginTop: 4 }}>
                ×{previewGift.count} received
              </Text>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
