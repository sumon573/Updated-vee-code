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
 *   - Two-state buttons (boss 2026-10-27 20:10): the seated mic shows
 *     MUTED (mic+gear + red slash) vs UNMUTED (plain mic+gear), and the
 *     speaker shows OFF (dimmed glyph + red slash) vs ON (plain white
 *     glyph) — both driven by the REAL engine booleans (isMuted,
 *     speakerOn props from the Screen), never invented state. The red
 *     slash is the same marker on both buttons, drawn in code and clipped
 *     to the 42dp circle, so OFF reads at a glance on light + dark + all
 *     16 room themes (the circles are dark on every theme, the slash is
 *     #FF453A). Unseated JOIN icon is never slashed. Sizes, positions,
 *     tap actions, row fit (265dp fixed + pill) and tap hygiene unchanged.
 * Round 5 (boss 2026-10-27 19:06): NO background strip — the row floats
 * directly on the user's room theme. Bare glyph (calendar) is a black
 * glyph recolored per theme via tintColor (speaker: see the 19:41
 * white-on-dark-circle note below); the Say pill stays dark
 * with a theme-aware border so it separates on every theme.
 * Round 5b (boss 2026-10-27 19:27): comment pill slightly SMALLER so the
 * other buttons get a bit more space and grow slightly bigger — one small
 * step each (mic/gift 52→58, gamepad 56→62 wide keeping aspect, calendar/
 * speaker hit boxes 48→52 with glyphs scaled proportionally, smiley 26→28).
 * Pill stays flex:1 height 48, "Say..." 16px, so it shrinks only relatively
 * and stays readable; no fixed pill width (small screens safe).
 * imo-balanced (boss 2026-10-27 19:39): step-2's 62dp buttons squeezed the
 * pill on real phones, so the row is rebalanced to imo's own proportions,
 * measured from the boss's 19:11 crop (1080x240, row span x36-1044):
 * mic circle 120px (11.9%), Say pill 318px (31.5%), calendar glyph 61px
 * (6.1%), clover span 81px (8.0%), flower circle 120px (11.9%), gift
 * circle 122px (12.1%). Applied: circles 42dp (~imo 43-44), gamepad 46dp
 * wide, bare-glyph boxes 38dp, row chrome tightened (gap 8, side pad 10),
 * pill inner padding trimmed (10/4). "Say..." need at 16px is ~89dp
 * (10 pad + ~42.5 text measured + 28 smiley + 4 smiley pad + 4 pad);
 * pill widths: 360dp -> 94dp (fits, +5 margin), 390dp -> 124dp,
 * 437dp -> 171dp. Buttons do NOT grow further in this version.
 * Speaker (boss 2026-10-27 19:41, folded in before push): WHITE glyph
 * (#FFFFFF, same white as the mute/join/event buttons) on a #252525
 * dark circle on ALL themes — #252525 sampled from the mic-circle
 * slice itself, so it is the same dark-circle family as mic+gear.
 * Never gold #D0A010, never theme-dark: a bare white glyph would
 * vanish on light themes, the dark circle keeps it visible everywhere.
 * The 42dp circle (vs the 38dp box) costs 4dp of pill room, so the
 * row gap is 7dp (not 8dp) to hold the pill fit: chrome = 20 side
 * + 35 gaps = 55; buttons = 42+42+46+38+42 = 210; pill widths now
 * 360dp -> 95dp (fits, +6 margin over the ~89dp need), 390dp -> 125dp,
 * 437dp -> 172dp.
 * Two-mode mic button (boss 2026-10-27 19:43, folded in before push):
 * seated -> mic+gear (MUTE), unseated -> BOTTOM_JOIN dark circle +
 * white '+' (JOIN); Screen passes isSeated={mySeatIdx >= 0} (mySeatIdx
 * is -1 when unseated — NOT null — so the prop uses >= 0).
 * Tap hygiene audit (boss 2026-10-27 19:50, verified in code, no overlap):
 * ScalePress adds NO hitSlop (Pressable with no own style; hit = child
 * size) and its scale animation only SHRINKS (0.95) on press, so a press
 * can never spill into a neighbour. Hit boxes, exactly: mic/join 42x42,
 * Say Pressable = pill minus smiley zone, smiley 32x32 (28 image + 2 pad,
 * inside the 48-high pill with 8dp vertical clearance, last child, so it
 * cannot overlap the Say text pressable), calendar box 38x38, speaker
 * circle 42x42, gamepad 46x41, gift 42x42 — laid out by flexbox with 7dp
 * gaps and 10dp side padding, so every hit box is separated from its
 * neighbours; taps in gaps fall through the non-pressable row container
 * to the chat below and trigger nothing. No hitSlop/padding change was
 * needed — the audit found zero spills.
 * Premium game icon (boss 2026-10-27 19:50): BOTTOM_GAMEPAD is now the
 * luxury icon (dark disc + gold-trimmed glossy controller, gold D-pad and
 * buttons) at the same 46x41dp footprint; games-hub action unchanged.
 * Fit (fixed row = 20 side + 35 gaps + 210 buttons = 265dp): 360dp ->
 * pill 95dp, 390dp -> 125dp, 437dp -> 172dp; pill need ~89dp, so the row
 * fits on ALL phones with no overflow and no crowding (standing law).
 */
import React from 'react';
import { View, Text, Image, Pressable } from 'react-native';
import * as Haptics from 'expo-haptics';
import ScalePress from '@/components/ScalePress';
import {
  BOTTOM_MIC_GEAR, BOTTOM_JOIN, BOTTOM_SMILEY, BOTTOM_CALENDAR,
  BOTTOM_SPEAKER, BOTTOM_GAMEPAD, BOTTOM_GIFT,
} from './bottomIcons';

export interface VoiceRoomBottomBarProps {
  keyboardOpen: boolean;
  /** True when the user is seated (mySeatIdx >= 0 in the Screen) — the mic
      button shows the mic+gear MUTE icon. False (audience) — it shows the
      dark-circle white-'+' JOIN icon instead. Action unchanged. */
  isSeated: boolean;
  /** Effective self-mute for the seated mic button (Screen passes
      mySeatIdx >= 0 ? (seats[mySeatIdx]?.muted ?? muted) : false — the
      same effective value Screen already uses for micMuted elsewhere;
      engine `muted` is the single source of truth the tap flips, the seat
      flag is its persisted mirror). Unseated: unused (JOIN shows). */
  isMuted: boolean;
  /** LiveKit speaker output state (Screen passes speakerOn from
      useLivekitVoiceRoom — the boolean toggleSpeaker flips). */
  speakerOn: boolean;
  /** Text/icon color on the room theme bg (dark on light themes, light on
      Midnight) — used as tintColor for the bare calendar glyph. */
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

/**
 * Red diagonal slash marking an OFF state (muted mic / speaker off) — the
 * SAME marker on both buttons, so OFF reads at a glance on any theme.
 * Drawn in code (not a new PNG slice) so it stays crisp at any density;
 * clipped to the 42dp circle by the wrapper's overflow:'hidden'.
 * pointerEvents none: the slash never steals or blocks the tap.
 */
function OffSlash() {
  return (
    <View pointerEvents="none" style={{
      position: 'absolute', left: -7, top: 19.5, width: 56, height: 3,
      borderRadius: 1.5, backgroundColor: '#FF453A',
      transform: [{ rotate: '-45deg' }],
    }} />
  );
}

export function VoiceRoomBottomBar(props: VoiceRoomBottomBarProps) {
  const {
    keyboardOpen, bottomPad, themeOnBg, isDarkTheme, isSeated, isMuted, speakerOn,
    handleMicBarPress, toggleSpeaker,
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
        flexDirection: 'row', alignItems: 'center', gap: 7,
        paddingHorizontal: 10, paddingTop: 10, paddingBottom: bottomPad,
        opacity: keyboardOpen ? 0 : 1 }}>
        {/* Mic button — TWO MODES (boss 19:43) + TWO STATES (boss 20:10):
            seated -> mic+gear; unseated/audience -> dark-circle white-'+'
            JOIN icon (never slashed — it is not a mute control). Seated:
            UNMUTED = plain mic+gear, MUTED = mic+gear + red slash, driven
            by the real isMuted prop. Action (handleMicBarPress) unchanged. */}
        <ScalePress onPress={handleMicBarPress}>
          <View style={{ width: 42, height: 42, borderRadius: 21, overflow: 'hidden' }}>
            <Image source={{ uri: isSeated ? BOTTOM_MIC_GEAR : BOTTOM_JOIN }} style={{ width: 42, height: 42 }} />
            {isSeated && isMuted && <OffSlash />}
          </View>
        </ScalePress>

        {/* Say pill — dark pill + "Say..." + smiley inside (target). */}
        <View style={{
          flex: 1, height: 48, borderRadius: 24,
          backgroundColor: isDarkTheme ? '#2E2E2E' : '#262626',
          borderWidth: 1,
          borderColor: isDarkTheme ? 'rgba(255,255,255,0.30)' : 'rgba(0,0,0,0.12)',
          flexDirection: 'row', alignItems: 'center',
          paddingLeft: 10, paddingRight: 4 }}>
          <Pressable onPress={onSayPress} style={{ flex: 1 }}>
            <Text style={{ color: '#B8B8B8', fontSize: 16 }}>
              Say...
            </Text>
          </Pressable>
          <ScalePress onPress={onSmileyPress} style={{ padding: 2 }}>
            <Image source={{ uri: BOTTOM_SMILEY }} style={{ width: 28, height: 28 }} />
          </ScalePress>
        </View>

        {/* Calendar — Task Center (existing modal). */}
        <ScalePress onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setTaskCenterOpen(true); }}>
          <View style={{ width: 38, height: 38, alignItems: 'center', justifyContent: 'center' }}>
            <Image source={{ uri: BOTTOM_CALENDAR }} style={{ width: 23, height: 22, tintColor: themeOnBg }} />
          </View>
        </ScalePress>

        {/* Speaker — voice-output toggle (existing handler). Boss 19:41:
            WHITE glyph on a dark circle (mic-circle family) on ALL themes.
            TWO STATES (boss 20:10): ON = plain white glyph, OFF = dimmed
            glyph + red slash, driven by the real speakerOn prop. */}
        <ScalePress onPress={toggleSpeaker}>
          <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: '#252525', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            <Image source={{ uri: BOTTOM_SPEAKER }} style={{ width: 23, height: 18, tintColor: '#FFFFFF', opacity: speakerOn ? 1 : 0.6 }} />
            {!speakerOn && <OffSlash />}
          </View>
        </ScalePress>

        {/* Games hub — existing RoomGamesModal. */}
        <ScalePress onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setGamesOpen(true); }}>
          <Image source={{ uri: BOTTOM_GAMEPAD }} style={{ width: 46, height: 41 }} />
        </ScalePress>

        {/* Gift panel — existing GiftsModal. */}
        <ScalePress onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setGiftsOpen(true); }}>
          <Image source={{ uri: BOTTOM_GIFT }} style={{ width: 42, height: 42 }} />
        </ScalePress>
      </View>
    </>
  );
}
