import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { KeycloakProvider } from './components/KeycloakProvider';
import AuthGuard from './components/AuthGuard';
import AuthCallback from './components/AuthCallback';
import PrivatePage from './pages/PrivatePage';

function App() {
  return (
    <Router>
      <KeycloakProvider>
        <Routes>
          {/* Public routes */}
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/auth/error" element={<div>Authentication Error</div>} />
          <Route path="/auth/success" element={<AuthCallback />} />
          <Route path="/public" element={<div>Public Page</div>} />
          <Route path="/" element={<div>Home Page</div>} />
          
          {/* Protected routes - wrap the element with AuthGuard, not the Route itself */}
          <Route path="/private" element={
            <AuthGuard>
              <PrivatePage />
            </AuthGuard>
          }>
          </Route>
        </Routes>
      </KeycloakProvider>
    </Router>
  );
}

export default App;