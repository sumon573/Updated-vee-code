/**
 * NobelScreen — "My Noble" (NOTE 10, 2026-10-11).
 * IMO-exact noble level screen. Noble XP grows from diamond sending
 * (tracked in users/{uid}/nobleXP on every gift send).
 *
 * Layout per reference video (Screen_Recording_20261011_011556.mp4):
 * - Header: back + "My Noble" + ? + trophy
 * - Profile: DP + name + current noble badge pill
 * - Progress bar I → II with XP numbers
 * - "Need 👑X to secure your current noble level Y (Deadline: ...)"
 * - Horizontal rank tabs: Knight → SSKing
 * - "Noble Privileges" + Experience range + privilege grid
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, Pressable, Image, ScrollView,
  ActivityIndicator, Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { getErrorCause } from '@/src/utils/errorDisplay';

const { width } = Dimensions.get('window');

// ─── Noble rank definitions ──────────────────────────────────────────────
// XP thresholds based on IMO reference (Baron 1260~8399, Marquis 252000~587999,
// Royal Duke 1260K~4200K, SSKing 42000K+).
interface NobleRank {
  key: string;
  name: string;
  minXP: number;
  maxXP: number;
  color: string;
  privileges: string[];
}

const PRIVILEGES = {
  nameplate: 'Noble Nameplate',
  badge: 'Noble Badge',
  gift: 'Noble Gift',
  avatarFrame: 'Avatar Frame',
  entryEffects: 'Fancy Entry Effects',
  micRipple: 'Microphone Ripple',
  seatPriority: 'Seat Priority',
} as const;

const NOBLE_RANKS: NobleRank[] = [
  { key: 'knight', name: 'Knight', minXP: 0, maxXP: 1259, color: '#8BC34A',
    privileges: [PRIVILEGES.nameplate] },
  { key: 'baron', name: 'Baron', minXP: 1260, maxXP: 8399, color: '#26A69A',
    privileges: [PRIVILEGES.nameplate, PRIVILEGES.badge, PRIVILEGES.gift] },
  { key: 'viscount', name: 'Viscount', minXP: 8400, maxXP: 41999, color: '#42A5F5',
    privileges: [PRIVILEGES.nameplate, PRIVILEGES.badge, PRIVILEGES.gift] },
  { key: 'count', name: 'Count', minXP: 42000, maxXP: 251999, color: '#7E57C2',
    privileges: [PRIVILEGES.nameplate, PRIVILEGES.badge, PRIVILEGES.gift, PRIVILEGES.avatarFrame] },
  { key: 'marquis', name: 'Marquis', minXP: 252000, maxXP: 587999, color: '#EC407A',
    privileges: [PRIVILEGES.nameplate, PRIVILEGES.badge, PRIVILEGES.gift, PRIVILEGES.avatarFrame, PRIVILEGES.entryEffects] },
  { key: 'duke', name: 'Duke', minXP: 588000, maxXP: 1259999, color: '#FF7043',
    privileges: [PRIVILEGES.nameplate, PRIVILEGES.badge, PRIVILEGES.gift, PRIVILEGES.avatarFrame, PRIVILEGES.entryEffects] },
  { key: 'royalDuke', name: 'Royal Duke', minXP: 1260000, maxXP: 4200000, color: '#FFA000',
    privileges: [PRIVILEGES.nameplate, PRIVILEGES.badge, PRIVILEGES.gift, PRIVILEGES.avatarFrame, PRIVILEGES.entryEffects, PRIVILEGES.micRipple] },
  { key: 'king', name: 'King', minXP: 4200001, maxXP: 41999999, color: '#FBC02D',
    privileges: [PRIVILEGES.nameplate, PRIVILEGES.badge, PRIVILEGES.gift, PRIVILEGES.avatarFrame, PRIVILEGES.entryEffects, PRIVILEGES.micRipple] },
  { key: 'sking', name: 'SKing', minXP: 42000000, maxXP: 419999999, color: '#E65100',
    privileges: [PRIVILEGES.nameplate, PRIVILEGES.badge, PRIVILEGES.gift, PRIVILEGES.avatarFrame, PRIVILEGES.entryEffects, PRIVILEGES.micRipple] },
  { key: 'ssking', name: 'SSKing', minXP: 420000000, maxXP: Number.MAX_SAFE_INTEGER, color: '#BF360C',
    privileges: [PRIVILEGES.nameplate, PRIVILEGES.badge, PRIVILEGES.gift, PRIVILEGES.avatarFrame, PRIVILEGES.entryEffects, PRIVILEGES.micRipple, PRIVILEGES.seatPriority] },
];

const PRIVILEGE_ICONS: Record<string, string> = {
  [PRIVILEGES.nameplate]: '🎖️',
  [PRIVILEGES.badge]: '🛡️',
  [PRIVILEGES.gift]: '🎁',
  [PRIVILEGES.avatarFrame]: '🖼️',
  [PRIVILEGES.entryEffects]: '✨',
  [PRIVILEGES.micRipple]: '🎤',
  [PRIVILEGES.seatPriority]: '💺',
};

function getRankForXP(xp: number): { rank: NobleRank; index: number } {
  for (let i = NOBLE_RANKS.length - 1; i >= 0; i--) {
    if (xp >= NOBLE_RANKS[i].minXP) return { rank: NOBLE_RANKS[i], index: i };
  }
  return { rank: NOBLE_RANKS[0], index: 0 };
}

function formatXP(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`;
  return `${n}`;
}

function formatDeadline(ts: number): string {
  const d = new Date(ts);
  const pad = (x: number) => `${x}`.padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function NobelScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { user } = useAuth();
  const [xp, setXp] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRankIdx, setSelectedRankIdx] = useState(1); // default: Baron tab

  useEffect(() => {
    if (!user?.uid) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { get, ref } = await import('firebase/database');
        const { database } = await import('@/src/config/firebase');
        const snap = await get(ref(database, `users/${user.uid}/nobleXP`));
        if (!cancelled) {
          const val = snap.exists() ? Number(snap.val()) || 0 : 0;
          setXp(val);
          const { index } = getRankForXP(val);
          setSelectedRankIdx(index);
        }
      } catch (e) {
        if (!cancelled) setError(getErrorCause(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.uid]);

  const { rank: currentRank } = getRankForXP(xp);
  const selectedRank = NOBLE_RANKS[selectedRankIdx];
  // Sub-level I/II/III within the rank
  const rangeSpan = currentRank.maxXP - currentRank.minXP;
  const subLevel = rangeSpan > 0
    ? Math.min(3, Math.floor(((xp - currentRank.minXP) / rangeSpan) * 3) + 1)
    : 1;
  const progress = rangeSpan > 0
    ? Math.min(1, Math.max(0, (xp - currentRank.minXP) / rangeSpan))
    : 0;
  const needXP = Math.max(0, currentRank.maxXP - xp);
  // Deadline: 30 days from now to maintain level (IMO shows a deadline)
  const deadline = Date.now() + 30 * 24 * 60 * 60 * 1000;

  const renderPrivilege = (name: string, idx: number) => (
    <View key={idx} style={{ width: (width - 64) / 3, alignItems: 'center', marginBottom: 20 }}>
      <View style={{
        width: 56, height: 56, borderRadius: 28,
        backgroundColor: '#FFF8E1', alignItems: 'center', justifyContent: 'center',
        marginBottom: 8,
      }}>
        <Text style={{ fontSize: 28 }}>{PRIVILEGE_ICONS[name] ?? '🎁'}</Text>
      </View>
      <Text style={{ fontSize: 12, color: '#333', textAlign: 'center', fontWeight: '500' }}>
        {name}
      </Text>
    </View>
  );

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color="#FF9800" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      {/* Header */}
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingTop: 50, paddingHorizontal: 16, paddingBottom: 12,
      }}>
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Feather name="arrow-left" size={24} color="#000" />
        </Pressable>
        <Text style={{ fontSize: 18, fontWeight: '700', color: '#000', marginLeft: 12, flex: 1 }}>
          {t('nobel.myNoble', { defaultValue: 'My Noble' })}
        </Text>
        <Pressable hitSlop={8} style={{ marginRight: 16 }}>
          <Feather name="help-circle" size={22} color="#000" />
        </Pressable>
        <Pressable hitSlop={8}>
          <Feather name="award" size={22} color="#000" />
        </Pressable>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {error ? (
          <View style={{ padding: 20, alignItems: 'center' }}>
            <Text style={{ color: '#D32F2F', fontSize: 14 }}>{error}</Text>
          </View>
        ) : (
          <>
            {/* Profile */}
            <View style={{ alignItems: 'center', paddingTop: 8 }}>
              {user?.photoURL ? (
                <Image source={{ uri: user.photoURL }} style={{ width: 72, height: 72, borderRadius: 36 }} />
              ) : (
                <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: '#E0E0E0', alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontSize: 24, fontWeight: '700', color: '#757575' }}>
                    {(user?.displayName || '?').charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
              <Text style={{ fontSize: 18, fontWeight: '700', color: '#000', marginTop: 10 }}>
                {user?.displayName || 'Vee User'}
              </Text>
              {/* Current noble badge pill */}
              <View style={{
                flexDirection: 'row', alignItems: 'center',
                backgroundColor: currentRank.color + '22',
                borderWidth: 1.5, borderColor: currentRank.color,
                borderRadius: 14, paddingHorizontal: 12, paddingVertical: 4,
                marginTop: 8,
              }}>
                <Text style={{ fontSize: 13, fontWeight: '800', color: currentRank.color }}>
                  {currentRank.name} {['I', 'II', 'III'][subLevel - 1]}
                </Text>
              </View>
            </View>

            {/* Progress bar */}
            <View style={{ paddingHorizontal: 24, marginTop: 16 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#26A69A' }}>I</Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#BDBDBD' }}>II</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#FF9800', marginRight: 8 }}>
                  👑{formatXP(xp)}
                </Text>
                <View style={{ flex: 1, height: 8, backgroundColor: '#F0F0F0', borderRadius: 4, overflow: 'hidden' }}>
                  <View style={{
                    width: `${progress * 100}%`, height: 8,
                    backgroundColor: '#26A69A', borderRadius: 4,
                  }} />
                </View>
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#FF9800', marginLeft: 8 }}>
                  👑{formatXP(currentRank.maxXP)}
                </Text>
              </View>
              <Text style={{ fontSize: 12, color: '#757575', textAlign: 'center', marginTop: 8 }}>
                {t('nobel.needToSecure', {
                  defaultValue: `Need 👑${formatXP(needXP)} to secure your current noble level ${currentRank.name} ${['I', 'II', 'III'][subLevel - 1]} (Deadline: ${formatDeadline(deadline)})`,
                })}
              </Text>
            </View>

            {/* Rank tabs */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginTop: 16 }}
              contentContainerStyle={{ paddingHorizontal: 16 }}
            >
              {NOBLE_RANKS.map((r, idx) => {
                const active = idx === selectedRankIdx;
                return (
                  <Pressable
                    key={r.key}
                    onPress={() => setSelectedRankIdx(idx)}
                    hitSlop={{ top: 8, bottom: 8 }}
                    style={{
                      paddingHorizontal: 14, paddingVertical: 8, marginRight: 4,
                      borderBottomWidth: active ? 2.5 : 0,
                      borderBottomColor: '#FF9800',
                    }}
                  >
                    <Text style={{
                      fontSize: 14,
                      fontWeight: active ? '700' : '400',
                      color: active ? '#FF9800' : '#9E9E9E',
                    }}>
                      {r.name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            {/* Privileges */}
            <View style={{ alignItems: 'center', marginTop: 12, marginBottom: 8 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ width: 40, height: 1.5, backgroundColor: '#FFB74D' }} />
                <Text style={{ fontSize: 16, fontWeight: '700', color: '#FF9800', marginHorizontal: 12 }}>
                  {t('nobel.privileges', { defaultValue: 'Noble Privileges' })}
                </Text>
                <View style={{ width: 40, height: 1.5, backgroundColor: '#FFB74D' }} />
              </View>
              <Text style={{ fontSize: 13, color: '#757575', marginTop: 6 }}>
                {t('nobel.experience', {
                  defaultValue: `Experience: ${formatXP(selectedRank.minXP)}~${selectedRank.maxXP >= Number.MAX_SAFE_INTEGER ? '∞' : formatXP(selectedRank.maxXP)}`,
                })}
              </Text>
            </View>

            <View style={{
              flexDirection: 'row', flexWrap: 'wrap',
              paddingHorizontal: 32, paddingTop: 12, justifyContent: 'flex-start',
            }}>
              {selectedRank.privileges.map(renderPrivilege)}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}
