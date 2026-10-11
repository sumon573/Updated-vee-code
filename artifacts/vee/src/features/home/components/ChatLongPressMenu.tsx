/**
 * ChatLongPressMenu — imo-style context menu (2026-10-11 Issue #6).
 * Long-press a chat → Pin to top, Mute/Unmute, Hide/Unhide, Delete Chat History.
 * Every option is functional and real.
 */
import { Modal, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

type Props = {
  visible: boolean;
  chatName: string;
  isPinned: boolean;
  isMuted: boolean;
  isHidden: boolean;
  onPin: () => void;
  onMute: () => void;
  onHide: () => void;
  onDeleteHistory: () => void;
  onClose: () => void;
};

export default function ChatLongPressMenu({
  visible, chatName, isPinned, isMuted, isHidden,
  onPin, onMute, onHide, onDeleteHistory, onClose,
}: Props) {
  const items: Array<{
    icon: string; label: string; danger?: boolean; action: () => void;
  }> = [
    {
      icon: isPinned ? 'pin-outline' : 'pin',
      label: isPinned ? 'Unpin from top' : 'Pin to top',
      action: onPin,
    },
    {
      icon: isMuted ? 'notifications' : 'notifications-off',
      label: isMuted ? 'Unmute' : 'Mute',
      action: onMute,
    },
    {
      icon: isHidden ? 'eye' : 'eye-off',
      label: isHidden ? 'Unhide' : 'Hide',
      action: onHide,
    },
    {
      icon: 'trash-outline',
      label: 'Delete Chat History',
      danger: true,
      action: onDeleteHistory,
    },
  ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.35)',
          justifyContent: 'center',
          alignItems: 'center',
          paddingHorizontal: 40,
        }}
        onPress={onClose}
      >
        <Pressable
          onPress={(e) => e.stopPropagation()}
          style={{
            backgroundColor: '#FFFFFF',
            borderRadius: 16,
            paddingVertical: 8,
            width: '100%',
            maxWidth: 320,
            shadowColor: '#000',
            shadowOpacity: 0.2,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 4 },
            elevation: 8,
          }}
        >
          <Text
            style={{
              fontSize: 13,
              fontWeight: '700',
              color: '#9E9E9E',
              paddingHorizontal: 20,
              paddingVertical: 8,
            }}
            numberOfLines={1}
          >
            {chatName}
          </Text>
          {items.map((item) => (
            <Pressable
              key={item.label}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                item.action();
              }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingHorizontal: 20,
                paddingVertical: 13,
              }}
            >
              <Ionicons
                name={item.icon as any}
                size={20}
                color={item.danger ? '#F44336' : '#424242'}
                style={{ marginRight: 14 }}
              />
              <Text
                style={{
                  fontSize: 16,
                  fontWeight: '500',
                  color: item.danger ? '#F44336' : '#212121',
                }}
              >
                {item.label}
              </Text>
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
