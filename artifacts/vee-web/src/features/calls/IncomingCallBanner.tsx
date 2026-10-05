/**
 * Global incoming-call banner.
 *
 * Mounted once in the app Shell: watches `calls/{myUid}` and shows a
 * fixed banner whenever someone rings, from any screen. Accept navigates to
 * the call page as callee; Decline removes the invite (the caller's
 * no-answer timer ends their side).
 *
 * Hidden while already on a /call/* route — the CallPage handles the
 * invite there.
 */

import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { cancelCallInvite, subscribeIncomingCall, type IncomingCall } from './callsService';

export default function IncomingCallBanner(): React.JSX.Element | null {
  const { user, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<IncomingCall | null>(null);

  useEffect(() => {
    if (loading || !user) {
      setInvite(null);
      return;
    }
    return subscribeIncomingCall(user.uid, (next) => {
      // Ignore our own stale invite node and invites we created.
      setInvite(next && next.callerId !== user.uid ? next : null);
    });
  }, [loading, user]);

  const onCallRoute = location.pathname.startsWith('/call/');
  if (!invite || onCallRoute) return null;

  const handleAccept = (): void => {
    const callerId = invite.callerId;
    setInvite(null);
    navigate(`/call/${callerId}`);
  };

  const handleDecline = (): void => {
    if (!user) return;
    setInvite(null);
    // Contract: invite is removed on decline.
    void cancelCallInvite(user.uid).catch(() => {
      /* non-critical */
    });
  };

  return (
    <div className="incoming-call-banner" role="alert">
      <div className="incoming-call-info">
        {invite.callerPhotoURL ? (
          <img className="incoming-call-avatar" src={invite.callerPhotoURL} alt="" />
        ) : (
          <div className="incoming-call-avatar incoming-call-avatar-fallback">
            {(invite.callerName || '?').trim().charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <strong>{invite.callerName}</strong>
          <div className="muted">Incoming voice call…</div>
        </div>
      </div>
      <div className="incoming-call-actions">
        <button type="button" className="btn btn-primary" onClick={handleAccept}>
          ✅
        </button>
        <button type="button" className="btn btn-danger" onClick={handleDecline}>
          ❌
        </button>
      </div>
    </div>
  );
}
