/* ─────────────────────── Music player sheet ─────────────────────── */

import React, { useState, useEffect, useRef } from 'react';
import { View, Text, Pressable, StyleSheet, PanResponder } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { get, ref } from 'firebase/database';
import { database } from '@/src/config/firebase';
import { resolveProfileName } from '@/src/services/userService';
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
 * - The disc does not spin: the reference frame is static and no
 *   rotation was specified.
 * 2026-10-27: the seek bar is REAL now (bot seekSec intent, consumed
 * before the bot's pause handling; seek while paused stays paused).
 * Scrubbing is a PanResponder on the existing View bar — no native
 * slider module. While scrubbing, the dot/fill/time show the scrub
 * position and the 1s elapsed tick never overrides it; on release the
 * target second is written. Members (canControl false) get the bar as
 * display-only: the responder refuses the gesture, so nothing pretends
 * to scrub. Next is sequential (queue first, else library order, wrap)
 * and greys ONLY when queue AND library are both empty. Echo is a
 * host-seat-only room-wide effect toggle, default OFF — never sold as
 * a clarity improvement (echo smears timing by design).
 * - Transport buttons (prev/play/next/power) AND the playlist button
 *   are hidden for viewers who cannot control (canControl false) —
 *   playlist leads to track change / Add, so it is maintain, not view.
 *   Volume (mute + level row) stays: it is local to this phone only.
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

  // Scrub state (2026-10-27): fraction while the user drags, null when
  // not scrubbing. The ref mirrors the state synchronously — the
  // release handler must read the FINAL drag position, and setState
  // from the last move event may not have flushed yet when release
  // fires. trackWidthRef is the hit-area width from onLayout.
  const [scrubFrac, setScrubFrac] = useState<number | null>(null);
  const scrubFracRef = useRef<number | null>(null);
  const trackWidthRef = useRef(0);
  const setScrub = (f: number | null) => {
    scrubFracRef.current = f;
    setScrubFrac(f);
  };
  // Gate mirror: the responder is created ONCE (useRef) but must read
  // CURRENT values — the first render often has current=null (the
  // subscription has not delivered yet), and a closure over that would
  // refuse every scrub forever. The mirror is rewritten each render.
  const scrubGateRef = useRef({ canControl, hasCurrent: false, duration: null as number | null });
  // Rewritten after every render (effect, not render body) so the
  // responder always sees the latest gate values.
  useEffect(() => {
    scrubGateRef.current = { canControl, hasCurrent: !!current, duration };
  });
  const scrubResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => {
        const g = scrubGateRef.current;
        return g.canControl && g.hasCurrent && g.duration != null && g.duration > 0;
      },
      onMoveShouldSetPanResponder: () => {
        const g = scrubGateRef.current;
        return g.canControl && g.hasCurrent && g.duration != null && g.duration > 0;
      },
      onPanResponderGrant: (evt) => {
        const w = trackWidthRef.current;
        setScrub(w > 0 ? Math.min(1, Math.max(0, evt.nativeEvent.locationX / w)) : 0);
      },
      onPanResponderMove: (evt) => {
        const w = trackWidthRef.current;
        setScrub(w > 0 ? Math.min(1, Math.max(0, evt.nativeEvent.locationX / w)) : 0);
      },
      onPanResponderRelease: () => {
        const f = scrubFracRef.current;
        const d = scrubGateRef.current.duration;
        setScrub(null);
        if (f != null && d != null && d > 0) controls.seekTo(f * d);
      },
      onPanResponderTerminate: () => {
        setScrub(null);
      },
    }),
  ).current;

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

  // While scrubbing, the bar shows the scrub position, never the tick.
  const displayElapsed = scrubFrac != null && duration != null ? scrubFrac * duration : elapsed;
  const progress = duration != null && duration > 0 ? Math.min(displayElapsed / duration, 1) : 0;
  const title = current ? displayTitle(current.title) : 'No music yet';
  // Player name (2026-10-27, boss: sheet showed "undefined is playing
  // music"): the bot-written current node does not always carry
  // addedByName, so resolve it — queue item by queueId, then by mediaId,
  // then a one-shot profile read for the player uid (nickname first,
  // displayName second, 'User' last — the codebase's nameless fallback).
  // Never "undefined", never a placeholder name.
  const queuedName =
    music?.queue.find((t) => t.queueId === current?.queueId)?.addedByName ||
    music?.queue.find((t) => t.mediaId === current?.mediaId)?.addedByName ||
    '';
  const [profileName, setProfileName] = useState('');
  useEffect(() => {
    if (!current || current.addedByName || queuedName) {
      setProfileName('');
      return;
    }
    let cancelled = false;
    get(ref(database, `users/${current.addedBy}`))
      .then((snap) => {
        if (!cancelled && snap.exists()) setProfileName(resolveProfileName(snap.val()));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [current?.queueId, current?.addedBy, current?.addedByName, queuedName]);
  const playerName = (current?.addedByName || '').trim() || queuedName || profileName;
  const subtitle = current
    ? playerName
      ? `${playerName} is playing music`
      : 'Now playing'
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
        <Text style={[styles.time, { color: palette.sub }]}>{fmtDur(displayElapsed)}</Text>
        <View
          style={styles.trackHit}
          {...scrubResponder.panHandlers}
          onLayout={(e) => {
            trackWidthRef.current = e.nativeEvent.layout.width;
          }}
        >
          <View style={[styles.track, { backgroundColor: palette.faint }]}>
            <View style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: palette.blue }]} />
            <View
              style={[
                styles.dot,
                { left: `${progress * 100}%`, backgroundColor: '#FFFFFF', borderColor: palette.border },
              ]}
            />
          </View>
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
            onPress={controls.nextSequential}
            hitSlop={8}
            style={[styles.ctl, !controls.hasNext() && styles.dim]}
            disabled={!controls.hasNext()}
          >
            <Feather name="skip-forward" size={24} color={palette.text} />
          </Pressable>
        ) : null}
        {canControl ? (
          <Pressable onPress={onOpenPlaylist} hitSlop={8} style={styles.ctl}>
            <Feather name="list" size={24} color={palette.text} />
          </Pressable>
        ) : null}
      </View>

      {/* Volume LEVEL (2026-10-27, boss: speaker was mute-only) — local to
          this phone, the same mechanism as mute (LiveKit track gain +
          AsyncStorage persist via controls.setVolume). Mute toggle above
          is unchanged; this row raises/lowers the level in 10% steps. */}
      <View style={styles.volRow}>
        <Pressable onPress={() => controls.setVolume(controls.volume - 0.1)} hitSlop={8} style={styles.volStep}>
          <Feather name="minus" size={18} color={palette.text} />
        </Pressable>
        <View style={styles.volSegs}>
          {Array.from({ length: 10 }, (_, i) => (
            <Pressable
              key={i}
              onPress={() => controls.setVolume((i + 1) / 10)}
              hitSlop={2}
              style={styles.volSegHit}
            >
              <View
                style={[
                  styles.volSeg,
                  { backgroundColor: i < Math.round(controls.volume * 10) ? palette.blue : palette.faint },
                ]}
              />
            </Pressable>
          ))}
        </View>
        <Pressable onPress={() => controls.setVolume(controls.volume + 0.1)} hitSlop={8} style={styles.volStep}>
          <Feather name="plus" size={18} color={palette.text} />
        </Pressable>
        <Text style={[styles.volPct, { color: palette.sub }]}>{Math.round(controls.volume * 100)}%</Text>
      </View>

      {/* Echo (2026-10-27, boss: echo if possible) — host-seat only,
          room-wide by construction (one publisher track). Default OFF;
          an opt-in effect, never labelled a clarity improvement. */}
      {canControl ? (
        <View style={styles.echoRow}>
          <Text style={[styles.echoLabel, { color: palette.text }]}>Echo</Text>
          <Pressable
            onPress={controls.toggleEcho}
            hitSlop={8}
            style={[
              styles.echoToggle,
              {
                borderColor: palette.border,
                backgroundColor: music?.echo === true ? palette.blue : 'transparent',
              },
            ]}
          >
            <Text
              style={[
                styles.echoToggleText,
                { color: music?.echo === true ? '#FFFFFF' : palette.sub },
              ]}
            >
              {music?.echo === true ? 'ON' : 'OFF'}
            </Text>
          </Pressable>
          <Text style={[styles.echoNote, { color: palette.sub }]}>Room-wide effect</Text>
        </View>
      ) : null}
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
  trackHit: { flex: 1, marginHorizontal: 8, paddingVertical: 10, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, position: 'relative' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 2 },
  dot: { position: 'absolute', top: -4, width: 12, height: 12, borderRadius: 6, marginLeft: -6, borderWidth: 1 },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  ctl: { padding: 4 },
  volRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14, gap: 8 },
  volStep: { padding: 4 },
  volSegs: { flex: 1, flexDirection: 'row', gap: 3 },
  volSegHit: { flex: 1, paddingVertical: 6 },
  volSeg: { height: 6, borderRadius: 3 },
  volPct: { fontSize: 12, fontWeight: '800', width: 36, textAlign: 'right' },
  playBtn: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  echoRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 10 },
  echoLabel: { fontSize: 13, fontWeight: '700' },
  echoToggle: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 4 },
  echoToggleText: { fontSize: 12, fontWeight: '800' },
  echoNote: { fontSize: 12, flex: 1 },
  dim: { opacity: 0.35 },
});
