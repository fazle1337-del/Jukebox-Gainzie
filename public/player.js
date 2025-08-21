// player.js - Music Player Status and Controls
// Add this as a separate file in your public/ directory

let currentPlayerStatus = null;

// Function to fetch and display current player status
async function updatePlayerStatus() {
    try {
        const response = await fetch('/api/player/status', {
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        });
        
        if (response.ok) {
            currentPlayerStatus = await response.json();
            displayPlayerStatus();
        }
    } catch (error) {
        console.error('Error fetching player status:', error);
    }
}

// Function to display player status in the UI
function displayPlayerStatus() {
    const statusContainer = document.getElementById('player-status');
    if (!statusContainer) return;

    if (currentPlayerStatus.isPlaying && currentPlayerStatus.currentSong) {
        const song = currentPlayerStatus.currentSong;
        statusContainer.innerHTML = `
            <div class="now-playing">
                <h3>🎵 Now Playing</h3>
                <div class="song-info">
                    <strong>${song.title}</strong><br>
                    <span>by ${song.artist}</span><br>
                    <small>Album: ${song.album || 'Unknown'}</small>
                </div>
                <div class="player-controls">
                    <button onclick="skipSong()" class="btn-skip">⏭️ Skip</button>
                    <div class="volume-control">
                        <label>Volume: ${currentPlayerStatus.volume}%</label>
                        <input type="range" min="0" max="100" value="${currentPlayerStatus.volume}" 
                               onchange="setVolume(this.value)" class="volume-slider">
                    </div>
                </div>
            </div>
        `;
    } else {
        statusContainer.innerHTML = `
            <div class="now-playing idle">
                <h3>🎵 Player Idle</h3>
                <p>Vote for songs to start playing music!</p>
                <button onclick="startPlayback()" class="btn-start">▶️ Start Playing</button>
            </div>
        `;
    }
}

// Function to skip current song
async function skipSong() {
    try {
        const response = await fetch('/api/player/skip', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (response.ok) {
            const result = await response.json();
            console.log(result.message);
            // Update status immediately
            setTimeout(updatePlayerStatus, 1000);
        }
    } catch (error) {
        console.error('Error skipping song:', error);
    }
}

// Function to set volume
async function setVolume(volume) {
    try {
        const response = await fetch('/api/player/volume', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ volume: parseInt(volume) })
        });
        
        if (response.ok) {
            const result = await response.json();
            console.log(result.message);
        }
    } catch (error) {
        console.error('Error setting volume:', error);
    }
}

// Function to start playback manually
async function startPlayback() {
    try {
        const response = await fetch('/api/player/start', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${localStorage.getItem('token')}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (response.ok) {
            const result = await response.json();
            console.log(result.message);
            setTimeout(updatePlayerStatus, 1000);
        }
    } catch (error) {
        console.error('Error starting playback:', error);
    }
}

// Initialize player status functionality
function initPlayerStatus() {
    // Add player status container to your HTML if it doesn't exist
    if (!document.getElementById('player-status')) {
        const container = document.createElement('div');
        container.id = 'player-status';
        container.className = 'player-status-container';
        
        // Insert it at the top of your main content
        const mainContent = document.querySelector('main') || document.body;
        mainContent.insertBefore(container, mainContent.firstChild);
    }
    
    // Start updating player status
    updatePlayerStatus();
    
    // Update player status every 5 seconds
    setInterval(updatePlayerStatus, 5000);
}

// Auto-initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initPlayerStatus);
