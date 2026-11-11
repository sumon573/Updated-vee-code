import React from 'react';
import { View, Pressable } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { C } from '../constants/theme';
import type { Role } from '../types/room';

/* ── 2026-11-11 (boss, imo mirror): the 5-icon room action bar ──────────
   ROLE-GATED (the core rule, boss 13:37–13:48):
   - Owner → Admin/User: all 5 icons.
   - Admin → User: all 5 icons (the room-role sheet is restricted instead).
   - Admin → Admin, Admin → Owner, User → everyone: NO bar (null).
   Icons left → right:
   1. Comment block/unblock — the icon CHANGES with the state: blocked =
      speech bubble with a red slash; unblocked = bubble with 3 lines.
   2. Invite to seat (person + plus).
   3. Kick out (arrow out of a box).
   4. Room role (person with a gear badge).
   5. "..." — NO action yet (boss 13:37), rendered as a plain View so it
      never promises a tap. */

/** True when the viewer may see the 5-icon bar for this target. */
export function canShowRoomActionBar(viewerRole: Role, targetRole: Role): boolean {
  if (viewerRole === 'host') return targetRole === 'admin' || targetRole === 'member';
  if (viewerRole === 'admin') return targetRole === 'member';
  return false;
}

/** Comment block/unblock icon: speech bubble; blocked = diagonal red
 * slash across it, unblocked = three horizontal lines inside it. */
function CommentBlockIcon({ blocked }: { blocked: boolean }) {
  return (
    <View style={{ width: 26, height: 26, alignItems: 'center', justifyContent: 'center' }}>
      <Feather name="message-circle" size={24} color={C.text} />
      {blocked ? (
        <View style={{ position: 'absolute', width: 28, height: 2, backgroundColor: '#DC2626', transform: [{ rotate: '-45deg' }], borderRadius: 1 }} />
      ) : (
        <View style={{ position: 'absolute', alignItems: 'center', justifyContent: 'center', gap: 2.5 }}>
          <View style={{ width: 11, height: 1.6, backgroundColor: C.text, borderRadius: 1 }} />
          <View style={{ width: 11, height: 1.6, backgroundColor: C.text, borderRadius: 1 }} />
          <View style={{ width: 11, height: 1.6, backgroundColor: C.text, borderRadius: 1 }} />
        </View>
      )}
    </View>
  );
}

/** Room-role icon: person with a small gear badge at the bottom-right. */
function RoleIcon() {
  return (
    <View style={{ width: 26, height: 26, alignItems: 'center', justifyContent: 'center' }}>
      <Feather name="user" size={22} color={C.text} />
      <View style={{ position: 'absolute', right: -1, bottom: -1, backgroundColor: C.card, borderRadius: 7, width: 14, height: 14, alignItems: 'center', justifyContent: 'center' }}>
        <Feather name="settings" size={11} color={C.text} />
      </View>
    </View>
  );
}

export function RoomUserActionBar({ viewerRole, targetRole, isCommentBlocked, onToggleCommentBlock, onInvite, onKick, onOpenRoleSettings }: {
  viewerRole: Role;
  targetRole: Role;
  /** True when the target currently holds an active comment-block. */
  isCommentBlocked: boolean;
  onToggleCommentBlock: () => void;
  onInvite: () => void;
  onKick: () => void;
  onOpenRoleSettings: () => void;
}) {
  if (!canShowRoomActionBar(viewerRole, targetRole)) return null;
  const cell = { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, paddingVertical: 8 };
  return (
    <View style={{ flexDirection: 'row', borderTopWidth: 0.5, borderTopColor: C.border, backgroundColor: C.card, paddingVertical: 6 }}>
      <Pressable onPress={onToggleCommentBlock} hitSlop={8} style={cell}>
        <CommentBlockIcon blocked={isCommentBlocked} />
      </Pressable>
      <Pressable onPress={onInvite} hitSlop={8} style={cell}>
        <Feather name="user-plus" size={24} color={C.text} />
      </Pressable>
      <Pressable onPress={onKick} hitSlop={8} style={cell}>
        <Feather name="log-out" size={24} color={C.text} />
      </Pressable>
      <Pressable onPress={onOpenRoleSettings} hitSlop={8} style={cell}>
        <RoleIcon />
      </Pressable>
      {/* Icon 5 "..." — no action yet (boss). Plain View, not a Pressable. */}
      <View style={cell}>
        <Feather name="more-horizontal" size={24} color={C.text} />
      </View>
    </View>
  );
}
