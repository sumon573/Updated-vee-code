import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { C } from '../constants/theme';
import { DiamondIcon } from '@/src/components/DiamondIcon';
import { ChatMsg } from '../types/room';
import { fmt } from '../utils/format';
import { MsgText } from './Avatar';
import { truncateTo12 } from '@/src/utils/truncateName';

type Props = {
  item: ChatMsg;
  accentColor: string;
  onReply: (msg: ChatMsg) => void;
  /** Text messages only: long-press opens the Copy/Reply action sheet
      (2026-10-23, Sumon — copy applies to user-sent text, nothing else). */
  onAction?: (msg: ChatMsg) => void;
};

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** Wallet-style compact diamonds: 1k / 10k / 100k / 1m / 1b (boss rule). */
function formatDiamonds(n: number): string {
  const trim = (v: number) => (v % 1 === 0 ? String(v) : v.toFixed(1).replace(/\.0$/, ''));
  if (n >= 1e9) return trim(n / 1e9) + 'b';
  if (n >= 1e6) return trim(n / 1e6) + 'm';
  if (n >= 1e3) return trim(n / 1e3) + 'k';
  return String(Math.floor(n));
}

function CardAvatar({ name, photoURL, color, size }: {
  name: string; photoURL?: string; color: string; size: number;
}) {
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: color + '2E', alignItems: 'center', justifyContent: 'center',
      borderWidth: 1.5, borderColor: '#FFFFFF', overflow: 'hidden',
    }}>
      {photoURL ? (
        <Image
          source={{ uri: photoURL }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          cachePolicy="memory-disk"
          recyclingKey={photoURL}
        />
      ) : (
        <Text style={{ color, fontSize: size * 0.34, fontWeight: '800' }}>
          {initialsFor(name)}
        </Text>
      )}
    </View>
  );
}

/**
 * A single row in the room chat FlatList.
 *
 * Long-press → set as reply target (shown as a reply preview above input).
 * @mention tokens are highlighted in the accent color via MsgText.
 * Memoized: every incoming message would otherwise re-render the whole list.
 */
function RoomChatMessage({ item, accentColor, onReply, onAction }: Props) {
  const { t } = useTranslation();
  const isSystem = item.sender === 'System';

  /* ── System messages: centered pill ── */
  if (isSystem) {
    return (
      <View style={{ alignItems: 'center', marginVertical: 5 }}>
        <View style={{
          backgroundColor: accentColor + '18',
          borderRadius: 999,
          paddingHorizontal: 14, paddingVertical: 5,
          borderWidth: 1, borderColor: accentColor + '33',
        }}>
          <Text style={{ color: accentColor + 'CC', fontSize: 11, fontWeight: '600' }}>
            {item.text}
          </Text>
        </View>
      </View>
    );
  }

  /* ── Gift messages: highlight gift card (2026-10-23, Sumon picked A) ──
     Full-width soft gold-rose card: sender DP + name, the real gift
     thumbnail + name, then the receiver DP(s) + name and the diamond
     total — so a gift reads as a gift at a glance, never as plain text. */
  if (item.kind === 'gift' && item.gift) {
    const g = item.gift;
    const recipients = g.recipients.slice(0, 3);
    const extraCount = g.recipients.length - recipients.length;
    const recipientNames = g.recipients.map((r) => r.name).join(', ');
    return (
      <Pressable
        onLongPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onReply(item);
        }}
        style={{ marginBottom: 10 }}
      >
        <LinearGradient
          colors={['#FFF8E1', '#FFEDD5', '#FFE4E6']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            borderRadius: 16, paddingHorizontal: 12, paddingVertical: 10,
            borderWidth: 1, borderColor: '#F0B64F',
          }}
        >
          {/* Sender line */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
            <CardAvatar name={item.sender} photoURL={g.senderAvatar} color={item.color} size={30} />
            <Text style={{ color: '#7C2D12', fontSize: 12, fontWeight: '800', flexShrink: 1 }} numberOfLines={1}>
              {truncateTo12(item.sender)}
            </Text>
            <Text style={{ color: '#9A3412', fontSize: 11, fontWeight: '600' }}>
              {t('voiceRoom.chat.giftSent')}
            </Text>
            <View style={{ flex: 1 }} />
            <View style={{
              backgroundColor: '#D97706', borderRadius: 999,
              paddingHorizontal: 9, paddingVertical: 3,
              flexDirection: 'row', alignItems: 'center',
            }}>
              <DiamondIcon size={11} />
              <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '800', marginLeft: 3 }}>
                {formatDiamonds(g.totalCoins)}
              </Text>
            </View>
          </View>

          {/* Gift → receiver line */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 9 }}>
            <View style={{
              width: 50, height: 50, borderRadius: 14,
              backgroundColor: 'rgba(255,255,255,0.75)',
              borderWidth: 1, borderColor: '#F5C86B',
              alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
            }}>
              {g.thumbnailUrl ? (
                <Image
                  source={{ uri: g.thumbnailUrl }}
                  style={{ width: 42, height: 42 }}
                  contentFit="contain"
                  cachePolicy="memory-disk"
                  recyclingKey={g.giftId}
                />
              ) : (
                <Text style={{ fontSize: 26 }}>🎁</Text>
              )}
            </View>
            <View style={{ flexShrink: 1 }}>
              <Text style={{ color: '#431407', fontSize: 13, fontWeight: '800' }} numberOfLines={1}>
                {g.giftName}
              </Text>
              {g.quantity > 1 && (
                <Text style={{ color: '#B45309', fontSize: 11, fontWeight: '700', marginTop: 1 }}>
                  {'×' + g.quantity}
                </Text>
              )}
            </View>
            <Text style={{ color: '#D97706', fontSize: 16, fontWeight: '900' }}>➜</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {recipients.map((r, i) => (
                <View key={r.uid} style={{ marginLeft: i === 0 ? 0 : -9, zIndex: recipients.length - i }}>
                  <CardAvatar name={r.name} photoURL={r.photoURL} color="#BE123C" size={32} />
                </View>
              ))}
              {extraCount > 0 && (
                <View style={{
                  marginLeft: -9, width: 32, height: 32, borderRadius: 16,
                  backgroundColor: '#9A3412', alignItems: 'center', justifyContent: 'center',
                  borderWidth: 1.5, borderColor: '#FFFFFF',
                }}>
                  <Text style={{ color: '#FFFFFF', fontSize: 10, fontWeight: '800' }}>
                    {'+' + extraCount}
                  </Text>
                </View>
              )}
            </View>
            <Text style={{ color: '#7C2D12', fontSize: 12, fontWeight: '700', flexShrink: 1 }} numberOfLines={1}>
              {truncateTo12(recipientNames)}
            </Text>
          </View>
        </LinearGradient>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3, marginHorizontal: 4 }}>
          <Text style={{ color: C.muted, fontSize: 9 }}>{fmt(item.ts)}</Text>
          <Text style={{ color: C.muted + '66', fontSize: 9 }}>
            {t('voiceRoom.chat.holdToReply')}
          </Text>
        </View>
      </Pressable>
    );
  }

  const bubbleBg    = item.isMe ? accentColor + '30' : '#F1F5F9';
  const borderColor = item.isMe ? accentColor + '55' : '#E2E8F0';

  return (
    <Pressable
      onLongPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        // User-sent TEXT only → action sheet (Copy / Reply). Gift cards
        // and system pills never reach this branch.
        if (onAction) onAction(item); else onReply(item);
      }}
      style={{ marginBottom: 10, alignItems: item.isMe ? 'flex-end' : 'flex-start' }}
    >
      {/* Sender name (other users only) */}
      {!item.isMe && (
        <Text style={{
          color: item.color,
          fontSize: 11, fontWeight: '800',
          marginBottom: 3, marginLeft: 4,
          letterSpacing: 0.2,
        }}>
          {truncateTo12(item.sender)}
        </Text>
      )}

      <View style={{
        backgroundColor: bubbleBg,
        borderRadius: 16,
        borderBottomRightRadius: item.isMe ? 4 : 16,
        borderBottomLeftRadius:  item.isMe ? 16 : 4,
        paddingHorizontal: 13, paddingVertical: 9,
        maxWidth: '82%',
        borderWidth: 1, borderColor,
      }}>
        {/* Reply-to block */}
        {item.replyTo && (
          <View style={{
            borderLeftWidth: 3, borderLeftColor: item.replyTo.color,
            paddingLeft: 9, marginBottom: 7,
            backgroundColor: 'rgba(15,23,42,0.06)',
            borderRadius: 8, padding: 6,
          }}>
            <Text style={{
              color: item.replyTo.color,
              fontSize: 10, fontWeight: '800', marginBottom: 2,
            }}>
              ↩ {truncateTo12(item.replyTo.sender)}
            </Text>
            <Text style={{ color: C.sub, fontSize: 11 }} numberOfLines={2}>
              {item.replyTo.text}
            </Text>
          </View>
        )}

        <MsgText text={item.text} accent={accentColor} />
      </View>

      {/* Timestamp + hint */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5,
        marginTop: 3, marginHorizontal: 4 }}>
        <Text style={{ color: C.muted, fontSize: 9 }}>{fmt(item.ts)}</Text>
        <Text style={{ color: C.muted + '66', fontSize: 9 }}>
          {t(onAction ? 'voiceRoom.chat.holdForActions' : 'voiceRoom.chat.holdToReply')}
        </Text>
      </View>
    </Pressable>
  );
}

export default memo(RoomChatMessage);
