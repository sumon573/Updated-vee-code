/**
 * CallsTabScreen — IMO-style call history tab (2026-10-19).
 * Reads callHistory/{uid} via callHistoryService. Rows: 52dp avatar,
 * 16sp name, call direction/status line, red missed styling, 79dp-inset
 * dividers — matching IMO chat-row tokens.
 */
import { useEffect, useState } from 'react';
import { View, Text, FlatList, Image, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/src/context/AuthContext';
import {
  subscribeCallHistory,
  type CallHistoryEntry,
} from '@/src/features/audio-call/services/callHistoryService';

interface CallsTabScreenProps {
  onCallBack: (entry: CallHistoryEntry) => void;
  onMissedCountChange?: (count: number) => void;
}

function formatTime(timestamp: number): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
  if (diffDays <= 0) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  if (diffDays === 1) return 'Yesterday';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function CallRow({
  entry,
  onCallBack,
}: {
  entry: CallHistoryEntry;
  onCallBack: (entry: CallHistoryEntry) => void;
}) {
  const missed = entry.direction === 'incoming' && entry.status === 'missed';
  const accent = missed ? '#ff3b30' : '#7a7a7a';
  const statusLabel =
    entry.status === 'missed'
      ? 'Missed'
      : entry.status === 'declined'
        ? 'Declined'
        : entry.status === 'cancelled'
          ? 'Cancelled'
          : entry.direction === 'incoming'
            ? 'Incoming'
            : 'Outgoing';
  const arrowIcon =
    entry.direction === 'incoming' ? 'arrow-down' : ('arrow-up' as const);

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        height: 76,
        paddingLeft: 12,
        paddingRight: 15,
        backgroundColor: '#FFFFFF',
      }}
    >
      {/* Avatar — 52dp */}
      <View style={{ margin: 3 }}>
        {entry.remotePhotoURL ? (
          <Image
            source={{ uri: entry.remotePhotoURL }}
            style={{ width: 52, height: 52, borderRadius: 26 }}
          />
        ) : (
          <View
            style={{
              width: 52,
              height: 52,
              borderRadius: 26,
              backgroundColor: '#DFE5EA',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: 20, fontWeight: '600', color: '#788187' }}>
              {(entry.remoteName || '?').charAt(0)}
            </Text>
          </View>
        )}
      </View>

      {/* Text block */}
      <View style={{ flex: 1, marginLeft: 9, justifyContent: 'center' }}>
        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          style={{ fontSize: 16, fontWeight: '500', color: '#000000' }}
        >
          {entry.remoteName || 'Vee User'}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
          <Ionicons name={arrowIcon} size={14} color={accent} />
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={{ fontSize: 13, color: accent, marginLeft: 4 }}
          >
            {statusLabel}
            {entry.status === 'completed' && entry.durationSec != null
              ? ` · ${Math.floor(entry.durationSec / 60)}:${String(entry.durationSec % 60).padStart(2, '0')}`
              : ''}
          </Text>
        </View>
      </View>

      {/* Time + call-back */}
      <View style={{ alignItems: 'flex-end', justifyContent: 'center' }}>
        <Text style={{ fontSize: 12, color: '#7a7a7a' }}>{formatTime(entry.startedAt)}</Text>
        <TouchableOpacity
          onPress={() => onCallBack(entry)}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={{ marginTop: 6 }}
        >
          <Ionicons name="call" size={20} color="#009dff" />
        </TouchableOpacity>
      </View>

      {/* Divider — inset 79dp like IMO chat rows */}
      <View
        style={{
          position: 'absolute',
          left: 79,
          right: 0,
          bottom: 0,
          height: 1,
          backgroundColor: '#F0F1F2',
        }}
      />
    </View>
  );
}

export default function CallsTabScreen({ onCallBack, onMissedCountChange }: CallsTabScreenProps) {
  const { user } = useAuth();
  const [entries, setEntries] = useState<CallHistoryEntry[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!user?.uid) return;
    return subscribeCallHistory(user.uid, (list) => {
      setEntries(list);
      setReady(true);
      const missed = list.filter(
        (e) => e.direction === 'incoming' && e.status === 'missed',
      ).length;
      onMissedCountChange?.(missed);
    });
  }, [user?.uid, onMissedCountChange]);

  return (
    <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
      {/* Title bar */}
      <View
        style={{
          height: 48,
          justifyContent: 'center',
          paddingHorizontal: 16,
          borderBottomWidth: 1,
          borderBottomColor: '#F0F1F2',
        }}
      >
        <Text style={{ fontSize: 17, fontWeight: '600', color: '#25292D' }}>Calls</Text>
      </View>
      <FlatList
        data={entries}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <CallRow entry={item} onCallBack={onCallBack} />}
        ListEmptyComponent={
          ready ? (
            <View style={{ alignItems: 'center', paddingTop: 90, paddingHorizontal: 32 }}>
              <Text style={{ fontSize: 52, marginBottom: 14 }}>📞</Text>
              <Text style={{ fontSize: 17, fontWeight: '700', color: '#111111' }}>No calls yet</Text>
              <Text
                style={{ fontSize: 13, color: '#666666', marginTop: 6, textAlign: 'center' }}
              >
                Your recent calls will appear here
              </Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}
