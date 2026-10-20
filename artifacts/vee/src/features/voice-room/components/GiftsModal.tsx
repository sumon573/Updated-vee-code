/**
 * GiftsModal.tsx — IMO gift panel, exact rebuild (2026-10-19, boss order: হুবহু).
 *
 * IMO spec (from APK v2026.09.1051, BIUI tokens):
 * - White bottom sheet, 20dp top corner radius, slide-up
 * - 240dp photographic header (centerCrop) with close button
 * - Tabs: Hot / Rank / Recent / Event — active = dark text + 26x3.5dp #05b5fa underline
 * - 4-column grid, 64dp tiles (#f4f5f5, ~18dp radius), 12sp names (#8f9091)
 * - Footer: diamond balance + top-up, count stepper (- xN +), gradient Send
 *   button (#ccebff -> #66c4ff, text #002c47)
 *
 * Behavior (IMO, from jadx):
 * - ComboState: same gift re-sent within the window stacks xN
 * - Big gifts (>= 2000) trigger the room-wide broadcast banner
 * - Fullscreen animation plays for premium gifts (WebP via expo-image)
 *
 * Preserved Vee logic (untouched): server-driven gift_catalog, idempotency
 * keys (no double-charge), parallel multi-recipient sends, balance pre-check,
 * self-gift routing, giftFeed push, 70/30 commission via walletService,
 * gift-only-inside-rooms.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, Alert, Pressable, Modal, Image,
  FlatList, Dimensions,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import PremiumLoader from '@/src/components/PremiumLoader';
import { getErrorCause } from '@/src/utils/errorDisplay';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { ref, push, serverTimestamp } from 'firebase/database';
import { database } from '@/src/config/firebase';
import { Participant, GiftSentInfo } from '../types/room';
import {
  sendGift, getBalance, getWalletBalance,
  InsufficientFundsError, NetworkError,
} from '@/src/features/wallet/walletService';
import {
  fetchGiftCatalog, subscribeGiftCatalog, CatalogGift,
} from '../services/giftCatalogService';

/* ── IMO tokens ─────────────────────────────────────────────── */
const IMO_BLUE = '#05b5fa';
const IMO_SHEET = '#ffffff';
const IMO_TILE = '#f4f5f5';
const IMO_SUB = '#8f9091';
const IMO_TITLE = '#1a1a1a';
const IMO_SEND_FROM = '#ccebff';
const IMO_SEND_TO = '#66c4ff';
const IMO_SEND_TEXT = '#002c47';
const HEADER_H = 240;
// IMO promo header — animated blast artwork on Vee's own VPS
const HEADER_IMG = 'https://vee-club.duckdns.org/gifts/imo-blast-2418.webp';
// IMO big-gift broadcast threshold (server decides in IMO; Vee: blast tier)
const BIG_GIFT_COINS = 2000;
const MAX_RECIPIENTS = 10;
const MAX_QTY = 99;
const COMBO_WINDOW_MS = 6000;

/** Compact counts — boss standard: 1k / 10k / 100k / 1m / 1b (lowercase). */
function formatCompact(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const trim = (v: number) =>
    v >= 100 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, '');
  if (n >= 1e9) return trim(n / 1e9) + 'b';
  if (n >= 1e6) return trim(n / 1e6) + 'm';
  if (n >= 1e3) return trim(n / 1e3) + 'k';
  return String(Math.floor(n));
}

/* ── Types ──────────────────────────────────────────────────── */

interface GiftItem {
  id: string;
  nameKey: string;
  coins: number;
  category: string;
  thumbnailUrl?: string;
  animationUrl?: string;
  animationType?: string;
  videoSize?: number;
  videoFullscreen?: boolean;
  /** Minimum SVIP tier required (IMO: "Available to SVIP %d or above") */
  minSvipLevel?: number;
  /** Minimum noble rank index (0-based, NOBLE_RANKS) required to send */
  minNobleRank?: number;
}

function catalogToGiftItem(cg: CatalogGift): GiftItem {
  return {
    id: cg.id,
    nameKey: cg.name,
    coins: cg.price,
    category: cg.category,
    thumbnailUrl: cg.thumbnailUrl,
    animationUrl: cg.animationUrl,
    animationType: cg.animationType,
    videoSize: cg.videoSize,
    videoFullscreen: cg.videoFullscreen,
    minSvipLevel: cg.minSvipLevel,
    minNobleRank: cg.minNobleRank,
  };
}

type ImoTab = 'hot' | 'rank' | 'recent' | 'event';

/* ── Component ──────────────────────────────────────────────── */

export function GiftsModal({
  visible, onClose, onGiftSent, members, initialRecipient,
  walletBalance, myUid, myName, roomId }: {
  visible: boolean;
  onClose: () => void;
  /** Called immediately after a successful gift send — for the room fly animation */
  onGiftSent: (info: GiftSentInfo) => void;
  members: Participant[];
  initialRecipient?: Participant | null;
  /** Real-time wallet balance from Firebase subscription */
  walletBalance: number;
  myUid: string;
  myName: string;
  roomId?: string;
}) {
  const { t } = useTranslation();
  const [sending, setSending] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedGift, setSelectedGift] = useState<GiftItem | null>(null);
  // IMO stepper: 1..99
  const [quantity, setQuantity] = useState<number>(1);
  const [activeTab, setActiveTab] = useState<ImoTab>('hot');
  const [serverGifts, setServerGifts] = useState<GiftItem[]>([]);
  const [giftsLoading, setGiftsLoading] = useState(true);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  /** Sender's active SVIP tier (0 = none) — for SVIP-gated gifts. */
  const [mySvipTier, setMySvipTier] = useState(0);
  /** Sender's noble rank index (-1 = none) — for noble-gated gifts. */
  const [myNobleRank, setMyNobleRank] = useState(-1);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { getActiveSvipTier } = await import('@/src/features/svip/svipKickService');
        const tier = await getActiveSvipTier(myUid);
        if (!cancelled) setMySvipTier(tier);
      } catch { /* non-critical — treated as no SVIP */ }
      try {
        const { getNobleState } = await import('@/src/services/nobleService');
        const noble = await getNobleState(myUid);
        if (!cancelled) setMyNobleRank(noble && noble.rankIndex >= 0 ? noble.rankIndex : -1);
      } catch { /* non-critical — treated as no noble rank */ }
    })();
    return () => { cancelled = true; };
  }, [myUid, visible]);

  useEffect(() => {
    if (visible) {
      setSending(false);
      setSelectedGift(null);
      setQuantity(1);
      setActiveTab('hot');
      setPickerOpen(false);
      if (initialRecipient) setSelected([initialRecipient.id]);
      else setSelected([]);
      AsyncStorage.getItem(`recentGifts:${myUid}`)
        .then((v) => { if (v) { try { setRecentIds(JSON.parse(v)); } catch { /* ignore */ } } })
        .catch(() => {});
    }
  }, [visible, initialRecipient?.id, myUid]);

  // Server-driven catalog (single source of truth)
  useEffect(() => {
    let unsub: (() => void) | null = null;
    const load = async () => {
      setGiftsLoading(true);
      try {
        const catalog = await fetchGiftCatalog();
        const items = catalog
          .filter((cg) => cg.thumbnailUrl && cg.price > 0)
          .map(catalogToGiftItem);
        setServerGifts(items);
      } catch (e) {
        console.warn('[GiftsModal] catalog fetch failed:', e);
        setServerGifts([]);
      } finally {
        setGiftsLoading(false);
      }
    };
    load();
    unsub = subscribeGiftCatalog((catalog) => {
      const items = catalog
        .filter((cg) => cg.thumbnailUrl && cg.price > 0)
        .map(catalogToGiftItem);
      setServerGifts(items);
      setGiftsLoading(false);
    });
    return () => { if (unsub) unsub(); };
  }, []);

  const getVisibleGifts = useCallback((): GiftItem[] => {
    switch (activeTab) {
      case 'rank':
        return [...serverGifts].sort((a, b) => b.coins - a.coins);
      case 'recent': {
        const map = new Map(serverGifts.map((g) => [g.id, g]));
        return recentIds.map((id) => map.get(id)).filter((g): g is GiftItem => !!g);
      }
      case 'event':
        return serverGifts.filter((g) => g.category === 'event');
      case 'hot':
      default:
        return [...serverGifts].sort((a, b) => a.coins - b.coins);
    }
  }, [activeTab, serverGifts, recentIds]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= MAX_RECIPIENTS) return prev;
      return [...prev, id];
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const removeRecipient = (id: string) => {
    setSelected((prev) => prev.filter((x) => x !== id));
  };

  const selectedMembers = members.filter((m) => selected.includes(m.id));

  const bumpRecent = useCallback((giftId: string) => {
    setRecentIds((prev) => {
      const next = [giftId, ...prev.filter((id) => id !== giftId)].slice(0, 12);
      AsyncStorage.setItem(`recentGifts:${myUid}`, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, [myUid]);

  /* ── Send (IMO: tap Send → sends immediately, no confirm dialog) ── */
  const handleSend = async () => {
    const g = selectedGift;
    if (!g || selectedMembers.length === 0 || sending) return;

    // SVIP gating (IMO: "Available to SVIP %d or above" / "Cannot send because you are not SVIP")
    if (g.minSvipLevel && g.minSvipLevel > 0 && mySvipTier < g.minSvipLevel) {
      Alert.alert(
        'SVIP Gift',
        g.minSvipLevel === 1
          ? 'Cannot send because you are not SVIP.'
          : `Available to SVIP ${g.minSvipLevel} or above.`,
      );
      return;
    }

    // Noble gating (IMO noble exclusive gifts)
    if (g.minNobleRank != null && g.minNobleRank >= 0 && myNobleRank < g.minNobleRank) {
      try {
        const { NOBLE_RANKS } = await import('@/src/services/nobleService');
        const rankName = NOBLE_RANKS[g.minNobleRank]?.name || 'Noble';
        Alert.alert('Noble Gift', `Available to ${rankName} or above.`);
      } catch {
        Alert.alert('Noble Gift', 'Available to noble members or above.');
      }
      return;
    }

    const totalCost = g.coins * quantity * selectedMembers.length;

    try {
      const { initializeWallet } = await import('@/src/features/wallet/walletService');
      await initializeWallet(myUid);
    } catch { /* non-critical — proceed with send attempt */ }

    // Balance pre-check (same source as the UI display)
    let effectiveBalance: number | null = null;
    try {
      effectiveBalance = await getWalletBalance(myUid);
    } catch { /* try next */ }
    if (effectiveBalance === null || effectiveBalance === 0) {
      try {
        const serverBal = await getBalance();
        if (serverBal > 0) effectiveBalance = serverBal;
      } catch { /* use prop */ }
    }
    if (effectiveBalance === null || effectiveBalance === 0) effectiveBalance = walletBalance;
    if (effectiveBalance !== null && effectiveBalance > 0 && effectiveBalance < totalCost) {
      Alert.alert(
        t('voiceRoom.gifts.notEnoughCoins'),
        t('voiceRoom.gifts.notEnoughCoinsMsg', { total: formatCompact(totalCost) }),
      );
      return;
    }

    const recipients = selectedMembers;
    setSending(true);
    let didSucceed = false;
    try {
      // Idempotency: ONE persisted key per (recipient, gift, unit) — a retry
      // reuses the same keys so the server dedupes instead of double-charging.
      const keys = new Map<string, string[]>();
      for (const r of recipients) {
        const unitKeys: string[] = [];
        for (let q = 0; q < quantity; q++) {
          const storeKey = `pendingGiftKey:${myUid}:${r.id}:${g.id}:q${q}`;
          let key: string | null = null;
          try {
            key = await AsyncStorage.getItem(storeKey);
          } catch { /* non-critical */ }
          if (!key) {
            key = Crypto.randomUUID();
            try {
              await AsyncStorage.setItem(storeKey, key);
            } catch { /* non-critical */ }
          }
          unitKeys.push(key);
        }
        keys.set(r.id, unitKeys);
      }
      const senderAvatar = members.find((m) => m.id === myUid)?.photoURL;

      const succeeded: Participant[] = [];
      const failed: { name: string; insufficient: boolean; error?: unknown }[] = [];

      const sendToRecipient = async (r: Participant) => {
        let recipientOk = true;
        let recipientErr: unknown = null;
        let recipientInsufficient = false;
        for (let q = 0; q < quantity; q++) {
          const key = keys.get(r.id)![q];
          let lastErr: unknown = null;
          let charged = false;
          for (let attempt = 0; attempt < 2 && !charged; attempt++) {
            try {
              await sendGift({
                toUid: r.id, giftId: g.id, idempotencyKey: key,
                toName: r.name, toPhotoURL: r.photoURL, price: g.coins,
              });
              charged = true;
            } catch (e) {
              lastErr = e;
              if (!(e instanceof NetworkError)) break;
            }
          }
          if (!charged) {
            recipientOk = false;
            recipientErr = lastErr;
            recipientInsufficient = lastErr instanceof InsufficientFundsError;
            break;
          }
          // Best-effort feed entry — fire and forget.
          if (roomId) {
            const entry: Record<string, unknown> = {
              fromUid: myUid,
              fromName: myName,
              toUid: r.id,
              toName: r.name,
              giftId: g.id,
              thumbnailUrl: g.thumbnailUrl,
              coins: g.coins,
              ts: serverTimestamp(),
            };
            if (senderAvatar) entry.fromAvatar = senderAvatar;
            if (r.photoURL) entry.toAvatar = r.photoURL;
            push(ref(database, `rooms/${roomId}/giftFeed`), entry).catch(() => {});
          }
        }
        if (recipientOk) {
          for (let q = 0; q < quantity; q++) {
            try {
              await AsyncStorage.removeItem(`pendingGiftKey:${myUid}:${r.id}:${g.id}:q${q}`);
            } catch { /* non-critical */ }
          }
          return { ok: true as const, recipient: r };
        }
        return { ok: false as const, recipient: r, error: recipientErr, insufficient: recipientInsufficient };
      };

      const results = await Promise.all(recipients.map((r) => sendToRecipient(r)));
      for (const res of results) {
        if (res.ok) succeeded.push(res.recipient);
        else failed.push({ name: res.recipient.name, insufficient: !!res.insufficient, error: res.error });
      }

      if (succeeded.length === 0) {
        const allInsufficient = failed.length > 0 && failed.every((f) => f.insufficient);
        const firstError = failed.find((f) => f.error)?.error;
        const cause = firstError ? getErrorCause(firstError) : 'Unknown';
        Alert.alert(
          allInsufficient ? t('voiceRoom.gifts.notEnoughCoins') : t('voiceRoom.screen.error'),
          allInsufficient
            ? t('voiceRoom.gifts.notEnoughCoinsMsg', { total: formatCompact(totalCost) })
            : `${t('voiceRoom.gifts.sendFailed')}\n\nReason: ${cause}`,
        );
        return;
      }

      if (failed.length > 0) {
        Alert.alert(
          t('voiceRoom.gifts.partialSendTitle'),
          t('voiceRoom.gifts.partialSendMsg', { names: failed.map((f) => f.name).join(', ') }),
        );
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      didSucceed = true;
      bumpRecent(g.id);
      // IMO: panel closes immediately; the room plays the fullscreen animation.
      onGiftSent({
        giftId: g.id,
        emoji: g.thumbnailUrl || '',
        giftName: g.nameKey,
        coins: g.coins,
        senderUid: myUid,
        senderName: myName,
        senderAvatar,
        recipients: succeeded.map((r) => ({ uid: r.id, name: r.name, photoURL: r.photoURL })),
        animationUrl: g.animationUrl,
        animationType: g.animationType,
        videoSize: g.videoSize,
        videoFullscreen: g.videoFullscreen,
      });
      onClose();
    } finally {
      if (!didSucceed) setSending(false);
    }
  };

  const roleLabelFor = (m: Participant) => {
    if (m.role === 'host') return t('voiceRoom.gifts.roleOwner');
    if (m.role === 'admin') return t('voiceRoom.gifts.roleAdmin');
    return t('voiceRoom.gifts.roleMember');
  };

  const totalCost = selectedGift ? selectedGift.coins * quantity * selected.length : 0;
  const canSend = !!selectedGift && selected.length > 0 && !sending;
  const screenW = Dimensions.get('window').width;

  const tabs: { id: ImoTab; label: string }[] = [
    { id: 'hot', label: t('voiceRoom.gifts.tabHot') },
    { id: 'rank', label: t('voiceRoom.gifts.tabRank') },
    { id: 'recent', label: t('voiceRoom.gifts.tabRecent') },
    { id: 'event', label: t('voiceRoom.gifts.tabEvent') },
  ];

  const renderGiftTile = ({ item: g }: { item: GiftItem }) => {
    const isSelected = selectedGift?.id === g.id;
    const svipLocked = !!g.minSvipLevel && g.minSvipLevel > 0 && mySvipTier < g.minSvipLevel;
    const nobleLocked = g.minNobleRank != null && g.minNobleRank >= 0 && myNobleRank < g.minNobleRank;
    const locked = svipLocked || nobleLocked;
    return (
      <Pressable
        onPress={() => {
          setSelectedGift(g);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }}
        disabled={sending}
        style={{
          width: (screenW - 40 - 24) / 4,
          alignItems: 'center',
          marginBottom: 14,
          opacity: locked ? 0.55 : 1,
        }}>
        <View style={{
          width: 64, height: 64, borderRadius: 18,
          backgroundColor: IMO_TILE,
          alignItems: 'center', justifyContent: 'center',
          borderWidth: isSelected ? 2 : 0,
          borderColor: isSelected ? IMO_BLUE : 'transparent',
          overflow: 'hidden',
        }}>
          {g.thumbnailUrl ? (
            <Image
              source={{ uri: g.thumbnailUrl }}
              style={{ width: 50, height: 50, borderRadius: 10 }}
              resizeMode="cover"
            />
          ) : (
            <Feather name="gift" size={26} color={IMO_SUB} />
          )}
          {locked && (
            <View style={{
              position: 'absolute', top: 2, right: 2,
              backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 8,
              paddingHorizontal: 4, paddingVertical: 1,
            }}>
              <Text style={{ color: '#FFD54F', fontSize: 9, fontWeight: '700' }}>
                {nobleLocked ? '♛' : `👑${g.minSvipLevel}`}
              </Text>
            </View>
          )}
        </View>
        <Text
          style={{ color: IMO_SUB, fontSize: 12, marginTop: 4, textAlign: 'center' }}
          numberOfLines={1}>
          {g.nameKey}
        </Text>
        <Text style={{ color: IMO_SUB, fontSize: 11, marginTop: 1 }}>
          💎{formatCompact(g.coins)}
        </Text>
      </Pressable>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }}
        onPress={onClose}
      />
      <View style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        backgroundColor: IMO_SHEET,
        borderTopLeftRadius: 20, borderTopRightRadius: 20,
        maxHeight: '88%', overflow: 'hidden',
      }}>
        {/* ── 240dp photo header — 2026-10-20 audit fix (boss's 11:35 report):
            the header was a FIXED 2418 promo image, so selecting Blossom or
            Heart still previewed the 5000💎 proposal scene. It now previews
            the SELECTED gift's own artwork (promo only before any selection). ── */}
        <View style={{ height: HEADER_H, backgroundColor: '#0b1622' }}>
          <ExpoImage
            key={selectedGift?.id || 'promo'}
            source={{ uri: selectedGift?.animationUrl || selectedGift?.thumbnailUrl || HEADER_IMG }}
            style={{ width: '100%', height: HEADER_H }}
            contentFit="cover"
          />
          <Pressable
            onPress={onClose}
            style={{
              position: 'absolute', top: 14, right: 14,
              width: 32, height: 32, borderRadius: 16,
              backgroundColor: 'rgba(0,0,0,0.45)',
              alignItems: 'center', justifyContent: 'center',
            }}>
            <Feather name="x" size={18} color="#fff" />
          </Pressable>
        </View>

        {/* ── Recipient bar ── */}
        <View style={{
          flexDirection: 'row', alignItems: 'center',
          paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4,
        }}>
          <Text style={{ color: IMO_SUB, fontSize: 13, fontWeight: '600', marginRight: 8 }}>
            {t('voiceRoom.gifts.toLabel')}
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {selectedMembers.map((m) => (
                <Pressable
                  key={m.id}
                  onPress={() => removeRecipient(m.id)}
                  style={{
                    flexDirection: 'row', alignItems: 'center',
                    backgroundColor: '#e8f7ff', borderRadius: 999,
                    paddingLeft: 4, paddingRight: 8, paddingVertical: 4,
                  }}>
                  {m.photoURL ? (
                    <Image source={{ uri: m.photoURL }} style={{ width: 24, height: 24, borderRadius: 12 }} />
                  ) : (
                    <View style={{
                      width: 24, height: 24, borderRadius: 12, backgroundColor: m.color + '55',
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Text style={{ color: m.color, fontSize: 11, fontWeight: '800' }}>{m.initials}</Text>
                    </View>
                  )}
                  <Text style={{ color: IMO_TITLE, fontSize: 12, fontWeight: '700', marginLeft: 6, maxWidth: 80 }} numberOfLines={1}>
                    {m.name || 'User'}
                  </Text>
                  <Feather name="x" size={12} color={IMO_SUB} style={{ marginLeft: 4 }} />
                </Pressable>
              ))}
              <Pressable
                onPress={() => setPickerOpen((v) => !v)}
                style={{
                  width: 32, height: 32, borderRadius: 16,
                  borderWidth: 1.5, borderStyle: 'dashed', borderColor: IMO_BLUE,
                  alignItems: 'center', justifyContent: 'center',
                }}>
                <Feather name={pickerOpen ? 'chevron-up' : 'plus'} size={16} color={IMO_BLUE} />
              </Pressable>
            </View>
          </ScrollView>
        </View>

        {/* ── Person picker (expandable) ── */}
        {pickerOpen && (
          <View style={{ maxHeight: 220, borderTopWidth: 1, borderTopColor: '#eef0f0', marginTop: 8 }}>
            <ScrollView showsVerticalScrollIndicator={false}>
              {members.map((m) => {
                const isSel = selected.includes(m.id);
                return (
                  <Pressable
                    key={m.id}
                    onPress={() => toggleSelect(m.id)}
                    style={{
                      flexDirection: 'row', alignItems: 'center',
                      paddingVertical: 10, paddingHorizontal: 20,
                      borderBottomWidth: 1, borderBottomColor: '#f4f5f5',
                    }}>
                    <View style={{
                      width: 40, height: 40, borderRadius: 20, marginRight: 12,
                      backgroundColor: m.color + '33', overflow: 'hidden',
                      alignItems: 'center', justifyContent: 'center',
                      borderWidth: 2, borderColor: isSel ? IMO_BLUE : 'transparent',
                    }}>
                      {m.photoURL ? (
                        <Image source={{ uri: m.photoURL }} style={{ width: 40, height: 40, borderRadius: 20 }} />
                      ) : (
                        <Text style={{ color: m.color, fontSize: 14, fontWeight: '800' }}>{m.initials}</Text>
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: IMO_TITLE, fontSize: 14, fontWeight: '700' }}>{m.name || 'User'}</Text>
                      <Text style={{ color: IMO_SUB, fontSize: 11, marginTop: 1 }}>{roleLabelFor(m)}</Text>
                    </View>
                    <View style={{
                      width: 22, height: 22, borderRadius: 11,
                      backgroundColor: isSel ? IMO_BLUE : 'transparent',
                      borderWidth: 1.5, borderColor: isSel ? IMO_BLUE : '#d5d8d8',
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      {isSel && <Feather name="check" size={12} color="#fff" />}
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}

        {/* ── IMO tabs: Hot / Rank / Recent / Event ── */}
        <View style={{
          flexDirection: 'row', paddingHorizontal: 20, marginTop: 10,
          borderBottomWidth: 1, borderBottomColor: '#eef0f0',
        }}>
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <Pressable
                key={tab.id}
                onPress={() => {
                  setActiveTab(tab.id);
                  setSelectedGift(null);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
                style={{ marginRight: 28, paddingBottom: 10, alignItems: 'center' }}>
                <Text style={{
                  fontSize: 14.5, fontWeight: active ? '700' : '400',
                  color: active ? IMO_TITLE : IMO_SUB,
                }}>
                  {tab.label}
                </Text>
                {active && (
                  <View style={{
                    position: 'absolute', bottom: 0,
                    width: 26, height: 3.5, borderRadius: 2, backgroundColor: IMO_BLUE,
                  }} />
                )}
              </Pressable>
            );
          })}
        </View>

        {/* ── 4-column gift grid ── */}
        <View style={{ paddingHorizontal: 20, paddingTop: 14, maxHeight: 300 }}>
          {giftsLoading ? (
            <View style={{ alignItems: 'center', paddingVertical: 40 }}>
              <PremiumLoader size="large" />
              <Text style={{ color: IMO_SUB, fontSize: 12, marginTop: 12 }}>
                {t('voiceRoom.gifts.loading')}
              </Text>
            </View>
          ) : getVisibleGifts().length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 40 }}>
              <Text style={{ color: IMO_SUB, fontSize: 13 }}>
                {t('voiceRoom.gifts.emptyCategory')}
              </Text>
            </View>
          ) : (
            <FlatList
              data={getVisibleGifts()}
              renderItem={renderGiftTile}
              keyExtractor={(g) => g.id}
              numColumns={4}
              showsVerticalScrollIndicator={false}
              extraData={selectedGift?.id}
            />
          )}
        </View>

        {/* ── IMO footer: balance + stepper + Send ── */}
        <View style={{
          flexDirection: 'row', alignItems: 'center',
          paddingHorizontal: 20, paddingVertical: 14,
          borderTopWidth: 1, borderTopColor: '#eef0f0',
          gap: 10,
        }}>
          {/* Balance + top-up */}
          <Pressable
            onPress={() => { onClose(); router.push('/profile/topup'); }}
            style={{
              flexDirection: 'row', alignItems: 'center',
              backgroundColor: IMO_TILE, borderRadius: 999,
              paddingHorizontal: 10, paddingVertical: 8, gap: 6,
            }}>
            <Text style={{ fontSize: 14 }}>💎</Text>
            <Text style={{ color: IMO_TITLE, fontSize: 13, fontWeight: '800' }}>
              {formatCompact(walletBalance)}
            </Text>
            <View style={{
              width: 20, height: 20, borderRadius: 10, backgroundColor: IMO_BLUE,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Feather name="plus" size={12} color="#fff" />
            </View>
          </Pressable>

          {/* IMO stepper: - xN + */}
          <View style={{
            flexDirection: 'row', alignItems: 'center',
            backgroundColor: IMO_TILE, borderRadius: 999,
            paddingHorizontal: 4, paddingVertical: 4,
          }}>
            <Pressable
              onPress={() => setQuantity((q) => Math.max(1, q - 1))}
              style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="minus" size={15} color={quantity > 1 ? IMO_TITLE : '#c9cdcd'} />
            </Pressable>
            <Pressable onPress={() => setQuantity((q) => (q >= MAX_QTY ? 1 : Math.min(MAX_QTY, q * 10)))}>
              <Text style={{ color: IMO_TITLE, fontSize: 14, fontWeight: '800', minWidth: 40, textAlign: 'center' }}>
                ×{quantity}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setQuantity((q) => Math.min(MAX_QTY, q + 1))}
              style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="plus" size={15} color={quantity < MAX_QTY ? IMO_TITLE : '#c9cdcd'} />
            </Pressable>
          </View>

          {/* IMO gradient Send */}
          <View style={{ flex: 1 }}>
            <Pressable onPress={handleSend} disabled={!canSend}>
              <LinearGradient
                colors={canSend ? [IMO_SEND_FROM, IMO_SEND_TO] : ['#e9ebeb', '#e9ebeb']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={{
                  borderRadius: 22, height: 46,
                  alignItems: 'center', justifyContent: 'center',
                }}>
                <Text style={{
                  color: canSend ? IMO_SEND_TEXT : '#a9adad',
                  fontSize: 16, fontWeight: '800',
                }}>
                  {sending ? '···' : t('voiceRoom.gifts.send')}
                </Text>
              </LinearGradient>
            </Pressable>
          </View>
        </View>
        <View style={{ height: 10 }} />
      </View>
    </Modal>
  );
}

export { COMBO_WINDOW_MS, BIG_GIFT_COINS };
