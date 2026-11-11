import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, Modal } from 'react-native';
import { Image } from 'expo-image';
import { C } from '../constants/theme';

/* ── 2026-11-11 (boss, imo mirror): "Say hi" sheet ───────────────────────
   DP + name + blue "Send" (top-right), a "Greeting Message" field
   (pre-filled with "Hi {name}! 👋", editable) and a "Remark" field
   (placeholder "Add Remark", optional). Send delivers the greeting (+ the
   remark as a second paragraph in the same message) — it is NOT just
   opening a chat. Fields reset every time the sheet opens. */

export function SayHiSheet({ visible, targetName, targetPhotoURL, onClose, onSend }: {
  visible: boolean;
  targetName: string;
  targetPhotoURL?: string | null;
  onClose: () => void;
  onSend: (greeting: string, remark: string) => void;
}) {
  const [greeting, setGreeting] = useState(`Hi ${targetName}! 👋`);
  const [remark, setRemark] = useState('');
  useEffect(() => {
    if (visible) { setGreeting(`Hi ${targetName}! 👋`); setRemark(''); }
  }, [visible, targetName]);
  const canSend = greeting.trim().length > 0;
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
            <Text style={{ flex: 1, fontSize: 17, fontWeight: '700', color: C.text, marginLeft: 10 }} numberOfLines={1}>{targetName}</Text>
            <Pressable
              onPress={() => { if (canSend) onSend(greeting.trim(), remark.trim()); }}
              disabled={!canSend}
              hitSlop={8}
              style={{ paddingHorizontal: 6, paddingVertical: 6, opacity: canSend ? 1 : 0.4 }}
            >
              <Text style={{ fontSize: 16, fontWeight: '700', color: '#2196F3' }}>Send</Text>
            </Pressable>
          </View>
          <Text style={{ fontSize: 14, fontWeight: '600', color: C.text, marginTop: 18, marginBottom: 8 }}>Greeting Message</Text>
          <TextInput
            value={greeting}
            onChangeText={setGreeting}
            multiline
            style={{ borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: C.text, minHeight: 64, textAlignVertical: 'top' }}
          />
          <Text style={{ fontSize: 14, fontWeight: '600', color: C.text, marginTop: 16, marginBottom: 8 }}>Remark</Text>
          <TextInput
            value={remark}
            onChangeText={setRemark}
            placeholder="Add Remark"
            placeholderTextColor={C.muted}
            multiline
            style={{ borderWidth: 1, borderColor: C.border, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: C.text, minHeight: 56, textAlignVertical: 'top' }}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}
