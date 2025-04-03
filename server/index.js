require('dotenv').config();
const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");

// Add these imports at the top
const axios = require('axios');
const session = require('express-session');
const cookieParser = require('cookie-parser');

const KEYCLOAK_URL = process.env.KEYCLOAK_URL;
const REALM = process.env.KEYCLOAK_REALM;
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID;
const CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL;
// process.env.NODE_ENV === 'production' 
  // ? 'https://your-production-domain.com' 
  // : 'http://localhost:5173';
const REDIRECT_URI = `${FRONTEND_URL}/auth/callback`;

const app = express();
const port = 5000;



// Configure CORS properly
app.use(cors({
  // origin: 'http://localhost:4173', // Your frontend URL
  origin:  FRONTEND_URL,
  credentials: true // This is important for cookies
}));
app.use(express.json());

// PostgreSQL connection
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// Configure middleware for sessions and cookies
app.use(cookieParser());
app.use(session({
  secret: process.env.SESSION_SECRET || 'river-watch-session-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production', // true in production
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    sameSite: 'lax',
    // Important: set the domain if needed
    // domain: 'localhost'
  }
}));

// Add this route to your Express server
app.get("/auth/token", (req, res) => {
  if (!req.session.authenticated || !req.session.accessToken) {
    console.log("Auth token request - not authenticated");
    return res.status(401).json({ error: 'Not authenticated' });
  }
  
  console.log("Auth token request - sending token");
  // Make sure the token is returned exactly in this format
  res.json({ token: req.session.accessToken });
});

// Add this endpoint to check session status
app.get("/auth/debug", (req, res) => {
  console.log("Session data:", req.session);
  res.json({
    sessionId: req.sessionID,
    authenticated: req.session.authenticated || false,
    hasUserProfile: !!req.session.userProfile,
    hasAccessToken: !!req.session.accessToken,
    cookies: req.cookies
  });
});

// Authentication endpoints
app.get("/auth/login", (req, res) => {
  // Generate random state for CSRF protection
  const state = require('crypto').randomBytes(16).toString('hex');
  const nonce = require('crypto').randomBytes(16).toString('hex');
  
  // Store state in session
  req.session.authState = state;
  req.session.authNonce = nonce;
  
  const authUrl = new URL(`${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/auth`);
  authUrl.searchParams.append('client_id', CLIENT_ID);
  authUrl.searchParams.append('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.append('response_type', 'code');
  authUrl.searchParams.append('scope', 'openid profile email');
  authUrl.searchParams.append('state', state);
  authUrl.searchParams.append('nonce', nonce);
  
  res.json({ authUrl: authUrl.toString() });
});

app.get("/auth/callback", async (req, res) => {
  const { code, state } = req.query;
  console.log("Received callback with code:", code ? "Yes" : "No");
  console.log("State from query:", state);
  console.log("State from session:", req.session.authState);
  
  // Verify state to prevent CSRF
  if (!state || state !== req.session.authState) {
    return res.status(400).json({ error: 'Invalid state parameter' });
  }
  
  try {
    // Exchange code for tokens
    const tokenResponse = await axios.post(
      `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token`,
      new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        redirect_uri: REDIRECT_URI
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );
    // Before redirecting, log the session
  console.log("Session after authentication:", {
    authenticated: req.session.authenticated,
    hasUserProfile: !!req.session.userProfile,
    hasAccessToken: !!req.session.accessToken
  });
    const { access_token, refresh_token, id_token } = tokenResponse.data;
    
    // Store tokens in session (server-side)
    req.session.accessToken = access_token;
    req.session.refreshToken = refresh_token;
    req.session.idToken = id_token;
    
    // Get user profile
    const userResponse = await axios.get(
      `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/userinfo`,
      {
        headers: {
          Authorization: `Bearer ${access_token}`
        }
      }
    );
    
    // Store user profile in session
    req.session.userProfile = userResponse.data;
    req.session.authenticated = true;
    
    // Redirect to frontend
    res.redirect(`${FRONTEND_URL}/auth/success`);
  } catch (error) {
    console.error('Token exchange error:', error.response?.data || error.message);
    res.redirect(`${FRONTEND_URL}/auth/error`);
  }
});

app.get("/auth/status", (req, res) => {
  console.log("Checking auth status. Session authenticated:", req.session.authenticated);
  console.log("Session ID:", req.sessionID);
  
  if (req.session.authenticated && req.session.userProfile) {
    res.json({
      authenticated: true,
      userProfile: req.session.userProfile
    });
  } else {
    res.json({
      authenticated: false,
      userProfile: null
    });
  }
});

app.post("/auth/logout", async (req, res) => {
  try {
    // Call Keycloak logout endpoint
    if (req.session.refreshToken) {
      await axios.post(
        `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/logout`,
        new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          refresh_token: req.session.refreshToken
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );
    }
    
    // Clear session
    req.session.destroy((err) => {
      if (err) {
        console.error('Error destroying session:', err);
      }
      res.json({ success: true });
    });
  } catch (error) {
    console.error('Logout error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Logout failed' });
  }
});

// Token refresh endpoint
app.post("/auth/refresh", async (req, res) => {
  if (!req.session.refreshToken) {
    return res.status(401).json({ error: 'No refresh token available' });
  }
  
  try {
    const response = await axios.post(
      `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/token`,
      new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: req.session.refreshToken
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );
    
    const { access_token, refresh_token } = response.data;
    
    // Update tokens in session
    req.session.accessToken = access_token;
    if (refresh_token) {
      req.session.refreshToken = refresh_token;
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Token refresh error:', error.response?.data || error.message);
    req.session.authenticated = false;
    res.status(401).json({ error: 'Failed to refresh token' });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
