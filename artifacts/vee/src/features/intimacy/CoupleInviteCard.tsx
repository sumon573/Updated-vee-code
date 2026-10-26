/**
 * CoupleInviteCard.tsx — Pending couple-invitation card for the chat list.
 * Builder D (2026-10-26). Pure UI + callbacks: every write goes through
 * coupleService (accept/reject); this component makes no RTDB writes itself.
 *
 * Props (exactly): invite, sender profile, onAccept, onReject.
 * The card itself never navigates to a thread — only its buttons act.
 * Tapping the sender row opens nothing; the parent owns all navigation.
 *
 * Display states:
 *   pending + live   → sender photo + name + token design label +
 *                      "wants to be your couple" + Accept (green/primary) +
 *                      Reject (outline) + "Expires in Xh Ym" countdown.
 *   pending + expired → plain "Expired" text, NO accept button (and no
 *                      reject button — the invite is simply over).
 *   accepted          → plain "Accepted" text (formation already landed).
 *   rejected          → plain "Declined" text + the honest no-refund note:
 *                      the 5000 diamonds sent with the invite are not
 *                      refunded. No refund is ever promised.
 * All user-visible strings use t(..., { defaultValue }) — no locale edits.
 */

import { useEffect, useState } from 'react';
import { View, Text, Pressable, Image } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import {
  type CoupleInvite,
  isCoupleInviteExpired,
  coupleInviteRemainingMs,
} from './coupleService';

export type CoupleInviteSenderProfile = {
  name: string;
  photoURL: string | null;
};

type Props = {
  invite: CoupleInvite;
  sender: CoupleInviteSenderProfile;
  onAccept: () => Promise<void>;
  onReject: () => Promise<void>;
};

const C = {
  card: '#FFFFFF',
  border: '#E5E5EA',
  text: '#000000',
  muted: '#8E8E93',
  primary: '#7C3AED',
  accept: '#34C759',
  acceptText: '#FFFFFF',
} as const;

function formatCountdown(remainingMs: number): { h: number; m: number } {
  const totalMin = Math.floor(remainingMs / 60000);
  return { h: Math.floor(totalMin / 60), m: totalMin % 60 };
}

export function CoupleInviteCard({ invite, sender, onAccept, onReject }: Props) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<'accept' | 'reject' | null>(null);
  // Re-render the countdown as time passes (30s tick is plenty for "Xh Ym").
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const expired = invite.status === 'pending' && isCoupleInviteExpired(invite);
  const remainingMs = invite.status === 'pending' ? coupleInviteRemainingMs(invite) : null;
  const countdown = remainingMs !== null ? formatCountdown(remainingMs) : null;
  const senderName = sender.name || t('coupleInvite.someone', { defaultValue: 'Someone' });
  // Token design ids (Builder C: 'cupid' | 'eternal' | 'lovelock' |
  // 'luster') shown as readable labels; unknown ids fall back to the raw id.
  const TOKEN_LABELS: Record<string, string> = {
    cupid: 'Cupid token',
    eternal: 'Eternal token',
    lovelock: 'Love Lock token',
    luster: 'Luster token',
  };
  const tokenLabel = invite.tokenDesign
    ? t(`coupleInvite.token.${invite.tokenDesign}`, {
        defaultValue: TOKEN_LABELS[invite.tokenDesign] ?? invite.tokenDesign,
      })
    : t('coupleInvite.defaultToken', { defaultValue: 'Couple token' });
  const initials = (senderName || '?').slice(0, 1).toUpperCase();

  const handleAccept = async () => {
    if (busy || expired) return;
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
    if (busy || expired) return;
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
          <Text style={{ color: C.muted, fontSize: 13, marginTop: 2 }} numberOfLines={1}>
            {tokenLabel}
          </Text>
          <Text style={{ color: C.text, fontSize: 14, marginTop: 2 }}>
            {t('coupleInvite.wantsToBeCouple', { defaultValue: 'wants to be your couple' })}
          </Text>
        </View>
      </View>

      {invite.status === 'accepted' ? (
        <Text style={{ color: C.muted, fontSize: 14, fontWeight: '700', marginTop: 12 }}>
          {t('coupleInvite.accepted', { defaultValue: 'Accepted — you are now a couple!' })}
        </Text>
      ) : invite.status === 'rejected' ? (
        <View style={{ marginTop: 12 }}>
          <Text style={{ color: C.muted, fontSize: 14, fontWeight: '700' }}>
            {t('coupleInvite.declined', { defaultValue: 'Declined' })}
          </Text>
          <Text style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>
            {t('coupleInvite.noRefund', {
              defaultValue: 'The 5000 diamonds sent with this invitation are not refunded.',
            })}
          </Text>
        </View>
      ) : expired ? (
        <Text style={{ color: C.muted, fontSize: 14, fontWeight: '700', marginTop: 12 }}>
          {t('coupleInvite.expired', { defaultValue: 'Expired' })}
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
                  ? t('coupleInvite.accepting', { defaultValue: 'Accepting…' })
                  : t('coupleInvite.accept', { defaultValue: 'Accept' })}
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
                  ? t('coupleInvite.rejecting', { defaultValue: 'Rejecting…' })
                  : t('coupleInvite.reject', { defaultValue: 'Reject' })}
              </Text>
            </Pressable>
          </View>
          {countdown && (
            <Text style={{ color: C.muted, fontSize: 12, marginTop: 8 }}>
              {t('coupleInvite.expiresIn', {
                defaultValue: 'Expires in {{h}}h {{m}}m',
                h: countdown.h,
                m: countdown.m,
              })}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}
