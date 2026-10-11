/**
 * CountryPicker — bottom-sheet country selector matching the IMO reference.
 *
 * - Title "Choose a Country/Region"
 * - Search bar filters by name or dial code (live)
 * - Full country list: flag emoji + name + dial code
 * - Backdrop tap dismisses; selecting a row selects + dismisses
 */
import { useState, useMemo } from 'react';
import {
  View, Text, TextInput, FlatList, Pressable, Modal,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { COUNTRIES, type Country } from '@/src/data/countries';

const C = {
  text: '#0A1A33',
  muted: '#8E8E93',
  border: '#ECECF1',
  searchBg: '#F4F4F6',
  backdrop: 'rgba(0,0,0,0.45)',
} as const;

interface Props {
  visible: boolean;
  selected: Country;
  onSelect: (country: Country) => void;
  onClose: () => void;
}

export default function CountryPicker({ visible, selected, onSelect, onClose }: Props) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COUNTRIES;
    const digits = q.replace(/^\+/, '');
    return COUNTRIES.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (digits.length > 0 && c.dialCode.startsWith(digits)),
    );
  }, [query]);

  function handleSelect(country: Country) {
    onSelect(country);
    setQuery('');
    onClose();
  }

  function handleClose() {
    setQuery('');
    onClose();
  }

  function renderItem({ item }: { item: Country }) {
    const isSelected = item.iso === selected.iso;
    return (
      <Pressable
        onPress={() => handleSelect(item)}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          paddingVertical: 14,
          paddingHorizontal: 20,
          borderBottomWidth: 1,
          borderBottomColor: C.border,
          backgroundColor: pressed ? '#F7F7FA' : '#FFFFFF',
        })}
        accessibilityRole="button"
        accessibilityLabel={`${item.name} +${item.dialCode}`}
      >
        <Text style={{ fontSize: 26, marginRight: 14 }}>{item.flag}</Text>
        <Text
          style={{
            flex: 1,
            fontSize: 19,
            color: C.text,
            fontWeight: isSelected ? '700' : '400',
          }}
          numberOfLines={1}
        >
          {item.name}
        </Text>
        {isSelected && (
          <Feather name="check" size={20} color="#1E9BF0" style={{ marginRight: 10 }} />
        )}
        <Text style={{ fontSize: 19, color: C.muted }}>+{item.dialCode}</Text>
      </Pressable>
    );
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleClose}
    >
      <Pressable
        style={{ flex: 1, backgroundColor: C.backdrop }}
        onPress={handleClose}
      >
        <Pressable
          style={{
            marginTop: 90,
            flex: 1,
            backgroundColor: '#FFFFFF',
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            overflow: 'hidden',
          }}
          onPress={() => {}}
        >
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
              {/* Drag handle */}
              <View style={{ alignItems: 'center', paddingTop: 10 }}>
                <View
                  style={{
                    width: 72,
                    height: 5,
                    borderRadius: 3,
                    backgroundColor: '#E3E3E8',
                  }}
                />
              </View>

              {/* Title */}
              <Text
                style={{
                  fontSize: 25,
                  fontWeight: '700',
                  color: '#000000',
                  paddingHorizontal: 22,
                  paddingTop: 14,
                  paddingBottom: 16,
                }}
              >
                {t('auth.phoneLogin.countryPickerTitle')}
              </Text>

              {/* Search */}
              <View style={{ paddingHorizontal: 22, paddingBottom: 8 }}>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    backgroundColor: C.searchBg,
                    borderRadius: 10,
                    paddingHorizontal: 12,
                    height: 48,
                  }}
                >
                  <Feather name="search" size={20} color="#A9A9B0" />
                  <TextInput
                    style={{ flex: 1, fontSize: 19, color: C.text, marginLeft: 8, height: '100%' }}
                    placeholder={t('auth.phoneLogin.countrySearchPlaceholder')}
                    placeholderTextColor="#A9A9B0"
                    value={query}
                    onChangeText={setQuery}
                    autoCorrect={false}
                    autoCapitalize="none"
                    returnKeyType="search"
                  />
                  {query.length > 0 && (
                    <Pressable onPress={() => setQuery('')} hitSlop={10}>
                      <Feather name="x-circle" size={18} color="#A9A9B0" />
                    </Pressable>
                  )}
                </View>
              </View>

              {/* List */}
              {filtered.length === 0 ? (
                <View style={{ flex: 1, alignItems: 'center', paddingTop: 60 }}>
                  <Text style={{ fontSize: 16, color: C.muted }}>
                    {t('auth.phoneLogin.noCountriesFound')}
                  </Text>
                </View>
              ) : (
                <FlatList
                  data={filtered}
                  keyExtractor={(item) => item.iso}
                  renderItem={renderItem}
                  keyboardShouldPersistTaps="handled"
                  initialNumToRender={30}
                  maxToRenderPerBatch={30}
                  windowSize={10}
                />
              )}
            </SafeAreaView>
          </KeyboardAvoidingView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
