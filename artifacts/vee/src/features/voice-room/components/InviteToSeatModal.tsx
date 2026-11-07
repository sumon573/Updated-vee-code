import { View, Text, ScrollView, Pressable, Modal } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { C } from '../constants/theme';
import { Participant } from '../types/room';
import { useIsKing } from '@/src/hooks/useNobleRank';
import { KingSparkle, KING_GOLD } from './KingShimmerName';
// Glass P1d — Candidate A "Pod Glass" (see src/design/GLASS_RULES.md).
// Translucent fill only — no expo-blur, static, one layer per surface.
import { GlassView } from '@/src/design/GlassView';
import type { ResolvedGlass } from '@/src/design/glassTokens';


/* ─────────────────────────── Invite to Seat Modal ─────────────────────────── */
/* 2026-11-01 (batch56): invite candidate name — own tiny component
   because the rows render inline in a map. */
function InviteName({ uid, name }: { uid: string; name: string }) {
  const isKing = useIsKing(uid);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <Text style={{ color: isKing ? KING_GOLD : C.text, fontSize: 14, fontWeight: '700', flexShrink: 1 }}>{name}</Text>
      {isKing ? <KingSparkle /> : null}
    </View>
  );
}

export function InviteToSeatModal({ visible, audience, seatIdx, onClose, onInvite, accent, glass }: {
  visible: boolean; audience: Participant[]; seatIdx: number;
  onClose: () => void; onInvite: (memberId: string) => void;
  accent: string;
  /** Glass P1d: resolved room-theme glass (Candidate A). Optional — without
      it the sheet uses plain light glass. */
  glass?: ResolvedGlass;
}) {
  const { t } = useTranslation();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' }} onPress={onClose} />
      {/* Glass P1d: the sheet is glass `modal` over the dimmed backdrop;
          the accent hairline is kept via accentBorder (low alpha). */}
      <GlassView variant="modal" resolved={glass} accentBorder={accent + '44'}
        style={{ position: 'absolute', bottom: 0, left: 0, right: 0, maxHeight: '75%' }}>
        <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: C.muted,
          alignSelf: 'center', marginTop: 12 }} />
        <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16,
          borderBottomWidth: 1, borderBottomColor: C.borderFaint }}>
          <Feather name="user-plus" size={17} color={accent} />
          <Text style={{ color: C.text, fontSize: 16, fontWeight: '900', marginLeft: 10, flex: 1 }}>
            {t('voiceRoom.inviteToSeat.title', { number: seatIdx + 1 })}
          </Text>
          <Pressable onPress={onClose}><Feather name="x" size={20} color={C.sub} /></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16 }} showsVerticalScrollIndicator={false}>
          {audience.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 30 }}>
              <Feather name="users" size={36} color={C.muted} />
              <Text style={{ color: C.muted, fontSize: 14, marginTop: 12 }}>
                {t('voiceRoom.inviteToSeat.noAudience')}
              </Text>
            </View>
          ) : (
            audience.map(m => (
              <Pressable key={m.id}
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onInvite(m.id); }}
                style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12,
                  borderBottomWidth: 1, borderBottomColor: C.borderFaint }}>
                <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: m.color + '33',
                  alignItems: 'center', justifyContent: 'center', marginRight: 12,
                  borderWidth: 2, borderColor: m.color + '55' }}>
                  <Text style={{ color: m.color, fontSize: 15, fontWeight: '800' }}>{m.initials}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <InviteName uid={m.id} name={m.name} />
                  <Text style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>
                    {t('voiceRoom.inviteToSeat.inAudience')}
                  </Text>
                </View>
                <View style={{ backgroundColor: accent + '22', borderRadius: 16,
                  paddingHorizontal: 14, paddingVertical: 7,
                  borderWidth: 1, borderColor: accent + '55' }}>
                  <Text style={{ color: accent, fontSize: 13, fontWeight: '800' }}>
                    {t('voiceRoom.inviteToSeat.invite')}
                  </Text>
                </View>
              </Pressable>
            ))
          )}
        </ScrollView>
      </GlassView>
    </Modal>
  );
}
