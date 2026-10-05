/**
 * Gift-sending panel: catalog grid + recipient picker + fly animation.
 *
 * Flow (mirrors the native app):
 *  1. One POST /api/wallet/send-gift per recipient, with a FRESH idempotency
 *     key generated up-front per send attempt (retries reuse the same key).
 *  2. On success, best-effort push() to rooms/{roomId}/giftFeed (when a
 *     roomId is provided) so everyone in the room sees the receive banner.
 *  3. The sender-side fly animation plays, showing the recipient's avatar
 *     and name.
 */

import { useRef, useState } from 'react';
import { push, ref } from 'firebase/database';
import { rtdb } from '../../lib/firebase';
import { auth } from '../../lib/firebase';
import { ApiError } from '../../lib/api';
import { GIFT_CATALOG, giftById, type GiftItem } from './giftCatalog';
import { sendGift } from './walletService';
import { GiftAvatar, GiftFlyAnimation, type GiftFlyHandle } from './GiftFlyAnimation';

export type GiftRecipient = {
  uid: string;
  name: string;
  photoURL?: string;
};

export default function GiftPanel({
  roomId,
  recipients,
  fromName,
  fromAvatar,
  onSent,
}: {
  /** Voice-room id — enables the giftFeed push so the room sees the gift. */
  roomId?: string;
  /** Seat occupants for quick-pick (optional; uid input always available). */
  recipients?: GiftRecipient[];
  fromName: string;
  fromAvatar?: string;
  onSent?: () => void;
}): React.JSX.Element {
  const [selectedGift, setSelectedGift] = useState<GiftItem>(GIFT_CATALOG[0] as GiftItem);
  const [recipientUid, setRecipientUid] = useState('');
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const flyRef = useRef<GiftFlyHandle>(null);

  const myUid = auth.currentUser?.uid ?? '';

  function resolveRecipient(): GiftRecipient | null {
    const uid = recipientUid.trim();
    if (!uid) return null;
    const known = recipients?.find((r) => r.uid === uid);
    return known ?? { uid, name: uid.slice(0, 8) };
  }

  async function handleSend(): Promise<void> {
    const to = resolveRecipient();
    if (!to) {
      setIsError(true);
      setStatus('Pick a recipient first.');
      return;
    }
    if (to.uid === myUid) {
      setIsError(true);
      setStatus('You cannot send a gift to yourself.');
      return;
    }
    const gift = giftById(selectedGift.id);
    if (!gift) return;

    setSending(true);
    setIsError(false);
    setStatus('Sending…');
    // Fresh idempotency key per (recipient, gift) attempt, generated UP FRONT
    // so any retry of this attempt can never double-charge.
    const idempotencyKey = crypto.randomUUID();
    try {
      const result = await sendGift(to.uid, gift.id, idempotencyKey);

      // Best-effort giftFeed push AFTER the server confirmed the charge.
      if (roomId) {
        void push(ref(rtdb, `rooms/${roomId}/giftFeed`), {
          fromUid: myUid,
          fromName,
          toUid: to.uid,
          toName: to.name,
          giftId: gift.id,
          emoji: gift.emoji,
          coins: gift.coins,
          ts: Date.now(),
          ...(fromAvatar ? { fromAvatar } : {}),
          ...(to.photoURL ? { toAvatar: to.photoURL } : {}),
        }).catch(() => {
          /* best-effort — the gift itself already succeeded */
        });
      }

      flyRef.current?.playFly({
        fromName,
        fromAvatar,
        toUid: to.uid,
        toName: to.name,
        toAvatar: to.photoURL,
        giftId: gift.id,
        emoji: gift.emoji,
        coins: gift.coins,
        target: null, // graceful top-center landing (no seat coords on web)
      });

      setIsError(false);
      setStatus(
        result.replayed
          ? `Already sent — showing the original receipt.`
          : `Sent ${gift.emoji} ${gift.name} to ${to.name}!`,
      );
      onSent?.();
    } catch (e) {
      setIsError(true);
      setStatus(
        e instanceof ApiError
          ? e.message
          : e instanceof Error
            ? e.message
            : 'Gift failed to send.',
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="card gift-panel">
      <h2>🎁 Send a gift</h2>

      <div className="gift-grid">
        {GIFT_CATALOG.map((gift) => (
          <button
            key={gift.id}
            type="button"
            className={`gift-cell ${selectedGift.id === gift.id ? 'gift-cell-selected' : ''}`}
            onClick={() => setSelectedGift(gift)}
          >
            <span className="gift-cell-emoji">{gift.emoji}</span>
            <span className="gift-cell-name">{gift.name}</span>
            <span className="gift-cell-coins">💎{gift.coins}</span>
          </button>
        ))}
      </div>

      {recipients && recipients.length > 0 && (
        <div className="gift-recipients">
          {recipients
            .filter((r) => r.uid !== myUid)
            .map((r) => (
              <button
                key={r.uid}
                type="button"
                className={`gift-recipient ${recipientUid === r.uid ? 'gift-recipient-selected' : ''}`}
                onClick={() => setRecipientUid(r.uid)}
              >
                <GiftAvatar photoURL={r.photoURL} name={r.name} size={28} />
                <span>{r.name}</span>
              </button>
            ))}
        </div>
      )}

      <label className="field">
        <span>Recipient UID</span>
        <input
          value={recipientUid}
          onChange={(e) => setRecipientUid(e.target.value)}
          placeholder="Firebase UID of the recipient"
          autoComplete="off"
        />
      </label>

      <button
        type="button"
        className="btn btn-primary"
        onClick={() => void handleSend()}
        disabled={sending}
      >
        {sending ? 'Sending…' : `Send ${selectedGift.emoji} for 💎${selectedGift.coins}`}
      </button>

      {status && <p className={isError ? 'error-text' : 'muted'}>{status}</p>}

      <GiftFlyAnimation ref={flyRef} />
    </div>
  );
}
