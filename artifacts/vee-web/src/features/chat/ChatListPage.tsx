/** Chat list page — 1-to-1 DM threads from `userChats/{uid}`. */

import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import {
  createOrGetChat,
  subscribeUserChats,
  type ChatListEntry,
} from './dmService';

function formatTime(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function ChatListPage(): React.JSX.Element {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [chats, setChats] = useState<ChatListEntry[]>([]);
  const [peerUid, setPeerUid] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading || !user) return;
    return subscribeUserChats(user.uid, setChats);
  }, [loading, user]);

  async function handleStartChat(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!user || starting) return;
    const target = peerUid.trim();
    if (!target || target === user.uid) {
      setError("Enter another user's UID.");
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const chatId = await createOrGetChat(
        user.uid,
        user.displayName ?? user.email ?? 'Vee user',
        target,
        'Unknown',
      );
      setPeerUid('');
      navigate(`/chat/${chatId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the chat.');
    } finally {
      setStarting(false);
    }
  }

  if (loading) {
    return (
      <div className="page">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="page">
        <div className="card">
          <p>
            Sign in to see your chats. <Link to="/">Go to sign-in</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="hero">
        <h1>💬 Chats</h1>
        <p className="muted">Your 1-to-1 conversations.</p>
      </header>

      <form className="card" onSubmit={(e) => void handleStartChat(e)}>
        <h2>Start a chat</h2>
        <label className="field">
          <span>Peer's user UID</span>
          <input
            value={peerUid}
            onChange={(e) => setPeerUid(e.target.value)}
            placeholder="Firebase UID of the other person"
            autoComplete="off"
          />
        </label>
        <button type="submit" className="btn btn-primary" disabled={starting}>
          {starting ? 'Starting…' : 'Open chat'}
        </button>
        {error && <p className="error-text">{error}</p>}
      </form>

      <div className="card chat-list">
        {chats.length === 0 ? (
          <p className="muted">No chats yet. Start one above.</p>
        ) : (
          chats.map((chat) => (
            <Link key={chat.id} className="chat-row" to={`/chat/${chat.id}`}>
              <div className="chat-row-main">
                <div className="chat-row-top">
                  <strong>{chat.participantName}</strong>
                  <span className="muted chat-time">{formatTime(chat.lastMessageTime)}</span>
                </div>
                <div className="chat-row-bottom">
                  <span className="muted chat-preview">
                    {chat.lastMessage || <em>No messages yet</em>}
                  </span>
                  {chat.unreadCount > 0 && (
                    <span className="chat-unread">{chat.unreadCount}</span>
                  )}
                </div>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
