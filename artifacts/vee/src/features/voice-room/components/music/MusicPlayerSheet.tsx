/* ─────────────────────── Music player sheet ─────────────────────── */

import React, { useState, useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import type { RoomMusic } from '../../services/roomMusicService';
import { MUSIC_VINYL_URL } from './musicArt';
import type { MusicPalette } from './musicTheme';
import type { MusicControls } from './useMusicControls';
import { displayTitle, fmtDur } from './musicFormat';

/**
 * MusicPlayerSheet — the FIRST view on tapping the Music icon
 * (boss 2026-10-27 00:03, imo screenshot): dark bottom sheet over the
 * room — collapse chevron top-center, vinyl disc left, song title +
 * "{playerName} is playing music", seek bar with dot, controls row
 * (volume, prev, BIG center play, next, playlist icon).
 *
 * Deliberate v1 omissions (reported, not faked):
 * - Top-right hand + equalizer icons are NOT rendered: no matching
 *   engine action exists for either (no raise-hand music action, no
 *   equalizer settings). Power IS wired (stop room music).
 * - The seek bar is DISPLAY-ONLY: the engine has no seek action
 *   (no setPosition anywhere). It shows real position/duration and
 *   never implies scrubbing.
 * - The disc does not spin: the reference frame is static and no
 *   rotation was specified.
 * - Transport buttons (prev/play/next/power) are hidden for viewers
 *   who cannot control (canControl false); volume + playlist stay.
 */

interface PlayerSheetProps {
  active: boolean;
  music: RoomMusic | null;
  canControl: boolean;
  controls: MusicControls;
  palette: MusicPalette;
  onClose: () => void;
  onOpenPlaylist: () => void;
}

export function MusicPlayerSheet(props: PlayerSheetProps) {
  const { active, music, canControl, controls, palette, onClose, onOpenPlaylist } = props;
  const current = music?.current ?? null;
  const state = music?.state ?? 'idle';
  const playing = state === 'playing';
  const duration = current?.durationSec ?? null;

  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (active) controls.syncVolume();
  }, [active, controls]);

  useEffect(() => {
    setElapsed(current?.positionSec ?? 0);
  }, [current?.queueId, current?.positionSec, state]);

  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      setElapsed((e) => (duration != null ? Math.min(e + 1, duration) : e + 1));
    }, 1000);
    return () => clearInterval(t);
  }, [playing, duration]);

  const progress = duration != null && duration > 0 ? Math.min(elapsed / duration, 1) : 0;
  const title = current ? displayTitle(current.title) : 'No music yet';
  const subtitle = current
    ? `${current.addedByName} is playing music`
    : 'Tap the playlist icon to add songs';
  const playDisabled = !canControl || (state !== 'playing' && state !== 'paused' && !controls.canPlaySomething());

  return (
    <View style={styles.wrap}>
      <Pressable onPress={onClose} hitSlop={8} style={styles.chevron}>
        <Feather name="chevron-down" size={22} color={palette.sub} />
      </Pressable>

      <View style={styles.topRow}>
        <Image source={{ uri: MUSIC_VINYL_URL }} style={styles.disc} contentFit="cover" />
        <View style={styles.meta}>
          <Text style={[styles.title, { color: palette.text }]} numberOfLines={1}>
            {title}
          </Text>
          <Text style={[styles.subtitle, { color: palette.sub }]} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
        {canControl && current ? (
          <Pressable onPress={controls.stop} hitSlop={8} style={styles.power}>
            <Feather name="power" size={22} color={palette.text} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.seekRow}>
        <Text style={[styles.time, { color: palette.sub }]}>{fmtDur(elapsed)}</Text>
        <View style={[styles.track, { backgroundColor: palette.faint }]}>
          <View style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: palette.blue }]} />
          <View
            style={[
              styles.dot,
              { left: `${progress * 100}%`, backgroundColor: '#FFFFFF', borderColor: palette.border },
            ]}
          />
        </View>
        <Text style={[styles.time, { color: palette.sub }]}>{fmtDur(duration)}</Text>
      </View>

      <View style={styles.controls}>
        <Pressable onPress={controls.toggleMute} hitSlop={8} style={styles.ctl}>
          <Feather name={controls.volume > 0 ? 'volume-2' : 'volume-x'} size={24} color={palette.text} />
        </Pressable>
        {canControl ? (
          <Pressable
            onPress={controls.restartCurrent}
            hitSlop={8}
            style={[styles.ctl, !current && styles.dim]}
            disabled={!current}
          >
            <Feather name="skip-back" size={24} color={palette.text} />
          </Pressable>
        ) : null}
        {canControl ? (
          <Pressable
            onPress={controls.togglePlay}
            hitSlop={8}
            style={[styles.playBtn, { backgroundColor: palette.playBtn }, playDisabled && styles.dim]}
            disabled={playDisabled}
          >
            <Feather name={playing ? 'pause' : 'play'} size={28} color="#FFFFFF" />
          </Pressable>
        ) : null}
        {canControl ? (
          <Pressable
            onPress={controls.nextRoom}
            hitSlop={8}
            style={[styles.ctl, !controls.hasQueued() && styles.dim]}
            disabled={!controls.hasQueued()}
          >
            <Feather name="skip-forward" size={24} color={palette.text} />
          </Pressable>
        ) : null}
        <Pressable onPress={onOpenPlaylist} hitSlop={8} style={styles.ctl}>
          <Feather name="list" size={24} color={palette.text} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 20 },
  chevron: { alignItems: 'center', paddingVertical: 2 },
  topRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  disc: { width: 64, height: 64, borderRadius: 32 },
  meta: { flex: 1, marginLeft: 14, marginRight: 8 },
  title: { fontSize: 16, fontWeight: '800' },
  subtitle: { fontSize: 13, marginTop: 3 },
  power: { padding: 4 },
  seekRow: { flexDirection: 'row', alignItems: 'center', marginTop: 18 },
  time: { fontSize: 12, width: 40, textAlign: 'center' },
  track: { flex: 1, height: 4, borderRadius: 2, marginHorizontal: 8, position: 'relative' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 2 },
  dot: { position: 'absolute', top: -4, width: 12, height: 12, borderRadius: 6, marginLeft: -6, borderWidth: 1 },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  ctl: { padding: 4 },
  playBtn: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  dim: { opacity: 0.35 },
});
