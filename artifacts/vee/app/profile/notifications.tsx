/**
 * Notifications Settings Screen — Firebase-backed
 * Persists all toggles to: users/{uid}/notificationSettings
 * 2026-10-19 (Sumon): restyled to IMO Me-tab design language —
 * #F4F5F5 bg, white 12dp cards, 56dp title bar, 30dp icon tiles,
 * IMO green switches. All logic untouched.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, Switch, Pressable, Platform, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ref, get, update } from 'firebase/database';
import { database } from '@/src/config/firebase';
import { useAuth } from '@/src/context/AuthContext';

// IMO BIUI light tokens (matches app/profile/index.tsx)
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
  green: '#34C759' } as const;

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

// IMO section caption
function SectionCaption({ label }: { label: string }) {
  return (
    <Text style={{
      color: C.muted, fontSize: 12, fontWeight: '700',
      letterSpacing: 0.8, marginTop: 16, marginBottom: 2,
      paddingHorizontal: 15 }}>
      {label}
    </Text>
  );
}

type NotifSettings = {
  messages: boolean;
  voiceRooms: boolean;
  follows: boolean;
  mentions: boolean;
  stories: boolean;
  sounds: boolean;
  vibration: boolean;
};

const DEFAULTS: NotifSettings = {
  messages: true,
  voiceRooms: true,
  follows: true,
  mentions: true,
  stories: false,
  sounds: true,
  vibration: true,
};

function SettingRow({
  icon, iconBg, iconColor, label, subtitle, value, onChange, last,
}: {
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
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        paddingVertical: 13, paddingHorizontal: 15,
      }}>
        <View style={{
          width: 30, height: 30, borderRadius: 8,
          backgroundColor: iconBg,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Feather name={icon} size={16} color={iconColor} />
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={{ color: C.text, fontSize: 16 }}>{label}</Text>
          {subtitle ? (
            <Text style={{ color: C.muted, fontSize: 14, marginTop: 2 }}>{subtitle}</Text>
          ) : null}
        </View>
        <Switch
          value={value}
          onValueChange={onChange}
          trackColor={{ false: C.mutedLight, true: C.green }}
          thumbColor="#fff"
        />
      </View>
      {!last && <View style={{ height: 0.5, backgroundColor: C.border, marginLeft: 57 }} />}
    </View>
  );
}

export default function NotificationsScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const [settings, setSettings] = useState<NotifSettings>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);

  // ── Load from Firebase on mount ─────────────────────────────────────────
  useEffect(() => {
    if (!user?.uid) return;
    get(ref(database, `users/${user.uid}/notificationSettings`))
      .then((snap) => {
        if (snap.exists()) {
          setSettings((prev) => ({ ...prev, ...(snap.val() as Partial<NotifSettings>) }));
        }
      })
      .catch(() => {
        Alert.alert(t('notifications.error'), t('notifications.loadError'));
      })
      .finally(() => setLoaded(true));
  }, [user?.uid, t]);

  // ── Toggle + persist ──────────────────────────────────────────────────
  const toggle = useCallback(
    (key: keyof NotifSettings) => {
      const newVal = !settings[key];
      setSettings((prev) => ({ ...prev, [key]: newVal }));
      if (user?.uid) {
        update(ref(database, `users/${user.uid}/notificationSettings`), { [key]: newVal })
          .catch(() => {
            Alert.alert(t('notifications.error'), t('notifications.saveError'));
          });
      }
    },
    [settings, user?.uid, t],
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <TitleBar title={t('notifications.title')} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        <SectionCaption label={t('notifications.sectionAlerts')} />
        <View style={cardStyle}>
          <SettingRow
            icon="message-circle" iconBg={C.blueLight} iconColor={C.blue}
            label={t('notifications.messages')}
            subtitle={t('notifications.messagesSub')}
            value={settings.messages}
            onChange={() => toggle('messages')}
          />
          <SettingRow
            icon="mic" iconBg="#F1E8FF" iconColor="#8B5CF6"
            label={t('notifications.voiceRooms')}
            subtitle={t('notifications.voiceRoomsSub')}
            value={settings.voiceRooms}
            onChange={() => toggle('voiceRooms')}
          />
          <SettingRow
            icon="user-plus" iconBg="#E6F7ED" iconColor="#34C759"
            label={t('notifications.newFollowers')}
            subtitle={t('notifications.newFollowersSub')}
            value={settings.follows}
            onChange={() => toggle('follows')}
          />
          <SettingRow
            icon="at-sign" iconBg="#FFF4E0" iconColor="#F59E0B"
            label={t('notifications.mentions')}
            subtitle={t('notifications.mentionsSub')}
            value={settings.mentions}
            onChange={() => toggle('mentions')}
          />
          <SettingRow
            icon="circle" iconBg="#FDE8E8" iconColor="#FF3B30"
            label={t('notifications.stories')}
            subtitle={t('notifications.storiesSub')}
            value={settings.stories}
            onChange={() => toggle('stories')}
            last
          />
        </View>

        <SectionCaption label={t('notifications.sectionSound')} />
        <View style={cardStyle}>
          <SettingRow
            icon="volume-2" iconBg={C.blueLight} iconColor={C.blue}
            label={t('notifications.sounds')}
            value={settings.sounds}
            onChange={() => toggle('sounds')}
          />
          <SettingRow
            icon="activity" iconBg="#F1E8FF" iconColor="#8B5CF6"
            label={t('notifications.vibration')}
            value={settings.vibration}
            onChange={() => toggle('vibration')}
            last
          />
        </View>

        <View style={[cardStyle, { padding: 15 }]}>
          <Text style={{ color: C.muted, fontSize: 12, lineHeight: 18 }}>
            {t('notifications.pushHint')}
          </Text>
        </View>

        {!loaded && (
          <Text style={{ color: C.mutedLight, fontSize: 11, textAlign: 'center', marginTop: 12 }}>
            {t('notifications.loadingPrefs')}
          </Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
