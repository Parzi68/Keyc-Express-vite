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

// Function to fetch rainfall data
const getRainfallDataKathua = async (bottomlevel) => {
  try {
    // Query for daily rainfall
    const dailyResult = await pool.query(`
      SELECT SUM(totalrainfall) AS hourly_rainfall
FROM (
    SELECT totalrainfall 
    FROM tag.rainfall_in_half_hourly_kathua
    WHERE bucket >= NOW()::date AND source_id = '0001'
    ORDER BY bucket DESC
    LIMIT 2
) subquery;

    `);
    
    // Query for monthly rainfall
    const monthlyResult = await pool.query(`
      SELECT totalrainfall AS monthly_rainfall
FROM (
    SELECT totalrainfall 
    FROM tag.rainfall_in_monthly_kathua
    WHERE bucket >= NOW()::date AND source_id = '0001'
    ORDER BY bucket DESC
    LIMIT 1
) subquery;

    `);

    // Query for yearly rainfall
    const yearlyResult = await pool.query(`
           SELECT totalrainfall AS yearly_rainfall
FROM (
    SELECT totalrainfall 
    FROM tag.rainfall_in_yearly_kathua
    WHERE source_id = '0001'
    ORDER BY bucket DESC
    LIMIT 1
) subquery;
    `);

    const flowrate = await pool.query(`
      SELECT flowrate AS flowrate FROM tag.wms_live_data;
      `);

      const emptyHeight = await pool.query(`
        SELECT ($1 - emptyheightinmm) as water_level FROM tag.wms_live_data WHERE source_id = '0001' ORDER BY time DESC LIMIT 1;
      `, [bottomlevel]);

    return {
      dailyRainfall: dailyResult.rows[0]?.hourly_rainfall || 0,
      monthlyRainfall: monthlyResult.rows[0]?.monthly_rainfall || 0,
      yearlyRainfall: yearlyResult.rows[0]?.yearly_rainfall || 0,
      flowrate: flowrate.rows[0]?.flowrate || 0,
      emptyheightinmm: emptyHeight.rows[0]?.water_level || 0, // This is now water level, not empty height
    };
  } catch (error) {
    console.error("Database query error:", error);
    return { dailyRainfall: 0, monthlyRainfall: 0, yearlyRainfall: 0 };
  }
};

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

const getRainfallDataBillwar = async (bottomlevel) => {
  try {
    // Query for daily rainfall
    const dailyResult = await pool.query(`
      SELECT SUM(totalrainfall) AS hourly_rainfall
FROM (
    SELECT totalrainfall 
    FROM tag.rainfall_in_half_hourly_billwar
    WHERE bucket >= NOW()::date AND source_id = '0002'
    ORDER BY bucket DESC
    LIMIT 2
) subquery;

    `);
    
    // Query for monthly rainfall
    const monthlyResult = await pool.query(`
      SELECT totalrainfall AS monthly_rainfall
FROM (
    SELECT totalrainfall 
    FROM tag.rainfall_in_monthly_billwar
    WHERE bucket >= NOW()::date AND source_id = '0002'
    ORDER BY bucket DESC
    LIMIT 1
) subquery;

    `);

    // Query for yearly rainfall
    const yearlyResult = await pool.query(`
           SELECT totalrainfall AS yearly_rainfall
FROM (
    SELECT totalrainfall 
    FROM tag.rainfall_in_yearly_billwar
    WHERE source_id = '0002'
    ORDER BY bucket DESC
    LIMIT 1
) subquery;
    `);

    // const flowrate = await pool.query(`
    //   SELECT flowrate AS flowrate FROM tag.wms_live_data;
    //   `);

      const emptyHeight = await pool.query(`
        SELECT ($1 - emptyheightinmm) as water_level FROM tag.wms_live_data WHERE source_id = '0002' ORDER BY time DESC LIMIT 1;
      `, [bottomlevel]);

    return {
      dailyRainfall: dailyResult.rows[0]?.hourly_rainfall || 0,
      monthlyRainfall: monthlyResult.rows[0]?.monthly_rainfall || 0,
      yearlyRainfall: yearlyResult.rows[0]?.yearly_rainfall || 0,
      // flowrate: flowrate.rows[0]?.flowrate || 0,
      emptyheightinmm: emptyHeight.rows[0]?.water_level || 0, // This is now water level, not empty height
    };
  } catch (error) {
    console.error("Database query error:", error);
    return { dailyRainfall: 0, monthlyRainfall: 0, yearlyRainfall: 0 };
  }
};



/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////



// API Route
app.get("/rainfall-kathua", async (req, res) => {
  try {
    const { bottomlevel = 1550 } = req.query; // Get bottomlevel from query parameters, default to 1500
    const rainfallData = await getRainfallDataKathua(Number(bottomlevel));
    res.json(rainfallData);
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.get("/rainfall-billwar", async (req, res) => {
  try {
    const { bottomlevel = 1550 } = req.query; // Get bottomlevel from query parameters, default to 1500
    const rainfallData = await getRainfallDataBillwar(Number(bottomlevel));
    res.json(rainfallData);
  } catch (error) {
    res.status(500).json({ error: "Internal Server Error" });
  }
});



// Start server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

// Endpoint to fetch half-hourly rainfall data
app.get("/half-hourly-rainfall-kathua", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        bucket,
        totalrainfall
      FROM tag.rainfall_in_half_hourly_kathua
      WHERE bucket::date = NOW()::date AND source_id = '0001'
      ORDER BY bucket ASC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching half-hourly rainfall data:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});


app.get("/half-hourly-rainfall-billwar", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        bucket,
        totalrainfall
      FROM tag.rainfall_in_half_hourly_billwar
      WHERE bucket::date = NOW()::date AND source_id = '0002'
      ORDER BY bucket ASC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching half-hourly rainfall data:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});



// Endpoint to fetch monthly rainfall data
app.get("/monthly-rainfall-kathua", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        bucket,
        totalrainfall
      FROM tag.rainfall_in_monthly_kathua
      WHERE EXTRACT(MONTH FROM bucket) = EXTRACT(MONTH FROM NOW()) AND EXTRACT(YEAR FROM bucket) = EXTRACT(YEAR FROM NOW()) AND source_id = '0001'
      ORDER BY bucket ASC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching monthly rainfall data:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});


app.get("/monthly-rainfall-billwar", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        bucket,
        totalrainfall
      FROM tag.rainfall_in_monthly_billwar
      WHERE EXTRACT(MONTH FROM bucket) = EXTRACT(MONTH FROM NOW()) AND EXTRACT(YEAR FROM bucket) = EXTRACT(YEAR FROM NOW()) AND source_id = '0002'
      ORDER BY bucket ASC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching monthly rainfall data:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Endpoint to fetch yearly rainfall data (daily)
app.get("/yearly-rainfall-kathua", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        DATE_TRUNC('month', bucket) AS bucket,
        SUM(totalrainfall) AS totalrainfall
      FROM tag.rainfall_in_yearly_kathua
      WHERE EXTRACT(YEAR FROM bucket) = EXTRACT(YEAR FROM NOW()) AND source_id = '0001'
      GROUP BY bucket
      ORDER BY bucket ASC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching yearly rainfall data:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});


app.get("/yearly-rainfall-billwar", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        DATE_TRUNC('month', bucket) AS bucket,
        SUM(totalrainfall) AS totalrainfall
      FROM tag.rainfall_in_yearly_billwar
      WHERE EXTRACT(YEAR FROM bucket) = EXTRACT(YEAR FROM NOW()) AND source_id = '0002'
      GROUP BY bucket
      ORDER BY bucket ASC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching yearly rainfall data:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Endpoint to fetch historical data for Kathua
app.get("/historical-data-kathua", async (req, res) => {
  try {
    const { days = 7 } = req.query; // Default to 7 days
    const result = await pool.query(`
      SELECT 
        time, 
        (1550 - emptyheightinmm) as water_level, 
        flowrate, 
        liquidlevelinmm, 
        rainfallonthedaycnt 
      FROM tag.wms_live_data 
      WHERE source_id = '0001' AND time >= NOW() - INTERVAL '${days} days'
      ORDER BY time ASC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching historical data for Kathua:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});
// Endpoint to fetch water level data for Kathua
app.get("/water-level-kathua", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT bucket, source_id, water_level
FROM (
    SELECT 
        bucket,
        source_id,
        last_emptyheight - LAG(last_emptyheight) 
            OVER (PARTITION BY source_id ORDER BY bucket) AS water_level
    FROM tag.water_level_half_hourly_aggregate_kathua
    WHERE bucket::date = NOW()::date  -- Filter for the current day
        AND source_id = '0001'        -- Filter for Kathua source ID
) sub
WHERE water_level IS NOT NULL AND water_level >= 0
ORDER BY bucket ASC;

    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching water level data:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Endpoint to fetch historical data for Billawar
app.get("/historical-data-billawar", async (req, res) => {
  try {
    const { days = 7 } = req.query; // Default to 7 days
    const result = await pool.query(`
      SELECT 
        time, 
        COALESCE((2850 - emptyheightinmm), 0) as water_level, 
        COALESCE(flowrate, 0) as flowrate, 
        COALESCE(liquidlevelinmm, 0) as liquidlevelinmm, 
        COALESCE(rainfallonthedaycnt, 0) as rainfallonthedaycnt 
      FROM tag.wms_live_data 
      WHERE source_id = '0002' AND time >= NOW() - INTERVAL '${days} days'
      ORDER BY time ASC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching historical data for Billawar:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});
// Endpoint to fetch water level data for Kathua
app.get("/water-level-billwar", async (req, res) => {
  try {
    const result = await pool.query(`
       SELECT bucket, source_id, water_level
FROM (
    SELECT 
        bucket,
        source_id,
        last_emptyheight - LAG(last_emptyheight) 
            OVER (PARTITION BY source_id ORDER BY bucket) AS water_level
    FROM tag.water_level_half_hourly_aggregate_billwar
    WHERE bucket::date = NOW()::date  -- Filter for the current day
        AND source_id = '0002'        -- Filter for billwar source ID
) sub
WHERE water_level IS NOT NULL AND water_level >= 0
ORDER BY bucket ASC;
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching water level data:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});


// Endpoint to fetch device metadata - optimized version
app.get("/devices-metadata", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT ON (source_id)
        time,
        host,
        altitude,
        datetime,
        latitude,
        location_name,
        longitude,
        vndid,
        source_id,
        sensor1,
        sensor2
      FROM tag.wms_metadata
      ORDER BY source_id, time DESC
    `);
    
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching device metadata:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});// Endpoint to fetch monthly water level data for Kathua
app.get("/monthly-water-level-kathua", async (req, res) => {
  try {
    console.log("Fetching monthly water level data for Kathua...");
    const result = await pool.query(`
SELECT date, source_id, water_level
FROM (
    SELECT 
        bucket AS date,
        source_id,
        last_emptyheight - LAG(last_emptyheight) 
            OVER (PARTITION BY source_id ORDER BY bucket) AS water_level
    FROM tag.water_level_daily_aggregate_kathua
) sub
WHERE water_level IS NOT NULL 
    AND water_level >= 0 
    AND EXTRACT(MONTH FROM date) = EXTRACT(MONTH FROM CURRENT_DATE) 
    AND EXTRACT(YEAR FROM date) = EXTRACT(YEAR FROM CURRENT_DATE)
ORDER BY date ASC;




    `);
    console.log("Kathua monthly water level data:", result.rows);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching monthly water level data for Kathua:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Endpoint to fetch monthly water level data for Billwar
app.get("/monthly-water-level-billwar", async (req, res) => {
  try {
    console.log("Fetching monthly water level data for Billwar...");
    const result = await pool.query(`
      SELECT date, source_id, water_level
FROM (
    SELECT 
        bucket AS date,
        source_id,
        last_emptyheight - LAG(last_emptyheight) 
            OVER (PARTITION BY source_id ORDER BY bucket) AS water_level
    FROM tag.water_level_daily_aggregate_billwar
) sub
WHERE water_level IS NOT NULL 
    AND water_level >= 0 
    AND EXTRACT(MONTH FROM date) = EXTRACT(MONTH FROM CURRENT_DATE) 
    AND EXTRACT(YEAR FROM date) = EXTRACT(YEAR FROM CURRENT_DATE)
ORDER BY date ASC;
    `);
    console.log("Billwar monthly water level data:", result.rows);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching monthly water level data for Billwar:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Endpoint for yearly water level data for Kathua
app.get('/yearly-water-level-kathua', async (req, res) => {
  try {
    const result = await pool.query(`
    SELECT date, source_id, water_level
FROM (
    SELECT 
        DATE_TRUNC('month', bucket) AS date,
        source_id,
        last_emptyheight - LAG(last_emptyheight) 
            OVER (PARTITION BY source_id ORDER BY bucket) AS water_level
    FROM tag.water_level_monthly_aggregate_kathua
) sub
WHERE water_level IS NOT NULL AND water_level >= 0
ORDER BY date ASC;

    `);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching yearly water level data for Kathua:', error);
    res.status(500).json({ 
      error: 'Failed to fetch yearly water level data for Kathua', 
      details: error.message
    });
  }
});

// Endpoint for yearly water level data for Billwar
app.get('/yearly-water-level-billwar', async (req, res) => {
  try {
    const result = await pool.query(`
       SELECT date, source_id, water_level
FROM (
    SELECT 
        DATE_TRUNC('month', bucket) AS date,
        source_id,
        last_emptyheight - LAG(last_emptyheight) 
            OVER (PARTITION BY source_id ORDER BY bucket) AS water_level
    FROM tag.water_level_monthly_aggregate_billwar
) sub
WHERE water_level IS NOT NULL AND water_level >= 0
ORDER BY date ASC;
    `);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching yearly water level data:', error);
    res.status(500).json({ 
      error: 'Failed to fetch yearly water level data', 
      details: error.message
    });
  }
});