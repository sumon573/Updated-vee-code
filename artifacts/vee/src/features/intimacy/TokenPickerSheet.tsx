/**
 * TokenPickerSheet.tsx — Couple/Friend token picker sheet (Builder C, 2026-10-26).
 *
 * Renders as a sheet over the Couple page (dimmed background). Art comes from
 * INTIMACY_ART (art child owns src/features/intimacy/intimacyArt.ts — that
 * file may not exist yet; the import below is written anyway per spec and the
 * sheet renders a placeholder box whenever an art URL is empty).
 *
 * COUPLE tab Send: validates + charges via inviteService.sendCoupleInvite
 * (invite first, receipt-guarded debit, exactly-once) → success Alert
 * ("Invitation sent") + close. Failure → plain Alert message, no partial state.
 * FRIEND tab Send (coordinator decision): token delivered as a gift-style DM
 * message (token art + text, no diamond charge, no couple formation, no
 * intimacy change) via inviteService.sendFriendTokenMessage.
 *
 * All user-visible strings use t('...', { defaultValue: 'English text' }) —
 * no locale files are edited here.
 */

import { useState } from 'react';
import { View, Text, Pressable, Modal, Alert, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { INTIMACY_ART } from '@/src/features/intimacy/intimacyArt';
import {
  sendCoupleInvite,
  sendFriendTokenMessage,
  type TokenDesign,
} from '@/src/features/intimacy/inviteService';

export interface TokenRecipient {
  uid: string;
  name: string;
  photoURL: string | null;
}

export interface TokenPickerSheetProps {
  visible: boolean;
  onClose: () => void;
  senderUid: string;
  senderName: string;
  senderPhotoURL: string | null;
  recipient: TokenRecipient;
  /** Called after a couple invitation is sent (parent refreshes Pending state). */
  onCoupleSent?: () => void;
}

const TOKENS: { design: TokenDesign; labelKey: string; label: string; artKey: 'tokenCupid' | 'tokenEternal' | 'tokenLoveLock' | 'tokenLuster' }[] = [
  { design: 'cupid', labelKey: 'couple.tokenCupid', label: "Cupid's Arrow", artKey: 'tokenCupid' },
  { design: 'eternal', labelKey: 'couple.tokenEternal', label: 'Eternal', artKey: 'tokenEternal' },
  { design: 'lovelock', labelKey: 'couple.tokenLoveLock', label: 'Love Lock', artKey: 'tokenLoveLock' },
  { design: 'luster', labelKey: 'couple.tokenLuster', label: 'Luster', artKey: 'tokenLuster' },
];

const PINK = '#FF4D7E';
const PINK_LIGHT = '#FFF0F4';

function Photo({ uri, name, size }: { uri: string | null; name: string; size: number }) {
  if (uri) {
    return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} contentFit="cover" />;
  }
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: '#E3F2FD', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: size * 0.4, fontWeight: '700', color: '#007AFF' }}>{initial}</Text>
    </View>
  );
}

function ArtBox({ uri, size }: { uri: string | null | undefined; size: number }) {
  if (uri) {
    return <Image source={{ uri }} style={{ width: size, height: size }} contentFit="contain" />;
  }
  return (
    <View style={{ width: size, height: size, borderRadius: 12, backgroundColor: PINK_LIGHT, alignItems: 'center', justifyContent: 'center' }}>
      <Feather name="heart" size={size * 0.4} color={PINK} />
    </View>
  );
}

export default function TokenPickerSheet({
  visible,
  onClose,
  senderUid,
  senderName,
  senderPhotoURL,
  recipient,
  onCoupleSent,
}: TokenPickerSheetProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'couple' | 'friend'>('couple');
  const [selected, setSelected] = useState<TokenDesign>('cupid');
  const [sending, setSending] = useState(false);

  const selectedToken = TOKENS.find((tk) => tk.design === selected) ?? TOKENS[0];
  const ringBoxArt = (INTIMACY_ART as { ringBox?: string }).ringBox || null;
  const selectedArt = (INTIMACY_ART as Record<string, string | undefined>)[selectedToken.artKey] || null;

  function showHelp() {
    Alert.alert(
      t('couple.tokenHelpTitle', { defaultValue: 'About tokens' }),
      t('couple.tokenHelpBody', {
        defaultValue:
          'A token is the design of your proposal. Sending a couple invitation costs 5000 diamonds, charged when you send. Diamonds are not returned if the invitation is rejected or expires. An invitation expires 5 hours after sending.',
      }),
    );
  }

  function plainErrorMessage(code: string): string {
    switch (code) {
      case 'insufficient':
        return t('couple.errorInsufficient', { defaultValue: 'Not enough diamonds. You need 5000 diamonds to send a couple invitation.' });
      case 'sender-already-coupled':
        return t('couple.errorSenderCoupled', { defaultValue: 'You already have a couple.' });
      case 'recipient-already-coupled':
        return t('couple.errorRecipientCoupled', { defaultValue: 'This person already has a couple.' });
      case 'pending-exists':
        return t('couple.errorPendingExists', { defaultValue: 'You already have a pending invitation.' });
      case 'not-in-inbox':
        return t('couple.errorNotInInbox', { defaultValue: 'This person is not in your inbox.' });
      case 'no-intimacy':
        return t('couple.errorNoIntimacy', { defaultValue: 'You need intimacy points with this person first.' });
      default:
        return t('couple.errorGeneric', { defaultValue: 'Could not send the invitation. Please try again.' });
    }
  }

  async function handleSend() {
    if (sending) return;
    setSending(true);
    try {
      if (tab === 'couple') {
        await sendCoupleInvite({ senderUid, recipientUid: recipient.uid, tokenDesign: selected });
        Alert.alert(
          t('couple.sentTitle', { defaultValue: 'Invitation sent' }),
          t('couple.sentBody', { defaultValue: 'Your couple invitation has been sent.' }),
        );
        onCoupleSent?.();
        onClose();
      } else {
        await sendFriendTokenMessage({
          senderUid,
          senderName,
          recipientUid: recipient.uid,
          recipientName: recipient.name,
          tokenDesign: selected,
          tokenLabel: selectedToken.label,
          tokenArtUrl: selectedArt,
        });
        Alert.alert(
          t('couple.friendSentTitle', { defaultValue: 'Token sent' }),
          t('couple.friendSentBody', { defaultValue: 'Your token has been sent.' }),
        );
        onClose();
      }
    } catch (e) {
      const code = e instanceof Error ? e.message : '';
      Alert.alert(
        t('couple.sendFailedTitle', { defaultValue: 'Could not send' }),
        plainErrorMessage(code),
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}
        onPress={onClose}
      >
        <Pressable
          style={{
            backgroundColor: '#FFFFFF',
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            paddingHorizontal: 16,
            paddingTop: 12,
            paddingBottom: 28,
            maxHeight: '88%',
          }}
          onPress={() => {}}
        >
          {/* Header: "?" help left, X close right */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Pressable onPress={showHelp} hitSlop={8} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="help-circle" size={22} color="#25292D" />
            </Pressable>
            <Text style={{ fontSize: 17, fontWeight: '600', color: '#25292D' }}>
              {t('couple.tokenTitle', { defaultValue: 'Send a token' })}
            </Text>
            <Pressable onPress={onClose} hitSlop={8} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="x" size={22} color="#25292D" />
            </Pressable>
          </View>

          {/* Big pink heart ring-box art flanked by the two photos */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 12 }}>
            <Photo uri={senderPhotoURL} name={senderName} size={56} />
            <View style={{ marginHorizontal: 16 }}>
              <ArtBox uri={ringBoxArt} size={110} />
            </View>
            <Photo uri={recipient.photoURL} name={recipient.name} size={56} />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 6 }}>
            <Text style={{ fontSize: 13, color: '#788187', maxWidth: 110, textAlign: 'center' }} numberOfLines={1}>
              {senderName}
            </Text>
            <Text style={{ fontSize: 13, color: '#788187', marginHorizontal: 16 }}> </Text>
            <Text style={{ fontSize: 13, color: '#788187', maxWidth: 110, textAlign: 'center' }} numberOfLines={1}>
              {recipient.name}
            </Text>
          </View>

          {/* Segmented tabs: Couple (active default) | Friend */}
          <View style={{ flexDirection: 'row', backgroundColor: '#F4F5F5', borderRadius: 20, padding: 3, marginTop: 16 }}>
            {(['couple', 'friend'] as const).map((key) => {
              const active = tab === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => setTab(key)}
                  style={{
                    flex: 1,
                    height: 36,
                    borderRadius: 17,
                    backgroundColor: active ? PINK : 'transparent',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ fontSize: 15, fontWeight: '600', color: active ? '#FFFFFF' : '#788187' }}>
                    {key === 'couple'
                      ? t('couple.tabCouple', { defaultValue: 'Couple' })
                      : t('couple.tabFriend', { defaultValue: 'Friend' })}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Token grid of 4 designs */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginTop: 16 }}>
            {TOKENS.map((tk) => {
              const art = (INTIMACY_ART as Record<string, string | undefined>)[tk.artKey] || null;
              const isSelected = selected === tk.design;
              return (
                <Pressable
                  key={tk.design}
                  onPress={() => setSelected(tk.design)}
                  style={{
                    width: '48%',
                    marginBottom: 12,
                    borderRadius: 12,
                    borderWidth: isSelected ? 2 : 1,
                    borderColor: isSelected ? PINK : '#F0F1F2',
                    backgroundColor: isSelected ? PINK_LIGHT : '#FFFFFF',
                    padding: 10,
                    alignItems: 'center',
                  }}
                >
                  <ArtBox uri={art} size={64} />
                  <Text style={{ fontSize: 14, fontWeight: '600', color: '#25292D', marginTop: 8 }} numberOfLines={1}>
                    {t(tk.labelKey, { defaultValue: tk.label })}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Note text */}
          <Text style={{ fontSize: 13, color: '#788187', textAlign: 'center', marginTop: 4 }}>
            {tab === 'couple'
              ? t('couple.tokenNote', {
                  defaultValue: "Send a token to show your sincerity. It won't be returned if rejected or expires.",
                })
              : t('couple.friendTokenNote', {
                  defaultValue: 'Send a token as a gift message. No diamonds are charged and no couple is formed.',
                })}
          </Text>

          {/* Big white Send button (pink text) */}
          <Pressable
            onPress={handleSend}
            disabled={sending}
            style={{
              marginTop: 16,
              height: 50,
              borderRadius: 25,
              backgroundColor: '#FFFFFF',
              borderWidth: 1,
              borderColor: PINK,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: sending ? 0.6 : 1,
            }}
          >
            {sending ? (
              <ActivityIndicator color={PINK} />
            ) : (
              <Text style={{ fontSize: 17, fontWeight: '700', color: PINK }}>
                {t('couple.send', { defaultValue: 'Send' })}
              </Text>
            )}
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
