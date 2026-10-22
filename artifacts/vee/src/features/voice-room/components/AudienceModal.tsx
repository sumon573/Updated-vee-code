import { memo, useCallback } from 'react';
import { View, Text, Pressable, Modal, FlatList, Dimensions } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { C } from '../constants/theme';
import { Participant, Role } from '../types/room';
import { VerifiedName } from '@/src/components/VerifiedName';
import AnimatedFrame from '@/src/components/AnimatedFrame';
import { truncateTo12 } from '@/src/utils/truncateName';

/**
 * Perf (2026-10-22 audit): the audience list is VIRTUALIZED (FlatList) with
 * a memoized row. The old ScrollView + .map() mounted every member at
 * once — hundreds of rows, each with VerifiedName + AnimatedFrame
 * machinery — and hitched/freezed when opening Live Audience in big rooms.
 */
const LIST_MAX_HEIGHT = Math.max(
  240,
  Math.round(Dimensions.get('window').height * 0.8) - 130,
);

const AudienceRow = memo(function AudienceRow({
  m, isOwnerOrAdmin, audienceLabel, adminBadge, onManage,
}: {
  m: Participant;
  isOwnerOrAdmin: boolean;
  audienceLabel: string;
  adminBadge: string;
  onManage: (m: Participant) => void;
}) {
  return (
    <Pressable
      onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onManage(m); }}
      style={{ flexDirection: 'row', alignItems: 'center',
        paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.borderFaint }}>
      {/* Issue 5: Show profile photo; fallback to initials avatar */}
      <View style={{ width: 44, height: 44,
        alignItems: 'center', justifyContent: 'center',
        marginRight: 12 }}>
        <View style={{ width: 44, height: 44, borderRadius: 22,
          overflow: 'hidden',
          backgroundColor: m.color + '33',
          alignItems: 'center', justifyContent: 'center',
          borderWidth: 2, borderColor: m.color + '55' }}>
          {m.photoURL ? (
            <Image
              source={{ uri: m.photoURL }}
              style={{ width: 44, height: 44, borderRadius: 22 }}
              cachePolicy="memory-disk"
              recyclingKey={m.id}
            />
          ) : (
            <Text style={{ color: m.color, fontSize: 15, fontWeight: '800' }}>{m.initials}</Text>
          )}
        </View>
        {/* 2026-10-13 (Sumon): Server-hosted animated frame */}
        {!!(m as any).activeFrame && (m as any).activeFrame !== 'none' && (
          <View style={{ position: 'absolute', alignItems: 'center', justifyContent: 'center' }}>
            <AnimatedFrame size={44} frameId={(m as any).activeFrame} />
          </View>
        )}
      </View>
      <View style={{ flex: 1 }}>
        <VerifiedName
          name={truncateTo12(m.name)}
          uid={(m as any).uid || (m as any).id}
          nameStyle={{ color: C.text, fontSize: 14, fontWeight: '700' }}
          logoSize={14}
        />
        <Text style={{ color: C.muted, fontSize: 11, marginTop: 1 }}>
          {audienceLabel}
        </Text>
      </View>
      {m.role === 'admin' && (
        <View style={{ backgroundColor: C.gold + '33', borderRadius: 10,
          paddingHorizontal: 8, paddingVertical: 3, marginRight: 8 }}>
          <Text style={{ color: C.gold, fontSize: 10, fontWeight: '800' }}>
            {adminBadge}
          </Text>
        </View>
      )}
      {isOwnerOrAdmin && <Feather name="more-horizontal" size={18} color={C.muted} />}
    </Pressable>
  );
});

/* ─────────────────────────── Audience Modal ─────────────────────────── */
export function AudienceModal({ visible, onClose, audience, myRole, onManageMember }: {
  visible: boolean; onClose: () => void;
  audience: Participant[]; myRole: Role;
  onManageMember: (m: Participant) => void;
}) {
  const { t } = useTranslation();
  const isOwnerOrAdmin = myRole === 'host' || myRole === 'admin';
  const handleManage = useCallback((m: Participant) => {
    onManageMember(m);
    onClose();
  }, [onManageMember, onClose]);
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={onClose} />
      <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0,
        backgroundColor: '#FFFFFF', borderTopLeftRadius: 26, borderTopRightRadius: 26,
        borderWidth: 1, borderColor: C.border, maxHeight: '80%' }}>
        <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: C.muted,
          alignSelf: 'center', marginTop: 12 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16,
          borderBottomWidth: 1, borderBottomColor: C.borderFaint }}>
          <Feather name="users" size={16} color={C.primary} />
          <Text style={{ color: C.text, fontSize: 16, fontWeight: '900', marginLeft: 8, flex: 1 }}>
            {t('voiceRoom.audience.title')}
          </Text>
          <View style={{ backgroundColor: C.primary + '33', borderRadius: 20,
            paddingHorizontal: 10, paddingVertical: 4, marginRight: 10 }}>
            <Text style={{ color: C.primary, fontSize: 13, fontWeight: '800' }}>{audience.length}</Text>
          </View>
          <Pressable onPress={onClose}><Feather name="x" size={20} color={C.sub} /></Pressable>
        </View>
        {audience.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 30 }}>
            <Feather name="users" size={36} color={C.muted} />
            <Text style={{ color: C.muted, fontSize: 14, marginTop: 12 }}>
              {t('voiceRoom.audience.noAudience')}
            </Text>
          </View>
        ) : (
          <FlatList
            data={audience}
            keyExtractor={(m) => m.id}
            renderItem={({ item }) => (
              <AudienceRow
                m={item}
                isOwnerOrAdmin={isOwnerOrAdmin}
                audienceLabel={t('voiceRoom.audience.audienceLabel')}
                adminBadge={t('voiceRoom.audience.adminBadge')}
                onManage={handleManage}
              />
            )}
            contentContainerStyle={{ padding: 16 }}
            showsVerticalScrollIndicator={false}
            style={{ maxHeight: LIST_MAX_HEIGHT }}
            windowSize={7}
            initialNumToRender={18}
            maxToRenderPerBatch={18}
          />
        )}
      </View>
    </Modal>
  );
}
