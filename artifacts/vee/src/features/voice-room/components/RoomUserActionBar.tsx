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
   Icons left → right (2026-11-11, boss 19:13 + 19:16: imo-polished):
   1. Comment block/unblock — imo's bubble + diagonal slash in BOTH
      states; the STATE is the slash colour (dark = unblocked, red =
      blocked). Slim bar: 42dp (was 54dp) — container paddingVertical 4,
      cell paddingVertical 5, icons 22 (was 24); the bar is a slim compact
      row like imo's, not a tall banner eating space.
   2. Invite to seat — imo's person + arrow badge (was person + plus).
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

/** Comment block/unblock icon: imo's speech bubble + diagonal slash.
 * The STATE is the slash colour — dark = unblocked, red = blocked.
 * 2026-11-11 (boss, imo icons 19:16): the 3-lines inside the bubble
 * (boss's 13:37 spec) made Vee's icon look busier than imo's clean
 * bubble+slash, so the lines are gone; the slash-colour state rule
 * (slash = blocked) is unchanged. */
function CommentBlockIcon({ blocked }: { blocked: boolean }) {
  return (
    <View style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>
      <Feather name="message-circle" size={22} color={C.text} />
      <View style={{ position: 'absolute', width: 26, height: 2, backgroundColor: blocked ? '#DC2626' : C.text, transform: [{ rotate: '-45deg' }], borderRadius: 1 }} />
    </View>
  );
}

/** Room-role icon: person with a small gear badge at the bottom-right. */
function RoleIcon() {
  return (
    <View style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>
      <Feather name="user" size={20} color={C.text} />
      <View style={{ position: 'absolute', right: -1, bottom: -1, backgroundColor: C.card, borderRadius: 7, width: 13, height: 13, alignItems: 'center', justifyContent: 'center' }}>
        <Feather name="settings" size={10} color={C.text} />
      </View>
    </View>
  );
}

/** Invite icon: person with a small arrow badge at the bottom-right —
    imo's invite glyph (person + arrow), NOT person + plus. Mirrors the
    RoleIcon badge composition so the two person-icons match. */
function InviteIcon() {
  return (
    <View style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>
      <Feather name="user" size={20} color={C.text} />
      <View style={{ position: 'absolute', right: -1, bottom: -1, backgroundColor: C.card, borderRadius: 7, width: 13, height: 13, alignItems: 'center', justifyContent: 'center' }}>
        <Feather name="arrow-up-right" size={10} color={C.text} />
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
  const cell = { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, paddingVertical: 5 };
  return (
    <View style={{ flexDirection: 'row', borderTopWidth: 0.5, borderTopColor: C.border, backgroundColor: C.card, paddingVertical: 4 }}>
      <Pressable onPress={onToggleCommentBlock} hitSlop={8} style={cell}>
        <CommentBlockIcon blocked={isCommentBlocked} />
      </Pressable>
      <Pressable onPress={onInvite} hitSlop={8} style={cell}>
        <InviteIcon />
      </Pressable>
      <Pressable onPress={onKick} hitSlop={8} style={cell}>
        <Feather name="log-out" size={22} color={C.text} />
      </Pressable>
      <Pressable onPress={onOpenRoleSettings} hitSlop={8} style={cell}>
        <RoleIcon />
      </Pressable>
      {/* Icon 5 "..." — no action yet (boss). Plain View, not a Pressable. */}
      <View style={cell}>
        <Feather name="more-horizontal" size={22} color={C.text} />
      </View>
    </View>
  );
}
