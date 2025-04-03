import React, { createContext, useState, useEffect, ReactNode, useCallback } from 'react';
import axios from 'axios';

// Define a basic UserProfile interface
interface UserProfile {
  sub: string;
  name?: string;
  preferred_username?: string;
  given_name?: string;
  family_name?: string;
  email?: string;
  email_verified?: boolean;
}

interface KeycloakContextType {
  authenticated: boolean;
  loading: boolean;
  userProfile: UserProfile | null;
  login: () => void;
  logout: () => void;
}

export const KeycloakContext = createContext<KeycloakContextType | null>(null);

interface KeycloakProviderProps {
  children: ReactNode;
}

export const KeycloakProvider: React.FC<KeycloakProviderProps> = ({ children }) => {
  const [authenticated, setAuthenticated] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);

  // Check authentication status on mount
  useEffect(() => {
    const checkAuthStatus = async () => {
      try {
        setLoading(true);
        const response = await axios.get('/api/auth/status', { 
          withCredentials: true // This is crucial
        });
        
        if (response.data.authenticated) {
          setAuthenticated(true);
          setUserProfile(response.data.userProfile);
        } else {
          setAuthenticated(false);
          setUserProfile(null);
        }
      } catch (error) {
        console.error('Error checking auth status:', error);
        setAuthenticated(false);
        setUserProfile(null);
      } finally {
        setLoading(false);
      }
    };

    checkAuthStatus();
  }, []);

  // Login function
  const login = useCallback(async () => {
    try {
      setLoading(true);
      const response = await axios.get('/api/auth/login');
      window.location.href = response.data.authUrl;
    } catch (error) {
      console.error('Login error:', error);
      setLoading(false);
    }
  }, []);

  // Logout function
  const logout = useCallback(async () => {
    try {
      setLoading(true);
      await axios.post('/api/auth/logout', {}, { withCredentials: true });
      setAuthenticated(false);
      setUserProfile(null);
      window.location.href = '/';
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const contextValue: KeycloakContextType = {
    authenticated,
    loading,
    userProfile,
    login,
    logout
  };

  return (
    <KeycloakContext.Provider value={contextValue}>
      {children}
    </KeycloakContext.Provider>
  );
};
