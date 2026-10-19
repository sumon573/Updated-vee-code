/**
 * About Vee Screen
 *
 * Phase 2 QA fix:
 * - Removed Tech Stack section.
 * - Professional About text.
 * - Official Vee logo (app icon image).
 * 2026-10-19 (Sumon): restyled to IMO Me-tab design language —
 * #F4F5F5 bg, white 12dp cards, 56dp title bar, IMO MenuRow link rows.
 * All content + links untouched.
 */

import {
  View, Text, ScrollView, Pressable, Platform, Linking, Image, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

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

// IMO menu row: 30dp rounded-square icon, 16sp label, external-link right
function LinkRow({
  icon, iconBg, iconColor, label, onPress, last,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  iconBg: string;
  iconColor: string;
  label: string;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <View>
      <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 15 }}>
        <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: iconBg, alignItems: 'center', justifyContent: 'center' }}>
          <Feather name={icon} size={16} color={iconColor} />
        </View>
        <Text style={{ flex: 1, fontSize: 16, color: C.text, marginLeft: 12 }} numberOfLines={1}>{label}</Text>
        <Feather name="external-link" size={16} color={C.mutedLight} />
      </Pressable>
      {!last && <View style={{ height: 0.5, backgroundColor: C.border, marginLeft: 57 }} />}
    </View>
  );
}

export default function AboutScreen() {
  const { t } = useTranslation();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <TitleBar title={t('about.title')} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {/* App branding — official Vee logo */}
        <View style={{ alignItems: 'center', marginTop: 24, marginBottom: 8 }}>
          <View style={{
            width: 96, height: 96, borderRadius: 28,
            overflow: 'hidden',
            shadowColor: '#000', shadowOpacity: 0.12,
            shadowRadius: 16, shadowOffset: { width: 0, height: 6 },
            elevation: 8, marginBottom: 16,
          }}>
            <Image
              source={require('@/assets/images/icon.png')}
              style={{ width: 96, height: 96 }}
              resizeMode="cover"
            />
          </View>
          <Text style={{ color: C.text, fontSize: 28, fontWeight: '900' }}>Vee</Text>
          <Text style={{ color: C.muted, fontSize: 14, marginTop: 4 }}>{t('about.version')}</Text>
          <View style={{
            flexDirection: 'row', alignItems: 'center',
            marginTop: 10, backgroundColor: '#E6F7ED',
            borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5,
          }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.green, marginRight: 6 }} />
            <Text style={{ color: C.green, fontSize: 12, fontWeight: '700' }}>
              {t('about.productionBuild')}
            </Text>
          </View>
        </View>

        {/* About text */}
        <View style={[cardStyle, { padding: 18 }]}>
          <Text style={{ color: C.text, fontSize: 15, fontWeight: '800', marginBottom: 8 }}>
            {t('about.aboutHeading')}
          </Text>
          <Text style={{ color: C.muted, fontSize: 14, lineHeight: 22 }}>
            {t('about.aboutText')}
          </Text>
        </View>

        {/* Legal */}
        <Text style={{
          color: C.mutedLight, fontSize: 11, fontWeight: '700',
          letterSpacing: 0.8, marginTop: 20, marginBottom: 2,
          paddingHorizontal: 15,
        }}>
          {t('about.sectionLegal')}
        </Text>
        <View style={cardStyle}>
          <LinkRow
            icon="file-text" iconBg={C.blueLight} iconColor={C.blue}
            label={t('about.termsOfService')}
            onPress={() => Linking.openURL('https://veeapp.com/terms').catch(() => {
              Alert.alert(t('about.error'), t('about.linkError'));
            })}
          />
          <LinkRow
            icon="shield" iconBg="#E6F7ED" iconColor={C.green}
            label={t('about.privacyPolicy')}
            onPress={() => Linking.openURL('https://welcome-to-vee-privacy-guidance.netlify.app/').catch(() => {
              Alert.alert(t('about.error'), t('about.linkError'));
            })}
            last
          />
        </View>

        <Text style={{
          color: C.muted, fontSize: 12,
          textAlign: 'center', marginTop: 24, lineHeight: 18,
          paddingHorizontal: 30,
        }}>
          {t('about.footer')}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
