/**
 * VoiceMessageBubble — IMO-style playable voice message.
 *
 * Layout (IMO voice bubble): play/pause circle button + progress bar +
 * duration label, inside the normal chat bubble.
 *
 * Playback uses expo-audio's useAudioPlayer (already a dependency).
 * The player is created lazily per bubble; only one voice message plays at
 * a time is NOT enforced here — rapid taps on two bubbles just move the
 * "now playing" state; each bubble owns its player and cleans up on unmount.
 *
 * 2026-10-22 (perf audit): progress/finish now come from
 * useAudioPlayerStatus (event-driven, updateInterval 250 ms) instead of a
 * hand-rolled setInterval poll that re-rendered via layout state 4×/sec
 * and detected the finish up to 250 ms late.
 */
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';
import { formatVoiceDuration } from '../hooks/useVoiceRecorder';

const C = {
  // IMO accents
  blue: '#009dff',
  playBg: '#009dff',
  trackBg: 'rgba(0,0,0,0.15)',
  trackBgOnBlue: 'rgba(255,255,255,0.35)',
  time: '#70000000',
  timeOnBlue: 'rgba(255,255,255,0.85)',
} as const;

type Props = {
  /** Remote (or local) audio URL — message.content for type='voice'. */
  uri: string;
  /** Duration in seconds (message.durationSec). Falls back to player duration. */
  durationSec?: number;
  /** True when this bubble is the sender's (affects tint colors). */
  isMe: boolean;
};

function VoiceMessageBubble({ uri, durationSec, isMe }: Props) {
  // useAudioPlayer(null) is allowed — player stays idle until we load.
  // We pass the uri up-front; the hook handles remote streaming.
  // updateInterval 250ms: status (currentTime) refreshes 4×/sec, matching
  // the old poll's smoothness but event-driven instead of polled.
  const player = useAudioPlayer(uri ? { uri } : null, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);

  const playing = status.playing;
  const totalSec = durationSec && durationSec > 0 ? durationSec : status.duration || 0;
  const elapsed = status.currentTime || 0;
  const progress = totalSec > 0 ? Math.min(1, elapsed / totalSec) : 0;

  // On natural finish, rewind so the next tap replays from the start
  // (progress/elapsed derive from currentTime, so the seek resets the UI).
  const finishHandledRef = useRef(false);
  useEffect(() => {
    if (status.didJustFinish && !finishHandledRef.current) {
      finishHandledRef.current = true;
      try { player.seekTo(0); } catch { /* noop */ }
    }
    if (!status.didJustFinish) finishHandledRef.current = false;
  }, [status.didJustFinish, player]);

  const toggle = useCallback(async () => {
    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        shouldRouteThroughEarpiece: false,
      }).catch(() => {});
      if (playing) {
        player.pause();
      } else {
        // Restart from the beginning if we were at the end.
        try {
          const dur = player.duration || totalSec || 0;
          if (dur > 0 && (player.currentTime || 0) >= dur - 0.3) {
            await player.seekTo(0);
          }
        } catch { /* seek is best-effort */ }
        player.play();
      }
    } catch {
      /* player torn down — nothing to toggle */
    }
  }, [playing, player, totalSec]);

  // Cleanup the native player on unmount (stops audio if the bubble scrolls away).
  useEffect(() => {
    return () => {
      try { player.remove(); } catch { /* noop */ }
    };
  }, [player]);

  const timeColor = isMe ? C.timeOnBlue : C.time;
  const trackBg = isMe ? C.trackBgOnBlue : C.trackBg;

  // 2026-10-20 (boss): the progress track must FIT the clip — the old fixed
  // minWidth 180 stretched a long empty line across even a 1-second voice
  // note ("unprofessional"). Width now scales with duration (short clip =
  // compact bubble), capped for long notes; unknown duration = compact.
  const trackWidth = totalSec > 0
    ? Math.round(Math.min(172, Math.max(64, 52 + totalSec * 3.4)))
    : 64;

  // 2026-10-20 (boss): heartbeat-style WAVEFORM instead of a plain straight
  // line — a row of bars with varying heights (like a heartbeat trace).
  // The pattern is seeded by the message uri, so each voice note has its own
  // stable wave that never changes between renders.
  const wave = useMemo(() => {
    const BAR_W = 3;
    const GAP = 2;
    const count = Math.max(10, Math.floor((trackWidth + GAP) / (BAR_W + GAP)));
    let seed = 0;
    for (let i = 0; i < uri.length; i++) seed = (seed * 31 + uri.charCodeAt(i)) | 0;
    const heights: number[] = [];
    for (let i = 0; i < count; i++) {
      const v = Math.abs(
        Math.sin(seed * 0.37 + i * 1.7) * 0.6 + Math.sin(seed * 0.11 + i * 0.53) * 0.4,
      );
      heights.push(5 + Math.round(v * 15)); // 5..20px
    }
    return { heights, BAR_W, GAP };
  }, [uri, trackWidth]);
  const filledBars = Math.round(progress * wave.heights.length);
  const playedColor = isMe ? '#FFFFFF' : C.blue;
  const idleColor = trackBg;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {/* Play / pause */}
      <Pressable
        onPress={toggle}
        hitSlop={8}
        style={{
          width: 38, height: 38, borderRadius: 19,
          backgroundColor: C.playBg,
          alignItems: 'center', justifyContent: 'center',
          marginRight: 10,
        }}
      >
        <Feather
          name={playing ? 'pause' : 'play'}
          size={18}
          color="#fff"
          style={playing ? undefined : { marginLeft: 2 }}
        />
      </Pressable>

      {/* Waveform (heartbeat-style) + duration */}
      <View style={{ width: trackWidth }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', height: 22 }}>
          {wave.heights.map((h, i) => (
            <View
              key={i}
              style={{
                width: wave.BAR_W,
                height: h,
                borderRadius: 1.5,
                marginRight: i === wave.heights.length - 1 ? 0 : wave.GAP,
                backgroundColor: i < filledBars ? playedColor : idleColor,
              }}
            />
          ))}
        </View>
        <Text style={{ color: timeColor, fontSize: 11, marginTop: 4, fontVariant: ['tabular-nums'] }}>
          {playing
            ? formatVoiceDuration(elapsed)
            : formatVoiceDuration(totalSec)}
        </Text>
      </View>
    </View>
  );
}

export default memo(VoiceMessageBubble);
