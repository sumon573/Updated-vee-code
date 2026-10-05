/** DM thread page — messages, typing indicator, presence, seen receipts. */

import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { get, ref } from 'firebase/database';
import { rtdb } from '../../lib/firebase';
import { useAuth } from '../../auth/AuthProvider';
import {
  markAllSeen,
  peerUidFromChatId,
  sendMessage,
  setTyping,
  subscribeMessages,
  subscribePresence,
  subscribeTyping,
  type DmMessage,
} from './dmService';

function MessageBubble({
  message,
  mine,
}: {
  message: DmMessage;
  mine: boolean;
}): React.JSX.Element {
  return (
    <div className={`msg ${mine ? 'msg-mine' : 'msg-theirs'}`}>
      {message.content ? (
        <p>{message.content}</p>
      ) : (
        <p className="muted">
          <em>This message was deleted.</em>
        </p>
      )}
      <div className="msg-meta">
        <span>
          {new Date(message.createdAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
        {mine && message.status === 'seen' && <span> ✓✓</span>}
        {Object.entries(message.reactions).map(([uid, emoji]) => (
          <span key={uid} className="msg-reaction">
            {emoji}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function ChatThreadPage(): React.JSX.Element {
  const { chatId } = useParams<{ chatId: string }>();
  const navigate = useNavigate();
  const { user, loading } = useAuth();

  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const [peerOnline, setPeerOnline] = useState(false);
  const [peerName, setPeerName] = useState('Chat');
  const [sendError, setSendError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const peerUid = user && chatId ? peerUidFromChatId(chatId, user.uid) : null;

  // Peer display name from the chat-list entry.
  useEffect(() => {
    if (!user || !chatId) return;
    let cancelled = false;
    void get(ref(rtdb, `userChats/${user.uid}/${chatId}`))
      .then((snap) => {
        if (cancelled || !snap.exists()) return;
        const v = snap.val() as { participantName?: string };
        if (typeof v.participantName === 'string' && v.participantName) {
          setPeerName(v.participantName);
        }
      })
      .catch(() => {
        /* non-critical */
      });
    return () => {
      cancelled = true;
    };
  }, [user, chatId]);

  // Messages + seen receipts + presence + typing.
  useEffect(() => {
    if (!user || !chatId || !peerUid) return;
    const unsubMsgs = subscribeMessages(chatId, user.uid, (next) => {
      setMessages(next);
      if (next.some((m) => m.senderId !== user.uid && m.status !== 'seen')) {
        void markAllSeen(chatId, user.uid).catch(() => {
          /* best-effort */
        });
      }
    });
    const unsubPresence = subscribePresence(peerUid, (online) => setPeerOnline(online));
    const unsubTyping = subscribeTyping(chatId, peerUid, setPeerTyping);
    return () => {
      unsubMsgs();
      unsubPresence();
      unsubTyping();
    };
  }, [user, chatId, peerUid]);

  // Keep the latest message in view.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, peerTyping]);

  async function handleSend(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!user || !chatId || !peerUid || sending || !draft.trim()) return;
    setSending(true);
    setSendError(null);
    setTyping(chatId, user.uid, false);
    try {
      await sendMessage(
        chatId,
        user.uid,
        user.displayName ?? user.email ?? 'Vee user',
        peerUid,
        draft,
      );
      setDraft('');
    } catch (e) {
      setSendError(e instanceof Error ? e.message : 'Message failed to send.');
    } finally {
      setSending(false);
    }
  }

  function handleDraftChange(value: string): void {
    setDraft(value);
    if (user && chatId && value.trim()) {
      setTyping(chatId, user.uid, true);
    }
  }

  if (loading) {
    return (
      <div className="page">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (!user || !chatId || !peerUid) {
    return (
      <div className="page">
        <div className="card">
          <p>Could not open this chat.</p>
          <Link className="btn btn-ghost" to="/chat">
            ← Back to chats
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page chat-thread">
      <header className="chat-header">
        <button type="button" className="btn btn-ghost" onClick={() => navigate('/chat')}>
          ←
        </button>
        <div className="chat-header-info">
          <strong>{peerName}</strong>
          <span className="muted">{peerOnline ? '🟢 online' : '⚪ offline'}</span>
        </div>
        <Link className="btn btn-ghost" to={`/call/${peerUid}`}>
          📞
        </Link>
      </header>

      <div className="msg-list">
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} mine={m.senderId === user.uid} />
        ))}
        {peerTyping && <div className="typing-indicator">typing…</div>}
        <div ref={bottomRef} />
      </div>

      {sendError && <p className="error-text">{sendError}</p>}

      <form className="msg-composer" onSubmit={(e) => void handleSend(e)}>
        <input
          value={draft}
          onChange={(e) => handleDraftChange(e.target.value)}
          placeholder="Type a message…"
          maxLength={2000}
          autoComplete="off"
        />
        <button type="submit" className="btn btn-primary" disabled={sending || !draft.trim()}>
          {sending ? '…' : 'Send'}
        </button>
      </form>
    </div>
  );
}
