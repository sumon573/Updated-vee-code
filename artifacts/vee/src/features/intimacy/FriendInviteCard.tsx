/**
 * FriendInviteCard.tsx — Pending friend-invitation card for the chat list.
 * (2026-10-27, friendship correction.) Mirror of CoupleInviteCard minus
 * the couple parts: no token design, no expiry countdown (friendship has
 * no expiry), no charge/no-refund note (friendship is free).
 * Pure UI + callbacks: every write goes through friendService (accept/
 * reject); this component makes no RTDB writes itself.
 *
 * Display states:
 *   pending  → sender photo + name + "wants to be your friend" +
 *              Accept (green) + Reject (outline).
 *   accepted → plain "Accepted" text (friendship already landed).
 *   rejected → plain "Declined" text.
 * All user-visible strings use t(..., { defaultValue }) — no locale edits.
 */

import { useState } from 'react';
import { View, Text, Pressable, Image } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { type FriendInvite } from './friendService';

export type FriendInviteSenderProfile = {
  name: string;
  photoURL: string | null;
};

type Props = {
  invite: FriendInvite;
  sender: FriendInviteSenderProfile;
  onAccept: () => Promise<void>;
  onReject: () => Promise<void>;
};

const C = {
  card: '#FFFFFF',
  border: '#E5E5EA',
  text: '#000000',
  muted: '#8E8E93',
  accept: '#34C759',
  acceptText: '#FFFFFF',
} as const;

export function FriendInviteCard({ invite, sender, onAccept, onReject }: Props) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<'accept' | 'reject' | null>(null);

  const senderName = sender.name || t('friendInvite.someone', { defaultValue: 'Someone' });
  const initials = (senderName || '?').slice(0, 1).toUpperCase();

  const handleAccept = async () => {
    if (busy) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setBusy('accept');
    try {
      await onAccept();
    } catch {
      // Parent shows the error Alert; the card just stops spinning.
      setBusy(null);
    }
  };

  const handleReject = async () => {
    if (busy) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setBusy('reject');
    try {
      await onReject();
    } catch {
      setBusy(null);
    }
  };

  return (
    <View
      style={{
        backgroundColor: C.card,
        borderWidth: 1, borderColor: C.border,
        borderRadius: 14, padding: 12, marginBottom: 10,
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {sender.photoURL ? (
          <Image source={{ uri: sender.photoURL }} style={{ width: 48, height: 48, borderRadius: 24 }} />
        ) : (
          <View style={{
            width: 48, height: 48, borderRadius: 24, backgroundColor: '#E3F2FD',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ color: '#007AFF', fontWeight: '800', fontSize: 18 }}>{initials}</Text>
          </View>
        )}
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={{ color: C.text, fontSize: 15, fontWeight: '800' }} numberOfLines={1}>
            {senderName}
          </Text>
          <Text style={{ color: C.text, fontSize: 14, marginTop: 2 }}>
            {t('friendInvite.wantsToBeFriend', { defaultValue: 'wants to be your friend' })}
          </Text>
        </View>
      </View>

      {invite.status === 'accepted' ? (
        <Text style={{ color: C.muted, fontSize: 14, fontWeight: '700', marginTop: 12 }}>
          {t('friendInvite.accepted', { defaultValue: 'Accepted — you are now friends!' })}
        </Text>
      ) : invite.status === 'rejected' ? (
        <Text style={{ color: C.muted, fontSize: 14, fontWeight: '700', marginTop: 12 }}>
          {t('friendInvite.declined', { defaultValue: 'Declined' })}
        </Text>
      ) : (
        <View style={{ marginTop: 12 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable
              onPress={handleAccept}
              disabled={busy !== null}
              style={{
                flex: 1, backgroundColor: C.accept, borderRadius: 12,
                paddingVertical: 10, alignItems: 'center',
                opacity: busy !== null ? 0.6 : 1,
              }}>
              <Text style={{ color: C.acceptText, fontSize: 15, fontWeight: '800' }}>
                {busy === 'accept'
                  ? t('friendInvite.accepting', { defaultValue: 'Accepting…' })
                  : t('friendInvite.accept', { defaultValue: 'Accept' })}
              </Text>
            </Pressable>
            <Pressable
              onPress={handleReject}
              disabled={busy !== null}
              style={{
                flex: 1, backgroundColor: 'transparent', borderRadius: 12,
                borderWidth: 1, borderColor: C.border,
                paddingVertical: 10, alignItems: 'center',
                opacity: busy !== null ? 0.6 : 1,
              }}>
              <Text style={{ color: C.text, fontSize: 15, fontWeight: '800' }}>
                {busy === 'reject'
                  ? t('friendInvite.rejecting', { defaultValue: 'Rejecting…' })
                  : t('friendInvite.reject', { defaultValue: 'Reject' })}
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}
