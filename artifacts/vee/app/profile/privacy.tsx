/**
 * Privacy Settings Screen — Firebase-backed
 * 2026-10-19: restyled to IMO Me-tab design language (#F4F5F5 bg, white
 * cards, 56dp title bar, ~56dp menu rows with 30dp icon tiles). All logic
 * unchanged — every toggle still persists to users/{uid}/privacy.
 */

import { useEffect, useState } from 'react';
import { View, Text, ScrollView, Switch, Pressable, Image, Alert, Platform } from 'react-native';
import PremiumLoader from '@/src/components/PremiumLoader';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { ref, update, onValue } from 'firebase/database';
import { database } from '@/src/config/firebase';
import { useAuth } from '@/src/context/AuthContext';
import { useTranslation } from 'react-i18next';
import {
  subscribeBlockedUsers, unblockUser, BlockRecord } from '@/src/services/blockService';
import { withTimeout } from '@/src/utils/withTimeout';

/** Max ms to wait for an RTDB write ack before treating the save as queued. */
const SAVE_TIMEOUT_MS = 12_000;

// IMO BIUI light tokens (2026-10-19, Me-tab spec): bg #f4f5f5, white cards,
// primary text #25292d, secondary #788187. Boss button standard #E3F2FD/#007AFF kept.
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
  goldBg: '#FFF8E6',
  goldBorder: '#F5D67B',
  goldText: '#B8860B' } as const;

// IMO card container: white, 12dp radius, 15dp side margins
const cardStyle = { backgroundColor: C.card, marginHorizontal: 15, marginTop: 12, borderRadius: 12 } as const;

type PrivacySettings = {
  showOnlineStatus: boolean;
  showLastSeen: boolean;
  allowMessageFromAll: boolean;
  showProfileToAll: boolean;
  allowRoomInvites: boolean;
};

const DEFAULTS: PrivacySettings = {
  showOnlineStatus: true,
  showLastSeen: true,
  allowMessageFromAll: true,
  showProfileToAll: true,
  allowRoomInvites: true };

// ─── IMO title bar: 56dp, back ‹ left, centered 17sp semibold, no gear ───
function TitleBar({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <View style={{ height: 56, backgroundColor: C.card, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 }}>
      <Pressable onPress={() => router.back()} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }} hitSlop={8}>
        <Feather name="chevron-left" size={24} color={C.text} />
      </Pressable>
      <Text style={{ flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600', color: C.text }} numberOfLines={1}>
        {title}
      </Text>
      {right ?? <View style={{ width: 40 }} />}
    </View>
  );
}

// Section caption above a card group
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{ fontSize: 13, color: C.muted, paddingHorizontal: 15, paddingTop: 14, paddingBottom: 6 }}>
      {children}
    </Text>
  );
}

// IMO menu row with trailing Switch — ~56dp, 30dp icon tile,
// 0.5dp divider inset 57dp from left
function SettingRow({
  icon, iconBg, iconColor, label, subtitle, value, onChange, last }: {
  icon: React.ComponentProps<typeof Feather>['name'];
  iconBg: string;
  iconColor: string;
  label: string;
  subtitle?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  last?: boolean;
}) {
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 15 }}>
        <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: iconBg, alignItems: 'center', justifyContent: 'center' }}>
          <Feather name={icon} size={16} color={iconColor} />
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={{ color: C.text, fontSize: 16 }} numberOfLines={1}>{label}</Text>
          {subtitle ? (
            <Text style={{ color: C.muted, fontSize: 12, marginTop: 2 }} numberOfLines={2}>{subtitle}</Text>
          ) : null}
        </View>
        <Switch
          value={value}
          onValueChange={onChange}
          trackColor={{ false: C.mutedLight, true: C.blue }}
          thumbColor="#fff"
        />
      </View>
      {!last && <View style={{ height: 0.5, backgroundColor: C.border, marginLeft: 57 }} />}
    </View>
  );
}

export default function PrivacyScreen() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [settings, setSettings] = useState<PrivacySettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [blockedUsers, setBlockedUsers] = useState<BlockRecord[]>([]);
  const [unblockingUid, setUnblockingUid] = useState<string | null>(null);
  const topPad = Platform.OS === 'web' ? 67 : 0;

  useEffect(() => {
    if (!user?.uid) return;
    const unsub = onValue(ref(database, `users/${user.uid}/privacy`), (snap) => {
      if (snap.exists()) {
        setSettings({ ...DEFAULTS, ...(snap.val() as Partial<PrivacySettings>) });
      }
      setLoading(false);
    });
    // Offline safety: onValue never fires on a cold start with no network
    // (the RTDB JS SDK has no disk persistence, so there is no cached data
    // to replay) — without this the spinner would run forever. Same 3s
    // timeout pattern already used in app/chat/index.tsx.
    const timeout = setTimeout(() => setLoading(false), 3000);
    return () => { clearTimeout(timeout); unsub(); };
  }, [user?.uid]);

  // Subscribe to blocked users list
  useEffect(() => {
    if (!user?.uid) return;
    return subscribeBlockedUsers(user.uid, setBlockedUsers);
  }, [user?.uid]);

  const handleUnblock = async (targetUid: string, targetName: string) => {
    if (!user?.uid) return;
    Alert.alert(
      'Unblock User',
      `Remove ${targetName} from your blocked list?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unblock',
          onPress: async () => {
            setUnblockingUid(targetUid);
            try {
              await unblockUser(user.uid, targetUid);
            } catch {
              Alert.alert(t('privacy.error'), t('privacy.unblockError'));
            } finally {
              setUnblockingUid(null);
            }
          } },
      ],
    );
  };

  const handleToggle = async (key: keyof PrivacySettings) => {
    if (!user?.uid) return;
    const newValue = !settings[key];
    const updated = { ...settings, [key]: newValue };
    setSettings(updated);
    setSaving(true);
    try {
      // Offline resilience: an RTDB write promise only resolves on server
      // ack, so a bare await hangs forever with no feedback while offline.
      // Race the write against a timeout — the write is NOT cancelled (RTDB
      // queues it and replays on reconnect); we just stop showing the saving
      // state and tell the user it is queued. The optimistic toggle stays.
      const result = await withTimeout(
        update(ref(database, `users/${user.uid}/privacy`), { [key]: newValue }),
        SAVE_TIMEOUT_MS,
      );
      if (result.timedOut) {
        Alert.alert(t('privacy.saveQueuedTitle'), t('privacy.saveQueuedMsg'));
        return;
      }
    } catch {
      setSettings(settings); // revert on error
      Alert.alert(t('privacy.error'), t('privacy.saveError'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
        <PremiumLoader size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <View style={{ paddingTop: topPad }}>
        <TitleBar
          title={t('privacy.title')}
          right={saving ? (
            <View style={{ width: 40, alignItems: 'center', justifyContent: 'center' }}>
              <PremiumLoader size="small" />
            </View>
          ) : undefined}
        />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        <SectionLabel>{t('privacy.sectionProfileStatus')}</SectionLabel>
        <View style={[cardStyle, { marginTop: 0, paddingVertical: 2 }]}>
          <SettingRow
            icon="eye" iconBg={C.blueLight} iconColor={C.blue}
            label={t('privacy.showOnlineStatus')}
            subtitle={t('privacy.showOnlineStatusSub')}
            value={settings.showOnlineStatus}
            onChange={() => handleToggle('showOnlineStatus')}
          />
          <SettingRow
            icon="clock" iconBg={C.tile} iconColor={C.muted}
            label={t('privacy.showLastSeen')}
            subtitle={t('privacy.showLastSeenSub')}
            value={settings.showLastSeen}
            onChange={() => handleToggle('showLastSeen')}
          />
          <SettingRow
            icon="globe" iconBg={C.blueLight} iconColor={C.blue}
            label={t('privacy.publicProfile')}
            subtitle={t('privacy.publicProfileSub')}
            value={settings.showProfileToAll}
            onChange={() => handleToggle('showProfileToAll')}
            last
          />
        </View>

        <SectionLabel>{t('privacy.sectionMessagesRooms')}</SectionLabel>
        <View style={[cardStyle, { marginTop: 0, paddingVertical: 2 }]}>
          <SettingRow
            icon="message-circle" iconBg="#E8F5E9" iconColor={C.green}
            label={t('privacy.allowMessageFromAll')}
            subtitle={t('privacy.allowMessageFromAllSub')}
            value={settings.allowMessageFromAll}
            onChange={() => handleToggle('allowMessageFromAll')}
          />
          <SettingRow
            icon="mic" iconBg={C.blueLight} iconColor={C.blue}
            label={t('privacy.allowRoomInvites')}
            subtitle={t('privacy.allowRoomInvitesSub')}
            value={settings.allowRoomInvites}
            onChange={() => handleToggle('allowRoomInvites')}
            last
          />
        </View>

        {/* ── Blocked Users ── */}
        <SectionLabel>BLOCKED USERS</SectionLabel>
        <View style={[cardStyle, { marginTop: 0, paddingVertical: 2 }]}>
          {blockedUsers.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 22 }}>
              <Feather name="slash" size={24} color={C.mutedLight} />
              <Text style={{ color: C.muted, fontSize: 13, marginTop: 10 }}>
                No blocked users
              </Text>
            </View>
          ) : (
            blockedUsers.map((b, i) => (
              <View key={b.targetUid}>
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 15 }}>
                  {b.targetAvatar ? (
                    <Image
                      source={{ uri: b.targetAvatar }}
                      style={{ width: 44, height: 44, borderRadius: 22 }}
                    />
                  ) : (
                    <View style={{
                      width: 44, height: 44, borderRadius: 22,
                      backgroundColor: '#FDECEA',
                      alignItems: 'center', justifyContent: 'center' }}>
                      <Feather name="user" size={20} color="#EF4444" />
                    </View>
                  )}
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={{ color: C.text, fontSize: 16, fontWeight: '500' }} numberOfLines={1}>
                      {b.targetName}
                    </Text>
                    <Text style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>
                      Blocked
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => handleUnblock(b.targetUid, b.targetName)}
                    disabled={unblockingUid === b.targetUid}
                    style={{
                      paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10,
                      backgroundColor: C.blueLight }}
                  >
                    {unblockingUid === b.targetUid ? (
                      <PremiumLoader size="small" />
                    ) : (
                      <Text style={{ color: C.blue, fontSize: 13, fontWeight: '700' }}>
                        Unblock
                      </Text>
                    )}
                  </Pressable>
                </View>
                {i < blockedUsers.length - 1 && (
                  <View style={{ height: 0.5, backgroundColor: C.border, marginLeft: 57 }} />
                )}
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
