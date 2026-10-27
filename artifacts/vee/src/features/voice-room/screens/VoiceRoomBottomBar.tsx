/**
 * VoiceRoomBottomBar — boss target 2026-10-27 18:44 (1000225055_4_i70l.png):
 * the bottom is EXACTLY that image — icons and everything the same.
 * Single floating row (no background box), pinned flush to the very bottom edge (boss 18:45: no
 * padding/gap below beyond the system safe-area inset, so the chat area
 * above grows bigger). This REPLACES the old two-row bottom area (the
 * separate message row above + the old floating-button row).
 *
 * Layout, left→right (all icons sliced from the target image itself,
 * bottomIcons.ts — no redraws, no Feather substitutes):
 *   mic+gear dark circle | "Say..." pill + smiley | calendar | speaker |
 *   gamepad dark circle | gift blue circle.
 *
 * Wiring (boss-confirmed functions, EXISTING handlers only):
 *   mic+gear  → handleMicBarPress (seated: mic mute/unmute; unseated:
 *               join first available seat, same as the old mic button).
 *               NOTE: Vee has NO audio-settings UI today (SettingsModal is
 *               room topic/privacy/PIN, owner/admin only) — the gear badge
 *               is part of the target's composite mic icon; there is no
 *               separate gear destination to wire. See report.
 *   Say pill  → opens the dark composer bar above the keyboard
 *               (onSayPress); typing @ still opens the mention dropdown.
 *   smiley    → existing EmojiPanel (reactions), same as before.
 *   calendar  → existing Task Center modal.
 *   speaker   → existing voice-output toggle (toggleSpeaker).
 *   gamepad   → existing games hub (RoomGamesModal).
 *   gift      → existing gift panel (GiftsModal).
 * Consequences of the exact target (reported, not hidden):
 *   - No X in this row: owner/admin + audience keep the header X;
 *     the plain-member header gains an X (same ExitModal) so no view
 *     loses its exit.
 *   - No invite (person+) button in the target: header share still opens
 *     the invite sheet for owner/admin/audience; plain members lose the
 *     bottom invite entry.
 *   - The static target icons carry no mute/speaker state: the old bar's
 *     red mic-off / grey volume-x states are gone; mute state still shows
 *     on the user's own seat mic icon.
 * Round 5 (boss 2026-10-27 19:06): NO background strip — the row floats
 * directly on the user's room theme. Bare glyphs (calendar, speaker) are
 * black glyphs recolored per theme via tintColor; the Say pill stays dark
 * with a theme-aware border so it separates on every theme.
 * Round 5b (boss 2026-10-27 19:27): comment pill slightly SMALLER so the
 * other buttons get a bit more space and grow slightly bigger — one small
 * step each (mic/gift 52→58, gamepad 56→62 wide keeping aspect, calendar/
 * speaker hit boxes 48→52 with glyphs scaled proportionally, smiley 26→28).
 * Pill stays flex:1 height 48, "Say..." 16px, so it shrinks only relatively
 * and stays readable; no fixed pill width (small screens safe).
 */
import React from 'react';
import { View, Text, Image, Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';
import ScalePress from '@/components/ScalePress';
import {
  BOTTOM_MIC_GEAR, BOTTOM_SMILEY, BOTTOM_CALENDAR,
  BOTTOM_SPEAKER, BOTTOM_GAMEPAD, BOTTOM_GIFT,
} from './bottomIcons';

export interface VoiceRoomBottomBarProps {
  keyboardOpen: boolean;
  /** Text/icon color on the room theme bg (dark on light themes, light on
      Midnight) — used as tintColor for the bare calendar/speaker glyphs. */
  themeOnBg: string;
  /** True only for dark room themes (bg luminance < 0.4) — drives the Say
      pill border + the speaker's gold tint. */
  isDarkTheme: boolean;
  /** Safe-area inset ONLY (boss 18:45: no extra padding below the row). */
  bottomPad: number;
  handleMicBarPress: () => void;
  toggleSpeaker: () => void;
  setTaskCenterOpen: (v: boolean) => void;
  setGiftsOpen: (v: boolean) => void;
  setGamesOpen: (v: boolean) => void;
  /** Say pill tap → open the dark composer bar (VoiceRoomScreen). */
  onSayPress: () => void;
  /** Smiley tap → existing EmojiPanel (reactions). */
  onSmileyPress: () => void;
}

export function VoiceRoomBottomBar(props: VoiceRoomBottomBarProps) {
  const {
    keyboardOpen, bottomPad, themeOnBg, isDarkTheme, handleMicBarPress,
    toggleSpeaker,
    setTaskCenterOpen, setGiftsOpen, setGamesOpen,
    onSayPress, onSmileyPress,
  } = props;
  return (
    <>
      {/* ═══ BOTTOM BAR — target row, flush to the very bottom edge ═══ */}
      {/* Opacity-hidden (kept mounted) while the comment keyboard is open —
          same pattern as the old bar (2026-10-26 typing-jitter fix): the
          dark composer bar takes the keyboard's place instead. */}
      <View
        pointerEvents={keyboardOpen ? 'none' : 'auto'}
        style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        flexDirection: 'row', alignItems: 'center', gap: 10,
        paddingHorizontal: 12, paddingTop: 10, paddingBottom: bottomPad,
        opacity: keyboardOpen ? 0 : 1 }}>
        {/* Mic + gear — target's composite icon, sliced exactly. */}
        <ScalePress onPress={handleMicBarPress}>
          <Image source={{ uri: BOTTOM_MIC_GEAR }} style={{ width: 58, height: 58 }} />
        </ScalePress>

        {/* Say pill — dark pill + "Say..." + smiley inside (target). */}
        <View style={{
          flex: 1, height: 48, borderRadius: 24,
          backgroundColor: isDarkTheme ? '#2E2E2E' : '#262626',
          borderWidth: 1,
          borderColor: isDarkTheme ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.12)',
          flexDirection: 'row', alignItems: 'center',
          paddingLeft: 16, paddingRight: 8 }}>
          <Pressable onPress={onSayPress} style={{ flex: 1 }}>
            <Text style={{ color: '#B8B8B8', fontSize: 16 }}>
              Say...
            </Text>
          </Pressable>
          <ScalePress onPress={onSmileyPress} style={{ padding: 4 }}>
            <Image source={{ uri: BOTTOM_SMILEY }} style={{ width: 28, height: 28 }} />
          </ScalePress>
        </View>

        {/* Calendar — Task Center (existing modal). */}
        <ScalePress onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setTaskCenterOpen(true); }}>
          <View style={{ width: 52, height: 52, alignItems: 'center', justifyContent: 'center' }}>
            <Image source={{ uri: BOTTOM_CALENDAR }} style={{ width: 32, height: 31, tintColor: themeOnBg }} />
          </View>
        </ScalePress>

        {/* Speaker — voice-output toggle (existing handler). */}
        <ScalePress onPress={toggleSpeaker}>
          <View style={{ width: 52, height: 52, alignItems: 'center', justifyContent: 'center' }}>
            <Image source={{ uri: BOTTOM_SPEAKER }} style={{ width: 32, height: 24, tintColor: isDarkTheme ? '#D0A010' : themeOnBg }} />
          </View>
        </ScalePress>

        {/* Games hub — existing RoomGamesModal. */}
        <ScalePress onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setGamesOpen(true); }}>
          <Image source={{ uri: BOTTOM_GAMEPAD }} style={{ width: 62, height: 55 }} />
        </ScalePress>

        {/* Gift panel — existing GiftsModal. */}
        <ScalePress onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setGiftsOpen(true); }}>
          <Image source={{ uri: BOTTOM_GIFT }} style={{ width: 58, height: 58 }} />
        </ScalePress>
      </View>
    </>
  );
}
