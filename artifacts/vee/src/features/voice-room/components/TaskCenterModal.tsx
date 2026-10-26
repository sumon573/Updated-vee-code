/**
 * TaskCenterModal — voice-room Task Center (2026-10-24, Sumon).
 *
 * The bottom-bar Task Center button existed but never opened anything
 * (taskCenterOpen state was set and never rendered) and the RTDB
 * `task_events` service was never consumed. This modal completes the
 * section: events are FULLY SERVER-DRIVEN from RTDB `task_events/{id}`
 * (see taskEventService) — adding/editing/removing an event on the
 * server updates this panel with no app build. Imageless events show
 * a clean placeholder tile (never filtered out).
 */
import { useEffect, useState } from 'react';
import { View, Text, Pressable, Modal, Platform, ScrollView, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { C } from '../constants/theme';
import { EventDetailsView } from './EventDetailsView';
import { DiamondIcon } from '@/src/components/DiamondIcon';
import {
  subscribeTaskEvents,
  type TaskEvent,
} from '@/src/features/tasks/services/taskEventService';

function fmtCompact(n: number): string {
  if (n >= 999_500_000) return `${parseFloat((n / 1_000_000_000).toFixed(1))}b`;
  if (n >= 999_500) return `${parseFloat((n / 1_000_000).toFixed(1))}m`;
  if (n >= 999.5) return `${parseFloat((n / 1_000).toFixed(1))}k`;
  return `${n}`;
}

function fmtDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function RewardChip({ event }: { event: TaskEvent }) {
  if (event.rewardType === 'diamond' && event.rewardAmount) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FDF2F8', borderWidth: 1, borderColor: '#F9A8D4', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
        <DiamondIcon size={13} />
        <Text style={{ color: '#9D174D', fontSize: 11, fontWeight: '800' }}>{fmtCompact(event.rewardAmount)}</Text>
      </View>
    );
  }
  if (event.rewardType === 'coin' && event.rewardAmount) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FDE68A', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
        <Text style={{ color: '#92400E', fontSize: 11, fontWeight: '800' }}>{fmtCompact(event.rewardAmount)} Coins</Text>
      </View>
    );
  }
  if (event.rewardType === 'badge' || event.rewardType === 'frame') {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#F5F3FF', borderWidth: 1, borderColor: '#DDD6FE', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
        <Text style={{ color: '#5B21B6', fontSize: 11, fontWeight: '800' }}>{event.rewardType === 'badge' ? 'Badge' : 'Frame'}</Text>
      </View>
    );
  }
  return null;
}

export function TaskCenterModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [events, setEvents] = useState<TaskEvent[] | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<TaskEvent | null>(null);

  // Closing the sheet always clears the details view first.
  const closeAll = () => { setSelectedEvent(null); onClose(); };

  useEffect(() => {
    if (!visible) return;
    const unsub = subscribeTaskEvents((ev) => setEvents(ev));
    return unsub;
  }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={closeAll}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.65)' }} onPress={closeAll} />
      <View style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, maxHeight: '78%',
        backgroundColor: '#FFFFFF', borderTopLeftRadius: 28, borderTopRightRadius: 28,
        borderWidth: 1, borderColor: C.border,
        paddingBottom: Platform.OS === 'web' ? 34 : 24, paddingTop: 8,
      }}>
        <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: C.muted, alignSelf: 'center', marginBottom: 14 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginBottom: 12 }}>
          {selectedEvent && (
            <Pressable onPress={() => setSelectedEvent(null)} hitSlop={10} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', marginRight: 8 }}>
              <Feather name="chevron-left" size={18} color={C.text} />
            </Pressable>
          )}
          <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: '#FFFBEB', borderWidth: 1.5, borderColor: '#F59E0B', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
            <Feather name="calendar" size={18} color="#D97706" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.text, fontSize: 17, fontWeight: '800' }}>Task Center</Text>
            <Text style={{ color: C.sub, fontSize: 12, marginTop: 1 }}>Events & rewards, updated live</Text>
          </View>
          <Pressable onPress={closeAll} hitSlop={10} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' }}>
            <Feather name="x" size={16} color={C.sub} />
          </Pressable>
        </View>

        {events === null ? (
          <View style={{ paddingVertical: 40, alignItems: 'center' }}>
            <ActivityIndicator color={C.primary} />
          </View>
        ) : events.length === 0 ? (
          <View style={{ paddingVertical: 36, paddingHorizontal: 32, alignItems: 'center' }}>
            <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
              <Feather name="gift" size={24} color={C.muted} />
            </View>
            <Text style={{ color: C.text, fontSize: 15, fontWeight: '700', textAlign: 'center' }}>No events right now</Text>
            <Text style={{ color: C.sub, fontSize: 12, textAlign: 'center', marginTop: 4 }}>New events and rewards will appear here.</Text>
          </View>
        ) : selectedEvent ? (
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingBottom: 8 }}>
            <EventDetailsView event={selectedEvent} />
          </ScrollView>
        ) : (
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8 }}>
            {events.map((ev) => (
              <Pressable key={ev.id} onPress={() => setSelectedEvent(ev)} style={{
                flexDirection: 'row', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: C.border,
                borderRadius: 18, padding: 12, marginBottom: 10,
              }}>
                {ev.imageUrl ? (
                  <Image source={{ uri: ev.imageUrl }} style={{ width: 64, height: 64, borderRadius: 16, backgroundColor: C.card }} contentFit="cover" cachePolicy="memory-disk" />
                ) : (
                  <View style={{ width: 64, height: 64, borderRadius: 16, backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FDE68A', alignItems: 'center', justifyContent: 'center' }}>
                    <Feather name="gift" size={26} color="#D97706" />
                  </View>
                )}
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={{ color: C.text, fontSize: 15, fontWeight: '800' }} numberOfLines={1}>{ev.title}</Text>
                  {!!ev.description && (
                    <Text style={{ color: C.sub, fontSize: 12, marginTop: 2 }} numberOfLines={2}>{ev.description}</Text>
                  )}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 7, flexWrap: 'wrap' }}>
                    <RewardChip event={ev} />
                    {!!ev.endTime && (
                      <Text style={{ color: C.muted, fontSize: 11, fontWeight: '600' }}>Ends {fmtDate(ev.endTime)}</Text>
                    )}
                    {!!ev.startTime && ev.startTime > Date.now() && (
                      <Text style={{ color: C.muted, fontSize: 11, fontWeight: '600' }}>Starts {fmtDate(ev.startTime)}</Text>
                    )}
                  </View>
                </View>
                <View style={{ justifyContent: 'center', marginLeft: 6 }}>
                  <Feather name="chevron-right" size={20} color={C.muted} />
                </View>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}
