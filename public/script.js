document.addEventListener('DOMContentLoaded', () => {
  // UI Elements
  const loginButton = document.getElementById('login-button');
  const loginDiv = document.getElementById('login');
  const uploadDiv = document.getElementById('upload');
  const playlistDiv = document.getElementById('playlist');
  const trackList = document.getElementById('track-list');
  const imageInput = document.getElementById('image-input');
  const imagePreview = document.getElementById('image-preview');
  const generateButton = document.getElementById('generate-button');
  const loadingDiv = document.getElementById('loading');
  const playerContainer = document.getElementById('player-container');
  const currentTrackName = document.getElementById('current-track-name');
  const currentTrackArtist = document.getElementById('current-track-artist');
  const playPauseButton = document.getElementById('play-pause-button');
  const previousButton = document.getElementById('previous-button');
  const nextButton = document.getElementById('next-button');

  // Spotify Player
  let player;
  let deviceId;
  let currentPlaylistId;
  let tracks = [];
  let currentTrackIndex = -1;
  let isPlaying = false;
  let playerReady = false;

  // Check if user is authenticated
  const checkAuth = async () => {
    try {
      const response = await fetch('/check-auth');
      const data = await response.json();
      if (data.authenticated) {
        loginDiv.classList.add('hidden');
        uploadDiv.classList.remove('hidden');
        // Initialize player when authenticated
        initializePlayer();
      } else {
        loginDiv.classList.remove('hidden');
        uploadDiv.classList.add('hidden');
      }
    } catch (error) {
      console.error('Error checking authentication:', error);
    }
  };

  // Handle login button click
  loginButton.addEventListener('click', () => {
    window.location.href = '/auth/spotify';
  });

  // Handle image input change
  imageInput.addEventListener('change', () => {
    const file = imageInput.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        imagePreview.src = e.target.result;
        imagePreview.style.display = 'block';
        generateButton.disabled = false;
      };
      reader.readAsDataURL(file);
    } else {
      imagePreview.style.display = 'none';
      generateButton.disabled = true;
    }
  });

  // Handle generate button click
  generateButton.addEventListener('click', async () => {
    const file = imageInput.files[0];
    if (!file) {
      alert('Please select an image.');
      return;
    }

    // Show loading state
    generateButton.disabled = true;
    loadingDiv.classList.remove('hidden');

    const formData = new FormData();
    formData.append('image', file);

    try {
      const response = await fetch('/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Error generating playlist');
      }

      const data = await response.json();
      
      // Store tracks and playlist ID
      tracks = data.tracks;
      currentPlaylistId = data.playlistId;
      
      // Display tracks
      renderTracks();
      
      // Show playlist section
      playlistDiv.classList.remove('hidden');
      playerContainer.classList.remove('hidden');
      
      // Make sure player is initialized
      if (!playerReady) {
        console.log('Player not ready yet, initializing...');
        initializePlayer();
      } else {
        console.log('Player is ready, device ID:', deviceId);
      }
      
      // Scroll to playlist section
      playlistDiv.scrollIntoView({ behavior: 'smooth' });
      
    } catch (error) {
      console.error('Error:', error);
      alert(error.message || 'Error generating playlist.');
    } finally {
      // Hide loading state
      loadingDiv.classList.add('hidden');
      generateButton.disabled = false;
    }
  });

  // Render tracks in the track list
  const renderTracks = () => {
    trackList.innerHTML = '';
    
    tracks.forEach((track, index) => {
      const li = document.createElement('li');
      li.className = 'track-item';
      if (index === currentTrackIndex) {
        li.classList.add('playing');
      }
      
      li.innerHTML = `
        <div class="track-number">${index + 1}</div>
        <div class="track-info">
          <div class="track-name">${track.name}</div>
          <div class="track-artist">${track.artist}</div>
        </div>
        <div class="track-controls">
          <button class="play-button" data-index="${index}">
            <i class="fas ${index === currentTrackIndex && isPlaying ? 'fa-pause' : 'fa-play'}"></i>
          </button>
        </div>
      `;
      
      // Add click event to the entire track item
      li.addEventListener('click', () => {
        playTrack(index);
      });
      
      // Add click event to the play button
      const playButton = li.querySelector('.play-button');
      playButton.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent triggering the li click event
        if (index === currentTrackIndex && isPlaying) {
          pausePlayback();
        } else {
          playTrack(index);
        }
      });
      
      trackList.appendChild(li);
    });
  };

  // Initialize Spotify player
  const initializePlayer = () => {
    // Only load the script if it hasn't been loaded yet
    if (!window.Spotify && !document.getElementById('spotify-player-script')) {
      console.log('Loading Spotify Web Playback SDK...');
      const script = document.createElement('script');
      script.id = 'spotify-player-script';
      script.src = 'https://sdk.scdn.co/spotify-player.js';
      script.async = true;
      document.body.appendChild(script);
    } else if (window.Spotify) {
      // If Spotify is already loaded, initialize the player directly
      console.log('Spotify SDK already loaded, initializing player...');
      setupPlayer();
    }
  };

  // Setup the Spotify player
  const setupPlayer = () => {
    if (player) {
      console.log('Player already initialized');
      return;
    }

    console.log('Setting up Spotify player...');
    player = new Spotify.Player({
      name: 'Aesthetic Playlist Player',
      getOAuthToken: async (callback) => {
        try {
          const response = await fetch('/get-token');
          const data = await response.json();
          console.log('Got access token for player');
          callback(data.accessToken);
        } catch (error) {
          console.error('Error getting token:', error);
        }
      },
      volume: 0.5
    });

    // Error handling
    player.addListener('initialization_error', ({ message }) => {
      console.error('Initialization error:', message);
    });
    player.addListener('authentication_error', ({ message }) => {
      console.error('Authentication error:', message);
    });
    player.addListener('account_error', ({ message }) => {
      console.error('Account error:', message);
    });
    player.addListener('playback_error', ({ message }) => {
      console.error('Playback error:', message);
    });

    // Playback status updates
    player.addListener('player_state_changed', (state) => {
      console.log('Player state changed:', state);
      if (!state) {
        console.log('No state received');
        return;
      }
      
      const currentTrack = state.track_window.current_track;
      console.log('Current track:', currentTrack);
      
      // Find the index of the current track in our tracks array
      const trackIndex = tracks.findIndex(t => 
        t.name === currentTrack.name && 
        t.artist === currentTrack.artists[0].name);
      
      console.log('Found track index:', trackIndex);
      
      if (trackIndex !== -1) {
        currentTrackIndex = trackIndex;
        isPlaying = !state.paused;
        
        // Update UI
        updatePlayerUI(currentTrack.name, currentTrack.artists[0].name, !state.paused);
        renderTracks(); // Re-render to update the playing indicator
      }
    });

    // Ready
    player.addListener('ready', ({ device_id }) => {
      console.log('Spotify Player Ready with Device ID:', device_id);
      deviceId = device_id;
      playerReady = true;
      
      // Transfer playback to this device
      transferPlayback(device_id);
    });

    // Not Ready
    player.addListener('not_ready', ({ device_id }) => {
      console.log('Device ID has gone offline', device_id);
      playerReady = false;
    });

    // Connect to the player
    console.log('Connecting to Spotify player...');
    player.connect()
      .then(success => {
        if (success) {
          console.log('Successfully connected to Spotify!');
        } else {
          console.error('Failed to connect to Spotify');
        }
      })
      .catch(error => {
        console.error('Error connecting to Spotify:', error);
      });
  };

  // Transfer playback to the current device
  const transferPlayback = async (deviceId) => {
    try {
      const response = await fetch('/get-token');
      const data = await response.json();
      const accessToken = data.accessToken;
      
      console.log('Transferring playback to device:', deviceId);
      
      await fetch('https://api.spotify.com/v1/me/player', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          device_ids: [deviceId],
          play: false
        })
      });
      
      console.log('Playback transferred successfully');
    } catch (error) {
      console.error('Error transferring playback:', error);
    }
  };

  // Update player UI
  const updatePlayerUI = (trackName, artistName, playing) => {
    currentTrackName.textContent = trackName || 'No track selected';
    currentTrackArtist.textContent = artistName || '';
    
    // Update play/pause button
    playPauseButton.innerHTML = playing ? 
      '<i class="fas fa-pause"></i>' : 
      '<i class="fas fa-play"></i>';
  };

  // Play a specific track
  const playTrack = async (index) => {
    if (index < 0 || index >= tracks.length) {
      console.error('Invalid track index:', index);
      return;
    }
    
    if (!deviceId) {
      console.error('No device ID available');
      alert('Spotify player is not ready yet. Please wait a moment and try again.');
      return;
    }
    
    try {
      console.log(`Attempting to play track at index ${index}:`, tracks[index]);
      
      // Get fresh token
      const response = await fetch('/get-token');
      const data = await response.json();
      const accessToken = data.accessToken;
      
      // Get the track URI for the selected track
      const searchQuery = `track:${encodeURIComponent(tracks[index].name)} artist:${encodeURIComponent(tracks[index].artist)}`;
      console.log('Search query:', searchQuery);
      
      const trackResponse = await fetch(`https://api.spotify.com/v1/search?q=${searchQuery}&type=track&limit=1`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });
      
      if (!trackResponse.ok) {
        console.error('Search API error:', await trackResponse.text());
        throw new Error('Failed to search for track');
      }
      
      const trackData = await trackResponse.json();
      console.log('Track search results:', trackData);
      
      if (trackData.tracks && trackData.tracks.items.length > 0) {
        const trackUri = trackData.tracks.items[0].uri;
        console.log('Found track URI:', trackUri);
        
        // Play the track
        const playResponse = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
          method: 'PUT',
          body: JSON.stringify({ uris: [trackUri] }),
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
          }
        });
        
        if (!playResponse.ok) {
          const errorText = await playResponse.text();
          console.error('Play API error:', errorText);
          throw new Error('Failed to play track');
        }
        
        console.log('Track playback started');
        currentTrackIndex = index;
        isPlaying = true;
        
        // Update UI
        updatePlayerUI(tracks[index].name, tracks[index].artist, true);
        renderTracks();
      } else {
        console.error('Track not found on Spotify');
        alert(`Sorry, couldn't find "${tracks[index].name}" by ${tracks[index].artist} on Spotify.`);
      }
    } catch (error) {
      console.error('Error playing track:', error);
      alert('Error playing track: ' + (error.message || 'Unknown error'));
    }
  };

  // Play/pause current track
  const togglePlayPause = async () => {
    if (!deviceId) {
      console.error('No device ID available');
      return;
    }
    
    if (currentTrackIndex === -1) {
      // If no track is selected, play the first track
      if (tracks.length > 0) {
        playTrack(0);
      }
      return;
    }
    
    try {
      const response = await fetch('/get-token');
      const data = await response.json();
      const accessToken = data.accessToken;
      
      if (isPlaying) {
        console.log('Pausing playback');
        const pauseResponse = await fetch('https://api.spotify.com/v1/me/player/pause', {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        });
        
        if (!pauseResponse.ok) {
          console.error('Pause API error:', await pauseResponse.text());
          throw new Error('Failed to pause playback');
        }
        
        isPlaying = false;
      } else {
        console.log('Resuming playback');
        const playResponse = await fetch('https://api.spotify.com/v1/me/player/play', {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${accessToken}`
          }
        });
        
        if (!playResponse.ok) {
          console.error('Play API error:', await playResponse.text());
          throw new Error('Failed to resume playback');
        }
        
        isPlaying = true;
      }
      
      // Update UI
      playPauseButton.innerHTML = isPlaying ? 
        '<i class="fas fa-pause"></i>' : 
        '<i class="fas fa-play"></i>';
      renderTracks();
    } catch (error) {
      console.error('Error toggling playback:', error);
    }
  };

  // Pause playback
  const pausePlayback = async () => {
    if (!deviceId || !isPlaying) {
      console.log('Cannot pause: device not ready or not playing');
      return;
    }
    
    try {
      const response = await fetch('/get-token');
      const data = await response.json();
      const accessToken = data.accessToken;
      
      console.log('Pausing playback');
      const pauseResponse = await fetch('https://api.spotify.com/v1/me/player/pause', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      });
      
      if (!pauseResponse.ok) {
        console.error('Pause API error:', await pauseResponse.text());
        throw new Error('Failed to pause playback');
      }
      
      isPlaying = false;
      
      // Update UI
      playPauseButton.innerHTML = '<i class="fas fa-play"></i>';
      renderTracks();
    } catch (error) {
      console.error('Error pausing playback:', error);
    }
  };

  // Play next track
  const playNextTrack = () => {
    if (tracks.length === 0) return;
    
    const nextIndex = currentTrackIndex === -1 ? 0 : (currentTrackIndex + 1) % tracks.length;
    console.log('Playing next track, index:', nextIndex);
    playTrack(nextIndex);
  };

  // Play previous track
  const playPreviousTrack = () => {
    if (tracks.length === 0) return;
    
    const prevIndex = currentTrackIndex === -1 ? 0 : (currentTrackIndex - 1 + tracks.length) % tracks.length;
    console.log('Playing previous track, index:', prevIndex);
    playTrack(prevIndex);
  };

  // Event listeners for player controls
  playPauseButton.addEventListener('click', togglePlayPause);
  nextButton.addEventListener('click', playNextTrack);
  previousButton.addEventListener('click', playPreviousTrack);

  // Handle Spotify SDK ready event
  window.onSpotifyWebPlaybackSDKReady = () => {
    console.log('Spotify Web Playback SDK Ready');
    setupPlayer();
  };

  // Initialize the app
  checkAuth();
});