require('dotenv').config();

const express = require('express');
const session = require('express-session');
const multer = require('multer');
const fetch = require('node-fetch');
const app = express();
const port = 3000;

// Middleware
app.use(express.static('public'));
app.use(session({
  secret: 'your-secret-key', // Replace with a secure secret in production
  resave: false,
  saveUninitialized: true,
}));
const upload = multer({ storage: multer.memoryStorage() });

// Environment variables (set these in your environment)
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const REDIRECT_URI = 'http://localhost:3000/callback';

// Add some debugging to verify they're loaded correctly
console.log('Environment variables loaded:');
console.log('- SPOTIFY_CLIENT_ID available:', !!SPOTIFY_CLIENT_ID);
console.log('- SPOTIFY_CLIENT_SECRET available:', !!SPOTIFY_CLIENT_SECRET);
console.log('- OPENAI_API_KEY available:', !!OPENAI_API_KEY);

// Spotify authentication route
app.get('/auth/spotify', (req, res) => {
  const scopes = 'streaming playlist-modify-private user-read-private';
  res.redirect('https://accounts.spotify.com/authorize' +
    '?response_type=code' +
    '&client_id=' + SPOTIFY_CLIENT_ID +
    '&scope=' + encodeURIComponent(scopes) +
    '&redirect_uri=' + encodeURIComponent(REDIRECT_URI));
});

// Callback route after Spotify authentication
app.get('/callback', async (req, res) => {
  const code = req.query.code;
  console.log('Received authorization code:', code ? 'Code received' : 'No code received');
  
  if (!code) {
    console.error('Error response from Spotify:', req.query);
    return res.status(400).send('Authorization failed: No code received');
  }
  
  const authOptions = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET).toString('base64'),
    },
    body: `grant_type=authorization_code&code=${code}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`,
  };
  
  try {
    console.log('Making token request to Spotify...');
    const response = await fetch('https://accounts.spotify.com/api/token', authOptions);
    const data = await response.json();
    
    if (data.error) {
      console.error('Spotify API error:', data.error, data.error_description);
      return res.status(400).send(`Authentication error: ${data.error_description || data.error}`);
    }
    
    console.log('Successfully received access token');
    req.session.accessToken = data.access_token;
    req.session.refreshToken = data.refresh_token;
    res.redirect('/');
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).send('Authentication failed');
  }
});

// Check authentication status
app.get('/check-auth', (req, res) => {
  res.json({ authenticated: !!req.session.accessToken });
});

// Provide access token to client
app.get('/get-token', (req, res) => {
  if (req.session.accessToken) {
    res.json({ accessToken: req.session.accessToken });
  } else {
    res.status(401).json({ error: 'Not authenticated' });
  }
});

// Handle image upload and playlist generation
app.post('/upload', upload.single('image'), async (req, res) => {
  if (!req.session.accessToken) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  try {
    // Convert image to base64
    const imageBuffer = req.file.buffer;
    const base64Image = imageBuffer.toString('base64');

    // Call OpenAI GPT-4o for aesthetic description
    const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              { 
                type: 'text', 
                text: 'Look at this image and suggest music that would match its aesthetic. Respond with ONLY a JSON object in the following format, with no additional text:\n\n' +
                      '{\n' +
                      '  "mood": {\n' +
                      '    "energy": 0.7,        // How energetic (0.0-1.0)\n' +
                      '    "valence": 0.5,       // How positive (0.0-1.0)\n' +
                      '    "danceability": 0.6,  // How danceable (0.0-1.0)\n' +
                      '    "acousticness": 0.3   // How acoustic (0.0-1.0)\n' +
                      '  },\n' +
                      '  "searchTerms": ["term1", "term2", "term3"],  // 3-5 specific search terms\n' +
                      '  "seedArtists": ["artist1", "artist2"],       // 2-3 well-known artists\n' +
                      '  "description": "A brief description of the image aesthetic"\n' +
                      '}\n\n' +
                      'Make sure to only return valid JSON with no markdown formatting, comments, or additional text.'
              },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } },
            ],
          },
        ],
        response_format: { type: "json_object" }
      }),
    });
    const openaiData = await openaiResponse.json();
    
    // Parse the JSON response
    let musicData;
    try {
      const content = openaiData.choices[0].message.content;
      console.log('Raw LLM response:', content);
      musicData = JSON.parse(content);
      console.log('Parsed music data:', musicData);
    } catch (error) {
      console.error('Error parsing LLM response:', error);
      return res.status(500).json({ error: 'Failed to parse AI response', details: error.message });
    }
    
    // Extract values from the parsed JSON
    const { mood, searchTerms, seedArtists, description } = musicData;
    
    console.log('Extracted parameters:');
    console.log('- Search Terms:', searchTerms);
    console.log('- Seed Artists:', seedArtists);
    console.log('- Energy:', mood.energy);
    console.log('- Valence:', mood.valence);
    console.log('- Danceability:', mood.danceability);
    console.log('- Acousticness:', mood.acousticness);
    console.log('- Description:', description);

    // Collect tracks using search API
    let allTracks = [];
    const tracksNeeded = 20;
    
    // First, search for tracks by the seed artists
    for (const artist of seedArtists) {
      if (allTracks.length >= tracksNeeded) break;
      
      try {
        const searchResponse = await fetch(
          `https://api.spotify.com/v1/search?q=artist:${encodeURIComponent(artist)}&type=track&limit=10`,
          { headers: { 'Authorization': `Bearer ${req.session.accessToken}` } }
        );
        
        if (!searchResponse.ok) {
          console.warn(`Search for artist "${artist}" failed:`, await searchResponse.text());
          continue;
        }
        
        const searchData = await searchResponse.json();
        if (searchData.tracks && searchData.tracks.items.length > 0) {
          // Add tracks, avoiding duplicates
          for (const track of searchData.tracks.items) {
            if (!allTracks.some(t => t.id === track.id)) {
              allTracks.push(track);
              if (allTracks.length >= tracksNeeded) break;
            }
          }
        }
      } catch (error) {
        console.error(`Error searching for artist "${artist}":`, error);
      }
    }
    
    // Then, search using the search terms
    for (const term of searchTerms) {
      if (allTracks.length >= tracksNeeded) break;
      
      try {
        const searchResponse = await fetch(
          `https://api.spotify.com/v1/search?q=${encodeURIComponent(term)}&type=track&limit=10`,
          { headers: { 'Authorization': `Bearer ${req.session.accessToken}` } }
        );
        
        if (!searchResponse.ok) {
          console.warn(`Search for term "${term}" failed:`, await searchResponse.text());
          continue;
        }
        
        const searchData = await searchResponse.json();
        if (searchData.tracks && searchData.tracks.items.length > 0) {
          // Add tracks, avoiding duplicates
          for (const track of searchData.tracks.items) {
            if (!allTracks.some(t => t.id === track.id)) {
              allTracks.push(track);
              if (allTracks.length >= tracksNeeded) break;
            }
          }
        }
      } catch (error) {
        console.error(`Error searching for term "${term}":`, error);
      }
    }
    
    // If we still don't have enough tracks, do a generic search based on mood
    if (allTracks.length < tracksNeeded) {
      let moodTerm = '';
      if (mood.energy > 0.7) moodTerm += 'energetic ';
      else if (mood.energy < 0.3) moodTerm += 'calm ';
      
      if (mood.valence > 0.7) moodTerm += 'happy ';
      else if (mood.valence < 0.3) moodTerm += 'sad ';
      
      if (mood.acousticness > 0.7) moodTerm += 'acoustic ';
      
      if (!moodTerm) moodTerm = 'popular';
      
      try {
        const searchResponse = await fetch(
          `https://api.spotify.com/v1/search?q=${encodeURIComponent(moodTerm.trim())}&type=track&limit=${tracksNeeded - allTracks.length}`,
          { headers: { 'Authorization': `Bearer ${req.session.accessToken}` } }
        );
        
        if (searchResponse.ok) {
          const searchData = await searchResponse.json();
          if (searchData.tracks && searchData.tracks.items.length > 0) {
            // Add tracks, avoiding duplicates
            for (const track of searchData.tracks.items) {
              if (!allTracks.some(t => t.id === track.id)) {
                allTracks.push(track);
                if (allTracks.length >= tracksNeeded) break;
              }
            }
          }
        }
      } catch (error) {
        console.error(`Error searching for mood term "${moodTerm}":`, error);
      }
    }
    
    console.log(`Collected ${allTracks.length} tracks for playlist`);
    
    if (allTracks.length === 0) {
      return res.status(404).json({ error: 'No tracks found for the given image' });
    }

    // Get user ID
    const userResponse = await fetch('https://api.spotify.com/v1/me', {
      headers: { 'Authorization': `Bearer ${req.session.accessToken}` },
    });
    const userData = await userResponse.json();
    const userId = userData.id;

    // Create playlist
    const createPlaylistResponse = await fetch(`https://api.spotify.com/v1/users/${userId}/playlists`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${req.session.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Aesthetic Playlist from Image',
        description: `Based on the image aesthetic: ${description}`,
        public: false,
      }),
    });
    const playlistData = await createPlaylistResponse.json();
    const playlistId = playlistData.id;

    // Add tracks to playlist
    await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${req.session.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        uris: allTracks.map(track => track.uri) 
      }),
    });

    // Prepare track details for display
    const tracks = allTracks.map(track => ({
      name: track.name,
      artist: track.artists[0].name,
    }));

    res.json({ playlistId, tracks });
  } catch (error) {
    console.error('Error processing upload:', error);
    res.status(500).json({ error: 'Internal server error', message: error.message });
  }
});

// Add a diagnostic endpoint to test token validity
app.get('/test-token', async (req, res) => {
  if (!req.session.accessToken) {
    return res.status(401).json({ error: 'No access token in session' });
  }
  
  try {
    // Log token details (safely)
    const token = req.session.accessToken;
    console.log('Testing token:', token.substring(0, 5) + '...' + token.substring(token.length - 5));
    
    // Test 1: Get user profile (basic test)
    console.log('Test 1: Getting user profile...');
    const userResponse = await fetch('https://api.spotify.com/v1/me', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    
    console.log('User profile status:', userResponse.status);
    const userResponseText = await userResponse.text();
    let userTest = { status: userResponse.status };
    
    try {
      userTest.data = JSON.parse(userResponseText);
    } catch (e) {
      userTest.rawResponse = userResponseText;
    }
    
    // Test 2: Get available genres
    console.log('Test 2: Getting available genres...');
    const genresResponse = await fetch('https://api.spotify.com/v1/recommendations/available-genre-seeds', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    
    console.log('Genres status:', genresResponse.status);
    const genresResponseText = await genresResponse.text();
    let genresTest = { status: genresResponse.status };
    
    try {
      genresTest.data = JSON.parse(genresResponseText);
    } catch (e) {
      genresTest.rawResponse = genresResponseText;
    }
    
    // Test 3: Get simple recommendations with default values
    console.log('Test 3: Getting simple recommendations...');
    const recsResponse = await fetch('https://api.spotify.com/v1/recommendations?limit=5&seed_genres=pop', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    
    console.log('Recommendations status:', recsResponse.status);
    const recsResponseText = await recsResponse.text();
    let recsTest = { status: recsResponse.status };
    
    try {
      recsTest.data = JSON.parse(recsResponseText);
    } catch (e) {
      recsTest.rawResponse = recsResponseText;
    }
    
    // Test 4: Check token expiration
    // Decode the token to check expiration (if it's a JWT)
    let tokenInfo = { type: 'unknown' };
    try {
      // JWT tokens have 3 parts separated by dots
      if (token.split('.').length === 3) {
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
        tokenInfo = {
          type: 'JWT',
          exp: payload.exp ? new Date(payload.exp * 1000).toISOString() : 'Not found',
          expiresIn: payload.exp ? Math.floor((payload.exp * 1000 - Date.now()) / 1000) + ' seconds' : 'Unknown'
        };
      }
    } catch (e) {
      tokenInfo.error = e.message;
    }
    
    // Return all test results
    res.json({
      tokenInfo,
      userTest,
      genresTest,
      recsTest,
      sessionData: {
        hasRefreshToken: !!req.session.refreshToken
      }
    });
    
  } catch (error) {
    console.error('Error in token test:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add a token refresh endpoint
app.get('/refresh-token', async (req, res) => {
  if (!req.session.refreshToken) {
    return res.status(400).json({ error: 'No refresh token available' });
  }
  
  try {
    const refreshToken = req.session.refreshToken;
    console.log('Attempting to refresh token...');
    
    const authOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + Buffer.from(process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET).toString('base64'),
      },
      body: `grant_type=refresh_token&refresh_token=${refreshToken}`,
    };
    
    const response = await fetch('https://accounts.spotify.com/api/token', authOptions);
    const data = await response.json();
    
    if (data.error) {
      console.error('Token refresh error:', data.error);
      return res.status(400).json({ error: data.error_description || data.error });
    }
    
    // Update the session with the new access token
    req.session.accessToken = data.access_token;
    if (data.refresh_token) {
      req.session.refreshToken = data.refresh_token;
    }
    
    console.log('Token refreshed successfully');
    res.json({ success: true, newTokenFirstChars: data.access_token.substring(0, 5) + '...' });
    
  } catch (error) {
    console.error('Error refreshing token:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});