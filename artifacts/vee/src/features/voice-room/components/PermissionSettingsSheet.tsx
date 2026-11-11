import React from 'react';
import { View, Text, Pressable, Modal } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { C } from '../constants/theme';
import type { Role } from '../types/room';

/* ── 2026-11-11 (boss, imo mirror): "Permission Settings" sheet ─────────
   DP + name + ⓘ, "Permission Settings" heading, role rows, red
   "🗑 Remove from Member" button. Contents depend on viewer/target:
   - Owner → Admin: Admin (checked) + Member + Remove from Member.
   - Owner → User: Admin + Member (checked) + Remove from Member.
   - Admin → User: ONLY Member (checked) + Remove from Member — NO Admin
     row (an admin cannot set/dismiss an admin).
   `canSetAdmin` is false for Admin → User, so the Admin row never renders
   there. Tapping the checked row is a no-op; tapping the other role row
   applies that role. The ⓘ is shown as in the screenshot; its function is
   unknown, so it has no action. */

export function PermissionSettingsSheet({ visible, targetName, targetPhotoURL, targetRole, canSetAdmin, onSetAdmin, onDismissAdmin, onRemoveFromMember, onClose }: {
  visible: boolean;
  targetName: string;
  targetPhotoURL?: string | null;
  targetRole: Role;
  /** False for Admin → User (the Admin row must not render). */
  canSetAdmin: boolean;
  onSetAdmin: () => void;
  onDismissAdmin: () => void;
  onRemoveFromMember: () => void;
  onClose: () => void;
}) {
  const isAdmin = targetRole === 'admin';
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }} onPress={onClose}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{ backgroundColor: C.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 28 }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {targetPhotoURL ? (
              <Image source={{ uri: targetPhotoURL }} style={{ width: 40, height: 40, borderRadius: 20 }} contentFit="cover" />
            ) : (
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#E3F2FD', alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 18, fontWeight: '700', color: C.primary }}>{(targetName || 'U').slice(0, 1).toUpperCase()}</Text>
              </View>
            )}
            <Text style={{ fontSize: 17, fontWeight: '700', color: C.text, marginLeft: 10 }} numberOfLines={1}>{targetName}</Text>
            {/* ⓘ as shown in the screenshot — function unknown, no action. */}
            <Text style={{ fontSize: 15, color: C.muted, marginLeft: 6 }}>ⓘ</Text>
          </View>
          <Text style={{ fontSize: 16, fontWeight: '700', color: C.text, marginTop: 18, marginBottom: 8 }}>Permission Settings</Text>
          {canSetAdmin && (
            <Pressable
              onPress={() => { if (!isAdmin) onSetAdmin(); }}
              style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 13, borderBottomWidth: 0.5, borderBottomColor: C.border }}
            >
              <Feather name="user" size={18} color={C.text} />
              <Text style={{ flex: 1, fontSize: 16, color: C.text, marginLeft: 12 }}>Admin</Text>
              {isAdmin ? <Feather name="check" size={20} color="#2196F3" /> : null}
            </Pressable>
          )}
          <Pressable
            onPress={() => { if (isAdmin) onDismissAdmin(); }}
            style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 13, borderBottomWidth: 0.5, borderBottomColor: C.border }}
          >
            <Feather name="user" size={18} color={C.text} />
            <Text style={{ flex: 1, fontSize: 16, color: C.text, marginLeft: 12 }}>Member</Text>
            {!isAdmin ? <Feather name="check" size={20} color="#2196F3" /> : null}
          </Pressable>
          <Pressable
            onPress={onRemoveFromMember}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 18, backgroundColor: '#FEE2E2', borderRadius: 12, paddingVertical: 13 }}
          >
            <Feather name="trash-2" size={17} color="#DC2626" />
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#DC2626', marginLeft: 8 }}>Remove from Member</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
