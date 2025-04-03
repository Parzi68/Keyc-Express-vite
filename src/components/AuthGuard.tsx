import React, { useEffect } from 'react';
import { useKeycloak } from '../hooks/useKeycloak';

interface AuthGuardProps {
  children: React.ReactNode;
}

const AuthGuard: React.FC<AuthGuardProps> = ({ children }) => {
  const { loading, authenticated, login } = useKeycloak();

  // Automatically redirect to login if not authenticated
  useEffect(() => {
    if (!loading && !authenticated) {
      login();
    }
  }, [loading, authenticated, login]);

  if (loading) {
    return <div className="flex justify-center items-center h-screen">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
    </div>;
  }

  // If not authenticated, show a simple loading message
  // The useEffect above will trigger the redirect
  if (!authenticated) {
    return <div className="flex justify-center items-center h-screen">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      <p className="ml-3">Redirecting to login...</p>
    </div>;
  }

  return <>{children}</>;
};

export default AuthGuard;
