/**
 * VoiceRoomBottomBar — extracted from VoiceRoomScreen.tsx (IMO port Phase 1c split).
 * Floating action buttons (mic, speaker, tasks, gift, invite, exit). No logic changes.
 */
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import ScalePress from '@/components/ScalePress';
import { C } from '../constants/theme';
import {
  PulseMicButton, LiquidGoldSpeaker, LiveDateIcon,
  ObsidianGiftButton, SapphireInviteButton, ObsidianExitButton,
} from './VoiceRoomHelpers';

export interface VoiceRoomBottomBarProps {
  keyboardOpen: boolean;
  bottomPad: number;
  handleMicBarPress: () => void;
  mySeatIdx: number;
  muted: boolean;
  accentColor: string;
  toggleSpeaker: () => void;
  speakerOn: boolean;
  setTaskCenterOpen: (v: boolean) => void;
  setGiftsOpen: (v: boolean) => void;
  setInviteOpen: (v: boolean) => void;
  setExitModalOpen: (v: boolean) => void;
}

export function VoiceRoomBottomBar(props: VoiceRoomBottomBarProps) {
  const { t } = useTranslation();
  const {
    keyboardOpen, bottomPad, handleMicBarPress, mySeatIdx, muted, accentColor,
    toggleSpeaker, speakerOn,
    setTaskCenterOpen, setGiftsOpen, setInviteOpen, setExitModalOpen,
  } = props;
  return (
    <>

      {/* ═══ BOTTOM BAR ═══ */}
      {/* 2026-10-15 (Sumon): container background REMOVED — only the round buttons
          float, no bar behind them. ALL buttons uniform 46px circles
          (2026-10-15: Gift resized 56px → 46px per Sumon — same size as others).
          fixed-width items + space-evenly = perfectly equal spacing.
          Hidden while the comment keyboard is open. */}
      {!keyboardOpen && (
      <View style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-evenly',
        paddingBottom: bottomPad, paddingTop: 4, paddingHorizontal: 8,
        backgroundColor: 'transparent' }}>
        {/* CRITICAL-3: Mic bar — "Join Seat" for audience, Mute/Unmute for speakers */}
        <View style={{ flex: 1, alignItems: 'center' }}>
        <ScalePress onPress={handleMicBarPress}>
          <View style={{ alignItems: 'center', gap: 4 }}>
            {/* 2026-10-15 (Sumon): Option C Pulse Ring mic button.
                Join Seat keeps user-plus; seated uses PulseMicButton. */}
<View style={{ height: 50, justifyContent: 'center', alignItems: 'center' }}>
            {mySeatIdx < 0 ? (
              <Feather name="user-plus" size={21} color={accentColor} />
            ) : (
              <PulseMicButton muted={muted} />
            )}
            </View>
            <Text style={{
              color: mySeatIdx < 0 ? accentColor : muted ? C.red : '#007AFF',
              fontSize: 10, fontWeight: '700', textAlign: 'center' }}>
              {mySeatIdx < 0
                ? t('voiceRoom.screen.joinSeat')
                : t('voiceRoom.screen.mic')}
            </Text>
          </View>
        </ScalePress>
        </View>

        {/* Speaker — uniform circle */}
        <View style={{ flex: 1, alignItems: 'center' }}>
        <ScalePress onPress={toggleSpeaker}>
          <View style={{ alignItems: 'center', gap: 4 }}>
            {/* 2026-10-15 (Sumon): Option E Liquid Gold speaker. */}
<View style={{ height: 50, justifyContent: 'center', alignItems: 'center' }}>
                        <LiquidGoldSpeaker speakerOn={speakerOn} />
            </View>
            <Text style={{ color: speakerOn ? '#D4AF37' : C.sub, fontSize: 10, fontWeight: '700', textAlign: 'center' }}>
              {t('voiceRoom.screen.speaker')}
            </Text>
          </View>
        </ScalePress>
        </View>

        {/* Task Center — Royal Gold Calendar button (2026-10-15, Sumon picked Option A).
            The calendar IS the button (no circular wrapper). Date updates live;
            design never changes. */}
        <View style={{ flex: 1, alignItems: 'center' }}>
        <ScalePress onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setTaskCenterOpen(true); }}>
          <View style={{ alignItems: 'center', gap: 4 }}>
<View style={{ height: 50, justifyContent: 'center', alignItems: 'center' }}>
                        <LiveDateIcon />
            </View>
            <Text style={{ color: C.text, fontSize: 10, fontWeight: '700', textAlign: 'center' }}>
              Tasks
            </Text>
          </View>
        </ScalePress>
        </View>

        {/* Gifts — hero */}
        <View style={{ flex: 1, alignItems: 'center' }}>
        <ScalePress onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setGiftsOpen(true); }}>
          <View style={{ alignItems: 'center', gap: 4 }}>
            {/* 2026-10-15 (Sumon): Option C Obsidian Sparkle gift button. */}
<View style={{ height: 50, justifyContent: 'center', alignItems: 'center' }}>
                        <ObsidianGiftButton />
            </View>
            <Text style={{ color: C.text, fontSize: 10, fontWeight: '700', textAlign: 'center' }}>
              {t('voiceRoom.screen.gift')}
            </Text>
          </View>
        </ScalePress>
        </View>

        {/* Invite — uniform circle */}
        <View style={{ flex: 1, alignItems: 'center' }}>
        <ScalePress onPress={() => setInviteOpen(true)}>
          <View style={{ alignItems: 'center', gap: 4 }}>
            {/* 2026-10-15 (Sumon): Option B Sapphire Orbit invite button. */}
<View style={{ height: 50, justifyContent: 'center', alignItems: 'center' }}>
                        <SapphireInviteButton />
            </View>
            <Text style={{ color: C.text, fontSize: 10, fontWeight: '700', textAlign: 'center' }}>
              {t('voiceRoom.screen.invite')}
            </Text>
          </View>
        </ScalePress>
        </View>

        {/* Exit Room — uniform circle */}
        <View style={{ flex: 1, alignItems: 'center' }}>
        <ScalePress onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setExitModalOpen(true); }}>
          <View style={{ alignItems: 'center', gap: 4 }}>
            {/* 2026-10-15 (Sumon): Option B Obsidian Exit button. */}
<View style={{ height: 50, justifyContent: 'center', alignItems: 'center' }}>
                        <ObsidianExitButton />
            </View>
            <Text style={{ color: '#EF4444', fontSize: 10, fontWeight: '700', textAlign: 'center' }}>
              {t('voiceRoom.screen.exit')}
            </Text>
          </View>
        </ScalePress>
        </View>
      </View>
      )}

      {/* ═══ MODALS ═══ */}
      {/* Fix 3/8/9: Cloudinary upload happens inside RoomInfoModal; we persist the URL here */}
    </>
  );
}
