/**
 * TokenPickerSheet.tsx — Send Couple Invitation sheet (boss spec 2026-11-01).
 *
 * Couple ONLY — there is no Friend toggle on this sheet. The main page
 * Friend tab and all friend functionality elsewhere are untouched.
 *
 * The sheet offers five LEVELS (Lv1–Lv5), all following one shared design
 * pattern, progressively upgraded. Each box shows its level token art,
 * "Lv N", and its diamond amount (Lv1 1200, Lv2 2000, Lv3 3500, Lv4 5000,
 * Lv5 7000). Boxes are translucent glass tiles; the selected box gets the
 * pink border highlight. The user picks ANY level and sends at that level
 * by paying that level's amount — including Lv5 directly from the start.
 *
 * Title is dynamic: "Send Lv Rank" before a level is picked, "Send Lv N"
 * once picked. The sincerity note keeps its meaning: diamonds are not
 * returned if the invitation is rejected or expires (5h lifetime).
 *
 * Send: charges via inviteService.sendCoupleInvite (invite first,
 * receipt-guarded debit, exactly-once) with the selected level's amount
 * and sentLevel → success Alert ("Invitation sent") + close. Failure →
 * plain Alert message, no partial state. On accept, the couple starts at
 * the sent level (formation records paidLevel = sentLevel).
 *
 * Art: level tokens come from coupleLevelTokens.ts (Vee-original
 * 3D-render tiles, uploaded to /m/ 2026-11-02).
 * that shows this sheet.
 *
 * All user-visible strings use t('...', { defaultValue: 'English text' }) —
 * no locale files are edited here. All text is English.
 */

import { useState } from 'react';
import { View, Text, Pressable, Modal, Alert, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { INTIMACY_ART } from '@/src/features/intimacy/intimacyArt';
import { DiamondIcon } from '@/src/components/DiamondIcon';
import { sendCoupleInvite } from '@/src/features/intimacy/inviteService';
import {
  COUPLE_LEVEL_TOKENS,
  levelSendAmount,
  type CoupleLevelToken,
} from '@/src/features/intimacy/coupleLevelTokens';

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

const PINK = '#FF4D7E';
const PINK_LIGHT = '#FFF0F4';
/** Translucent glass tile background (lets the sheet behind show through). */
const GLASS_BG = 'rgba(255,255,255,0.55)';
const GLASS_BG_SELECTED = 'rgba(255,240,244,0.75)';

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

function LevelBox({
  token,
  isSelected,
  onPress,
}: {
  token: CoupleLevelToken;
  isSelected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        width: '48%',
        marginBottom: 12,
        borderRadius: 12,
        borderWidth: isSelected ? 2 : 1,
        borderColor: isSelected ? PINK : '#F0F1F2',
        backgroundColor: isSelected ? GLASS_BG_SELECTED : GLASS_BG,
        padding: 10,
        alignItems: 'center',
      }}
    >
      <ArtBox uri={token.artUrl} size={64} />
      <Text style={{ fontSize: 14, fontWeight: '700', color: '#25292D', marginTop: 8 }}>
        Lv {token.level}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
        <DiamondIcon size={13} />
        <Text style={{ fontSize: 13, fontWeight: '600', color: '#788187', marginLeft: 3 }}>
          {token.amount}
        </Text>
      </View>
    </Pressable>
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
  const [selectedLevel, setSelectedLevel] = useState<number | null>(null);
  const [sending, setSending] = useState(false);

  const selectedAmount = selectedLevel !== null ? levelSendAmount(selectedLevel) : null;
  const ringBoxArt = (INTIMACY_ART as { ringBox?: string }).ringBox || null;

  // Rows of two; the last row holds Lv5 alone, centered.
  const rows: CoupleLevelToken[][] = [];
  for (let i = 0; i < COUPLE_LEVEL_TOKENS.length; i += 2) {
    rows.push(COUPLE_LEVEL_TOKENS.slice(i, i + 2));
  }

  function showHelp() {
    Alert.alert(
      t('couple.levelHelpTitle', { defaultValue: 'About levels' }),
      t('couple.levelHelpBody', {
        defaultValue:
          'Pick a level and send at that level: Lv1 1200, Lv2 2000, Lv3 3500, Lv4 5000, Lv5 7000 diamonds, charged when you send. On accept, your couple starts at the level you sent. Diamonds are not returned if the invitation is rejected or expires. An invitation expires 5 hours after sending.',
      }),
    );
  }

  function plainErrorMessage(code: string): string {
    switch (code) {
      case 'insufficient':
        return t('couple.errorInsufficient', {
          defaultValue: `Not enough diamonds. You need ${selectedAmount ?? 1200} diamonds to send this invitation.`,
        });
      case 'invalid-amount':
        return t('couple.errorInvalidAmount', { defaultValue: 'This level price is not available. Please pick another level.' });
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
    if (sending || selectedLevel === null || selectedAmount === null) return;
    setSending(true);
    try {
      await sendCoupleInvite({
        senderUid,
        recipientUid: recipient.uid,
        amount: selectedAmount,
        sentLevel: selectedLevel,
      });
      Alert.alert(
        t('couple.sentTitle', { defaultValue: 'Invitation sent' }),
        t('couple.sentBody', { defaultValue: 'Your couple invitation has been sent.' }),
      );
      onCoupleSent?.();
      onClose();
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
          {/* Header: "?" help left, dynamic title, X close right */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Pressable onPress={showHelp} hitSlop={8} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
              <Feather name="help-circle" size={22} color="#25292D" />
            </Pressable>
            <Text style={{ fontSize: 17, fontWeight: '600', color: '#25292D' }}>
              {selectedLevel !== null
                ? t('couple.sendLv', { defaultValue: `Send Lv ${selectedLevel}` })
                : t('couple.sendLvRank', { defaultValue: 'Send Lv Rank' })}
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

          {/* Level grid: 5 boxes, one shared pattern, progressively upgraded */}
          <View style={{ marginTop: 16 }}>
            {rows.map((row, rowIndex) => (
              <View
                key={rowIndex}
                style={{
                  flexDirection: 'row',
                  justifyContent: row.length === 1 ? 'center' : 'space-between',
                }}
              >
                {row.map((token) => (
                  <LevelBox
                    key={token.level}
                    token={token}
                    isSelected={selectedLevel === token.level}
                    onPress={() => setSelectedLevel(token.level)}
                  />
                ))}
              </View>
            ))}
          </View>

          {/* Note text */}
          <Text style={{ fontSize: 13, color: '#788187', textAlign: 'center', marginTop: 4 }}>
            {t('couple.levelNote', {
              defaultValue: "Send a level to show your sincerity. Diamonds won't be returned if rejected or expires.",
            })}
          </Text>

          {/* Big white Send button (pink text); disabled until a level is picked */}
          <Pressable
            onPress={handleSend}
            disabled={sending || selectedLevel === null}
            style={{
              marginTop: 16,
              height: 50,
              borderRadius: 25,
              backgroundColor: '#FFFFFF',
              borderWidth: 1,
              borderColor: PINK,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: sending || selectedLevel === null ? 0.6 : 1,
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
