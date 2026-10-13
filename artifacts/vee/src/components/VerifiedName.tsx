import React, { useState } from 'react';
import { View, Text, Pressable, Modal, Image, StyleSheet } from 'react-native';
import { useVerifiedBadge } from '../hooks/useVerifiedBadge';

interface VerifiedNameProps {
  name: string;
  hasOfficialBadge?: boolean;
  uid?: string;
  nameStyle?: any;
  logoSize?: number;
}

/**
 * 2026-10-13 (Sumon): Name with Vee Official badge.
 * - Shows small badge next to name if user has official badge
 * - Click badge → polished "Vee Official" badge popup
 * - Use EVERYWHERE names are displayed (voice room, search, contacts, chat, members)
 * - Pass either hasOfficialBadge (boolean) or uid (will check via hook)
 */
export function VerifiedName({ name, hasOfficialBadge, uid, nameStyle, logoSize = 16 }: VerifiedNameProps) {
  const [showBadge, setShowBadge] = useState(false);
  const hookVerified = useVerifiedBadge(uid);
  
  // Use explicit boolean if provided, otherwise use hook result (if uid provided)
  const verified = hasOfficialBadge !== undefined ? hasOfficialBadge : (uid ? hookVerified : false);

  return (
    <View style={styles.container}>
      <Text style={nameStyle} numberOfLines={1}>{name}</Text>
      {verified && (
        <Pressable onPress={() => setShowBadge(true)} hitSlop={8}>
          <Image
            source={require('@/assets/images/vee-badge.png')}
            style={{ width: logoSize, height: logoSize, marginLeft: 4 }}
            resizeMode="contain"
          />
        </Pressable>
      )}

      {/* Badge popup */}
      <Modal visible={showBadge} transparent animationType="fade" onRequestClose={() => setShowBadge(false)}>
        <Pressable style={styles.overlay} onPress={() => setShowBadge(false)}>
          <View style={styles.card}>
            <Image
              source={require('@/assets/images/vee-badge.png')}
              style={{ width: 120, height: 120, marginBottom: 12 }}
              resizeMode="contain"
            />
            <Text style={styles.title}>Vee Official</Text>
            <Text style={styles.subtitle}>Official verified badge by Vee</Text>
            <Pressable style={styles.button} onPress={() => setShowBadge(false)}>
              <Text style={styles.buttonText}>Close</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    minWidth: 240,
  },
  title: {
    fontSize: 20,
    fontWeight: '900',
    color: '#000000',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: '#8E8E93',
    fontStyle: 'italic',
    marginBottom: 16,
  },
  button: {
    backgroundColor: '#E3F2FD',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 10,
  },
  buttonText: {
    color: '#007AFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
