import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Onboarding from './pages/Onboarding';
import Dashboard from './pages/Dashboard';
import Send from './pages/Send';
import Receive from './pages/Receive';
import Swap from './pages/Swap';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Navigate to="/onboarding" replace />} />
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/dashboard" element={<Dashboard />} />
        
        {/* Apple Wallet Deep Links */}
        <Route path="/app/send" element={<Send />} />
        <Route path="/app/receive" element={<Receive />} />
        <Route path="/app/swap" element={<Swap />} />

        {/* Route aliases (some passes/links may use these paths) */}
        <Route path="/send" element={<Send />} />
        <Route path="/receive" element={<Receive />} />
        <Route path="/swap" element={<Swap />} />
      </Routes>
    </Router>
  );
}

export default App;
