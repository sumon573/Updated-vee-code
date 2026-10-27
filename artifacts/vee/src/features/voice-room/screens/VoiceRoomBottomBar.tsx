/**
 * VoiceRoomBottomBar — boss target 2026-10-27 18:44 (1000225055_4_i70l.png):
 * the bottom is EXACTLY that image — icons and everything the same.
 * Single dark row, pinned flush to the very bottom edge (boss 18:45: no
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
 * The row is its own dark strip (#101010) on ALL 16 room themes, so every
 * button stays clearly visible on light and dark themes alike.
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
    keyboardOpen, bottomPad, handleMicBarPress,
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
        opacity: keyboardOpen ? 0 : 1,
        backgroundColor: '#101010' }}>
        {/* Mic + gear — target's composite icon, sliced exactly. */}
        <ScalePress onPress={handleMicBarPress}>
          <Image source={{ uri: BOTTOM_MIC_GEAR }} style={{ width: 52, height: 52 }} />
        </ScalePress>

        {/* Say pill — dark pill + "Say..." + smiley inside (target). */}
        <View style={{
          flex: 1, height: 48, borderRadius: 24,
          backgroundColor: '#262626',
          flexDirection: 'row', alignItems: 'center',
          paddingLeft: 16, paddingRight: 8 }}>
          <Pressable onPress={onSayPress} style={{ flex: 1 }}>
            <Text style={{ color: '#8A8A8A', fontSize: 16 }}>
              Say...
            </Text>
          </Pressable>
          <ScalePress onPress={onSmileyPress} style={{ padding: 4 }}>
            <Image source={{ uri: BOTTOM_SMILEY }} style={{ width: 26, height: 26 }} />
          </ScalePress>
        </View>

        {/* Calendar — Task Center (existing modal). */}
        <ScalePress onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setTaskCenterOpen(true); }}>
          <View style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
            <Image source={{ uri: BOTTOM_CALENDAR }} style={{ width: 30, height: 29 }} />
          </View>
        </ScalePress>

        {/* Speaker — voice-output toggle (existing handler). */}
        <ScalePress onPress={toggleSpeaker}>
          <View style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
            <Image source={{ uri: BOTTOM_SPEAKER }} style={{ width: 30, height: 22 }} />
          </View>
        </ScalePress>

        {/* Games hub — existing RoomGamesModal. */}
        <ScalePress onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setGamesOpen(true); }}>
          <Image source={{ uri: BOTTOM_GAMEPAD }} style={{ width: 56, height: 50 }} />
        </ScalePress>

        {/* Gift panel — existing GiftsModal. */}
        <ScalePress onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setGiftsOpen(true); }}>
          <Image source={{ uri: BOTTOM_GIFT }} style={{ width: 52, height: 52 }} />
        </ScalePress>
      </View>
    </>
  );
}
