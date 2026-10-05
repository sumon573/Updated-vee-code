/**
 * Top-Up Screen — Buy diamonds with USDT (TRC20)
 *
 * Flow (mirrors the web client's TopUpPage):
 *   1. Fetch server-owned config: GET /api/wallet/topup-config
 *      → { usdtTrc20Address, packages: [{ id, diamonds, usdt }] }
 *   2. User sends the EXACT USDT amount (TRC20) to the shown address.
 *   3. User pastes the TRC20 transaction hash.
 *   4. POST /api/wallet/topup-crypto { txHash, packageId } verifies on-chain
 *      and credits diamonds.
 *
 * bKash is hidden for now (user request 2026-10-05) — USDT only.
 */

import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, Pressable, TextInput,
  ActivityIndicator, Alert, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useAuth } from '@/src/context/AuthContext';
import { auth } from '@/src/config/firebase';
import { getApiBase } from '@/src/utils/platform';
import { useTranslation } from 'react-i18next';

const C = {
  bg: '#07020F',
  primary: '#7C3AED',
  glow: '#8B5CF6',
  text: '#FFFFFF',
  muted: '#B8A6D9',
  mutedDim: '#4A3D6E',
  border: '#1E1830',
  surface: 'rgba(255,255,255,0.055)',
  green: '#22C55E',
  red: '#EF4444',
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
      ...(init?.headers ?? {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as any)?.error || (data as any)?.message || `Request failed (${res.status})`);
  }
  return data;
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
      setConfigError(e instanceof Error ? e.message : 'Failed to load top-up options');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user?.uid) void loadConfig();
  }, [user?.uid, loadConfig]);

  const copyAddress = useCallback(async () => {
    if (!config?.usdtTrc20Address) return;
    await Clipboard.setStringAsync(config.usdtTrc20Address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [config?.usdtTrc20Address]);

  const handleSubmit = useCallback(async () => {
    const hash = txHash.trim();
    if (!hash) {
      Alert.alert(t('topup.errorTitle'), t('topup.enterTxHash'));
      return;
    }
    if (!pkgId) {
      Alert.alert(t('topup.errorTitle'), t('topup.selectPackage'));
      return;
    }
    setSubmitting(true);
    try {
      const res = (await authedFetch('/api/wallet/topup-crypto', {
        method: 'POST',
        body: JSON.stringify({ txHash: hash, packageId: pkgId }),
      })) as { diamonds?: number; newBalance?: number };
      const credited = res.diamonds ?? 0;
      const balance = res.newBalance ?? 0;
      Alert.alert(
        t('topup.successTitle'),
        t('topup.successMsg', { diamonds: credited.toLocaleString(), balance: balance.toLocaleString() }),
        [{ text: 'OK', onPress: () => router.back() }],
      );
      setTxHash('');
    } catch (e) {
      Alert.alert(t('topup.errorTitle'), e instanceof Error ? e.message : t('topup.failed'));
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
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 60 }}
        >
          {/* Header */}
          <View style={{
            flexDirection: 'row', alignItems: 'center',
            paddingTop: topPad + 10, paddingBottom: 20,
          }}>
            <Pressable onPress={() => router.back()} hitSlop={14} style={{ marginRight: 12 }}>
              <Feather name="arrow-left" size={24} color={C.text} />
            </Pressable>
            <Text style={{ color: C.text, fontSize: 20, fontWeight: '900', flex: 1 }}>
              ➕ {t('topup.title')}
            </Text>
          </View>

          {!user ? (
            <View style={styles.card}>
              <Text style={{ color: C.muted, textAlign: 'center' }}>{t('topup.signInFirst')}</Text>
            </View>
          ) : loading ? (
            <View style={{ alignItems: 'center', paddingTop: 60 }}>
              <ActivityIndicator color={C.glow} size="large" />
              <Text style={{ color: C.muted, marginTop: 12 }}>{t('topup.loading')}</Text>
            </View>
          ) : configError || !config ? (
            <View style={styles.card}>
              <Text style={{ color: C.red, textAlign: 'center' }}>
                {configError ?? t('topup.unavailable')}
              </Text>
              <Pressable onPress={() => void loadConfig()} style={styles.retryBtn}>
                <Text style={{ color: C.text, fontWeight: '700' }}>{'Retry'}</Text>
              </Pressable>
            </View>
          ) : (
            <>
              {/* Step 1: address */}
              <Text style={styles.stepTitle}>1️⃣ {t('topup.step1')}</Text>
              <View style={styles.card}>
                <Text style={{ color: C.muted, fontSize: 13, marginBottom: 10 }}>
                  {t('topup.step1Sub')}
                </Text>
                <View style={{
                  backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 12,
                  padding: 12, borderWidth: 1, borderColor: C.border,
                }}>
                  <Text selectable style={{
                    color: C.text, fontSize: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                  }}>
                    {config.usdtTrc20Address}
                  </Text>
                </View>
                <Pressable onPress={() => void copyAddress()} style={styles.copyBtn}>
                  <Feather name={copied ? 'check' : 'copy'} size={16} color={C.text} />
                  <Text style={{ color: C.text, fontWeight: '700', marginLeft: 8 }}>
                    {copied ? t('topup.copied') : t('topup.copyAddress')}
                  </Text>
                </Pressable>
              </View>

              {/* Step 2: package */}
              <Text style={styles.stepTitle}>2️⃣ {t('topup.step2')}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {config.packages.map((p) => {
                  const selected = p.id === pkgId;
                  return (
                    <Pressable
                      key={p.id}
                      onPress={() => setPkgId(p.id)}
                      style={{
                        width: '48%',
                        backgroundColor: selected ? 'rgba(124,58,237,0.25)' : C.surface,
                        borderRadius: 16, padding: 14, alignItems: 'center',
                        borderWidth: 2,
                        borderColor: selected ? C.glow : 'rgba(255,255,255,0.08)',
                      }}
                    >
                      <Text style={{ color: C.text, fontSize: 18, fontWeight: '900' }}>
                        💎{p.diamonds.toLocaleString()}
                      </Text>
                      <Text style={{ color: C.glow, fontSize: 14, fontWeight: '700', marginTop: 4 }}>
                        ${p.usdt} USDT
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Step 3: tx hash */}
              <Text style={styles.stepTitle}>3️⃣ {t('topup.step3')}</Text>
              <View style={styles.card}>
                <TextInput
                  value={txHash}
                  onChangeText={setTxHash}
                  placeholder={t('topup.txHashPlaceholder')}
                  placeholderTextColor={C.mutedDim}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={{
                    backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 12,
                    padding: 14, color: C.text, fontSize: 13,
                    borderWidth: 1, borderColor: C.border,
                    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                  }}
                />
                <Pressable
                  onPress={() => void handleSubmit()}
                  disabled={submitting}
                  style={{
                    backgroundColor: C.primary, borderRadius: 14,
                    padding: 16, alignItems: 'center', marginTop: 14,
                    opacity: submitting ? 0.6 : 1,
                  }}
                >
                  {submitting ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={{ color: '#fff', fontSize: 16, fontWeight: '900' }}>
                      {t('topup.verifyBtn', { diamonds: (pkg?.diamonds ?? 0).toLocaleString() })}
                    </Text>
                  )}
                </Pressable>
              </View>

              <Text style={{ color: C.mutedDim, fontSize: 12, lineHeight: 18, marginTop: 8 }}>
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
    backgroundColor: C.surface,
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    marginBottom: 8,
  },
  stepTitle: {
    color: C.text,
    fontSize: 17,
    fontWeight: '900' as const,
    marginTop: 20,
    marginBottom: 12,
  },
  copyBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: 'rgba(124,58,237,0.2)',
    borderRadius: 12,
    padding: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: 'rgba(139,92,246,0.35)',
  },
  retryBtn: {
    backgroundColor: C.primary,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center' as const,
    marginTop: 14,
  },
};
