/**
 * Noble Leaderboard — /leaderboard (2026-10-31, boss).
 *
 * The trophy on My Noble opens here. Shows the top 20 Noble ranks by XP,
 * served by the VPS-maintained `noble_leaderboard` node (clients cannot
 * query users/ directly — users/$uid is per-user read only).
 * Rank #1 gets the premium gold treatment; every row taps through to
 * that user's profile (/user-profile?uid=...).
 */
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, Dimensions } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import PremiumLoader from '@/src/components/PremiumLoader';
import { NOBLE_RANKS } from '@/src/services/nobleService';

const { width } = Dimensions.get('window');

type Entry = {
  uid: string;
  name: string;
  photoURL?: string;
  rankIndex: number;
  xp: number;
};

function DP({ photoURL, name, size }: { photoURL?: string; name: string; size: number }) {
  if (photoURL) {
    return (
      <Image
        source={{ uri: photoURL }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        contentFit="cover"
      />
    );
  }
  const initial = (name || 'V').trim().charAt(0).toUpperCase() || 'V';
  return (
    <View
      style={{
        width: size, height: size, borderRadius: size / 2,
        backgroundColor: '#7E57C2', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Text style={{ fontSize: size * 0.4, fontWeight: '800', color: '#fff' }}>{initial}</Text>
    </View>
  );
}

function RankPill({ rankIndex }: { rankIndex: number }) {
  const rank = NOBLE_RANKS[rankIndex] || NOBLE_RANKS[0];
  return (
    <View
      style={{
        height: 20, borderRadius: 10, paddingHorizontal: 8,
        backgroundColor: rank.color, alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Text style={{ fontSize: 11, fontWeight: '700', color: '#fff' }}>
        {rank.name.toUpperCase()}
      </Text>
    </View>
  );
}

export default function LeaderboardScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  useEffect(() => {
    let unsub: (() => void) | null = null;
    (async () => {
      try {
        const { ref, onValue } = await import('firebase/database');
        const { database } = await import('@/src/config/firebase');
        unsub = onValue(ref(database, 'noble_leaderboard'), (snap) => {
          const v = snap.val();
          if (v && Array.isArray(v.entries)) {
            setEntries(v.entries);
            setUpdatedAt(typeof v.updatedAt === 'number' ? v.updatedAt : null);
          } else {
            setEntries([]);
          }
          setLoading(false);
        });
      } catch {
        setLoading(false);
      }
    })();
    const timeout = setTimeout(() => setLoading(false), 8000);
    return () => {
      clearTimeout(timeout);
      try { unsub?.(); } catch { /* non-critical */ }
    };
  }, []);

  const formatXP = (xp: number) => {
    if (xp >= 1000000) return `${(xp / 1000000).toFixed(1)}M`;
    if (xp >= 1000) return `${(xp / 1000).toFixed(1)}K`;
    return `${xp}`;
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <View
        style={{
          flexDirection: 'row', alignItems: 'center',
          paddingTop: 50, paddingHorizontal: 16, paddingBottom: 12,
          borderBottomWidth: 1, borderBottomColor: '#F0F0F0',
        }}
      >
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Feather name="arrow-left" size={28} color="#000" />
        </Pressable>
        <Text style={{ fontSize: 28, fontWeight: '700', color: '#000', marginLeft: 16, flex: 1 }}>
          Noble Leaderboard
        </Text>
        <MaterialIcons name="emoji-events" size={26} color="#C9A227" />
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <PremiumLoader size="large" />
        </View>
      ) : entries.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 }}>
          <Text style={{ fontSize: 16, color: '#7F8C8D', textAlign: 'center' }}>
            No rankings yet — check back soon.
          </Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false}>
          <Text style={{ fontSize: 13, color: '#9E9E9E', textAlign: 'center', marginTop: 12 }}>
            Top 20 · Noble XP
          </Text>
          {entries.map((e, i) => {
            const isTop = i === 0;
            const inner = (
              <>
                <Text
                  style={{
                    width: 28, fontSize: isTop ? 20 : 16, fontWeight: '800',
                    color: isTop ? '#C9A227' : '#9E9E9E', textAlign: 'center',
                  }}
                >
                  {i + 1}
                </Text>
                {isTop ? (
                  <View
                    style={{
                      borderWidth: 3, borderColor: '#C9A227', borderRadius: 34,
                      marginLeft: 8, marginRight: 4,
                    }}
                  >
                    <DP photoURL={e.photoURL} name={e.name} size={64} />
                  </View>
                ) : (
                  <View style={{ marginLeft: 8, marginRight: 4 }}>
                    <DP photoURL={e.photoURL} name={e.name} size={48} />
                  </View>
                )}
                <View style={{ flex: 1, marginLeft: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text
                      style={{ fontSize: isTop ? 18 : 16, fontWeight: '800', color: '#000', flexShrink: 1 }}
                      numberOfLines={1}
                    >
                      {e.name}
                    </Text>
                    {isTop && (
                      <View
                        style={{
                          marginLeft: 8, backgroundColor: '#C9A227', borderRadius: 10,
                          paddingHorizontal: 8, height: 20, alignItems: 'center', justifyContent: 'center',
                        }}
                      >
                        <Text style={{ fontSize: 11, fontWeight: '800', color: '#fff' }}>TOP 1</Text>
                      </View>
                    )}
                  </View>
                  <View style={{ marginTop: 6, alignSelf: 'flex-start' }}>
                    <RankPill rankIndex={e.rankIndex} />
                  </View>
                </View>
                <Text style={{ fontSize: isTop ? 17 : 15, fontWeight: '800', color: '#212121', marginLeft: 8 }}>
                  {formatXP(e.xp)}
                </Text>
              </>
            );
            return (
              <Pressable
                key={e.uid}
                onPress={() => router.push(`/user-profile?uid=${e.uid}&name=${encodeURIComponent(e.name)}` as never)}
              >
                {isTop ? (
                  <LinearGradient
                    colors={['#FFF8E1', '#FFECB3']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={{
                      flexDirection: 'row', alignItems: 'center',
                      marginHorizontal: 16, marginTop: 12, borderRadius: 16, padding: 16,
                      borderWidth: 1, borderColor: '#C9A227',
                    }}
                  >
                    {inner}
                  </LinearGradient>
                ) : (
                  <View
                    style={{
                      flexDirection: 'row', alignItems: 'center',
                      marginHorizontal: 16, marginTop: 12, borderRadius: 16, padding: 12,
                      backgroundColor: '#FAFAFA', borderWidth: 1, borderColor: '#F0F0F0',
                    }}
                  >
                    {inner}
                  </View>
                )}
              </Pressable>
            );
          })}
          {updatedAt && (
            <Text style={{ fontSize: 12, color: '#9E9E9E', textAlign: 'center', marginVertical: 20 }}>
              Updated {new Date(updatedAt).toLocaleString()}
            </Text>
          )}
          <View style={{ height: 16 }} />
        </ScrollView>
      )}
    </View>
  );
}
