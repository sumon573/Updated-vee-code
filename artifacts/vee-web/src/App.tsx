import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import Home from './pages/Home';
import Room from './pages/Room';
import Call from './pages/Call';
import Wallet from './pages/Wallet';
import TopUpPage from './pages/TopUpPage';
import ChatListPage from './features/chat/ChatListPage';
import ChatThreadPage from './features/chat/ChatThreadPage';
import IncomingCallBanner from './features/calls/IncomingCallBanner';

function Shell(): React.JSX.Element {
  return (
    <div className="shell">
      <IncomingCallBanner />
      <nav className="tabbar">
        <NavLink to="/" end className="tab">
          🏠
        </NavLink>
        <NavLink to="/chat" className="tab">
          💬
        </NavLink>
        <NavLink to="/room/lobby" className="tab">
          🎙
        </NavLink>
        <NavLink to="/wallet" className="tab">
          💎
        </NavLink>
      </nav>
      <main className="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/room/:roomId" element={<Room />} />
          <Route path="/call/:roomId" element={<Call />} />
          <Route path="/wallet" element={<Wallet />} />
          <Route path="/topup" element={<TopUpPage />} />
          <Route path="/chat" element={<ChatListPage />} />
          <Route path="/chat/:chatId" element={<ChatThreadPage />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App(): React.JSX.Element {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Shell />
      </BrowserRouter>
    </AuthProvider>
  );
}
