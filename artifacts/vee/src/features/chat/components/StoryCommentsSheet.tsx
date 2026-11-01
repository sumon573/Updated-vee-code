import React, { useState, useEffect } from 'react';
import { View, Text, Pressable, Image, TextInput, FlatList, KeyboardAvoidingView, Platform } from 'react-native';
import PremiumLoader from '@/src/components/PremiumLoader';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { StoryComment } from '../types';
import { STORY_REACTIONS } from '../data/storyConstants';
import { getErrorCause } from '@/src/utils/errorDisplay';

type Props = {
  visible: boolean;
  comments: StoryComment[];
  reactions: Record<string, string>;
  currentUserId?: string;
  currentUserName?: string;
  currentUserAvatar?: string;
  onClose: () => void;
  onSendComment: (text: string, replyTo?: { id: string; name: string }) => Promise<void>;
};

/**
 * Full comments sheet (2026-10-11):
 * - All comments with avatars
 * - Reply to any comment (threaded)
 * - Reactions summary at top
 */
export default function StoryCommentsSheet({
  visible, comments, reactions,
  currentUserId, currentUserName, currentUserAvatar,
  onClose, onSendComment }: Props) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) {
      setText('');
      setReplyTo(null);
      setError(null);
    }
  }, [visible]);

  if (!visible) return null;

  // Group reactions by emoji.
  const reactionCounts = new Map<string, number>();
  for (const emoji of Object.values(reactions)) {
    reactionCounts.set(emoji, (reactionCounts.get(emoji) ?? 0) + 1);
  }

  // Sort comments by time, with replies grouped under parents.
  const topLevel = comments.filter((c) => !c.replyTo).sort((a, b) => a.ts - b.ts);
  const replies = new Map<string, StoryComment[]>();
  for (const c of comments.filter((c) => c.replyTo)) {
    const list = replies.get(c.replyTo!) ?? [];
    list.push(c);
    replies.set(c.replyTo!, list);
  }
  for (const list of replies.values()) list.sort((a, b) => a.ts - b.ts);

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    try {
      await onSendComment(trimmed, replyTo ?? undefined);
      setText('');
      setReplyTo(null);
    } catch (e) {
      setError(getErrorCause(e));
    } finally {
      setSending(false);
    }
  };

  const renderComment = (cmt: StoryComment, isReply: boolean) => (
    <View key={cmt.id} style={{ marginBottom: 12, marginLeft: isReply ? 44 : 0 }}>
      <View style={{ flexDirection: 'row' }}>
        {cmt.userAvatar ? (
          <Image source={{ uri: cmt.userAvatar }} style={{ width: 32, height: 32, borderRadius: 16, marginRight: 10 }} />
        ) : (
          <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
            <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>
              {cmt.userName.charAt(0).toUpperCase()}
            </Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>{cmt.userName}</Text>
          {cmt.replyToName && (
            <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 11, marginTop: 2 }}>
              {t('chat.storyReplyingTo', { name: cmt.replyToName, defaultValue: `Replying to ${cmt.replyToName}` })}
            </Text>
          )}
          <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 14, marginTop: 2 }}>{cmt.text}</Text>
          <Pressable
            onPress={() => setReplyTo({ id: cmt.id, name: cmt.userName })}
            style={{ marginTop: 4, alignSelf: 'flex-start' }}
          >
            <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '600' }}>
              {t('chat.storyReply', { defaultValue: 'Reply' })}
            </Text>
          </Pressable>
        </View>
      </View>
      {/* Nested replies */}
      {!isReply && (replies.get(cmt.id) ?? []).map((r) => renderComment(r, true))}
    </View>
  );

  return (
    <View style={{
      position: 'absolute', top: 0, bottom: 0, left: 0, right: 0,
      backgroundColor: 'rgba(0,0,0,0.95)', zIndex: 50 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)' }}>
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700', flex: 1 }}>
            {t('chat.storyComments', { defaultValue: 'Comments' })} ({comments.length})
          </Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Feather name="x" size={24} color="#fff" />
          </Pressable>
        </View>

        {/* Reactions summary */}
        {reactionCounts.size > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)' }}>
            {Array.from(reactionCounts.entries()).map(([emoji, count]) => (
              <View key={emoji} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 4, marginRight: 8, marginBottom: 4 }}>
                <Text style={{ fontSize: 16 }}>{emoji}</Text>
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700', marginLeft: 4 }}>{count}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Comments list */}
        <FlatList
          data={topLevel}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => renderComment(item, false)}
          contentContainerStyle={{ padding: 16 }}
          ListEmptyComponent={
            <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, textAlign: 'center', marginTop: 40 }}>
              {t('chat.storyNoComments', { defaultValue: 'No comments yet. Be the first!' })}
            </Text>
          }
        />

        {/* Reply-to indicator */}
        {replyTo && (
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, backgroundColor: 'rgba(255,255,255,0.05)' }}>
            <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12, flex: 1 }}>
              {t('chat.storyReplyingTo', { name: replyTo.name, defaultValue: `Replying to ${replyTo.name}` })}
            </Text>
            <Pressable onPress={() => setReplyTo(null)} hitSlop={8}>
              <Feather name="x" size={16} color="rgba(255,255,255,0.7)" />
            </Pressable>
          </View>
        )}

        {/* Error */}
        {error && (
          <Text style={{ color: '#ff6b6b', fontSize: 12, paddingHorizontal: 16, paddingVertical: 4 }}>{error}</Text>
        )}

        {/* Input */}
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)' }}>
            <TextInput
              style={{ flex: 1, color: '#fff', fontSize: 14, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, marginRight: 10 }}
              placeholder={replyTo
                ? t('chat.storyReplyPlaceholder', { name: replyTo.name, defaultValue: `Reply to ${replyTo.name}...` })
                : t('chat.storyAddComment', { defaultValue: 'Add a comment...' })}
              placeholderTextColor="rgba(255,255,255,0.5)"
              value={text}
              onChangeText={setText}
              multiline
              maxLength={500}
            />
            <Pressable
              onPress={handleSend}
              disabled={!text.trim() || sending}
              style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: text.trim() ? '#3b82f6' : 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center' }}
            >
              {sending ? (
                <PremiumLoader size="small" />
              ) : (
                <Feather name="send" size={18} color="#fff" />
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
