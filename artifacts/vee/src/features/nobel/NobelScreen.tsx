/**
 * NobelScreen — "My Noble" (NOTE 10, 2026-10-11).
 *
 * IMO-exact noble level screen. Noble XP grows from REAL diamonds sent as
 * gifts in voice rooms (users/{uid}/noble, written atomically on every gift
 * send — see nobleService). Self-gifts never count.
 *
 * Maintenance is REAL and persisted: each rank-up (or first gift) opens a
 * 30-day window (maintenanceDeadline) with a required amount
 * (maintenanceRequired = ceil(rankMinXP / 2)). Gifts inside the window add
 * to maintenanceXP; a window that expires unmet DEMOTES the rank one step
 * suspends privileges until the requirement is met again.
 *
 * Privileges render honestly: enforced privileges show active (✓) once the
 * rank is reached; privileges with no real code path yet (Noble Gift,
 * Microphone Ripple, Seat Priority) show locked (🔒) — never unlocked-but-dead.
 *
 * Light mode only. Errors show their actual cause.
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, Pressable, Image, ScrollView,
  ActivityIndicator, Alert, Dimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '@/src/context/AuthContext';
import { getErrorCause } from '@/src/utils/errorDisplay';
import {
  NOBLE_RANKS, PRIVILEGES, NobleState, PrivilegeDef,
  subscribeNoble, formatXP, formatDeadline, refreshNobleState,
} from '@/src/services/nobleService';

const { width } = Dimensions.get('window');
const ROMAN = ['I', 'II', 'III'];

function subLevelFor(xp: number, rankIdx: number): number {
  const r = NOBLE_RANKS[rankIdx];
  const span = r.maxXP - r.minXP;
  if (!Number.isFinite(span) || span <= 0) return 1;
  return Math.min(3, Math.floor(((xp - r.minXP) / span) * 3) + 1);
}

export default function NobelScreen({ embedded = false }: { embedded?: boolean }) {
  const router = useRouter();
  const { user } = useAuth();
  const [noble, setNoble] = useState<NobleState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRankIdx, setSelectedRankIdx] = useState(0);
  // 2026-10-15 (Sumon): profile name from RTDB — Nobel tab must show the SAME
  // name as the profile screen (profile uses RTDB profile.name, not auth).
  const [profileName, setProfileName] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.uid) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    // 2026-10-15 (Sumon): lazy demotion — roll over expired windows on view.
    refreshNobleState(user.uid).catch(() => {});
    // 2026-10-15 (Sumon): fetch RTDB profile name — must match profile screen.
    (async () => {
      try {
        const { ref, get } = await import('firebase/database');
        const { database } = await import('@/src/config/firebase');
        const snap = await get(ref(database, `users/${user.uid}/name`)).catch(() => null);
        const n = snap?.val();
        if (typeof n === 'string' && n.trim()) setProfileName(n.trim());
      } catch { /* fall back to auth displayName */ }
    })();
    const unsub = subscribeNoble(
      user.uid,
      (s) => {
        setNoble(s);
        setSelectedRankIdx(s ? s.rankIndex : 0);
        setLoading(false);
      },
      (e) => {
        setError(getErrorCause(e));
        setLoading(false);
      },
    );
    const timeout = setTimeout(() => setLoading(false), 8000);
    return () => { clearTimeout(timeout); unsub(); };
  }, [user?.uid]);

  const showAbout = () => {
    Alert.alert(
      'About Noble',
      'Noble ranks grow when you send diamonds as gifts in voice rooms.\n\n' +
      'Each rank unlocks privileges. Send the maintenance amount before the ' +
      'deadline to keep your rank secured — otherwise privileges are suspended ' +
      'until you catch up.',
    );
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color="#FF9800" />
      </View>
    );
  }

  const xp = noble?.xp ?? 0;
  const rankIdx = noble?.rankIndex ?? 0;
  const rank = NOBLE_RANKS[rankIdx];
  const selectedRank = NOBLE_RANKS[selectedRankIdx];
  const sub = subLevelFor(xp, rankIdx);
  const isTop = rankIdx === NOBLE_RANKS.length - 1;
  const span = rank.maxXP - rank.minXP;
  const progress = !Number.isFinite(span) || span <= 0
    ? 1
    : Math.min(1, Math.max(0, (xp - rank.minXP) / span));

  const remaining = noble ? Math.max(0, noble.maintenanceRequired - noble.maintenanceXP) : 0;
  const maintenanceLine = !noble
    ? 'Send diamonds as gifts in voice rooms to earn Noble XP.'
    : remaining > 0
      ? `Need 👑${formatXP(remaining)} to secure your current noble level ${rank.name} ${ROMAN[sub - 1]} (Deadline: ${formatDeadline(noble.maintenanceDeadline)})`
      : `Your ${rank.name} ${ROMAN[sub - 1]} level is secured until ${formatDeadline(noble.maintenanceDeadline)}.`;

  const renderPrivilege = (key: string) => {
    const def = PRIVILEGES.find((p) => p.key === key) as PrivilegeDef;
    // Earned = user reached the rank that grants it.
    const earned = rankIdx >= def.minRankIndex;
    const active = earned && def.enforced;
    const locked = earned && !active;
    return (
      <View key={def.key} style={{ width: (width - 64) / 3, alignItems: 'center', marginBottom: 20 }}>
        <View style={{
          width: 56, height: 56, borderRadius: 28,
          backgroundColor: locked ? '#F2F2F7' : '#FFF8E1',
          alignItems: 'center', justifyContent: 'center',
          marginBottom: 8, opacity: locked ? 0.6 : 1,
        }}>
          <Text style={{ fontSize: 28 }}>{def.icon}</Text>
          {locked && (
            <View style={{
              position: 'absolute', bottom: -2, right: -2,
              backgroundColor: '#fff', borderRadius: 10, padding: 2,
            }}>
              <Feather name="lock" size={12} color="#8E8E93" />
            </View>
          )}
          {active && (
            <View style={{
              position: 'absolute', bottom: -2, right: -2,
              backgroundColor: '#4CAF50', borderRadius: 10, padding: 2,
            }}>
              <Feather name="check" size={12} color="#fff" />
            </View>
          )}
        </View>
        <Text style={{
          fontSize: 12, color: locked ? '#8E8E93' : '#333',
          textAlign: 'center', fontWeight: '500',
        }}>
          {def.name}
        </Text>
      </View>
    );
  };

  const anyLocked = selectedRank.privileges.some((k) => {
    const def = PRIVILEGES.find((p) => p.key === k) as PrivilegeDef;
    return rankIdx >= def.minRankIndex && !def.enforced;
  });

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      {/* Header — hidden when embedded in the Decoration tab (2026-10-11) */}
      {!embedded && (
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingTop: 50, paddingHorizontal: 16, paddingBottom: 12,
      }}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={24} color="#000" />
        </Pressable>
        <Text style={{ fontSize: 18, fontWeight: '700', color: '#000', marginLeft: 12, flex: 1 }}>
          My Noble
        </Text>
        <Pressable hitSlop={12} style={{ marginRight: 16 }} onPress={showAbout}>
          <Feather name="help-circle" size={22} color="#000" />
        </Pressable>

      </View>
      )}

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
                <View style={{
                  width: 72, height: 72, borderRadius: 36, backgroundColor: '#E0E0E0',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Text style={{ fontSize: 24, fontWeight: '700', color: '#757575' }}>
                    {((profileName || user?.displayName || '?').charAt(0).toUpperCase())}
                  </Text>
                </View>
              )}
              <Text style={{ fontSize: 18, fontWeight: '700', color: '#000', marginTop: 10 }}>
                {profileName || user?.displayName || 'Vee User'}
              </Text>
              <View style={{
                flexDirection: 'row', alignItems: 'center',
                backgroundColor: rank.color + '22',
                borderWidth: 1.5, borderColor: rank.color,
                borderRadius: 14, paddingHorizontal: 12, paddingVertical: 4,
                marginTop: 8,
              }}>
                <Text style={{ fontSize: 13, fontWeight: '800', color: rank.color }}>
                  {rank.name} {ROMAN[sub - 1]}
                </Text>
              </View>
            </View>

            {/* Progress bar */}
            <View style={{ paddingHorizontal: 24, marginTop: 16 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#26A69A' }}>{ROMAN[sub - 1]}</Text>
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#BDBDBD' }}>
                  {isTop ? 'MAX' : ROMAN[Math.min(2, sub)]}
                </Text>
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
                  👑{isTop ? 'MAX' : formatXP(rank.maxXP)}
                </Text>
              </View>
              <Text style={{ fontSize: 12, color: '#757575', textAlign: 'center', marginTop: 8, lineHeight: 18 }}>
                {maintenanceLine}
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
                const activeTab = idx === selectedRankIdx;
                return (
                  <Pressable
                    key={r.key}
                    onPress={() => setSelectedRankIdx(idx)}
                    hitSlop={{ top: 8, bottom: 8 }}
                    style={{
                      flexDirection: 'row', alignItems: 'center',
                      paddingHorizontal: 12, paddingVertical: 8, marginRight: 4,
                      borderBottomWidth: activeTab ? 2.5 : 0,
                      borderBottomColor: '#FF9800',
                    }}
                  >
                    <View style={{
                      width: 10, height: 10, borderRadius: 5,
                      backgroundColor: r.color, marginRight: 6,
                    }} />
                    <Text style={{
                      fontSize: 14,
                      fontWeight: activeTab ? '700' : '400',
                      color: activeTab ? '#FF9800' : '#9E9E9E',
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
                  Noble Privileges
                </Text>
                <View style={{ width: 40, height: 1.5, backgroundColor: '#FFB74D' }} />
              </View>
              <Text style={{ fontSize: 13, color: '#757575', marginTop: 6 }}>
                Experience: {formatXP(selectedRank.minXP)}~{formatXP(selectedRank.maxXP)}
              </Text>
            </View>

            <View style={{
              flexDirection: 'row', flexWrap: 'wrap',
              paddingHorizontal: 32, paddingTop: 12, justifyContent: 'flex-start',
            }}>
              {selectedRank.privileges.map(renderPrivilege)}
            </View>
            {anyLocked && (
              <Text style={{ fontSize: 11, color: '#8E8E93', textAlign: 'center', paddingHorizontal: 40, paddingBottom: 8 }}>
                🔒 = privilege not available yet — it will activate here when it ships.
              </Text>
            )}
            <View style={{ height: 32 }} />
          </>
        )}
      </ScrollView>
    </View>
  );
}
