/* ─────────────────────── Music controls ─────────────────────── */

import { useRef, useEffect, useState, useCallback } from 'react';
import { Alert } from 'react-native';
import * as Haptics from 'expo-haptics';
import {
  setMusicState,
  setPlayQueueId,
  addMusicTrack,
  getRoomMusicOnce,
  type RoomMusic,
  type MusicState,
} from '../../services/roomMusicService';
import {
  getMusicVolumeSync,
  setMusicVolume as persistMusicVolume,
} from '../../services/musicVolumeService';

/**
 * useMusicControls — playback controls for the music flow (2026-10-27).
 * Wraps the existing VeeMusic engine (roomMusic node + bot) with the
 * control-confirmation pattern from the old player: write the intent,
 * wait up to 8s for bot-side confirmation, retry ONCE, then show a
 * visible error (never a silent no-op). The engine has NO seek action
 * and NO previous-track history — see restartCurrent for how prev is
 * mapped, and the build report for the full gap list.
 */

type Target = 'playing' | 'paused' | 'next' | 'stopped';

interface ControlsArgs {
  roomId: string;
  canControl: boolean;
  uid: string | null;
  myName: string;
  getMusic: () => RoomMusic | null;
  onVolumeChange: (v: number) => void;
}

export function useMusicControls(args: ControlsArgs) {
  const { roomId, canControl, uid, myName, getMusic, onVolumeChange } = args;
  const mountedRef = useRef(true);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmSeqRef = useRef(0);
  const [volume, setVolumeState] = useState(getMusicVolumeSync());
  const lastVolRef = useRef(getMusicVolumeSync() > 0 ? getMusicVolumeSync() : 1);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, []);

  const syncVolume = useCallback(() => {
    setVolumeState(getMusicVolumeSync());
  }, []);

  const isControlConfirmed = useCallback(
    (target: Target, before: { state: MusicState; curId: string | null; startedAt: number | null }) => {
      const m = getMusic();
      if (!m) return false;
      if (target === 'playing') {
        if (m.state !== 'playing') return false;
        const cur = m.current;
        if (!cur) return false;
        return (
          cur.queueId !== before.curId ||
          (before.startedAt != null && cur.startedAt !== before.startedAt) ||
          (cur.positionSec ?? 0) > 0
        );
      }
      if (target === 'paused') return m.state === 'paused';
      if (target === 'stopped') return m.state === 'stopped' || m.state === 'idle';
      if (target === 'next') return m.state === 'playing' && (m.current?.queueId ?? null) !== before.curId;
      return false;
    },
    [getMusic],
  );

  const control = useCallback(
    (target: Target, attempt = 0) => {
      if (!canControl) return;
      const before = (() => {
        const m = getMusic();
        return {
          state: (m?.state ?? 'idle') as MusicState,
          curId: m?.current?.queueId ?? null,
          startedAt: m?.current?.startedAt ?? null,
        };
      })();
      const seq = ++confirmSeqRef.current;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setMusicState(roomId, target).catch(() => {});
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = setTimeout(() => {
        if (!mountedRef.current || seq !== confirmSeqRef.current) return;
        if (isControlConfirmed(target, before)) return;
        if (attempt === 0) {
          control(target, 1);
          return;
        }
        Alert.alert(
          'Music control failed',
          'The music bot did not confirm this action. Check your connection and try again.',
        );
      }, 8000);
    },
    [canControl, getMusic, isControlConfirmed, roomId],
  );

  const playTrack = useCallback(
    (queueId: string) => {
      if (!canControl) return;
      const seq = ++confirmSeqRef.current;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setPlayQueueId(roomId, queueId).catch(() => {});
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = setTimeout(() => {
        if (!mountedRef.current || seq !== confirmSeqRef.current) return;
        if (getMusic()?.current?.queueId === queueId) return;
        Alert.alert(
          'Could not play this song',
          'The music bot did not start this song. Check your connection and try again.',
        );
      }, 8000);
    },
    [canControl, getMusic, roomId],
  );

  const playMine = useCallback(() => {
    if (!canControl) return;
    const m = getMusic();
    const cur = m?.current;
    if (cur && cur.addedBy === uid) {
      control('playing');
      return;
    }
    const mine = (m?.queue ?? []).find((t) => t.addedBy === uid);
    if (mine) playTrack(mine.queueId);
  }, [canControl, getMusic, uid, control, playTrack]);

  const nextRoom = useCallback(() => {
    // Next: the bot advances the room queue ('next' state write). The
    // queue holds the opener's own songs in practice (adds are
    // owner/admin-gated), so this is the honest engine action for the
    // player's next button.
    control('next');
  }, [control]);

  const hasQueued = useCallback(() => {
    const m = getMusic();
    return (m?.queue ?? []).length > 0;
  }, [getMusic]);

  const playLibrarySong = useCallback(
    (entry: { mediaId: string; title: string; url: string; duration: number | null }) => {
      if (!canControl) return;
      const m = getMusic();
      const queued = (m?.queue ?? []).find((t) => t.mediaId === entry.mediaId && t.addedBy === uid);
      if (queued) {
        playTrack(queued.queueId);
        return;
      }
      addMusicTrack(
        roomId,
        { title: entry.title, url: entry.url, mediaId: entry.mediaId, durationSec: entry.duration },
        myName,
      )
        .then((queueId) => {
          if (queueId) playTrack(queueId);
        })
        .catch(() => {
          Alert.alert('Could not play this song', 'Check your connection and try again.');
        });
    },
    [canControl, getMusic, uid, roomId, myName, playTrack],
  );

  const restartCurrent = useCallback(() => {
    // Prev: the engine keeps NO previous-track history, so prev restarts
    // the current track from the beginning. 'stopped' keeps the song with
    // positionSec reset to 0; once the bot has converted to stopped/idle
    // (max 5s wait), 'playing' restarts it from 0.
    if (!canControl) return;
    const m = getMusic();
    if (!m?.current) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setMusicState(roomId, 'stopped').catch(() => {});
    const started = Date.now();
    const tick = () => {
      if (!mountedRef.current) return;
      const cur = getMusic();
      if (cur && (cur.state === 'stopped' || cur.state === 'idle')) {
        control('playing');
        return;
      }
      if (Date.now() - started > 5000) {
        control('playing');
        return;
      }
      setTimeout(tick, 500);
    };
    setTimeout(tick, 500);
  }, [canControl, getMusic, roomId, control]);

  const togglePlay = useCallback(() => {
    if (!canControl) return;
    const m = getMusic();
    if (m?.state === 'playing') control('paused');
    else if (m?.state === 'paused') control('playing');
    else playMine();
  }, [canControl, getMusic, control, playMine]);

  const stop = useCallback(() => {
    control('stopped');
  }, [control]);

  const setVol = useCallback(
    (v: number) => {
      const clamped = Math.min(1, Math.max(0, Math.round(v * 10) / 10));
      setVolumeState(clamped);
      if (clamped > 0) lastVolRef.current = clamped;
      persistMusicVolume(clamped).catch(() => {});
      onVolumeChange(clamped);
    },
    [onVolumeChange],
  );

  const toggleMute = useCallback(() => {
    const cur = getMusicVolumeSync();
    if (cur > 0) {
      lastVolRef.current = cur;
      setVol(0);
    } else {
      setVol(lastVolRef.current > 0 ? lastVolRef.current : 1);
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [setVol]);

  const canPlaySomething = useCallback(() => {
    const m = getMusic();
    if (!m) return false;
    if (m.current && m.current.addedBy === uid) return true;
    return (m.queue ?? []).some((t) => t.addedBy === uid);
  }, [getMusic, uid]);

  // Fresh-read helper for post-add decisions (same role as the old modal's
  // getRoomMusicOnce usage): never trust a render closure after a Stop.
  const freshMusic = useCallback(() => getRoomMusicOnce(roomId), [roomId]);

  return {
    control,
    playTrack,
    playMine,
    nextRoom,
    hasQueued,
    playLibrarySong,
    restartCurrent,
    togglePlay,
    stop,
    volume,
    toggleMute,
    syncVolume,
    canPlaySomething,
    freshMusic,
  };
}

export type MusicControls = ReturnType<typeof useMusicControls>;
