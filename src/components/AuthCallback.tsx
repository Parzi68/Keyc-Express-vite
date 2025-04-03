import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';

const AuthCallback: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleCallback = async () => {
      const params = new URLSearchParams(location.search);
      const code = params.get('code');
      const state = params.get('state');
      
      if (!code) {
        setError('No authorization code received');
        return;
      }
      
      try {
        // Send the code to your backend
        await axios.get(`/api/auth/callback?code=${code}&state=${state}`, {
          withCredentials: true
        });
        
        // After successful authentication, redirect to home
        navigate('/');
      } catch (err) {
        console.error('Error during authentication callback:', err);
        setError('Authentication failed');
      }
    };
    
    handleCallback();
  }, [location, navigate]);

  if (error) {
    return (
      <div className="flex justify-center items-center h-screen">
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
          <p>Authentication error: {error}</p>
          <button 
            onClick={() => navigate('/')}
            className="mt-2 bg-red-500 hover:bg-red-600 text-white font-medium py-1 px-2 rounded"
          >
            Return to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-center items-center h-screen">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      <p className="ml-3">Completing authentication...</p>
    </div>
  );
};

export default AuthCallback;
