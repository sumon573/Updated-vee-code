/**
 * VoiceRoomBottomBar — extracted from VoiceRoomScreen.tsx (IMO port Phase 1c split).
 * Floating action buttons (mic, speaker, tasks, gift, games, invite, exit). No logic changes.
 * 2026-10-22 (Sumon): text labels under the buttons REMOVED — icon-only bar,
 * slimmer, and the reclaimed height goes to the seats/chat above.
 */
import React from 'react';
import { View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import ScalePress from '@/components/ScalePress';
import {
  PulseMicButton, LiquidGoldSpeaker, LiveDateIcon,
  ObsidianGiftButton, NeonGamepadButton, SapphireInviteButton, ObsidianExitButton,
} from './VoiceRoomHelpers';

export interface VoiceRoomBottomBarProps {
  keyboardOpen: boolean;
  bottomPad: number;
  handleMicBarPress: () => void;
  mySeatIdx: number;
  muted: boolean;
  accentColor: string;
  /** 2026-10-21 (boss): theme-aware label colors (labels sit on the room
      background). Defaults keep the light look. */
  onBg?: string;
  onBgSub?: string;
  toggleSpeaker: () => void;
  speakerOn: boolean;
  setTaskCenterOpen: (v: boolean) => void;
  setGiftsOpen: (v: boolean) => void;
  setGamesOpen: (v: boolean) => void;
  setInviteOpen: (v: boolean) => void;
  setExitModalOpen: (v: boolean) => void;
  /** 2026-10-27 (boss, imo audience header): audience view shows the
      exit X in the header instead — hide the below-screen cross so it
      exists only once (moved, not duplicated). */
  hideExit?: boolean;
}

export function VoiceRoomBottomBar(props: VoiceRoomBottomBarProps) {
  const {
    keyboardOpen, bottomPad, handleMicBarPress, mySeatIdx, muted, accentColor,
    toggleSpeaker, speakerOn,
    setTaskCenterOpen, setGiftsOpen, setGamesOpen, setInviteOpen, setExitModalOpen,
    hideExit,
  } = props;
  return (
    <>

      {/* ═══ BOTTOM BAR ═══ */}
      {/* 2026-10-15 (Sumon): container background REMOVED — only the round buttons
          float, no bar behind them. ALL buttons uniform 46px circles
          (2026-10-15: Gift resized 56px → 46px per Sumon — same size as others).
          fixed-width items + space-evenly = perfectly equal spacing.
          Opacity-hidden (kept mounted) while the comment keyboard is open — 2026-10-26 typing-jitter fix. */}
      {/* 2026-10-26 (typing-jitter fix): kept mounted, opacity-hidden while
          the comment keyboard is open — unmount/remount restarted every
          button animation on each keyboard cycle. */}
      <View
        pointerEvents={keyboardOpen ? 'none' : 'auto'}
        style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-evenly',
        paddingBottom: bottomPad, paddingTop: 4, paddingHorizontal: 8,
        opacity: keyboardOpen ? 0 : 1,
        backgroundColor: 'transparent' }}>
        {/* CRITICAL-3: Mic bar — "Join Seat" for audience, Mute/Unmute for speakers */}
        <View style={{ flex: 1, alignItems: 'center' }}>
        <ScalePress onPress={handleMicBarPress}>
          <View style={{ alignItems: 'center' }}>
            {/* 2026-10-15 (Sumon): Option C Pulse Ring mic button.
                Join Seat keeps user-plus; seated uses PulseMicButton. */}
<View style={{ height: 50, justifyContent: 'center', alignItems: 'center' }}>
            {mySeatIdx < 0 ? (
              <Feather name="user-plus" size={21} color={accentColor} />
            ) : (
              <PulseMicButton muted={muted} />
            )}
            </View>
          </View>
        </ScalePress>
        </View>

        {/* Speaker — uniform circle */}
        <View style={{ flex: 1, alignItems: 'center' }}>
        <ScalePress onPress={toggleSpeaker}>
          <View style={{ alignItems: 'center' }}>
            {/* 2026-10-15 (Sumon): Option E Liquid Gold speaker. */}
<View style={{ height: 50, justifyContent: 'center', alignItems: 'center' }}>
                        <LiquidGoldSpeaker speakerOn={speakerOn} />
            </View>
          </View>
        </ScalePress>
        </View>

        {/* Task Center — Royal Gold Calendar button (2026-10-15, Sumon picked Option A).
            The calendar IS the button (no circular wrapper). Date updates live;
            design never changes. */}
        <View style={{ flex: 1, alignItems: 'center' }}>
        <ScalePress onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setTaskCenterOpen(true); }}>
          <View style={{ alignItems: 'center' }}>
<View style={{ height: 50, justifyContent: 'center', alignItems: 'center' }}>
                        <LiveDateIcon />
            </View>
          </View>
        </ScalePress>
        </View>

        {/* Gifts — hero */}
        <View style={{ flex: 1, alignItems: 'center' }}>
        <ScalePress onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setGiftsOpen(true); }}>
          <View style={{ alignItems: 'center' }}>
            {/* 2026-10-15 (Sumon): Option C Obsidian Sparkle gift button. */}
<View style={{ height: 50, justifyContent: 'center', alignItems: 'center' }}>
                        <ObsidianGiftButton />
            </View>
          </View>
        </ScalePress>
        </View>

        {/* Games — 2026-10-25 (Sumon picked the neon gamepad): opens the
            games hub (RoomGamesModal) listing every game — Ludu today,
            future games as they are added. Same flex:1 slot + 50-high
            wrapper + 52×52 button box as every sibling: EXACTLY the same
            size, placed right after Gifts (the spot he pointed at). */}
        <View style={{ flex: 1, alignItems: 'center' }}>
        <ScalePress onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setGamesOpen(true); }}>
          <View style={{ alignItems: 'center' }}>
<View style={{ height: 50, justifyContent: 'center', alignItems: 'center' }}>
                        <NeonGamepadButton />
            </View>
          </View>
        </ScalePress>
        </View>

        {/* Invite — uniform circle */}
        <View style={{ flex: 1, alignItems: 'center' }}>
        <ScalePress onPress={() => setInviteOpen(true)}>
          <View style={{ alignItems: 'center' }}>
            {/* 2026-10-15 (Sumon): Option B Sapphire Orbit invite button. */}
<View style={{ height: 50, justifyContent: 'center', alignItems: 'center' }}>
                        <SapphireInviteButton />
            </View>
          </View>
        </ScalePress>
        </View>

        {/* Exit Room — uniform circle (hidden for audience: header X instead) */}
        {!hideExit && (
        <View style={{ flex: 1, alignItems: 'center' }}>
        <ScalePress onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setExitModalOpen(true); }}>
          <View style={{ alignItems: 'center' }}>
            {/* 2026-10-15 (Sumon): Option B Obsidian Exit button. */}
<View style={{ height: 50, justifyContent: 'center', alignItems: 'center' }}>
                        <ObsidianExitButton />
            </View>
          </View>
        </ScalePress>
        </View>
        )}
      </View>

      {/* ═══ MODALS ═══ */}
      {/* Fix 3/8/9: Cloudinary upload happens inside RoomInfoModal; we persist the URL here */}
    </>
  );
}
