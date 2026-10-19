/**
 * Help & Support Screen
 * 2026-10-19 (Sumon): restyled to IMO Me-tab design language —
 * #F4F5F5 bg, white 12dp cards, 56dp title bar, boss-standard button.
 * All content + FAQ logic untouched.
 */

import { useState } from 'react';
import {
  View, Text, ScrollView, Pressable,
  Platform, Linking, LayoutAnimation, Alert,
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
  blueLight: '#E3F2FD' } as const;

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

function FAQItem({ question, answer, last }: { question: string; answer: string; last?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Pressable
        onPress={() => {
          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
          setOpen((p) => !p);
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16 }}>
          <Text style={{ flex: 1, color: C.text, fontSize: 14, fontWeight: '700', lineHeight: 20 }}>
            {question}
          </Text>
          <Feather name={open ? 'chevron-up' : 'chevron-down'} size={18} color={C.mutedLight} style={{ marginLeft: 10 }} />
        </View>
        {open && (
          <View style={{
            paddingHorizontal: 16, paddingBottom: 16,
            borderTopWidth: 0.5, borderTopColor: C.border,
          }}>
            <Text style={{ color: C.muted, fontSize: 13, lineHeight: 20, marginTop: 10 }}>
              {answer}
            </Text>
          </View>
        )}
      </Pressable>
      {!last && <View style={{ height: 0.5, backgroundColor: C.border }} />}
    </View>
  );
}

export default function HelpScreen() {
  const { t } = useTranslation();

  const faqs = [
    { q: t('help.faq1Q'), a: t('help.faq1A') },
    { q: t('help.faq2Q'), a: t('help.faq2A') },
    { q: t('help.faq3Q'), a: t('help.faq3A') },
    { q: t('help.faq4Q'), a: t('help.faq4A') },
    { q: t('help.faq5Q'), a: t('help.faq5A') },
    { q: t('help.faq6Q'), a: t('help.faq6A') },
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
      <TitleBar title={t('help.title')} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        {/* Contact */}
        <View style={[cardStyle, { padding: 18 }]}>
          <Text style={{ color: C.text, fontSize: 16, fontWeight: '800', marginBottom: 4 }}>
            {t('help.contactHeading')}
          </Text>
          <Text style={{ color: C.muted, fontSize: 13, lineHeight: 20 }}>
            {t('help.contactSub')}
          </Text>
          <Pressable
            onPress={() => Linking.openURL('mailto:veesupport0@gmail.com').catch(() => {
              Alert.alert(t('help.error'), t('help.linkError'));
            })}
            style={{
              flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
              backgroundColor: C.blueLight, borderRadius: 12,
              paddingHorizontal: 16, paddingVertical: 10, marginTop: 14,
            }}
          >
            <Feather name="mail" size={16} color={C.blue} style={{ marginRight: 8 }} />
            <Text style={{ color: C.blue, fontWeight: '700', fontSize: 13 }}>
              {t('help.emailUs')}
            </Text>
          </Pressable>
        </View>

        <Text style={{
          color: C.mutedLight, fontSize: 11, fontWeight: '700',
          letterSpacing: 0.8, marginTop: 20, marginBottom: 2,
          paddingHorizontal: 15,
        }}>
          {t('help.faqSection')}
        </Text>

        <View style={cardStyle}>
          {faqs.map((faq, i) => (
            <FAQItem key={i} question={faq.q} answer={faq.a} last={i === faqs.length - 1} />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
