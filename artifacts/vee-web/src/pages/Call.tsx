import { useParams, Link } from 'react-router-dom';
import CallPage from '../features/calls/CallPage';

/**
 * Route shell for /call/:roomId (:roomId = the peer's Firebase uid).
 * The real implementation lives in features/calls.
 */
export default function Call(): React.JSX.Element {
  const { roomId } = useParams<{ roomId: string }>();
  if (!roomId) {
    return (
      <div className="page">
        <div className="card">
          <p>No one to call.</p>
          <Link className="btn btn-ghost" to="/">
            ← Back home
          </Link>
        </div>
      </div>
    );
  }
  return <CallPage />;
}
