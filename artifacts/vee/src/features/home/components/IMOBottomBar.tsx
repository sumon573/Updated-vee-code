/**
 * IMOBottomBar — IMO-style bottom bar (2026-10-10).
 * "+" (left, blue) and search icon (right, blue).
 */
import { View, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface IMOBottomBarProps {
  onAddPress: () => void;
  onSearchPress: () => void;
}

export default function IMOBottomBar({ onAddPress, onSearchPress }: IMOBottomBarProps) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: '#FFFFFF',
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderTopWidth: 1,
        borderTopColor: '#E0E0E0',
      }}
    >
      <TouchableOpacity onPress={onAddPress} activeOpacity={0.7}>
        <Ionicons name="add" size={32} color="#2196F3" />
      </TouchableOpacity>
      <TouchableOpacity onPress={onSearchPress} activeOpacity={0.7}>
        <Ionicons name="search" size={26} color="#2196F3" />
      </TouchableOpacity>
    </View>
  );
}
