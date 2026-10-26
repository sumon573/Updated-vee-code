/**
 * TaskCenterModal — SINGLE-EVENT direct page (boss 2026-10-26 21:09).
 *
 * The task bar opens THE main event itself — ONE page, no list, no
 * intermediate panel. The main event is the first active event by
 * sortOrder, so the server decides which event is main.
 * Presentation (boss 2026-10-26 21:47): imo-style HALF display, NOT full
 * screen — a bottom sheet (70%) with the room visible above; tap outside
 * closes; the rest scrolls inside the sheet.
 * No events → a plain empty state (real state, never demo content).
 */
import { useState, useEffect } from 'react';
import { View, Text, Pressable, Modal } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { subscribeTaskEvents, type TaskEvent } from '@/src/features/tasks/services/taskEventService';
import { EventPageView } from './EventPageView';
import { C } from '../constants/theme';

export function TaskCenterModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [events, setEvents] = useState<TaskEvent[] | null>(null);

  useEffect(() => {
    if (!visible) return;
    const unsub = subscribeTaskEvents((ev) => setEvents(ev));
    return unsub;
  }, [visible]);

  const main = events && events.length > 0 ? events[0] : null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={{ height: '70%', backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden' }}>
      {main ? (
        <EventPageView event={main} onBack={onClose} onClose={onClose} />
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <Pressable onPress={onClose} hitSlop={10} style={{ position: 'absolute', top: 12, right: 16, width: 32, height: 32, borderRadius: 16, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' }}>
            <Feather name="x" size={16} color={C.sub} />
          </Pressable>
          <Text style={{ color: C.text, fontSize: 16, fontWeight: '800', textAlign: 'center' }}>
            {events === null ? 'Loading…' : 'No live events right now'}
          </Text>
        </View>
      )}
        </View>
      </View>
    </Modal>
  );
}
