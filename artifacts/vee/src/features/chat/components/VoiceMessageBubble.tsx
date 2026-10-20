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
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAudioPlayer, setAudioModeAsync } from 'expo-audio';
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
  const player = useAudioPlayer(uri ? { uri } : null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0); // 0..1
  const [elapsed, setElapsed] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const totalSec = durationSec && durationSec > 0 ? durationSec : player.duration || 0;

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Poll currentTime while playing (cheap, 250ms) — drives the progress bar.
  useEffect(() => {
    if (!playing) {
      stopPoll();
      return;
    }
    pollRef.current = setInterval(() => {
      try {
        const cur = player.currentTime || 0;
        const dur = player.duration || totalSec || 1;
        setElapsed(cur);
        setProgress(Math.min(1, cur / dur));
        // Finished (no didJustFinish in expo-audio — detect via time).
        if (dur > 0.5 && cur >= dur - 0.25 && !player.loop) {
          setPlaying(false);
          setProgress(0);
          setElapsed(0);
          try { player.seekTo(0); } catch { /* noop */ }
        }
      } catch {
        /* player torn down mid-poll */
      }
    }, 250);
    return stopPoll;
  }, [playing, player, totalSec, stopPoll]);

  useEffect(() => stopPoll, [stopPoll]);

  // If the player reports finished via status change, reset UI.
  useEffect(() => {
    if (!player.playing && playing) {
      // External pause/finish — sync the icon. (Poll loop also resets on finish.)
      const t = setTimeout(() => {
        try {
          if (!player.playing && (player.currentTime || 0) <= 0.05) {
            setPlaying(false);
            setProgress(0);
            setElapsed(0);
          }
        } catch { /* noop */ }
      }, 300);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [player.playing, playing, player]);

  const toggle = useCallback(async () => {
    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        shouldRouteThroughEarpiece: false,
      }).catch(() => {});
      if (playing) {
        player.pause();
        setPlaying(false);
      } else {
        // Restart from the beginning if we were at the end.
        try {
          const dur = player.duration || totalSec || 0;
          if (dur > 0 && (player.currentTime || 0) >= dur - 0.3) {
            await player.seekTo(0);
          }
        } catch { /* seek is best-effort */ }
        player.play();
        setPlaying(true);
      }
    } catch {
      setPlaying(false);
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

      {/* Progress + duration */}
      <View style={{ width: trackWidth }}>
        <View style={{
          height: 4, borderRadius: 2,
          backgroundColor: trackBg,
          overflow: 'hidden',
        }}>
          <View style={{
            height: 4, borderRadius: 2,
            width: `${Math.round(progress * 100)}%`,
            backgroundColor: C.blue,
          }} />
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
