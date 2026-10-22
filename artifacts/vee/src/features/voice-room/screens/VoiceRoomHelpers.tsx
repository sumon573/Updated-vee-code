/**
 * VoiceRoomHelpers — extracted from VoiceRoomScreen.tsx (IMO port Phase 1c split).
 * Pure helpers + small presentational components. No logic changes.
 */
import { useRef, useEffect, useState } from 'react';
import { View, Text, Image, Animated } from 'react-native';
import { Feather } from '@expo/vector-icons';
import ScalePress from '@/components/ScalePress';
import { Role, Participant, ChatMsg, roleToLevel } from '../types/room';
import type { RoomSeat, RoomAudienceMember } from '../services/firebaseRoomService';
import type { RoomChatMsg } from '../services/firebaseRoomChatService';

// P0 security (2026-10-12): PIN session cache এখন firebaseRoomService-এ
// শেয়ার্ড (isPinVerifiedForSession / setPinVerifiedForSession) — VoiceRoomHome-এর
// PIN dialog আর এই স্ক্রিন একই ক্যাশ দেখে, double PIN prompt হয় না।
// 2026-10-12 (Sumon): versioned — PIN বদলালে (pinVersion bump) পুরনো সেশন
// অকার্যকর; 2026-10-12 review fix: uid দিয়ে key — logout/login-এ আগের
// ইউজারের verification inherit হয় না।

// P1 anti-spam (2026-10-12): per-room last-send timestamps for the 1.5s
// chat throttle. Module-level so rapid re-renders can't reset it.
export const lastChatSendAt = new Map<string, number>();

export function fbSeatToParticipant(
  seat: NonNullable<RoomSeat>,
  speakingUsers: Record<string, boolean>,
): Participant {
  return {
    id: seat.userId,
    name: seat.userName,
    initials: seat.initials,
    color: seat.color,
    photoURL: seat.photoURL,
    speaking: speakingUsers[seat.userId] === true,
    muted: seat.muted,
    role: seat.role,
    // 2026-10-19 (IMO port Phase 1): dual-read numeric roleLevel —
    // use stored value when present, else derive from the string role.
    roleLevel: seat.roleLevel ?? roleToLevel(seat.role),
    // 2026-10-14 (Sumon): ROOT CAUSE FIX — activeFrame was never copied from
    // seat data to Participant, so frame could NEVER show on seats even though
    // Firebase had it. This one line fixes it.
    activeFrame: (seat as any).activeFrame || undefined,
    // 2026-10-15 (Sumon): noble rank for per-rank speaking ripple.
    nobleRankIndex: (seat as any).nobleRankIndex ?? undefined };
}

export function fbAudToParticipant(m: RoomAudienceMember): Participant {
  return {
    id: m.userId,
    name: m.userName,
    initials: m.initials,
    color: m.color,
    photoURL: m.photoURL,
    speaking: false,
    muted: true,
    // Preserve Firebase-synced role (admin / member); default to 'member'
    role: (m.role as Role | undefined) ?? 'member',
    // 2026-10-19 (IMO port Phase 1): dual-read numeric roleLevel
    roleLevel: (m as { roleLevel?: number }).roleLevel ?? roleToLevel(m.role),
    // 2026-10-13 (Sumon): active frame for audience list display
    activeFrame: (m as any).activeFrame || undefined,
    // 2026-10-15 (Sumon): noble rank for per-rank entry effect.
    nobleRankIndex: (m as any).nobleRankIndex ?? undefined };
}

export function fbChatToMsg(m: RoomChatMsg): ChatMsg {
  return {
    id: m.id,
    sender: m.senderName,
    color: m.senderColor,
    text: m.text,
    isMe: m.isMe ?? false,
    ts: m.ts,
    replyTo: m.replyTo };
}

/* ═══════════════════════════════════════════
   MAIN SCREEN
═══════════════════════════════════════════ */
/* ─────────────────────────── Live Audience Pill ─────────────────────────── */
// 2026-10-14 (Sumon): imo-style live audience pill — small DP + count (1+, 2+, 1k+).
// Position: top bar, next to Hourly Rank.
// 2026-10-15 (Sumon): counts EVERYONE live in the room (seated + audience),
// tap opens the full Live Audience page. DP is the exact real profile photo
// of the first live person (initials avatar if they have no photo — never demo).
export function LiveAudiencePill({ count, onPress, person }: { count: number; onPress: () => void; person?: Participant }) {
  const formatCount = (n: number): string => {
    if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.0', '')}k+`;
    return `${n}+`;
  };
  const photoURL = person?.photoURL;
  return (
    <ScalePress onPress={onPress}>
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: '#F1F5F9',
        borderRadius: 16, paddingLeft: 10, paddingRight: 5, paddingVertical: 3,
        borderWidth: 1, borderColor: '#E2E8F0' }}>
        <Text style={{ color: '#111827', fontSize: 13, fontWeight: '800', marginRight: 5 }}>
          {formatCount(count)}
        </Text>
        {photoURL ? (
          <Image source={{ uri: photoURL }} style={{ width: 24, height: 24, borderRadius: 12 }} />
        ) : (
          <View style={{
            width: 24, height: 24, borderRadius: 12,
            backgroundColor: person?.color || '#8B5CF6', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: '#FFF', fontSize: 10, fontWeight: '800' }}>{person?.initials || ''}</Text>
          </View>
        )}
      </View>
    </ScalePress>
  );
}

/* ── LiveDateIcon — Royal Gold Calendar (2026-10-15, Sumon picked Option A):
   Premium luxury calendar button: gold rings, gold gradient month strip,
   bold day number (fully visible, never clipped), red live-event badge.
   Ticks every 30s so the date rolls over at midnight without reopening
   the room. Design NEVER changes — only month/day text updates.
   liveCount = real live event count (badge hidden when 0, no demo numbers). ── */
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function LiveDateIcon({ liveCount = 0 }: { liveCount?: number }) {
  const [todayKey, setTodayKey] = useState(() => new Date().toDateString());
  useEffect(() => {
    const id = setInterval(() => {
      const k = new Date().toDateString();
      setTodayKey((prev) => (prev === k ? prev : k));
    }, 30000);
    return () => clearInterval(id);
  }, []);
  const now = new Date();
  const month = MONTHS_SHORT[now.getMonth()];
  const day = now.getDate();
  // Re-render is driven by todayKey; values below always reflect "now".
  void todayKey;
  // 2026-10-16 (Sumon): height 44 -> 56 so the day number is fully
  // visible (was clipped). Design unchanged — Royal Gold calendar.
  return (
    <View style={{
      width: 40, height: 56, borderRadius: 10,
      backgroundColor: '#FFFFFF', overflow: 'hidden', alignItems: 'center',
      borderWidth: 2, borderColor: '#D4AF37',
      shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 }, elevation: 5 }}>
      {/* Gold rings */}
      <View style={{ flexDirection: 'row', gap: 10, marginTop: -4, zIndex: 2 }}>
        <View style={{ width: 6, height: 10, borderRadius: 3, backgroundColor: '#D4AF37' }} />
        <View style={{ width: 6, height: 10, borderRadius: 3, backgroundColor: '#D4AF37' }} />
      </View>
      {/* Gold month strip */}
      <View style={{
        width: '100%', marginTop: 1, paddingVertical: 3, alignItems: 'center',
        backgroundColor: '#D4AF37' }}>
        <Text style={{ color: '#FFFFFF', fontSize: 9, fontWeight: '800', letterSpacing: 1.5 }}>
          {month.toUpperCase()}
        </Text>
      </View>
      {/* Day number — fully visible, generous padding so never clipped */}
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 2 }}>
        <Text style={{ color: '#1A1A2E', fontSize: 20, fontWeight: '900', lineHeight: 22 }}>
          {day}
        </Text>
      </View>
      {/* Live event badge — only when count > 0 (never demo) */}
      {liveCount > 0 && (
        <View style={{
          position: 'absolute', top: 4, right: 4,
          minWidth: 16, height: 16, borderRadius: 8,
          backgroundColor: '#FF3B30', borderWidth: 1.5, borderColor: '#FFFFFF',
          alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 }}>
          <Text style={{ color: '#FFFFFF', fontSize: 9, fontWeight: '800' }}>
            {liveCount > 99 ? '99+' : liveCount}
          </Text>
        </View>
      )}
    </View>
  );
}

// 2026-10-15 (Sumon): MODULE-LEVEL join-message dedup — survives component
// remounts (background return, etc.). Key: roomId + uid. Prevents "joined"
// spam when the screen remounts without the restore=1 param.
// 2026-10-19 polish: capped at 500 entries — a session-long Set never evicting
// is a slow memory leak; FIFO prune the oldest keys past the cap.
export const sentJoinMsgKeys = new Set<string>();
const SENT_JOIN_MSG_KEY_CAP = 500;
export function addSentJoinMsgKey(key: string): void {
  if (sentJoinMsgKeys.size >= SENT_JOIN_MSG_KEY_CAP) {
    let pruned = 0;
    for (const oldest of sentJoinMsgKeys) {
      sentJoinMsgKeys.delete(oldest);
      if (++pruned >= SENT_JOIN_MSG_KEY_CAP / 2) break;
    }
  }
  sentJoinMsgKeys.add(key);
}

/* ── ObsidianGiftButton — Option C (2026-10-15, Sumon picked):
   Premium gift button: obsidian dark + gold border, twinkling sparkles
   (Animated loop, staggered). Matches Royal Gold Task calendar luxury. ── */
export function TwinkleSparkle({ delay, style }: { delay: number; style: any }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim, delay]);
  const opacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] });
  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.25] });
  return (
    <Animated.Text style={[{ opacity, transform: [{ scale }] }, style]}>
      ✨
    </Animated.Text>
  );
}
export function ObsidianGiftButton() {
  // 2026-10-15 (Sumon): NO background box — only floating gift + sparkles.
  return (
    <View style={{ width: 52, height: 52, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: 30 }}>🎁</Text>
      <TwinkleSparkle delay={0} style={{ position: 'absolute', top: 0, left: 2, fontSize: 10 }} />
      <TwinkleSparkle delay={600} style={{ position: 'absolute', top: 3, right: 3, fontSize: 10 }} />
      <TwinkleSparkle delay={1200} style={{ position: 'absolute', bottom: 2, left: 5, fontSize: 10 }} />
    </View>
  );
}

/* ── ObsidianExitButton — Option B (2026-10-15, Sumon picked):
   2026-10-15 (Sumon): NO background box — only floating ✕. ── */
export function ObsidianExitButton() {
  return (
    <View style={{ width: 52, height: 52, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: 26, fontWeight: '900', color: '#FF5252', lineHeight: 30 }}>✕</Text>
    </View>
  );
}

/* ── SapphireInviteButton — Option B (2026-10-15, Sumon picked):
   Premium blue person-plus + orbiting sparkles. NO background box. ── */
export function OrbitSparkle({ delay, size }: { delay: number; size: number }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, { toValue: 1, duration: 4000, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim, delay]);
  const rotate = anim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const opacity = anim.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0.3, 1, 0.3, 1, 0.3] });
  return (
    <Animated.View style={{
      position: 'absolute', width: size, height: size,
      alignItems: 'center', justifyContent: 'center',
      transform: [{ rotate }],
    }}>
      <Animated.Text style={{ position: 'absolute', top: -4, fontSize: 10, opacity }}>✨</Animated.Text>
    </Animated.View>
  );
}
export function SapphireInviteButton() {
  return (
    <View style={{ width: 56, height: 56, alignItems: 'center', justifyContent: 'center' }}>
      {/* 2026-10-15 (Sumon): NO background box — floating blue person-plus + orbit sparkles. */}
      <Feather name="user-plus" size={26} color="#007AFF" style={{ textShadowColor: 'rgba(0,122,255,0.5)', textShadowRadius: 8 }} />
      <OrbitSparkle delay={0} size={56} />
      <OrbitSparkle delay={2000} size={56} />
    </View>
  );
}

/* ── PulseMicButton — Option C (2026-10-15, Sumon picked):
   Blue Feather mic + expanding pulse rings when unmuted.
   Muted = red mic-off. NO background box. ── */
export function PulseRing({ delay, color }: { delay: number; color: string }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, { toValue: 1, duration: 2000, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim, delay]);
  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1.5] });
  const opacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] });
  return (
    <Animated.View style={{
      position: 'absolute', width: 44, height: 44, borderRadius: 22,
      borderWidth: 2, borderColor: color,
      opacity, transform: [{ scale }],
    }} />
  );
}
export function PulseMicButton({ muted }: { muted: boolean }) {
  const color = muted ? '#FF4444' : '#007AFF';
  const iconName = muted ? 'mic-off' : 'mic';
  return (
    <View style={{ width: 56, height: 56, alignItems: 'center', justifyContent: 'center' }}>
      {/* 2026-10-15 (Sumon): NO background box — floating mic + pulse rings. */}
      {!muted && <PulseRing delay={0} color={color} />}
      {!muted && <PulseRing delay={1000} color={color} />}
      <Feather
        name={iconName}
        size={24}
        color={color}
        style={{ textShadowColor: color === '#007AFF' ? 'rgba(0,122,255,0.5)' : 'rgba(255,68,68,0.5)', textShadowRadius: 8 }}
      />
    </View>
  );
}

/* ── LiquidGoldSpeaker — Option E (2026-10-15, Sumon picked):
   Gold speaker + warm glow when ON, gray muted when OFF.
   NO background box. ── */
export function LiquidGoldSpeaker({ speakerOn }: { speakerOn: boolean }) {
  const color = speakerOn ? '#D4AF37' : '#6B7280';
  const iconName = speakerOn ? 'volume-2' : 'volume-x';
  return (
    <View style={{ width: 56, height: 56, alignItems: 'center', justifyContent: 'center' }}>
      {/* 2026-10-15 (Sumon): NO background box — floating gold speaker. */}
      <Feather
        name={iconName}
        size={24}
        color={color}
        style={speakerOn ? { textShadowColor: 'rgba(212,175,55,0.6)', textShadowRadius: 10 } : { opacity: 0.6 }}
      />
    </View>
  );
}

