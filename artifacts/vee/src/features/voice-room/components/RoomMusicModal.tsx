import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, Alert, Pressable, Modal } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as MediaLibrary from 'expo-media-library';
import { C } from '../constants/theme';
import {
  subscribeRoomMusic,
  addMusicTrack,
  setMusicState,
  removeQueueTrack,
  uploadMusicFile,
  type RoomMusic,
} from '../services/roomMusicService';
import {
  getMusicVolumeSync,
  setMusicVolume as persistMusicVolume,
} from '../services/musicVolumeService';

/* ─────────────────────────── Room Music Modal ─────────────────────────── */

/**
 * RoomMusicModal — room-wide music (2026-10-25, boss: everyone hears).
 * The VPS bot does the actual streaming; this modal is queue + controls.
 * Owner/admin: add from phone, play/pause/next/stop, remove queued tracks.
 * Members: read-only (now playing + queue) — they hear it via LiveKit.
 */
export function RoomMusicModal({
  visible, onClose, roomId, canControl, myName, onVolumeChange,
}: {
  visible: boolean;
  onClose: () => void;
  roomId: string;
  canControl: boolean;
  myName: string;
  /** Engine apply for the local music volume (0–1). */
  onVolumeChange: (v: number) => void;
}) {
  const [music, setMusic] = useState<RoomMusic | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [assets, setAssets] = useState<MediaLibrary.Asset[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [volume, setVolumeState] = useState(getMusicVolumeSync());

  useEffect(() => {
    if (!visible || !roomId) return;
    return subscribeRoomMusic(roomId, setMusic);
  }, [visible, roomId]);

  useEffect(() => {
    if (!visible) setPickerOpen(false);
    else setVolumeState(getMusicVolumeSync());
  }, [visible]);

  const loadAudio = useCallback(async () => {
    setAssetsLoading(true);
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Allow access to audio files to add music.');
        return;
      }
      const result = await MediaLibrary.getAssetsAsync({
        first: 100,
        mediaType: [MediaLibrary.MediaType.audio],
        sortBy: [MediaLibrary.SortBy.creationTime],
      });
      setAssets([...result.assets].sort((a, b) => (b.creationTime || 0) - (a.creationTime || 0)));
    } catch {
      Alert.alert('Error', 'Could not load audio files.');
    } finally {
      setAssetsLoading(false);
    }
  }, []);

  const openPicker = () => {
    setPickerOpen(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    loadAudio();
  };

  const handleAdd = async (asset: MediaLibrary.Asset) => {
    if (uploading) return;
    const filename = asset.filename || `music-${Date.now()}.mp3`;
    setUploading(filename);
    try {
      const { mediaId, url } = await uploadMusicFile({ uri: asset.uri, filename });
      await addMusicTrack(roomId, { title: filename, url, mediaId }, myName);
      if (!music || music.state === 'idle') {
        await setMusicState(roomId, 'playing');
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPickerOpen(false);
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not add music.');
    } finally {
      setUploading(null);
    }
  };

  const control = (state: 'playing' | 'paused' | 'next' | 'stopped') => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setMusicState(roomId, state).catch(() => {
      Alert.alert('Error', 'Could not change playback.');
    });
  };

  /** Local volume (this phone only): persist + apply to the bot track. */
  const setVol = (v: number) => {
    const clamped = Math.min(1, Math.max(0, Math.round(v * 10) / 10));
    setVolumeState(clamped);
    persistMusicVolume(clamped).catch(() => {});
    onVolumeChange(clamped);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const displayTitle = (title: string) => title.replace(/\.[^.]+$/, '');
  const fmtDur = (sec: number) => {
    const s = Math.floor(sec || 0);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  const current = music?.current ?? null;
  const state = music?.state ?? 'idle';
  const playing = state === 'playing';
  const paused = state === 'paused';

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={onClose} />
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0,
        backgroundColor: '#FFFFFF', borderTopLeftRadius: 26, borderTopRightRadius: 26,
        borderWidth: 1, borderColor: 'rgba(139,92,246,0.35)', maxHeight: '88%' }}>
        <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: C.muted,
          alignSelf: 'center', marginTop: 12, marginBottom: 4 }} />
        <ScrollView contentContainerStyle={{ padding: 20 }} showsVerticalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
            <View style={{ width: 40, height: 40, borderRadius: 12,
              backgroundColor: 'rgba(139,92,246,0.15)',
              alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
              <Feather name="music" size={18} color="#7C3AED" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.text, fontSize: 18, fontWeight: '900' }}>
                {pickerOpen ? 'Choose from phone' : 'Room Music'}
              </Text>
              <Text style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>
                {pickerOpen
                  ? 'Everyone in the room will hear it'
                  : canControl
                    ? 'Phone music for the whole room'
                    : 'Playing for the whole room'}
              </Text>
            </View>
            {pickerOpen ? (
              <Pressable onPress={() => setPickerOpen(false)} style={{ padding: 6 }}>
                <Feather name="arrow-left" size={22} color={C.sub} />
              </Pressable>
            ) : (
              <Pressable onPress={onClose} style={{ padding: 6 }}>
                <Feather name="x" size={22} color={C.sub} />
              </Pressable>
            )}
          </View>

          {pickerOpen ? (
            <>
              {assetsLoading ? (
                <Text style={{ color: C.muted, fontSize: 14, textAlign: 'center', paddingVertical: 24 }}>
                  Loading audio…
                </Text>
              ) : assets.length === 0 ? (
                <Text style={{ color: C.muted, fontSize: 14, textAlign: 'center', paddingVertical: 24 }}>
                  No audio files found on this phone.
                </Text>
              ) : (
                assets.map((a) => {
                  const filename = a.filename || 'Unknown';
                  const busy = uploading === filename;
                  return (
                    <Pressable
                      key={a.id}
                      onPress={() => handleAdd(a)}
                      disabled={!!uploading}
                      style={{ flexDirection: 'row', alignItems: 'center',
                        paddingVertical: 12, borderTopWidth: 1, borderTopColor: C.borderFaint,
                        opacity: uploading && !busy ? 0.5 : 1 }}>
                      <Feather name="music" size={16} color="#7C3AED" style={{ marginRight: 10 }} />
                      <View style={{ flex: 1 }}>
                        <Text numberOfLines={1} style={{ color: C.text, fontSize: 14, fontWeight: '700' }}>
                          {displayTitle(filename)}
                        </Text>
                        <Text style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>
                          {fmtDur(a.duration)}
                        </Text>
                      </View>
                      <Text style={{ color: '#7C3AED', fontSize: 13, fontWeight: '800' }}>
                        {busy ? 'Uploading…' : 'Add'}
                      </Text>
                    </Pressable>
                  );
                })
              )}
            </>
          ) : (
            <>
              {/* Now playing */}
              <View style={{ backgroundColor: 'rgba(139,92,246,0.08)',
                borderRadius: 16, padding: 16,
                borderWidth: 1, borderColor: 'rgba(139,92,246,0.25)' }}>
                <Text style={{ color: C.sub, fontSize: 12, fontWeight: '700', marginBottom: 6 }}>
                  {playing ? 'NOW PLAYING' : paused ? 'PAUSED' : 'NOTHING PLAYING'}
                </Text>
                <Text numberOfLines={2} style={{ color: C.text, fontSize: 16, fontWeight: '800' }}>
                  {current ? displayTitle(current.title) : 'No music yet'}
                </Text>
                {!!current && (
                  <Text style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>
                    Added by {current.addedByName}
                  </Text>
                )}
                {canControl && (playing || paused) && (
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
                    {playing && (
                      <Pressable onPress={() => control('paused')}
                        style={{ flex: 1, backgroundColor: '#7C3AED', borderRadius: 12,
                          paddingVertical: 11, alignItems: 'center' }}>
                        <Text style={{ color: '#FFF', fontWeight: '800', fontSize: 14 }}>Pause</Text>
                      </Pressable>
                    )}
                    {paused && (
                      <Pressable onPress={() => control('playing')}
                        style={{ flex: 1, backgroundColor: '#7C3AED', borderRadius: 12,
                          paddingVertical: 11, alignItems: 'center' }}>
                        <Text style={{ color: '#FFF', fontWeight: '800', fontSize: 14 }}>Resume</Text>
                      </Pressable>
                    )}
                    <Pressable onPress={() => control('next')}
                      style={{ flex: 1, backgroundColor: C.card, borderRadius: 12,
                        paddingVertical: 11, alignItems: 'center',
                        borderWidth: 1, borderColor: C.borderFaint }}>
                      <Text style={{ color: C.text, fontWeight: '800', fontSize: 14 }}>Next</Text>
                    </Pressable>
                    <Pressable onPress={() => control('stopped')}
                      style={{ flex: 1, backgroundColor: C.card, borderRadius: 12,
                        paddingVertical: 11, alignItems: 'center',
                        borderWidth: 1, borderColor: C.borderFaint }}>
                      <Text style={{ color: C.text, fontWeight: '800', fontSize: 14 }}>Stop</Text>
                    </Pressable>
                  </View>
                )}
              </View>

              {/* Music volume — LOCAL to this phone (everyone, not gated). */}
              {!!current && (
                <View style={{ marginTop: 16 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={{ color: C.sub, fontSize: 13, fontWeight: '700' }}>
                      Music volume
                    </Text>
                    <Text style={{ color: C.sub, fontSize: 13, fontWeight: '800' }}>
                      {Math.round(volume * 100)}%
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 }}>
                    <Pressable onPress={() => setVol(volume - 0.1)}
                      style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: C.card,
                        alignItems: 'center', justifyContent: 'center',
                        borderWidth: 1, borderColor: C.borderFaint }}>
                      <Feather name="minus" size={16} color={C.text} />
                    </Pressable>
                    <View style={{ flex: 1, flexDirection: 'row', gap: 3 }}>
                      {Array.from({ length: 10 }, (_, i) => (
                        <Pressable key={i} onPress={() => setVol((i + 1) / 10)}
                          style={{ flex: 1, height: 10, borderRadius: 5,
                            backgroundColor: i < Math.round(volume * 10) ? '#7C3AED' : C.borderFaint }}
                        />
                      ))}
                    </View>
                    <Pressable onPress={() => setVol(volume + 0.1)}
                      style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: C.card,
                        alignItems: 'center', justifyContent: 'center',
                        borderWidth: 1, borderColor: C.borderFaint }}>
                      <Feather name="plus" size={16} color={C.text} />
                    </Pressable>
                  </View>
                  <Text style={{ color: C.muted, fontSize: 11, marginTop: 6 }}>
                    Volume is only for your phone — it never changes others'.
                  </Text>
                </View>
              )}

              {/* Queue */}
              <Text style={{ color: C.sub, fontSize: 13, fontWeight: '700', marginTop: 20, marginBottom: 4 }}>
                Up next ({music?.queue.length ?? 0})
              </Text>
              {(music?.queue.length ?? 0) === 0 ? (
                <Text style={{ color: C.muted, fontSize: 13, paddingVertical: 8 }}>
                  Queue is empty.
                </Text>
              ) : (
                music!.queue.map((t) => (
                  <View key={t.queueId} style={{ flexDirection: 'row', alignItems: 'center',
                    paddingVertical: 11, borderTopWidth: 1, borderTopColor: C.borderFaint }}>
                    <Feather name="music" size={15} color={C.muted} style={{ marginRight: 10 }} />
                    <View style={{ flex: 1 }}>
                      <Text numberOfLines={1} style={{ color: C.text, fontSize: 14, fontWeight: '700' }}>
                        {displayTitle(t.title)}
                      </Text>
                      <Text style={{ color: C.muted, fontSize: 12, marginTop: 1 }}>
                        Added by {t.addedByName}
                      </Text>
                    </View>
                    {canControl && (
                      <Pressable
                        onPress={() => removeQueueTrack(roomId, t.queueId).catch(() => {})}
                        style={{ padding: 6 }}>
                        <Feather name="x" size={16} color={C.muted} />
                      </Pressable>
                    )}
                  </View>
                ))
              )}

              {canControl && (
                <Pressable onPress={openPicker}
                  style={{ marginTop: 16, backgroundColor: '#7C3AED', borderRadius: 14,
                    paddingVertical: 14, alignItems: 'center' }}>
                  <Text style={{ color: '#FFF', fontWeight: '800', fontSize: 15 }}>
                    Add music from phone
                  </Text>
                </Pressable>
              )}
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
