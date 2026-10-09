/**
 * AdminPanel — Hidden admin tools (2026-10-09).
 *
 * Only visible to users in admins/{uid} (checked via isCurrentUserAdmin).
 * - Grant custom short ID (digits only, any length 1-8) to any user/room
 * - Grant/revoke official verified badge
 *
 * Access: hidden — e.g. via settings (admin-only row).
 */

import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, TextInput,
  ActivityIndicator, Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  adminGrantShortId, adminGrantOfficialBadge, adminRevokeOfficialBadge,
  isCurrentUserAdmin,
} from './shortIdService';

const C = {
  bg: '#FFFFFF',
  primary: '#7C3AED',
  text: '#000000',
  muted: '#8E8E93',
  border: '#E5E5EA',
  surface: '#F2F2F7',
  gold: '#FFD700',
  green: '#22C55E',
  red: '#EF4444',
} as const;

export function AdminPanel() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [targetUid, setTargetUid] = useState('');
  const [customId, setCustomId] = useState('');
  const [idKind, setIdKind] = useState<'users' | 'rooms'>('users');
  const [working, setWorking] = useState(false);

  useEffect(() => {
    isCurrentUserAdmin().then(setIsAdmin).catch(() => setIsAdmin(false));
  }, []);

  const handleGrantId = async () => {
    if (!targetUid.trim() || !customId.trim()) {
      Alert.alert('Error', 'Enter target UID and custom ID');
      return;
    }
    if (!/^[0-9]{1,8}$/.test(customId.trim())) {
      Alert.alert('Error', 'ID must be digits only (1-8 digits)');
      return;
    }
    setWorking(true);
    try {
      const result = await adminGrantShortId(idKind, customId.trim(), targetUid.trim());
      if (result.success) {
        Alert.alert('Success', `ID ${customId} granted! 🎉`);
        setCustomId('');
      } else {
        Alert.alert('Error', result.error ?? 'Failed');
      }
    } finally {
      setWorking(false);
    }
  };

  const handleGrantBadge = async () => {
    if (!targetUid.trim()) {
      Alert.alert('Error', 'Enter target UID');
      return;
    }
    setWorking(true);
    try {
      const result = await adminGrantOfficialBadge(targetUid.trim());
      Alert.alert(result.success ? 'Success' : 'Error',
        result.success ? 'Official badge granted! ✅' : (result.error ?? 'Failed'));
    } finally {
      setWorking(false);
    }
  };

  const handleRevokeBadge = async () => {
    if (!targetUid.trim()) {
      Alert.alert('Error', 'Enter target UID');
      return;
    }
    setWorking(true);
    try {
      const result = await adminRevokeOfficialBadge(targetUid.trim());
      Alert.alert(result.success ? 'Success' : 'Error',
        result.success ? 'Official badge revoked.' : (result.error ?? 'Failed'));
    } finally {
      setWorking(false);
    }
  };

  if (isAdmin === null) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={C.primary} size="large" />
      </View>
    );
  }

  if (!isAdmin) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 30 }}>
        <Feather name="lock" size={48} color={C.muted} />
        <Text style={{ color: C.muted, fontSize: 16, fontWeight: '700', marginTop: 16, textAlign: 'center' }}>
          Admin access only
        </Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: 20 }}>
          <Text style={{ color: C.primary, fontWeight: '700' }}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 20 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 24 }}>
            <Pressable onPress={() => router.back()} hitSlop={14} style={{ marginRight: 12 }}>
              <Feather name="arrow-left" size={24} color={C.text} />
            </Pressable>
            <Text style={{ color: C.text, fontSize: 20, fontWeight: '900' }}>
              🛡️ Admin Panel
            </Text>
          </View>

          {/* Target */}
          <Text style={{ color: C.text, fontWeight: '800', marginBottom: 8 }}>Target User UID / Room ID</Text>
          <TextInput
            value={targetUid}
            onChangeText={setTargetUid}
            placeholder="Enter UID or Room ID"
            placeholderTextColor={C.muted}
            autoCapitalize="none"
            style={{
              backgroundColor: C.surface, borderRadius: 12, padding: 14,
              color: C.text, borderWidth: 1, borderColor: C.border, marginBottom: 20,
            }}
          />

          {/* Custom Short ID */}
          <View style={{ backgroundColor: C.surface, borderRadius: 16, padding: 16, marginBottom: 16 }}>
            <Text style={{ color: C.text, fontSize: 16, fontWeight: '900', marginBottom: 12 }}>
              🆔 Grant Custom Short ID
            </Text>
            <View style={{ flexDirection: 'row', marginBottom: 12 }}>
              {(['users', 'rooms'] as const).map((k) => (
                <Pressable
                  key={k}
                  onPress={() => setIdKind(k)}
                  style={{
                    flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center',
                    backgroundColor: idKind === k ? C.primary : '#fff', marginRight: k === 'users' ? 8 : 0,
                  }}
                >
                  <Text style={{ color: idKind === k ? '#fff' : C.muted, fontWeight: '700' }}>
                    {k === 'users' ? 'User' : 'Room'}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              value={customId}
              onChangeText={setCustomId}
              placeholder="Digits only, e.g. 7 or 88888"
              placeholderTextColor={C.muted}
              keyboardType="numeric"
              style={{
                backgroundColor: '#fff', borderRadius: 12, padding: 14,
                color: C.text, borderWidth: 1, borderColor: C.border, marginBottom: 12,
                fontSize: 18, fontWeight: '800', textAlign: 'center',
              }}
            />
            <Pressable
              onPress={handleGrantId}
              disabled={working}
              style={{
                backgroundColor: C.gold, borderRadius: 12, padding: 14,
                alignItems: 'center', opacity: working ? 0.6 : 1,
              }}
            >
              <Text style={{ color: '#000', fontWeight: '900' }}>Grant Custom ID</Text>
            </Pressable>
          </View>

          {/* Official Badge */}
          <View style={{ backgroundColor: C.surface, borderRadius: 16, padding: 16 }}>
            <Text style={{ color: C.text, fontSize: 16, fontWeight: '900', marginBottom: 12 }}>
              ✅ Official Verified Badge
            </Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable
                onPress={handleGrantBadge}
                disabled={working}
                style={{
                  flex: 1, backgroundColor: C.green, borderRadius: 12,
                  padding: 14, alignItems: 'center', opacity: working ? 0.6 : 1,
                }}
              >
                <Text style={{ color: '#fff', fontWeight: '900' }}>Grant</Text>
              </Pressable>
              <Pressable
                onPress={handleRevokeBadge}
                disabled={working}
                style={{
                  flex: 1, backgroundColor: C.red, borderRadius: 12,
                  padding: 14, alignItems: 'center', opacity: working ? 0.6 : 1,
                }}
              >
                <Text style={{ color: '#fff', fontWeight: '900' }}>Revoke</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
