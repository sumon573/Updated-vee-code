/**
 * Honor Screen — IMO-style badges and nameplates.
 * Users earn badges via activity; admins can grant officially.
 * New users start with ZERO badges.
 */
import { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/context/AuthContext';
import { useTheme } from '@/src/context/ThemeContext';
import {
  subscribeUserBadges, subscribeBadgeDefs, Badge,
} from '@/src/services/honorService';

export default function HonorScreen() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const { theme: C } = useTheme();
  const [badges, setBadges] = useState<Badge[]>([]);
  const [earned, setEarned] = useState<Record<string, any>>({});
  const [tab, setTab] = useState<'badges' | 'nameplates'>('badges');

  useEffect(() => {
    const unsub1 = subscribeBadgeDefs(setBadges);
    const unsub2 = user?.uid ? subscribeUserBadges(user.uid, setEarned) : () => {};
    return () => { unsub1(); unsub2(); };
  }, [user?.uid]);

  const earnedCount = Object.keys(earned).length;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView style={{ flex: 1 }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16 }}>
          <Pressable onPress={() => router.back()}>
            <Feather name="arrow-left" size={22} color={C.text} />
          </Pressable>
          <Text style={{ color: C.text, fontSize: 18, fontWeight: '800', marginLeft: 12, flex: 1 }}>
            {t('honor.title', 'Honor')}
          </Text>
          <Pressable>
            <Feather name="help-circle" size={20} color={C.muted} />
          </Pressable>
        </View>

        {/* Tabs */}
        <View style={{ flexDirection: 'row', paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: C.border }}>
          {(['badges', 'nameplates'] as const).map((tb) => (
            <Pressable key={tb} onPress={() => setTab(tb)}
              style={{ paddingVertical: 12, marginRight: 24, borderBottomWidth: 2,
                borderBottomColor: tab === tb ? C.primary : 'transparent' }}>
              <Text style={{ color: tab === tb ? C.primary : C.muted, fontSize: 15, fontWeight: tab === tb ? '800' : '500' }}>
                {tb === 'badges' ? t('honor.badges', 'Badges') + ` ${earnedCount}` : t('honor.nameplates', 'Nameplates')}
              </Text>
            </Pressable>
          ))}
        </View>

        <ScrollView contentContainerStyle={{ padding: 16 }}>
          {tab === 'badges' ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
              {badges.map((b) => {
                const isEarned = !!earned[b.id];
                return (
                  <View key={b.id} style={{
                    width: '30%', aspectRatio: 0.85,
                    backgroundColor: C.surface, borderRadius: 14,
                    alignItems: 'center', justifyContent: 'center', padding: 10,
                    borderWidth: 1, borderColor: C.border,
                    opacity: isEarned ? 1 : 0.45,
                  }}>
                    <Text style={{ fontSize: 36 }}>{b.icon}</Text>
                    <Text style={{ color: C.text, fontSize: 11, fontWeight: '700', marginTop: 6, textAlign: 'center' }} numberOfLines={2}>
                      {b.name}
                    </Text>
                    <View style={{ flexDirection: 'row', marginTop: 4 }}>
                      {Array.from({ length: b.stars }).map((_, i) => (
                        <Text key={i} style={{ fontSize: 8, color: C.gold }}>★</Text>
                      ))}
                    </View>
                    {!isEarned && (
                      <Text style={{ color: C.muted, fontSize: 9, marginTop: 4, textAlign: 'center' }} numberOfLines={2}>
                        {b.requirement}
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          ) : (
            <View style={{ alignItems: 'center', paddingVertical: 40 }}>
              <Feather name="award" size={48} color={C.mutedDim} />
              <Text style={{ color: C.muted, fontSize: 14, marginTop: 12 }}>
                {t('honor.noNameplates', 'No nameplates yet')}
              </Text>
              <Text style={{ color: C.mutedDim, fontSize: 12, marginTop: 4, textAlign: 'center', paddingHorizontal: 40 }}>
                {t('honor.nameplateHint', 'Earn nameplates through room activity')}
              </Text>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
