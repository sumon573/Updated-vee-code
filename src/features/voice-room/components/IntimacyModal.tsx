/**
 * IntimacyModal — IMO intimacy/relationship UI, ported to Vee (2026-10-19).
 *
 * IMO behavior (voiceroom/intimacyrelation): entry view lists your relationships
 * by intimacy value; tapping one opens the detail with level progress rendered
 * puzzle-style (hearts fill as the level grows); intimacy grows via gifts.
 * Vee backend: intimacyService (intimacy/{pairKey}).
 */
import { useEffect, useState } from 'react';
import {
  View, Text, Modal, Pressable, ScrollView, Image, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import {
  subscribeMyIntimacies, subscribeIntimacy, fetchPeerProfile,
  intimacyLevelFor, intimacyProgress, INTIMACY_LEVELS,
  type IntimacyEntry,
} from '../services/intimacyService';

interface Props {
  visible: boolean;
  myUid: string;
  onClose: () => void;
}

interface PeerInfo { name: string; photoURL: string | null }

function PeerAvatar({ uri, name, size }: { uri: string | null; name: string; size: number }) {
  if (uri) {
    return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  }
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2, backgroundColor: '#E3F2FD',
      alignItems: 'center', justifyContent: 'center',
    }}>
      <Text style={{ color: '#007AFF', fontWeight: '800', fontSize: size * 0.36 }}>
        {(name || '?').slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}

/** IMO puzzle-style: hearts fill left→right as level progress grows. */
function PuzzleHearts({ progress }: { progress: number }) {
  const total = 5;
  const filled = Math.round(progress * total);
  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {Array.from({ length: total }).map((_, i) => (
        <Text key={i} style={{ fontSize: 22, opacity: i < filled ? 1 : 0.25 }}>💗</Text>
      ))}
    </View>
  );
}

export function IntimacyModal({ visible, myUid, onClose }: Props) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<IntimacyEntry[] | null>(null);
  const [peers, setPeers] = useState<Record<string, PeerInfo>>({});
  const [selected, setSelected] = useState<IntimacyEntry | null>(null);
  const [liveValue, setLiveValue] = useState(0);

  useEffect(() => {
    if (!visible || !myUid) return;
    setEntries(null);
    setSelected(null);
    return subscribeMyIntimacies(myUid, setEntries);
  }, [visible, myUid]);

  useEffect(() => {
    if (!entries) return;
    const missing = entries.map((e) => e.otherUid).filter((u) => !peers[u]);
    if (missing.length === 0) return;
    let cancelled = false;
    (async () => {
      const got: Record<string, PeerInfo> = {};
      for (const u of missing.slice(0, 30)) {
        got[u] = await fetchPeerProfile(u);
        if (cancelled) return;
      }
      if (!cancelled) setPeers((p) => ({ ...p, ...got }));
    })();
    return () => { cancelled = true; };
  }, [entries]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live value for the open detail (IMO detail view updates in realtime).
  useEffect(() => {
    if (!selected) return;
    setLiveValue(selected.value);
    return subscribeIntimacy(myUid, selected.otherUid, (rec) => setLiveValue(rec.value));
  }, [selected, myUid]);

  const openDetail = (e: IntimacyEntry) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelected(e);
  };

  const level = intimacyLevelFor(liveValue);
  const progress = intimacyProgress(liveValue);
  const selPeer = selected ? peers[selected.otherUid] : undefined;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
        <View style={{
          backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20,
          maxHeight: '75%', paddingBottom: 28,
        }}>
          {/* header */}
          <View style={{
            flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18,
            paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F0F0F0',
          }}>
            {selected ? (
              <Pressable onPress={() => setSelected(null)} hitSlop={10} style={{ marginRight: 10 }}>
                <Feather name="arrow-left" size={20} color="#007AFF" />
              </Pressable>
            ) : (
              <Text style={{ fontSize: 18, marginRight: 8 }}>💕</Text>
            )}
            <Text style={{ fontSize: 16, fontWeight: '800', color: '#111', flex: 1 }}>
              {selected
                ? (selPeer?.name || t('voiceRoom.intimacy.someone'))
                : t('voiceRoom.intimacy.title')}
            </Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Feather name="x" size={20} color="#666" />
            </Pressable>
          </View>

          {selected ? (
            /* ── detail: IMO puzzle-style level view ── */
            <ScrollView style={{ padding: 20 }} showsVerticalScrollIndicator={false}>
              <View style={{ alignItems: 'center' }}>
                <PeerAvatar uri={selPeer?.photoURL ?? null} name={selPeer?.name || ''} size={84} />
                <Text style={{ fontSize: 17, fontWeight: '800', color: '#111', marginTop: 10 }}>
                  {selPeer?.name || t('voiceRoom.intimacy.someone')}
                </Text>
                <View style={{
                  marginTop: 8, backgroundColor: '#FFF3E0', borderRadius: 20,
                  paddingHorizontal: 14, paddingVertical: 6,
                }}>
                  <Text style={{ color: '#E65100', fontWeight: '800', fontSize: 13 }}>
                    {t('voiceRoom.intimacy.level', { n: level.id })}
                  </Text>
                </View>
                <View style={{ marginTop: 14 }}>
                  <PuzzleHearts progress={progress} />
                </View>
                {/* progress bar */}
                <View style={{
                  width: '100%', height: 10, borderRadius: 5, backgroundColor: '#F0F0F0',
                  marginTop: 14, overflow: 'hidden',
                }}>
                  <View style={{
                    width: `${Math.round(progress * 100)}%`, height: '100%',
                    backgroundColor: '#EC4899', borderRadius: 5,
                  }} />
                </View>
                <Text style={{ color: '#666', fontSize: 13, marginTop: 8 }}>
                  {liveValue.toLocaleString()} / {level.max === null ? '∞' : level.max.toLocaleString()}
                  {' '}{t('voiceRoom.intimacy.points')}
                </Text>
                {level.id < INTIMACY_LEVELS.length && (
                  <Text style={{ color: '#999', fontSize: 12, marginTop: 4, textAlign: 'center' }}>
                    {t('voiceRoom.intimacy.nextLevel', {
                      n: level.id + 1,
                      pts: ((level.max ?? liveValue) + 1 - liveValue).toLocaleString(),
                    })}
                  </Text>
                )}
                <Text style={{ color: '#999', fontSize: 12, marginTop: 14, textAlign: 'center', lineHeight: 18 }}>
                  {t('voiceRoom.intimacy.howTo')}
                </Text>
              </View>
            </ScrollView>
          ) : (
            /* ── entry list ── */
            <ScrollView style={{ paddingHorizontal: 18 }} showsVerticalScrollIndicator={false}>
              {entries === null ? (
                <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                  <ActivityIndicator size="large" color="#007AFF" />
                </View>
              ) : entries.length === 0 ? (
                <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                  <Text style={{ fontSize: 40 }}>💕</Text>
                  <Text style={{ color: '#999', marginTop: 12, textAlign: 'center', lineHeight: 20 }}>
                    {t('voiceRoom.intimacy.empty')}
                  </Text>
                </View>
              ) : (
                entries.map((e) => {
                  const p = peers[e.otherUid];
                  const lv = intimacyLevelFor(e.value);
                  return (
                    <Pressable
                      key={e.pairKey}
                      onPress={() => openDetail(e)}
                      style={{
                        flexDirection: 'row', alignItems: 'center', paddingVertical: 12,
                        borderBottomWidth: 1, borderBottomColor: '#F5F5F5',
                      }}
                    >
                      <PeerAvatar uri={p?.photoURL ?? null} name={p?.name || ''} size={48} />
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={{ fontSize: 15, fontWeight: '700', color: '#111' }}>
                          {p?.name || t('voiceRoom.intimacy.someone')}
                        </Text>
                        <Text style={{ fontSize: 12, color: '#999', marginTop: 2 }}>
                          {t('voiceRoom.intimacy.level', { n: lv.id })} · {e.value.toLocaleString()} {t('voiceRoom.intimacy.points')}
                        </Text>
                      </View>
                      <Text style={{ fontSize: 20 }}>💗</Text>
                      <Feather name="chevron-right" size={18} color="#CCC" style={{ marginLeft: 4 }} />
                    </Pressable>
                  );
                })
              )}
              <View style={{ height: 16 }} />
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}
