import React, { useState } from 'react';
import { View, Text, Pressable, Modal, Image, StyleSheet } from 'react-native';

interface VerifiedNameProps {
  name: string;
  hasOfficialBadge: boolean;
  nameStyle?: any;
  logoSize?: number;
}

/**
 * 2026-10-13 (Sumon): Name with Vee Official logo.
 * - Shows Vee logo next to name if user has official badge
 * - Click logo → polished "Vee Official" badge popup
 * - Use EVERYWHERE names are displayed
 */
export function VerifiedName({ name, hasOfficialBadge, nameStyle, logoSize = 16 }: VerifiedNameProps) {
  const [showBadge, setShowBadge] = useState(false);

  return (
    <View style={styles.container}>
      <Text style={nameStyle} numberOfLines={1}>{name}</Text>
      {hasOfficialBadge && (
        <Pressable onPress={() => setShowBadge(true)} hitSlop={8}>
          <Image
            source={require('@/assets/images/icon.png')}
            style={{ width: logoSize, height: logoSize, marginLeft: 4, borderRadius: logoSize / 2 }}
          />
        </Pressable>
      )}

      {/* Badge popup */}
      <Modal visible={showBadge} transparent animationType="fade" onRequestClose={() => setShowBadge(false)}>
        <Pressable style={styles.overlay} onPress={() => setShowBadge(false)}>
          <View style={styles.card}>
            <Image
              source={require('@/assets/images/icon.png')}
              style={{ width: 80, height: 80, borderRadius: 40, marginBottom: 12 }}
            />
            <Text style={styles.title}>Vee Official</Text>
            <Text style={styles.subtitle}>Grant to Vee Official Team</Text>
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
