/**
 * Profile — Decoration Screen
 * Shows owned avatar frames and nameplates. New users start with none.
 */
import { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuth } from '@/src/context/AuthContext';
import { subscribeUser, updateUser, VeeUser } from '@/src/services/userService';
import * as Haptics from 'expo-haptics';
// Nameplate catalog lives in the shared honor module (also used by the Honor screen).
import { NAMEPLATES } from '@/src/data/honor';

const C = {
  bg: '#FFFFFF',
  card: '#F2F2F7',
  text: '#000000',
  muted: '#8E8E93',
  border: '#E5E5EA',
  blue: '#007AFF',
  blueLight: '#E3F2FF',
} as const;

// Available frames (earned through activity)
const FRAMES = [
  { id: 'gold', name: 'Gold Frame', icon: '🟡', requirement: 'Reach Lv.5' },
  { id: 'diamond', name: 'Diamond Frame', icon: '💎', requirement: 'Reach Lv.10' },
  { id: 'crown', name: 'Crown Frame', icon: '👑', requirement: '100 followers' },
  { id: 'fire', name: 'Fire Frame', icon: '🔥', requirement: 'Host 10 rooms' },
];

export default function DecorationScreen() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<VeeUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'frames' | 'nameplates'>('frames');

  useEffect(() => {
    if (!user?.uid) { setLoading(false); return; }
    const unsub = subscribeUser(user.uid, (u) => { setProfile(u); setLoading(false); });
    const timeout = setTimeout(() => setLoading(false), 3000);
    return () => { clearTimeout(timeout); unsub(); };
  }, [user?.uid]);

  const handleEquip = async (type: 'frame' | 'nameplate', id: string) => {
    if (!user?.uid) return;
    const owned = type === 'frame' ? (profile?.ownedFrames || []) : (profile?.ownedNameplates || []);
    if (!owned.includes(id)) {
      Alert.alert('Not owned', 'You need to earn this decoration first.');
      return;
    }
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (type === 'frame') {
        await updateUser(user.uid, { activeFrame: id });
      } else {
        await updateUser(user.uid, { activeNameplate: id });
      }
    } catch {
      Alert.alert('Error', 'Could not equip decoration.');
    }
  };

  const items = tab === 'frames' ? FRAMES : NAMEPLATES;
  const owned = tab === 'frames' ? (profile?.ownedFrames || []) : (profile?.ownedNameplates || []);
  const active = tab === 'frames' ? profile?.activeFrame : profile?.activeNameplate;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 }}>
        <Pressable onPress={() => router.back()} style={{ padding: 8 }} hitSlop={12}>
          <Feather name="arrow-left" size={24} color={C.text} />
        </Pressable>
        <Text style={{ fontSize: 18, fontWeight: '800', color: C.text, marginLeft: 4 }}>Decoration</Text>
      </View>

      <View style={{ flexDirection: 'row', paddingHorizontal: 16, marginBottom: 12 }}>
        {(['frames', 'nameplates'] as const).map((t) => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            style={{
              flex: 1, paddingVertical: 10, alignItems: 'center',
              borderBottomWidth: 2,
              borderBottomColor: tab === t ? C.text : 'transparent',
            }}
          >
            <Text style={{ fontSize: 15, fontWeight: tab === t ? '800' : '500', color: tab === t ? C.text : C.muted }}>
              {t === 'frames' ? 'Frames' : 'Nameplates'}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={C.blue} size="large" />
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}>
          {items.map((item) => {
            const isOwned = owned.includes(item.id);
            const isActive = active === item.id;
            return (
              <Pressable
                key={item.id}
                onPress={() => handleEquip(tab === 'frames' ? 'frame' : 'nameplate', item.id)}
                style={{
                  flexDirection: 'row', alignItems: 'center',
                  backgroundColor: C.card, borderRadius: 16, padding: 16, marginBottom: 12,
                  borderWidth: isActive ? 2 : 0, borderColor: C.blue,
                }}
              >
                <Text style={{ fontSize: 40 }}>{item.icon}</Text>
                <View style={{ flex: 1, marginLeft: 14 }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: C.text }}>{item.name}</Text>
                  <Text style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>{item.requirement}</Text>
                </View>
                {isActive ? (
                  <View style={{ backgroundColor: C.blueLight, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: C.blue }}>Active</Text>
                  </View>
                ) : isOwned ? (
                  <Text style={{ fontSize: 13, fontWeight: '600', color: C.blue }}>Tap to equip</Text>
                ) : (
                  <Feather name="lock" size={20} color={C.muted} />
                )}
              </Pressable>
            );
          })}
          {items.length === 0 && (
            <View style={{ alignItems: 'center', paddingTop: 60 }}>
              <Text style={{ fontSize: 15, color: C.muted }}>No decorations yet</Text>
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
