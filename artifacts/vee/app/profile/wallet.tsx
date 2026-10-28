/**
 * Wallet Screen — Diamond balance + transaction history
 * Real-time data from Firebase via walletService
 * 2026-10-19 (Sumon): restyled to IMO Me-tab design language —
 * #F4F5F5 bg, white 12dp cards, 56dp title bar. All logic untouched.
 */

import { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, Platform } from 'react-native';
import PremiumLoader from '@/src/components/PremiumLoader';
import { DiamondIcon } from '@/src/components/DiamondIcon';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuth } from '@/src/context/AuthContext';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  subscribeWalletBalance,
  subscribeTransactionHistory,
  WalletTransaction } from '@/src/features/wallet/walletService';
import { useTranslation } from 'react-i18next';

// IMO BIUI light tokens (matches app/profile/index.tsx) + boss button standard
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
  red: '#FF3B30' } as const;

// IMO card container: white, 12dp radius, 15dp side margins
const cardStyle = { backgroundColor: C.card, marginHorizontal: 15, marginTop: 12, borderRadius: 12 } as const;

// IMO title bar: 56dp, back left, 17sp semibold title centered, NO gear on inner screens
function TitleBar({ title }: { title: string }) {
  const topPad = Platform.OS === 'web' ? 67 : 0;
  return (
    <View style={{ backgroundColor: C.card, paddingTop: topPad }}>
      <View style={{ height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 }}>
        <Pressable onPress={() => router.back()} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }} hitSlop={8}>
          <Feather name="chevron-left" size={24} color={C.text} />
        </Pressable>
        <Text style={{ flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600', color: C.text }} numberOfLines={1}>
          {title}
        </Text>
        <View style={{ width: 40 }} />
      </View>
    </View>
  );
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function TransactionItem({ tx, last }: { tx: WalletTransaction; last?: boolean }) {
  // FIX (2026-10-10): Wallet history shows ONLY diamond recharges (Sumon's
  // order). Gift transactions live on the Profile gift history section.
  const isRecharge = tx.type === 'recharge';
  const isReceived = tx.type === 'gift_received';
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 15 }}>
        {/* 30dp rounded-square icon tile (IMO) */}
        <View style={{
          width: 30, height: 30, borderRadius: 8,
          backgroundColor: isRecharge ? C.blueLight : isReceived ? '#E6F7ED' : C.tile,
          alignItems: 'center', justifyContent: 'center',
          marginRight: 12 }}>
          {tx.emoji
            ? <Text style={{ fontSize: 15 }}>{tx.emoji}</Text>
            : isRecharge
              ? <DiamondIcon size={15} />
              : <Text style={{ fontSize: 15 }}>🎁</Text>}
        </View>

        {/* Info */}
        <View style={{ flex: 1 }}>
          <Text style={{ color: C.text, fontSize: 16 }} numberOfLines={1}>
            {isRecharge ? 'Diamond Recharge' : tx.giftName}
          </Text>
          <Text style={{ color: C.muted, fontSize: 14, marginTop: 2 }} numberOfLines={1}>
            {isRecharge ? '⬇ Top-up' : isReceived ? '⬇ From' : '⬆ To'} {isRecharge ? '' : tx.counterpartName}
          </Text>
          <Text style={{ color: C.mutedLight, fontSize: 12, marginTop: 2 }}>
            {formatDate(tx.ts)}
          </Text>
        </View>

        {/* Amount */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <Text style={{
            fontSize: 16, fontWeight: '800',
            color: (isRecharge || isReceived) ? C.green : C.muted }}>
            {(isRecharge || isReceived) ? '+' : '-'}{Math.abs(tx.diamonds)}
          </Text>
          <DiamondIcon size={14} />
        </View>
      </View>
      {!last && <View style={{ height: 0.5, backgroundColor: C.border, marginLeft: 57 }} />}
    </View>
  );
}

// 2026-10-28 (boss: app-wide instant-load law) — cached-first wallet.
// The balance + history render from the last-known values instantly; the
// live subscriptions overwrite them when they deliver. The cache is
// DISPLAY-ONLY: no spending decision anywhere reads this screen's state —
// money truth stays Firebase via walletService.
const walletBalanceCacheKey = (uid: string) => `vee_wallet_balance_v1:${uid}`;
const walletTxsCacheKey = (uid: string) => `vee_wallet_txs_v1:${uid}`;

export default function WalletScreen() {
  const { user } = useAuth();
  const { t } = useTranslation();

  const [balance, setBalance] = useState<number | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [loadingBalance, setLoadingBalance] = useState(true);
  const [loadingTxs, setLoadingTxs] = useState(true);

  // Subscribe to real-time balance (cached-first: last-known balance
  // renders instantly, live value overwrites it when it arrives).
  useEffect(() => {
    if (!user?.uid) return;
    const key = walletBalanceCacheKey(user.uid);
    AsyncStorage.getItem(key).then((raw) => {
      if (raw == null) return;
      const n = Number(raw);
      if (!Number.isNaN(n)) {
        setBalance(n);
        setLoadingBalance(false);
      }
    }).catch(() => {});
    const unsub = subscribeWalletBalance(user.uid, (bal) => {
      setBalance(bal);
      setLoadingBalance(false);
      AsyncStorage.setItem(key, String(bal)).catch(() => {});
    });
    // Offline safety: never spin the inline loader forever on a cold,
    // offline start. Same 3s timeout pattern as app/chat/index.tsx.
    const timeout = setTimeout(() => setLoadingBalance(false), 3000);
    return () => { clearTimeout(timeout); unsub(); };
  }, [user?.uid]);

  // Subscribe to transaction history (cached-first, same pattern).
  useEffect(() => {
    if (!user?.uid) return;
    const key = walletTxsCacheKey(user.uid);
    AsyncStorage.getItem(key).then((raw) => {
      if (raw == null) return;
      try {
        const parsed = JSON.parse(raw) as WalletTransaction[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setTransactions(parsed);
          setLoadingTxs(false);
        }
      } catch { /* cache best-effort */ }
    }).catch(() => {});
    const unsub = subscribeTransactionHistory(user.uid, (txs) => {
      setTransactions(txs);
      setLoadingTxs(false);
      AsyncStorage.setItem(key, JSON.stringify(txs.slice(0, 50))).catch(() => {});
    });
    // Offline safety: never spin the inline loader forever on a cold,
    // offline start. Same 3s timeout pattern as app/chat/index.tsx.
    const timeout = setTimeout(() => setLoadingTxs(false), 3000);
    return () => { clearTimeout(timeout); unsub(); };
  }, [user?.uid]);

  // FIX (2026-10-10): Coerce diamonds to number — prevents NaN when
  // the transaction was written with a string or missing amount.
  const toNum = (v: unknown): number => {
    if (typeof v === 'number' && !isNaN(v)) return v;
    if (typeof v === 'string') { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
    return 0;
  };
  // FIX (2026-10-10): Wallet shows ONLY diamond recharges (Sumon's order).
  // Gift transactions are displayed on the Profile gift history section.
  const rechargeTxs = transactions.filter((tx) => tx.type === 'recharge');
  const totalRecharged = rechargeTxs
    .reduce((sum, tx) => sum + Math.abs(toNum(tx.diamonds)), 0);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <TitleBar title={t('wallet.title')} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 60 }}
      >
        {/* Balance card */}
        <View style={[cardStyle, { padding: 22, alignItems: 'center' }]}>
          <Text style={{ color: C.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.8 }}>
            {t('wallet.balance')}
          </Text>
          {loadingBalance ? (
            <PremiumLoader size="large" />
          ) : (
            <Text style={{
              color: C.text,
              // 2026-10-14 (Sumon): Compact professional format — 1k, 10k, 100k, 1m, 1b
              fontSize: 48,
              fontWeight: '900',
              marginTop: 6, letterSpacing: -1 }}>
              {(() => {
                const n = balance ?? 0;
                if (n >= 1_000_000_000) {
                  const v = n / 1_000_000_000;
                  return `${v >= 100 ? Math.round(v) : v.toFixed(v >= 10 ? 1 : 2).replace(/\.?0+$/, '')}b`;
                }
                if (n >= 1_000_000) {
                  const v = n / 1_000_000;
                  return `${v >= 100 ? Math.round(v) : v.toFixed(v >= 10 ? 1 : 2).replace(/\.?0+$/, '')}m`;
                }
                if (n >= 1_000) {
                  const v = n / 1_000;
                  return `${v >= 100 ? Math.round(v) : v.toFixed(v >= 10 ? 1 : 2).replace(/\.?0+$/, '')}k`;
                }
                return String(n);
              })()}
            </Text>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
            <DiamondIcon size={16} />
            <Text style={{ color: C.blue, fontSize: 16, fontWeight: '800' }}>
              {t('wallet.diamondsLabel')}
            </Text>
          </View>

          {/* Top-up button — boss's standard: #E3F2FD bg + #007AFF text */}
          <Pressable
            onPress={() => router.push('/profile/topup' as never)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: C.blueLight,
              borderRadius: 12,
              paddingVertical: 13,
              paddingHorizontal: 32,
              marginTop: 16 }}
          >
            <Feather name="plus-circle" size={18} color={C.blue} style={{ marginRight: 8 }} />
            <Text style={{ color: C.blue, fontSize: 16, fontWeight: '900' }}>
              {t('wallet.topUp')}
            </Text>
          </Pressable>
        </View>

        {/* Total recharged — IMO menu row in a white card */}
        <View style={cardStyle}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 15 }}>
            <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: C.blueLight, alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="trending-up" size={16} color={C.blue} />
            </View>
            <Text style={{ flex: 1, fontSize: 16, color: C.text, marginLeft: 12 }} numberOfLines={1}>
              {t('wallet.totalRecharged', { defaultValue: 'Total Recharged' })}
            </Text>
            <Text style={{ fontSize: 16, fontWeight: '900', color: C.blue }}>
              +{totalRecharged}
            </Text>
          </View>
        </View>

        {/* Transaction history header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 15, paddingTop: 18, paddingBottom: 6 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: C.text }}>{t('wallet.historyTitle')}</Text>
          <Text style={{ fontSize: 14, color: C.muted }}>{rechargeTxs.length}</Text>
        </View>

        {loadingTxs ? (
          <View style={{ alignItems: 'center', paddingTop: 30 }}>
            <PremiumLoader size="medium" />
          </View>
        ) : rechargeTxs.length === 0 ? (
          <View style={[cardStyle, { alignItems: 'center', paddingVertical: 44 }]}>
            <DiamondIcon size={40} />
            <Text style={{ color: C.text, fontSize: 16, fontWeight: '800', marginTop: 14 }}>
              {t('wallet.noTransactions')}
            </Text>
            <Text style={{ color: C.muted, fontSize: 13, marginTop: 6, textAlign: 'center', paddingHorizontal: 30 }}>
              {t('wallet.noTransactionsSub')}
            </Text>
          </View>
        ) : (
          <View style={cardStyle}>
            {rechargeTxs.map((tx, i) => (
              <TransactionItem key={tx.id} tx={tx} last={i === rechargeTxs.length - 1} />
            ))}
          </View>
        )}
        {rechargeTxs.length > 0 && (
          <Text style={{
            color: C.mutedLight, fontSize: 11,
            textAlign: 'center', marginTop: 10 }}>
            {t('wallet.showing', { count: rechargeTxs.length })}
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
