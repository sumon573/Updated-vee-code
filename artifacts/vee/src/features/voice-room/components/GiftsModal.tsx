import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Alert, Pressable, Modal, Image } from 'react-native';
import PremiumLoader from '@/src/components/PremiumLoader';
import { getErrorCause } from '@/src/utils/errorDisplay';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Crypto from 'expo-crypto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { ref, push, serverTimestamp } from 'firebase/database';
import { database } from '@/src/config/firebase';
import { C } from '../constants/theme';
import { Participant, GiftSentInfo } from '../types/room';
import { sendGift, getBalance, getWalletBalance, InsufficientFundsError, NetworkError } from '@/src/features/wallet/walletService';
import { fetchGiftCatalog, subscribeGiftCatalog, CatalogGift, GiftCategory as CatalogGiftCategory } from '../services/giftCatalogService';

/* ─────────────────────────── Gifts Modal ─────────────────────────── */

type GiftNameKey =
  | 'voiceRoom.gifts.giftHeart'
  | 'voiceRoom.gifts.giftRose'
  | 'voiceRoom.gifts.giftGift'
  | 'voiceRoom.gifts.giftDiamond'
  | 'voiceRoom.gifts.giftTrophy'
  | 'voiceRoom.gifts.giftRocket'
  | 'voiceRoom.gifts.giftCrown'
  | 'voiceRoom.gifts.giftFirework';

// 2026-10-16 (Sumon): PERMANENT — categories are server-driven, any string allowed
type GiftCategory = string;

interface GiftItem {
  id: string;
  emoji: string;
  nameKey: string;
  coins: number;
  category: GiftCategory;
  thumbnailUrl?: string;
  animationUrl?: string;
  animationType?: string;
  videoSize?: number;
  videoFullscreen?: boolean;
}

// Convert server CatalogGift to local GiftItem
function catalogToGiftItem(cg: CatalogGift): GiftItem {
  return {
    id: cg.id,
    emoji: '', // Server gifts use thumbnails, not emoji
    nameKey: cg.name, // Server gifts use direct names, not translation keys
    coins: cg.price,
    category: cg.category,
    thumbnailUrl: cg.thumbnailUrl,
    animationUrl: cg.animationUrl,
    animationType: cg.animationType,
    videoSize: cg.videoSize,
    videoFullscreen: cg.videoFullscreen,
  };
}

// 2026-10-16 (Sumon): Categorized gifts — Classic, Premium, Luxury.
// Tabs scroll horizontally, gifts scroll vertically per category.
// 2026-10-16 (Sumon): Categories generated dynamically from server.
// Known categories with pretty labels; unknown server categories get auto-labels.
const CATEGORY_LABELS: Record<string, string> = {
  all: '🌟 All',
  classic: 'Classic',
  premium: '👑 Premium',
  luxury: '💎 Luxury',
};

function getCategoryLabel(catId: string): string {
  return CATEGORY_LABELS[catId] || catId.charAt(0).toUpperCase() + catId.slice(1);
}

function getCategoryColor(catId: string): { bg: string; border: string } {
  // Known categories have brand colors; unknown get default
  switch (catId) {
    case 'premium': return { bg: '#FFD700', border: '#FFD700' };
    case 'luxury': return { bg: '#9D4EDD', border: '#C77DFF' };
    default: return { bg: '#007AFF', border: '#007AFF' };
  }
}

// 2026-10-16 (Sumon): Server-driven gifts — GIFTS now comes from RTDB `gift_catalog`.
// No hardcoded gifts. Server is the single source of truth.

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

  const [sent,     setSent]     = useState<string | null>(null);
  const [sending,  setSending]  = useState(false);
  const [step,     setStep]     = useState<'pick-person' | 'pick-gift'>('pick-gift');
  const [selected, setSelected] = useState<string[]>([]);
  /** 2-step send: user taps a gift to SELECT it (no auto-send), then taps
   *  the Send button and confirms. Prevents accidental wallet deductions. */
  const [selectedGift, setSelectedGift] = useState<GiftItem | null>(null);
  // 2026-10-17 (Sumon): Bulk send — quantity multiplier (1x, 5x, 10x, 20x, 50x)
  const [quantity, setQuantity] = useState<number>(1);
  // 2026-10-16 (Sumon): Category tabs — horizontal scroll, gifts vertical scroll
  const [activeCategory, setActiveCategory] = useState<string>('');
  // 2026-10-16 (Sumon): Server-driven gifts from RTDB gift_catalog
  const [serverGifts, setServerGifts] = useState<GiftItem[]>([]);
  const [giftsLoading, setGiftsLoading] = useState(true);
  // Auto-select first available category when server data loads
  // 2026-10-17 (Sumon): "All" tab is first — shows all gifts sorted by price (smallest first)
  useEffect(() => {
    if (serverGifts.length > 0) {
      const cats = Array.from(new Set(serverGifts.map(g => g.category)));
      // Auto-select if current is empty or not in available categories
      if (!activeCategory || (activeCategory !== 'all' && !cats.includes(activeCategory))) {
        setActiveCategory('all');
      }
    }
  }, [serverGifts, activeCategory]);

  // 2026-10-17 (Sumon): "All" tab — all gifts from all categories, sorted by price ascending
  const getVisibleGifts = (): GiftItem[] => {
    if (activeCategory === 'all') {
      return [...serverGifts].sort((a, b) => a.coins - b.coins);
    }
    return serverGifts.filter(g => g.category === activeCategory);
  };

  const getAllCategories = (): string[] => {
    const cats = Array.from(new Set(serverGifts.map(g => g.category)));
    const order: Record<string, number> = { classic: 0, premium: 1, luxury: 2, couple: 3, flowers: 4, 'vee-brand': 5, mini: 6 };
    cats.sort((a, b) => (order[a] ?? 100) - (order[b] ?? 100));
    return ['all', ...cats];
  };

  useEffect(() => {
    if (visible) {
      setSent(null);
      setSending(false);
      setSelectedGift(null);
      setQuantity(1);
      // 2026-10-17 (Sumon): Gift center opens directly — select gift first, then person
      if (initialRecipient) { setSelected([initialRecipient.id]); setStep('pick-person'); }
      else { setSelected([]); setStep('pick-gift'); }
    }
  }, [visible, initialRecipient?.id]);

  // 2026-10-16 (Sumon): Fetch server gift catalog
  useEffect(() => {
    let unsub: (() => void) | null = null;
    const load = async () => {
      setGiftsLoading(true);
      try {
        const catalog = await fetchGiftCatalog();
        // Only show gifts with thumbnails (no broken/demo visuals)
        const items = catalog
          .filter(cg => cg.thumbnailUrl && cg.price > 0)
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
    // Real-time updates
    unsub = subscribeGiftCatalog((catalog) => {
      const items = catalog
        .filter(cg => cg.thumbnailUrl && cg.price > 0)
        .map(catalogToGiftItem);
      setServerGifts(items);
      setGiftsLoading(false);
    });
    return () => { if (unsub) unsub(); };
  }, []);

  const toggleSelect = (id: string) => {
    setSelected((prev: string[]) => {
      if (prev.includes(id)) return prev.filter((x: string) => x !== id);
      // 2026-10-17 (Sumon): Max 10 recipients at once (including self)
      if (prev.length >= 10) return prev;
      return [...prev, id];
    });
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const selectedMembers = members.filter(m => selected.includes(m.id));

  /** 2-step send: confirm dialog before charging the wallet. */
  const confirmSend = () => {
    if (!selectedGift || sending) return;
    const g = selectedGift;
    const totalCost = g.coins * quantity * selectedMembers.length;
    Alert.alert(
      t('voiceRoom.gifts.confirmTitle'),
      t('voiceRoom.gifts.confirmMsg', {
        emoji: '',
        name: g.nameKey,
        total: totalCost,
        names: selectedMembers.map(m => m.name).join(', ') }),
      [
        { text: t('voiceRoom.gifts.cancel'), style: 'cancel' },
        {
          text: t('voiceRoom.gifts.send'),
          style: 'default',
          // M3 fix: guard against unexpected throws after diamonds may have
          // been charged (e.g. Crypto.randomUUID, onGiftSent callback).
          onPress: () => { handleSend(g).catch(() => {}); } },
      ],
    );
  };

  const handleSend = async (g: GiftItem) => {
    if (selectedMembers.length === 0 || sending) return;

    const totalCost = g.coins * quantity * selectedMembers.length;

    // ENSURE SERVER WALLET (2026-10-09): the server's send-gift endpoint
    // checks the SERVER-side balance. If /wallet/init never succeeded, the
    // server sees 0 even when Firebase shows 500. Initialize first.
    try {
      const { initializeWallet } = await import('@/src/features/wallet/walletService');
      await initializeWallet(myUid);
    } catch { /* non-critical — proceed with send attempt */ }

    // Balance pre-check: use Firebase (same source as the UI display).
    // Try a fresh one-shot read first; fall back to the server balance;
    // fall back to the subscribed prop last. If all fail, skip the pre-check
    // and let the server's InsufficientFundsError decide.
    // FIX (2026-10-09): the prop fallback must also cover the 0 case — if
    // Firebase returns 0 (missing node) and the server read fails, the old
    // `=== null` check skipped the prop and falsely blocked the user even
    // when the UI displayed a healthy balance.
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
    // H11 FIX: Skip pre-check if balance unknown — let server decide.
    // Old code falsely blocked when subscription hadn't loaded yet.
    if (effectiveBalance !== null && effectiveBalance > 0 && effectiveBalance < totalCost) {
      Alert.alert(
        t('voiceRoom.gifts.notEnoughCoins'),
        t('voiceRoom.gifts.notEnoughCoinsMsg', { total: totalCost }),
      );
      return;
    }

    // Self-gifting is allowed (net-zero): the sender is kept in the recipient
    // list and handled specially below — no server charge, just the feed
    // entry and animation. Balance is unchanged, which is the correct net
    // result of debiting + crediting the same account.
    const recipients = selectedMembers;

    if (recipients.length === 0) {
      Alert.alert('', t('voiceRoom.gifts.cantGiftSelf'));
      return;
    }

    setSending(true);
    // C2 fix: track success so finally doesn't re-enable the Send button
    // during the 1.6s success animation (would allow double-charge).
    let didSucceed = false;
    try {
      // Idempotency: ONE key per (recipient, gift, unit), PERSISTED across attempts.
      // 2026-10-12 audit fix (CRITICAL C2): keys were regenerated on every
      // handleSend(). If the app crashed after charge but before confirmation,
      // the retry used a NEW key → double-charge. Now: reuse the pending key
      // from AsyncStorage; clear it only on confirmed success.
      // 2026-10-19 (Sumon): units q>=1 used fresh random UUIDs that were NEVER
      // persisted — a crash after charging unit q but before its confirmation
      // double-charged that unit on retry (and the cleared q=0 key meant a
      // retry of a partially-failed recipient double-charged the units that
      // HAD succeeded). Now every unit's key is persisted BEFORE the loop,
      // and ALL of a recipient's keys are cleared only after the recipient's
      // FULL quantity succeeds — so a retry reuses the same keys and the
      // server dedupes instead of double-charging.
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
      const senderAvatar = members.find(m => m.id === myUid)?.photoURL;

      const succeeded: Participant[] = [];
      const failed: { name: string; insufficient: boolean; error?: unknown }[] = [];

      // 2026-10-17 (Sumon): PARALLEL sends — all recipients at once, not one-by-one
      const sendToRecipient = async (r: Participant): Promise<{ ok: boolean; recipient: Participant; error?: unknown; insufficient?: boolean }> => {
        // 2026-10-17 (Sumon): Bulk send — send quantity times per recipient
        let recipientOk = true;
        let recipientErr: unknown = null;
        let recipientInsufficient = false;
        for (let q = 0; q < quantity; q++) {
        // Persisted per-unit key — the SAME key is reused on retry so the
        // server dedupes instead of double-charging (see the C2 comment above).
        const key = keys.get(r.id)![q];
        let lastErr: unknown = null;
        let charged = false;
        // SELF-GIFT: route through server /send-gift (deduct-only).
        // C1 fix: client-side debitOwnWallet fails (rules .write:false),
        // so self-gifts go through the server like normal gifts.
        if (r.id === myUid) {
          // Fall through to the normal server path below (sends to self,
          // server debits without crediting).
        }
        // Retry once on network errors only, with the SAME idempotency key —
        // safe because the server dedupes on the key.
        for (let attempt = 0; attempt < 2 && !charged; attempt++) {
          try {
              await sendGift({ toUid: r.id, giftId: g.id, idempotencyKey: key, toName: r.name, toPhotoURL: r.photoURL, price: g.coins });
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
          break; // stop quantity loop for this recipient
        }
        // Best-effort feed entry — the gift is already charged. Fire and
        // forget: onGiftSent below must NOT wait for the RTDB echo.
        if (roomId) {
          const entry: Record<string, unknown> = {
            fromUid: myUid,
            fromName: myName,
            toUid: r.id,
            toName: r.name,
            giftId: g.id,
            thumbnailUrl: g.thumbnailUrl,
            coins: g.coins,
            ts: serverTimestamp() };
          if (senderAvatar) entry.fromAvatar = senderAvatar;
          if (r.photoURL) entry.toAvatar = r.photoURL;
          push(ref(database, `rooms/${roomId}/giftFeed`), entry).catch(() => {});
        }
        } // end quantity loop
        if (recipientOk) {
          // Full quantity confirmed — clear ALL of this recipient's persisted
          // unit keys so the next fresh send uses new keys. Recipients that
          // failed keep their keys: a retry reuses them and the server
          // dedupes instead of double-charging (2026-10-19, Sumon).
          for (let q = 0; q < quantity; q++) {
            try {
              await AsyncStorage.removeItem(`pendingGiftKey:${myUid}:${r.id}:${g.id}:q${q}`);
            } catch { /* non-critical */ }
          }
          return { ok: true, recipient: r };
        } else {
          return { ok: false, recipient: r, error: recipientErr, insufficient: recipientInsufficient };
        }
      };

      // Send to all recipients IN PARALLEL (not sequential)
      const results = await Promise.all(recipients.map(r => sendToRecipient(r)));
      for (const res of results) {
        if (res.ok) {
          succeeded.push(res.recipient);
        } else {
          failed.push({ name: res.recipient.name, insufficient: !!res.insufficient, error: res.error });
        }
      }

      if (succeeded.length === 0) {
        // Nothing went through — keep the modal open so the user can retry.
        const allInsufficient = failed.length > 0 && failed.every(f => f.insufficient);
        // Show actual cause (2026-10-10, Sumon's standing rule)
        const firstError = failed.find(f => f.error)?.error;
        const cause = firstError ? getErrorCause(firstError) : 'Unknown';
        Alert.alert(
          allInsufficient
            ? t('voiceRoom.gifts.notEnoughCoins')
            : t('voiceRoom.screen.error'),
          allInsufficient
            ? t('voiceRoom.gifts.notEnoughCoinsMsg', { total: totalCost })
            : `${t('voiceRoom.gifts.sendFailed')}\n\nReason: ${cause}`,
        );
        return;
      }

      if (failed.length > 0) {
        // Partial failure: successes stay — no rollback (idempotency makes a
        // manual retry of the missing recipients safe).
        Alert.alert(
          t('voiceRoom.gifts.partialSendTitle'),
          t('voiceRoom.gifts.partialSendMsg', { names: failed.map(f => f.name).join(', ') }),
        );
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSent(g.thumbnailUrl || g.nameKey);
      didSucceed = true; // C2: keep sending=true until modal closes
      onGiftSent({
        giftId: g.id,
        emoji: g.thumbnailUrl || '',
        giftName: g.nameKey,
        coins: g.coins,
        senderUid: myUid,
        senderName: myName,
        senderAvatar,
        recipients: succeeded.map(r => ({ uid: r.id, name: r.name, photoURL: r.photoURL })),
        animationUrl: g.animationUrl,
        animationType: g.animationType,
        videoSize: g.videoSize,
        videoFullscreen: g.videoFullscreen });
      setTimeout(() => { setSent(null); setSending(false); onClose(); }, 1600);
    } finally {
      // A throw anywhere above (e.g. inside the loop) must never leave the
      // spinner stuck or produce an unhandled rejection.
      // C2 fix: on success, keep sending=true until onClose (prevents
      // double-tap double-charge during the 1.6s animation).
      if (!didSucceed) {
        setSending(false);
      }
    }
  };

  const roleLabelFor = (m: Participant) => {
    if (m.role === 'host') return t('voiceRoom.gifts.roleOwner');
    if (m.role === 'admin') return t('voiceRoom.gifts.roleAdmin');
    return t('voiceRoom.gifts.roleMember');
  };

  const headerTitle = step === 'pick-person'
    ? t('voiceRoom.gifts.storeTitle')
    : selectedMembers.length > 0
      ? t('voiceRoom.gifts.sendTo', { names: selectedMembers.map(m => m.name).join(', ') })
      : t('voiceRoom.gifts.storeTitle');

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={onClose} />
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0,
        backgroundColor: '#0F0A1E', borderTopLeftRadius: 26, borderTopRightRadius: 26,
        padding: 20, borderWidth: 1, borderColor: C.border }}>
        <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: C.muted,
          alignSelf: 'center', marginBottom: 16 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
          {step === 'pick-person' && !initialRecipient && (
            <Pressable onPress={() => setStep('pick-gift')} style={{ marginRight: 10 }}>
              <Feather name="arrow-left" size={20} color={C.sub} />
            </Pressable>
          )}
          <Text style={{ flex: 1, color: C.text, fontSize: 16, fontWeight: '900' }} numberOfLines={1}>
            {headerTitle}
          </Text>
          {/* Real wallet balance display */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5,
            backgroundColor: C.gold + '22', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, marginRight: 10 }}>
            <Text style={{ fontSize: 13 }}>💎</Text>
            <Text style={{ color: C.gold, fontSize: 13, fontWeight: '800' }}>
              {walletBalance.toLocaleString()}
            </Text>
          </View>
          <Pressable onPress={onClose}><Feather name="x" size={22} color={C.sub} /></Pressable>
        </View>

        {step === 'pick-person' && (
          <>
            <Text style={{ color: C.sub, fontSize: 12, marginBottom: 12 }}>
              {t('voiceRoom.gifts.selectUp', { selected: selected.length })}
            </Text>
            <ScrollView style={{ maxHeight: 280 }} showsVerticalScrollIndicator={false}>
              {/* 2026-10-13 (Sumon-এর নিয়ম): gift anyone — seated + audience,
                  self সহ। আগে self ফিল্টার করা ছিল। */}
              {members.map(m => {
                const isSel = selected.includes(m.id);
                return (
                  <Pressable key={m.id} onPress={() => toggleSelect(m.id)}
                    style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
                      borderBottomWidth: 1, borderBottomColor: C.borderFaint }}>
                    <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: m.color + '33',
                      alignItems: 'center', justifyContent: 'center', borderWidth: 2,
                      borderColor: isSel ? m.color : m.color + '55', marginRight: 12, overflow: 'hidden' }}>
                      {m.photoURL ? (
                        <Image source={{ uri: m.photoURL }} style={{ width: 44, height: 44, borderRadius: 22 }} />
                      ) : (
                        <Text style={{ color: m.color, fontSize: 15, fontWeight: '800' }}>{m.initials}</Text>
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: C.text, fontSize: 14, fontWeight: '700' }}>{m.name || 'User'}</Text>
                      <Text style={{ color: C.muted, fontSize: 11, marginTop: 1 }}>
                        {roleLabelFor(m)}
                      </Text>
                    </View>
                    <View style={{ width: 24, height: 24, borderRadius: 12,
                      backgroundColor: isSel ? C.primary : 'transparent',
                      borderWidth: 2, borderColor: isSel ? C.primary : C.muted,
                      alignItems: 'center', justifyContent: 'center' }}>
                      {isSel && <Feather name="check" size={13} color={C.text} />}
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
            {/* 2026-10-17 (Sumon): Send button — after selecting gift then person */}
            <Pressable onPress={confirmSend}
              disabled={selected.length === 0 || !selectedGift || sending}
              style={{ marginTop: 16, backgroundColor: selected.length > 0 && selectedGift ? C.gold : C.muted,
                borderRadius: 16, paddingVertical: 14, alignItems: 'center',
                shadowColor: C.gold, shadowOpacity: 0.4, shadowRadius: 8,
                shadowOffset: { width: 0, height: 2 } }}>
              <Text style={{ color: '#fff', fontWeight: '900', fontSize: 15 }}>
                {selectedGift && selected.length > 0
                  ? `${t('voiceRoom.gifts.send')} ${selectedGift.nameKey} · 💎 ${selectedGift.coins * quantity * selected.length}`
                  : t('voiceRoom.gifts.selectFirst')}
              </Text>
            </Pressable>
          </>
        )}

        {step === 'pick-gift' && (
          <>
            {sent && (
              <View style={{ position: 'absolute', top: 60, left: 0, right: 0,
                alignItems: 'center', zIndex: 10 }}>
                {sent.startsWith('http') ? (
                  <Image source={{ uri: sent }} style={{ width: 72, height: 72, borderRadius: 12 }} />
                ) : (
                  <Text style={{ fontSize: 72 }}>{sent}</Text>
                )}
              </View>
            )}
            {sending && (
              <View style={{ position: 'absolute', top: 60, left: 0, right: 0,
                alignItems: 'center', zIndex: 10 }}>
                <PremiumLoader size="large" />
              </View>
            )}
            {/* 2026-10-16 (Sumon): Category tabs — premium polished */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false}
              style={{ marginBottom: 14 }}>
              <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 2, paddingVertical: 2 }}>
                {getAllCategories().map(catId => {
                  const isActive = activeCategory === catId;
                  const colors = getCategoryColor(catId);
                  const activeBg = colors.bg;
                  const activeBorder = colors.border;
                  return (
                    <Pressable key={catId} onPress={() => {
                      setActiveCategory(catId);
                      setSelectedGift(null);
      setQuantity(1);
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }}
                      style={{
                        paddingHorizontal: 20, paddingVertical: 12, borderRadius: 20,
                        justifyContent: 'center', alignItems: 'center', minHeight: 40,
                        backgroundColor: isActive ? activeBg : C.card,
                        borderWidth: isActive ? 1.5 : 1,
                        borderColor: isActive ? activeBorder : C.borderFaint,
                        shadowColor: isActive ? activeBg : 'transparent',
                        shadowOpacity: isActive ? 0.35 : 0,
                        shadowRadius: isActive ? 8 : 0,
                        shadowOffset: { width: 0, height: 2 },
                        elevation: isActive ? 4 : 0,
                      }}>
                      <Text style={{
                        color: isActive ? '#fff' : C.sub,
                        fontSize: 13, fontWeight: isActive ? '800' : '600',
                        letterSpacing: 0.3,
                      }}>
                        {getCategoryLabel(catId)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
            {/* Gifts grid — vertical scroll per category (server-driven) */}
            <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
            {giftsLoading ? (
              <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                <PremiumLoader size="large" />
                <Text style={{ color: C.muted, fontSize: 12, marginTop: 12 }}>
                  {t('voiceRoom.gifts.loading')}
                </Text>
              </View>
            ) : getVisibleGifts().length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                <Text style={{ color: C.muted, fontSize: 13 }}>
                  {t('voiceRoom.gifts.emptyCategory')}
                </Text>
              </View>
            ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between',
              opacity: sending ? 0.4 : 1 }}>
              {getVisibleGifts().map(g => {
                const isSelected = selectedGift?.id === g.id;
                return (
                  <Pressable key={g.id}
                    onPress={() => {
                      setSelectedGift(g);
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }}
                    disabled={sending}
                    style={{ width: '22%', backgroundColor: isSelected ? C.gold + '33' : C.card,
                      borderRadius: 14, padding: 10, alignItems: 'center',
                      borderWidth: isSelected ? 2 : 1,
                      borderColor: isSelected ? C.gold : C.borderFaint }}>
                    {g.thumbnailUrl ? (
                      <Image source={{ uri: g.thumbnailUrl }} style={{ width: 48, height: 48, borderRadius: 8 }}
                        resizeMode="cover" />
                    ) : (
                      <View style={{ width: 48, height: 48, borderRadius: 8, backgroundColor: C.borderFaint,
                        alignItems: 'center', justifyContent: 'center' }}>
                        <Feather name="gift" size={24} color={C.muted} />
                      </View>
                    )}
                    <Text style={{ color: C.text, fontSize: 10, fontWeight: '700', marginTop: 4 }} numberOfLines={1}>
                      {g.nameKey}
                    </Text>
                    <Text style={{ color: C.gold, fontSize: 10, marginTop: 2 }}>
                      💎 {selectedMembers.length > 1 ? `${g.coins}×${selectedMembers.length}` : g.coins}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            )}
            </ScrollView>
            {/* 2026-10-17 (Sumon): Quantity selector — bulk send 1x to 50x */}
            {selectedGift && !sending && (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 12, gap: 8 }}>
                <Text style={{ color: C.sub, fontSize: 13, fontWeight: '700' }}>Qty:</Text>
                {[1, 2, 5, 10, 20, 50].map(q => (
                  <Pressable key={q} onPress={() => { setQuantity(q); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
                    style={{
                      paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12,
                      backgroundColor: quantity === q ? C.gold : C.card,
                      borderWidth: 1, borderColor: quantity === q ? C.gold : C.borderFaint,
                    }}>
                    <Text style={{ color: quantity === q ? '#fff' : C.sub, fontSize: 12, fontWeight: quantity === q ? '800' : '600' }}>
                      {q}x
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
            {/* 2026-10-17 (Sumon): Next button — select gift first, then person */}
            {selectedGift && !sending && (
              <Pressable onPress={() => setStep('pick-person')}
                style={{ marginTop: 14, backgroundColor: C.pink, borderRadius: 14,
                  paddingVertical: 14, alignItems: 'center',
                  shadowColor: C.pink, shadowOpacity: 0.4, shadowRadius: 8,
                  shadowOffset: { width: 0, height: 2 } }}>
                <Text style={{ color: '#fff', fontWeight: '900', fontSize: 15 }}>
                  {t('voiceRoom.gifts.next')} → {selectedGift.nameKey} {quantity > 1 ? `(${quantity}x)` : ''} · 💎 {selectedGift.coins * quantity}
                </Text>
              </Pressable>
            )}
          </>
        )}
        <Pressable onPress={onClose} style={{ marginTop: 14, paddingVertical: 10, alignItems: 'center' }}>
          <Text style={{ color: C.muted }}>{t('voiceRoom.gifts.close')}</Text>
        </Pressable>
      </View>
    </Modal>
  );
}
