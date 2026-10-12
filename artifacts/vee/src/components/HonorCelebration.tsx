import React, { useEffect, useState } from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { ref, onValue, update } from 'firebase/database';
import { database } from '../config/firebase';
import { useAuth } from '../context/AuthContext';

interface HonorNotification {
  id: string;
  honorType: 'honor' | 'frame';
  honorName: string;
  title: string;
  body: string;
  timestamp: number;
  read: boolean;
}

/**
 * 2026-10-13 (Sumon): Shows "Congratulations! Got New Honor/Frame"
 * celebration when admin grants a badge/frame officially.
 * Listens to notifications/{uid} for honor_granted type.
 */
export function HonorCelebration() {
  const { user } = useAuth();
  const [pending, setPending] = useState<HonorNotification | null>(null);

  useEffect(() => {
    if (!user?.uid) return;
    const notifRef = ref(database, `notifications/${user.uid}`);
    const unsub = onValue(notifRef, (snap) => {
      if (!snap.exists()) return;
      const data = snap.val() as Record<string, Omit<HonorNotification, 'id'>>;
      // Find the latest unread honor_granted notification
      const entries = Object.entries(data)
        .map(([id, n]) => ({ id, ...n }))
        .filter((n: any) => n.type === 'honor_granted' && !n.read)
        .sort((a, b) => b.timestamp - a.timestamp);
      if (entries.length > 0 && !pending) {
        setPending(entries[0] as HonorNotification);
      }
    });
    return unsub;
  }, [user?.uid]);

  const dismiss = async () => {
    if (!user?.uid || !pending) return;
    // Mark as read
    await update(ref(database, `notifications/${user.uid}/${pending.id}`), { read: true });
    setPending(null);
  };

  if (!pending) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismiss}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.emoji}>{pending.honorType === 'frame' ? '🖼️' : '🏅'}</Text>
          <Text style={styles.title}>{pending.title}</Text>
          <Text style={styles.body}>{pending.body}</Text>
          <Text style={styles.honorName}>{pending.honorName}</Text>
          <Pressable style={styles.button} onPress={dismiss}>
            <Text style={styles.buttonText}>Awesome!</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 32,
    alignItems: 'center',
    width: '100%',
    maxWidth: 340,
  },
  emoji: {
    fontSize: 64,
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '900',
    color: '#000000',
    marginBottom: 8,
  },
  body: {
    fontSize: 18,
    color: '#007AFF',
    fontWeight: '600',
    marginBottom: 8,
  },
  honorName: {
    fontSize: 16,
    color: '#666666',
    marginBottom: 24,
  },
  button: {
    backgroundColor: '#E3F2FD',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 12,
  },
  buttonText: {
    color: '#007AFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
