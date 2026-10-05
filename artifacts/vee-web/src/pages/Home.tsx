import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider';

function SignInForm(): React.JSX.Element {
  const { user, loading, signIn, signOut } = useAuth();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const email = String(data.get('email') ?? '');
    const password = String(data.get('password') ?? '');
    await signIn(email, password);
    form.reset();
  }

  if (loading) {
    return <p className="muted">Checking sign-in…</p>;
  }

  if (user) {
    return (
      <div className="card">
        <p>
          Signed in as <strong>{user.displayName ?? user.email}</strong>
        </p>
        <button type="button" className="btn btn-ghost" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <form className="card" onSubmit={(e) => void handleSubmit(e)}>
      <h2>Sign in</h2>
      <label className="field">
        <span>Email</span>
        <input name="email" type="email" autoComplete="email" required />
      </label>
      <label className="field">
        <span>Password</span>
        <input name="password" type="password" autoComplete="current-password" required />
      </label>
      <button type="submit" className="btn btn-primary">
        Sign in
      </button>
    </form>
  );
}

export default function Home(): React.JSX.Element {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [callUid, setCallUid] = useState('');

  function handleCallSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const uid = callUid.trim();
    if (!uid || !user || uid === user.uid) return;
    navigate(`/call/${uid}?caller=1`);
  }

  return (
    <div className="page">
      <header className="hero">
        <h1>Vee</h1>
        <p className="muted">Social voice chat — rooms, calls and gifting.</p>
      </header>

      <SignInForm />

      {user !== null && (
        <>
          <nav className="links">
            <Link className="tile" to="/chat">
              💬 Chats
            </Link>
            <Link className="tile" to="/room/lobby">
              🎙 Voice room
            </Link>
            <Link className="tile" to="/wallet">
              💎 Wallet
            </Link>
          </nav>

          <form className="card" onSubmit={handleCallSubmit}>
            <h2>📞 Start a 1-to-1 call</h2>
            <label className="field">
              <span>Peer's user UID</span>
              <input
                value={callUid}
                onChange={(e) => setCallUid(e.target.value)}
                placeholder="Firebase UID of the person to call"
                autoComplete="off"
              />
            </label>
            <button type="submit" className="btn btn-primary">
              Call now
            </button>
          </form>
        </>
      )}
    </div>
  );
}
