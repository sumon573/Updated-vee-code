/**
 * ContactLongPressMenu — imo-style context menu for the Contacts tab
 * (2026-10-11 fix: Sumon reported long-press on contacts did nothing).
 * Long-press a contact → Chat, Audio Call, View Profile, Block/Unblock,
 * Unfriend. Every option is functional and real.
 */
import { Modal, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

type Props = {
  visible: boolean;
  contactName: string;
  isBlocked: boolean;
  onChat: () => void;
  onCall: () => void;
  onViewProfile: () => void;
  onBlockToggle: () => void;
  onUnfriend: () => void;
  onClose: () => void;
};

export default function ContactLongPressMenu({
  visible, contactName, isBlocked,
  onChat, onCall, onViewProfile, onBlockToggle, onUnfriend, onClose,
}: Props) {
  const items: Array<{
    icon: string; label: string; danger?: boolean; action: () => void;
  }> = [
    {
      icon: 'chatbubble-ellipses-outline',
      label: 'Chat',
      action: onChat,
    },
    {
      icon: 'call-outline',
      label: 'Audio Call',
      action: onCall,
    },
    {
      icon: 'person-outline',
      label: 'View Profile',
      action: onViewProfile,
    },
    {
      icon: isBlocked ? 'checkmark-circle-outline' : 'ban-outline',
      label: isBlocked ? 'Unblock' : 'Block',
      danger: !isBlocked,
      action: onBlockToggle,
    },
    {
      icon: 'person-remove-outline',
      label: 'Delete Contact',
      danger: true,
      action: onUnfriend,
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
            {contactName}
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
                name={item.icon as never}
                size={20}
                color={item.danger ? '#EF4444' : '#3B82F6'}
                style={{ marginRight: 14 }}
              />
              <Text
                style={{
                  fontSize: 15,
                  fontWeight: '600',
                  color: item.danger ? '#EF4444' : '#1F2937',
                }}
              >
                {item.label}
              </Text>
            </Pressable>
          ))}
          <View style={{ height: 8 }} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}
