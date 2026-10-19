/**
 * Top-Up Screen — IMO-style recharge UI (2026-10-19).
 *
 * IMO patterns applied (extracted from IMO v2026.09.1051 APK):
 *   - DiamondsOrderFragment: balance header (diamond icon + formatted balance),
 *     package list as ROWS (BIUIItemView: icon + amount + action button),
 *     bottom-sheet white aesthetic, 20dp radius cards.
 *   - Standalone IMO recharge is a WebView — not portable; the native
 *     package-row UI above is IMO's real recharge UX, applied here.
 *
 * Backend UNCHANGED (Vee's economy): USDT (TRC20) manual flow.
 *   1. Fetch server-owned config: GET /api/wallet/topup-config
 *      → { usdtTrc20Address, packages: [{ id, diamonds, usdt }] }
 *   2. User sends the EXACT USDT amount (TRC20) to the shown address.
 *   3. User pastes the TRC20 transaction hash.
 *   4. POST /api/wallet/topup-crypto { txHash, packageId, network } verifies
 *      on-chain and credits diamonds.
 *
 * bKash is hidden for now (user request 2026-10-05) — USDT only.
 * Store tab REMOVED from Top Up (2026-10-16) — Recharge only.
 */

import { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, Platform } from 'react-native';
import PremiumLoader from '@/src/components/PremiumLoader';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useAuth } from '@/src/context/AuthContext';
import { auth } from '@/src/config/firebase';
import { getApiBase } from '@/src/utils/platform';
import { getErrorCause } from '@/src/utils/errorDisplay';
import {
  getWalletBalance,
  subscribeTransactionHistory,
  type WalletTransaction,
} from '@/src/features/wallet/walletService';
import { useTranslation } from 'react-i18next';

const C = {
  bg: '#FFFFFF',
  cardBg: '#F4F5F5',
  primary: '#007AFF',
  primaryBg: '#E3F2FD',
  imoBlue: '#009DFF',
  text: '#000000',
  textDark: '#25292D',
  muted: '#788187',
  mutedDim: '#C7C7CC',
  border: '#E5E5EA',
  surface: '#F2F2F7',
  green: '#22C55E',
  red: '#EF4444',
  gold: '#FFB62E',
} as const;

interface TopupPackage {
  id: string;
  diamonds: number;
  usdt: number;
}

interface TopupConfig {
  usdtTrc20Address: string;
  packages: TopupPackage[];
}

async function authedFetch(path: string, init?: RequestInit): Promise<any> {
  const fbUser = auth.currentUser;
  if (!fbUser) throw new Error('Not signed in');
  const idToken = await fbUser.getIdToken();
  const res = await fetch(`${getApiBase()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
      ...(init?.headers ?? {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as any)?.error || (data as any)?.message || `Request failed (${res.status})`);
  }
  return data;
}

function fmt(n: number): string {
  return (n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function fmtCompact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}b`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
  if (n >= 100_000) return `${(n / 1_000).toFixed(0)}k`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${n}`;
}

function fmtDate(ts: number): string {
  try {
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export default function TopUpScreen() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const topPad = Platform.OS === 'web' ? 67 : 0;

  const [config, setConfig] = useState<TopupConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);
  const [pkgId, setPkgId] = useState<string>('');
  const [txHash, setTxHash] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [history, setHistory] = useState<WalletTransaction[]>([]);
  const [success, setSuccess] = useState<{ diamonds: number; balance: number } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setConfigError(null);
    try {
      const data = (await authedFetch('/api/wallet/topup-config', { method: 'GET' })) as TopupConfig;
      if (!data?.usdtTrc20Address || !Array.isArray(data?.packages)) {
        throw new Error('Invalid top-up config');
      }
      setConfig(data);
      if (data.packages.length > 0 && !pkgId) {
        setPkgId(data.packages[0].id);
      }
    } catch (e) {
      setConfigError(getErrorCause(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user?.uid) {
      void loadConfig();
      getWalletBalance(user.uid).then(setBalance).catch(() => setBalance(0));
      const unsub = subscribeTransactionHistory(user.uid, (txs) => {
        setHistory(txs.filter((x) => x.type === 'recharge').slice(-5).reverse());
      });
      return unsub;
    }
    return undefined;
  }, [user?.uid, loadConfig]);

  const copyAddress = useCallback(async () => {
    if (!config?.usdtTrc20Address) return;
    await Clipboard.setStringAsync(config.usdtTrc20Address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [config?.usdtTrc20Address]);

  const handleSubmit = useCallback(async () => {
    const hash = txHash.trim();
    setSubmitError(null);
    if (!hash) {
      setSubmitError(t('topup.enterTxHash'));
      return;
    }
    if (!pkgId) {
      setSubmitError(t('topup.selectPackage'));
      return;
    }
    setSubmitting(true);
    try {
      // Server requires `network` field (was missing → 400 "Unsupported network").
      const res = (await authedFetch('/api/wallet/topup-crypto', {
        method: 'POST',
        body: JSON.stringify({ txHash: hash, packageId: pkgId, network: 'trc20' }) })) as { diamonds?: number; newBalance?: number };
      const credited = res.diamonds ?? 0;
      const newBal = res.newBalance ?? 0;
      // Record the recharge in wallet history (wallet screen shows ONLY recharges).
      if (credited > 0) {
        import('@/src/features/wallet/walletService').then(({ recordRechargeTransaction }) => {
          recordRechargeTransaction(credited, newBal).catch(() => {});
        });
      }
      setBalance(newBal);
      setSuccess({ diamonds: credited, balance: newBal });
      setTxHash('');
    } catch (e) {
      setSubmitError(getErrorCause(e));
    } finally {
      setSubmitting(false);
    }
  }, [txHash, pkgId, t]);

  const pkg = config?.packages.find((p) => p.id === pkgId);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 60 }}
        >
          {/* IMO title bar: back ‹ + centered title */}
          <View style={{
            flexDirection: 'row', alignItems: 'center',
            paddingTop: topPad + 8, paddingBottom: 12 }}>
            <Pressable onPress={() => router.back()} hitSlop={14} style={{ padding: 4 }}>
              <Feather name="chevron-left" size={26} color={C.text} />
            </Pressable>
            <Text style={{
              color: C.text, fontSize: 17, fontWeight: '600',
              flex: 1, textAlign: 'center', marginRight: 34 }}>
              {t('topup.title')}
            </Text>
          </View>

          {!user ? (
            <View style={styles.card}>
              <Text style={{ color: C.muted, textAlign: 'center' }}>{t('topup.signInFirst')}</Text>
            </View>
          ) : loading ? (
            <View style={{ alignItems: 'center', paddingTop: 60 }}>
              <PremiumLoader size="large" />
              <Text style={{ color: C.muted, marginTop: 12 }}>{t('topup.loading')}</Text>
            </View>
          ) : configError || !config ? (
            <View style={styles.card}>
              <Text style={{ color: C.red, textAlign: 'center' }}>
                {configError ?? t('topup.unavailable')}
              </Text>
              <Pressable onPress={() => void loadConfig()} style={styles.retryBtn}>
                <Text style={{ color: C.primary, fontWeight: '700' }}>Retry</Text>
              </Pressable>
            </View>
          ) : (
            <>
              {/* IMO balance header (DiamondsOrderFragment pattern) */}
              <View style={styles.balanceCard}>
                <View style={styles.diamondIcon}>
                  <Text style={{ fontSize: 26 }}>💎</Text>
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={{ color: C.muted, fontSize: 13 }}>
                    {t('topup.currentBalance')}
                  </Text>
                  <Text style={{ color: C.text, fontSize: 24, fontWeight: '900', marginTop: 2 }}>
                    {balance === null ? '—' : fmt(balance)}
                  </Text>
                </View>
              </View>

              {/* Success state (IMO confirm pattern) */}
              {success && (
                <View style={styles.successCard}>
                  <View style={styles.successIcon}>
                    <Feather name="check" size={28} color="#FFFFFF" />
                  </View>
                  <Text style={{ color: C.text, fontSize: 17, fontWeight: '800', marginTop: 10 }}>
                    {t('topup.successTitle')}
                  </Text>
                  <Text style={{ color: C.muted, fontSize: 14, marginTop: 6, textAlign: 'center' }}>
                    {t('topup.successMsg', {
                      diamonds: fmt(success.diamonds),
                      balance: fmt(success.balance) })}
                  </Text>
                  <Pressable
                    onPress={() => setSuccess(null)}
                    style={styles.bossBtn}>
                    <Text style={{ color: C.primary, fontSize: 15, fontWeight: '800' }}>
                      OK
                    </Text>
                  </Pressable>
                </View>
              )}

              {/* Payment method row (IMO row pattern) */}
              <Text style={styles.sectionTitle}>{t('topup.paymentMethod')}</Text>
              <View style={styles.card}>
                <View style={styles.row}>
                  <View style={[styles.methodIcon, { backgroundColor: '#E8F5E9' }]}>
                    <Text style={{ fontSize: 22, fontWeight: '900', color: '#26A17B' }}>₮</Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={{ color: C.textDark, fontSize: 16, fontWeight: '600' }}>
                      USDT
                    </Text>
                    <Text style={{ color: C.muted, fontSize: 13, marginTop: 2 }}>
                      {t('topup.usdtNetwork')}
                    </Text>
                  </View>
                  <Feather name="check-circle" size={22} color={C.imoBlue} />
                </View>
              </View>

              {/* Step 1: address */}
              <Text style={styles.sectionTitle}>1. {t('topup.step1')}</Text>
              <View style={styles.card}>
                <Text style={{ color: C.muted, fontSize: 13, marginBottom: 10 }}>
                  {t('topup.step1Sub')}
                </Text>
                <View style={styles.addressBox}>
                  <Text selectable style={styles.addressText}>
                    {config.usdtTrc20Address}
                  </Text>
                </View>
                <Pressable onPress={() => void copyAddress()} style={styles.bossBtn}>
                  <Feather name={copied ? 'check' : 'copy'} size={16} color={C.primary} />
                  <Text style={{ color: C.primary, fontWeight: '800', marginLeft: 8, fontSize: 15 }}>
                    {copied ? t('topup.copied') : t('topup.copyAddress')}
                  </Text>
                </Pressable>
              </View>

              {/* Step 2: package ROWS (IMO BIUIItemView pattern) */}
              <Text style={styles.sectionTitle}>2. {t('topup.step2')}</Text>
              <View style={styles.card}>
                {config.packages.map((p, i) => {
                  const selected = p.id === pkgId;
                  return (
                    <View key={p.id}>
                      <Pressable
                        onPress={() => setPkgId(p.id)}
                        style={[
                          styles.pkgRow,
                          selected && styles.pkgRowSelected,
                        ]}>
                        <View style={[
                          styles.pkgIcon,
                          selected && { backgroundColor: '#D6EBFF' },
                        ]}>
                          <Text style={{ fontSize: 24 }}>💎</Text>
                        </View>
                        <View style={{ flex: 1, marginLeft: 12 }}>
                          <Text style={{ color: C.textDark, fontSize: 16, fontWeight: '800' }}>
                            {fmt(p.diamonds)} {t('topup.diamonds')}
                          </Text>
                          <Text style={{ color: C.muted, fontSize: 13, marginTop: 2 }}>
                            ${p.usdt} USDT
                          </Text>
                        </View>
                        <View style={[
                          styles.selectBtn,
                          selected ? styles.selectBtnActive : styles.selectBtnIdle,
                        ]}>
                          <Text style={{
                            fontSize: 13, fontWeight: '800',
                            color: selected ? C.primary : C.muted,
                          }}>
                            {selected ? `✓ ${t('topup.selected')}` : t('topup.select')}
                          </Text>
                        </View>
                      </Pressable>
                      {i < config.packages.length - 1 && <View style={styles.divider} />}
                    </View>
                  );
                })}
              </View>

              {/* Step 3: tx hash */}
              <Text style={styles.sectionTitle}>3. {t('topup.step3')}</Text>
              <View style={styles.card}>
                <TextInput
                  value={txHash}
                  onChangeText={(v) => { setTxHash(v); setSubmitError(null); }}
                  placeholder={t('topup.txHashPlaceholder')}
                  placeholderTextColor={C.mutedDim}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.hashInput}
                />
                {submitError ? (
                  <Text style={{ color: C.red, fontSize: 13, marginTop: 10 }}>
                    {submitError}
                  </Text>
                ) : null}
                <Pressable
                  onPress={() => void handleSubmit()}
                  disabled={submitting}
                  style={[styles.bossBtn, { marginTop: 14, opacity: submitting ? 0.6 : 1 }]}>
                  {submitting ? (
                    <PremiumLoader size="medium" />
                  ) : (
                    <Text style={{ color: C.primary, fontSize: 16, fontWeight: '900' }}>
                      {t('topup.verifyBtn', { diamonds: fmt(pkg?.diamonds ?? 0) })}
                    </Text>
                  )}
                </Pressable>
              </View>

              {/* Recent top-ups (IMO row pattern) */}
              {history.length > 0 && (
                <>
                  <Text style={styles.sectionTitle}>{t('topup.recentTopups')}</Text>
                  <View style={styles.card}>
                    {history.map((h, i) => (
                      <View key={h.id}>
                        <View style={styles.row}>
                          <View style={styles.histIcon}>
                            <Text style={{ fontSize: 20 }}>💎</Text>
                          </View>
                          <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={{ color: C.textDark, fontSize: 15, fontWeight: '600' }}>
                              {t('topup.rechargeLabel')}
                            </Text>
                            <Text style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>
                              {fmtDate(h.ts)}
                            </Text>
                          </View>
                          <Text style={{ color: C.green, fontSize: 15, fontWeight: '800' }}>
                            +{fmtCompact(Math.abs(h.diamonds))}
                          </Text>
                        </View>
                        {i < history.length - 1 && <View style={styles.divider} />}
                      </View>
                    ))}
                  </View>
                </>
              )}

              <Text style={{ color: C.mutedDim, fontSize: 12, lineHeight: 18, marginTop: 12 }}>
                {t('topup.disclaimer')}
              </Text>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = {
  card: {
    backgroundColor: C.cardBg,
    borderRadius: 20,
    padding: 16,
    marginBottom: 4 },
  balanceCard: {
    backgroundColor: C.cardBg,
    borderRadius: 20,
    padding: 18,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginBottom: 4 },
  diamondIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: C.primaryBg,
    alignItems: 'center' as const,
    justifyContent: 'center' as const },
  sectionTitle: {
    color: C.textDark,
    fontSize: 15,
    fontWeight: '700' as const,
    marginTop: 20,
    marginBottom: 10,
    marginLeft: 4 },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: 10 },
  divider: {
    height: 0.5,
    backgroundColor: C.border,
    marginLeft: 68 },
  methodIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center' as const,
    justifyContent: 'center' as const },
  addressBox: {
    backgroundColor: C.bg,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: C.border },
  addressText: {
    color: C.text,
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  bossBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: C.primaryBg,
    borderRadius: 14,
    padding: 14,
    marginTop: 12 },
  pkgRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderRadius: 14 },
  pkgRowSelected: {
    backgroundColor: 'rgba(0,157,255,0.08)' },
  pkgIcon: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: C.primaryBg,
    alignItems: 'center' as const,
    justifyContent: 'center' as const },
  selectBtn: {
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1.5 },
  selectBtnActive: {
    backgroundColor: C.primaryBg,
    borderColor: C.primary },
  selectBtnIdle: {
    backgroundColor: 'transparent',
    borderColor: C.border },
  hashInput: {
    backgroundColor: C.bg,
    borderRadius: 12,
    padding: 14,
    color: C.text,
    fontSize: 13,
    borderWidth: 1,
    borderColor: C.border,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  histIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: C.primaryBg,
    alignItems: 'center' as const,
    justifyContent: 'center' as const },
  successCard: {
    backgroundColor: '#F0FDF4',
    borderRadius: 20,
    padding: 22,
    alignItems: 'center' as const,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: '#BBF7D0' },
  successIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.green,
    alignItems: 'center' as const,
    justifyContent: 'center' as const },
  retryBtn: {
    backgroundColor: C.primaryBg,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center' as const,
    marginTop: 14 } };
