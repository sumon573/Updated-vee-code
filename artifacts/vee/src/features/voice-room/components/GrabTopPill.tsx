/**
 * GrabTopPill — "Grab the Top" highlight pill (boss, imo reference, 2026-10-27).
 *
 * Shows, in ONE small compact pill (same height as the Hourly Rank /
 * audience pills — no banner, no extra row), the top gift-senders of the
 * ROOM OWNER'S COUNTRY over the TRAILING 1 HOUR, as tiny avatars + "x1" +
 * ticking seconds, on a peach highlight tint.
 *
 * DATA CONTRACT (server-written node; NO client fabrication):
 *   grabTop/{roomId} = {
 *     ownerCountry: string,        // room owner's country (bot-resolved)
 *     windowStart: number,         // trailing-1-hour window start (ms)
 *     windowEnd: number,           // window end (ms)
 *     updatedAt: number,           // last bot refresh (ms; bot rewrites every 2 min)
 *     senders: [{ uid, name, photoURL, diamonds }],  // ranked, most diamonds first
 *   }
 *
 * RENDERING RULES (boss law: no demo content, ever):
 * - Renders NOTHING (null) when there is no node, no senders, or the node
 *   is stale (updatedAt older than 10 min — a stale ranking is a wrong
 *   ranking, so it disappears instead of showing old data).
 * - Seconds tick UP from the node's last refresh (updatedAt): they reset
 *   whenever the bot refreshes (every 2 min by contract). The reference
 *   "243s" is rendered the same way; its exact server-side meaning beyond
 *   the tick is not grounded in Vee data and is NOT claimed here.
 * - "x1" is rendered exactly as arranged in the reference. Its exact
 *   semantic (multiplier? rank badge?) is NOT grounded in Vee data —
 *   it is display-only replication, pending the boss's explanation.
 * - DISPLAY-ONLY: this pill has NO tap handler. The boss has not yet
 *   explained what tapping it opens; no destination is invented and no
 *   dead-button illusion is created. Tap wiring lands when he explains it.
 *
 * BLOCKING GAPS (why the pill is hidden today — see parent report):
 * - VeeUser has NO country field anywhere (no code reads/writes one), so
 *   the owner's country cannot be resolved from real data yet.
 * - Gift history is per-room only (rooms/{roomId}/giftEvents, trimmed to
 *   the last 50 by VeeGuard) with no app-wide or hourly aggregation, so a
 *   trailing-1-hour cross-room ranking cannot be computed from live data.
 * A bot must (1) obtain/store each user's country, (2) record gift sends
 * durably with sender + value + timestamp, and (3) write grabTop/{roomId}
 * every 2 min. Until then this pill stays hidden — never faked.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, Image } from 'react-native';
import { ref, onValue } from 'firebase/database';
import { database } from '@/src/config/firebase';

export type GrabTopSender = {
  uid: string;
  name?: string | null;
  photoURL?: string | null;
  diamonds?: number | null;
};

export type GrabTopNode = {
  ownerCountry?: string | null;
  windowStart?: number | null;
  windowEnd?: number | null;
  updatedAt?: number | null;
  senders?: GrabTopSender[] | null;
};

const STALE_AFTER_MS = 10 * 60 * 1000;
const MAX_AVATARS = 3;

function SenderAvatar({ sender }: { sender: GrabTopSender }) {
  const uri = typeof sender.photoURL === 'string' && sender.photoURL ? sender.photoURL : null;
  const initial = (sender.name || '?').charAt(0).toUpperCase();
  return (
    <View
      style={{
        width: 18, height: 18, borderRadius: 9, overflow: 'hidden',
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: '#E5E7EB', marginLeft: -3,
      }}>
      {uri ? (
        <Image source={{ uri }} style={{ width: 18, height: 18 }} />
      ) : (
        <Text style={{ color: '#6B7280', fontSize: 10, fontWeight: '800' }}>{initial}</Text>
      )}
    </View>
  );
}

export default function GrabTopPill({ roomId }: { roomId: string }) {
  const [node, setNode] = useState<GrabTopNode | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!roomId) { setNode(null); return; }
    return onValue(ref(database, `grabTop/${roomId}`), (snap) => {
      setNode(snap.exists() ? (snap.val() as GrabTopNode) : null);
    });
  }, [roomId]);

  // Ticking seconds (local 1s interval; resets on every bot refresh).
  useEffect(() => {
    if (!node?.updatedAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [node?.updatedAt]);

  if (!roomId || !node || !node.updatedAt) return null;
  const senders = Array.isArray(node.senders) ? node.senders.filter((s) => s && typeof s.uid === 'string') : [];
  if (senders.length === 0) return null;
  if (Date.now() - node.updatedAt > STALE_AFTER_MS) return null;

  const elapsedSec = Math.max(0, Math.floor((now - node.updatedAt) / 1000));
  const shown = senders.slice(0, MAX_AVATARS);

  return (
    <View
      style={{
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: '#FFE7CC',
        borderRadius: 16, paddingHorizontal: 10, paddingVertical: 4,
        flexShrink: 0,
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 4 }}>
        {shown.map((s) => (
          <SenderAvatar key={s.uid} sender={s} />
        ))}
      </View>
      <Text style={{ color: '#F97316', fontSize: 12, fontWeight: '700', marginLeft: 6 }}>x1</Text>
      <Text style={{ color: '#F97316', fontSize: 12, fontWeight: '700', marginLeft: 8 }}>{elapsedSec}s</Text>
    </View>
  );
}
