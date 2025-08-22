const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const DB_PATH = process.env.DB_PATH || './database/jukebox.db';
const MUSIC_PATH = process.env.MUSIC_PATH || './music';
const UPLOAD_PATH = process.env.UPLOAD_PATH || './uploads';

// Simple MusicPlayer class (stub implementation)
class MusicPlayer {
    constructor(db) {
        this.db = db;
        this.isPlaying = false;
        this.volume = 50;
        this.currentSong = null;
        this.eventListeners = {};
    }
    
    on(event, callback) {
        if (!this.eventListeners[event]) {
            this.eventListeners[event] = [];
        }
        this.eventListeners[event].push(callback);
        console.log(`MusicPlayer: Registered event ${event}`);
    }
    
    emit(event, data) {
        if (this.eventListeners[event]) {
            this.eventListeners[event].forEach(callback => callback(data));
        }
    }
    
    getCurrentStatus() {
        return {
            isPlaying: this.isPlaying,
            currentSong: this.currentSong,
            volume: this.volume
        };
    }
    
    async getCurrentPlaylist() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT p.*, s.title, s.artist, s.duration, s.file_path,
                       COUNT(v.id) as vote_count
                FROM playlist p
                JOIN songs s ON p.song_id = s.id
                LEFT JOIN votes v ON s.id = v.song_id
                GROUP BY p.id
                ORDER BY vote_count DESC, p.added_at
            `;
            
            this.db.all(query, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }
    
    async playNext() {
        console.log('MusicPlayer: playNext() called');
        // Get next song from playlist
        const query = `
            SELECT s.*, COUNT(v.id) as vote_count
            FROM playlist p
            JOIN songs s ON p.song_id = s.id
            LEFT JOIN votes v ON s.id = v.song_id
            GROUP BY s.id
            ORDER BY vote_count DESC, p.added_at ASC
            LIMIT 1
        `;
        
        this.db.get(query, (err, song) => {
            if (err || !song) {
                console.log('No songs in playlist');
                this.emit('playlistEmpty');
                return;
            }
            
            this.currentSong = song;
            this.isPlaying = true;
            
            console.log(`Now playing: ${song.title} by ${song.artist}`);
            this.emit('songStarted', song);
            
            // Simulate song duration (for demo purposes)
            setTimeout(() => {
            this.songFinished();
            }, (song.duration ? song.duration : 30) * 1000); // Use actual duration if available
        });
    }
    
    songFinished() {
        if (this.currentSong) {
            this.emit('songFinished', this.currentSong);
            this.isPlaying = false;
            this.currentSong = null;
            
            // Play next song if available
            setTimeout(() => this.playNext(), 1000);
        }
    }
    
    stopCurrentSong() {
        console.log('MusicPlayer: stopCurrentSong() called');
        if (this.currentSong) {
            this.emit('songFinished', this.currentSong);
        }
        this.isPlaying = false;
        this.currentSong = null;
        
        // Play next song
        setTimeout(() => this.playNext(), 1000);
    }
    
    setVolume(volume) {
        this.volume = Math.max(0, Math.min(100, volume));
        console.log(`MusicPlayer: Volume set to ${this.volume}%`);
    }
}

// Middleware
app.use(express.json());
app.use(express.static('public'));
app.use('/music', express.static(MUSIC_PATH));

// Database setup
const db = new sqlite3.Database(DB_PATH);

// Initialize database tables
db.serialize(() => {
    // Users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Songs table
    db.run(`CREATE TABLE IF NOT EXISTS songs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL,
        title TEXT NOT NULL,
        artist TEXT,
        duration INTEGER,
        file_path TEXT NOT NULL,
        added_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (added_by) REFERENCES users(id)
    )`);

    // Votes table
    db.run(`CREATE TABLE IF NOT EXISTS votes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        song_id INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (song_id) REFERENCES songs(id),
        UNIQUE(user_id, song_id)
    )`);

    // Current playlist table
    db.run(`CREATE TABLE IF NOT EXISTS playlist (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        song_id INTEGER NOT NULL,
        vote_count INTEGER DEFAULT 0,
        position INTEGER,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (song_id) REFERENCES songs(id)
    )`);

    // Now playing table
    db.run(`CREATE TABLE IF NOT EXISTS now_playing (
        id INTEGER PRIMARY KEY,
        song_id INTEGER,
        started_at DATETIME,
        FOREIGN KEY (song_id) REFERENCES songs(id)
    )`);
});

// Initialize music player after database setup
const musicPlayer = new MusicPlayer(db);

// Music player event listeners
musicPlayer.on('songStarted', (song) => {
    console.log(`🎵 Started playing: ${song.title} by ${song.artist}`);
    
    // Update now_playing table
    db.run('INSERT OR REPLACE INTO now_playing (id, song_id, started_at) VALUES (1, ?, CURRENT_TIMESTAMP)', 
        [song.id], (err) => {
            if (err) console.error('Error updating now_playing:', err);
        });
});

musicPlayer.on('songFinished', (song) => {
    console.log(`✅ Finished playing: ${song.title}`);
    
    // Clear now_playing table
    db.run('DELETE FROM now_playing WHERE id = 1', (err) => {
        if (err) console.error('Error clearing now_playing:', err);
    });
    
    // Remove from playlist after playing
    db.run('DELETE FROM playlist WHERE song_id = ?', [song.id], (err) => {
        if (err) console.error('Error removing from playlist:', err);
    });
});

musicPlayer.on('playlistEmpty', () => {
    console.log('📭 Playlist is empty, waiting for votes...');
});

// Music scanning function
async function scanMusicDirectory() {
    console.log('Scanning music directory for new files...');
    
    try {
        const files = await fs.readdir(MUSIC_PATH);
        const musicExtensions = ['.mp3', '.wav', '.flac', '.m4a', '.ogg'];
        
        for (const file of files) {
            if (file === '.gitkeep') continue; // Skip placeholder file
            
            const ext = path.extname(file).toLowerCase();
            if (!musicExtensions.includes(ext)) continue;
            
            const filePath = path.join(MUSIC_PATH, file);
            
            // Check if file already exists in database
            const existingSong = await new Promise((resolve, reject) => {
                db.get('SELECT id FROM songs WHERE filename = ?', [file], (err, row) => {
                    if (err) reject(err);
                    else resolve(row);
                });
            });
            
            if (existingSong) {
                console.log(`Skipping existing file: ${file}`);
                continue;
            }
            
            try {
                // Get file stats for basic info
                const stats = await fs.stat(filePath);
                
                // Try to extract metadata using ffprobe
                let title = path.basename(file, ext);
                let artist = 'Unknown Artist';
                let duration = 0;
                
                try {
                    const { stdout } = await execAsync(`ffprobe -v quiet -print_format json -show_format "${filePath}"`);
                    const metadata = JSON.parse(stdout);
                    
                    title = metadata.format.tags?.title || metadata.format.tags?.Title || title;
                    artist = metadata.format.tags?.artist || metadata.format.tags?.Artist || artist;
                    duration = Math.floor(metadata.format.duration) || 0;
                } catch (metadataError) {
                    console.log(`Could not extract metadata for ${file}, using filename`);
                }
                
                // Add to database
                await new Promise((resolve, reject) => {
                    db.run('INSERT INTO songs (filename, title, artist, duration, file_path, added_by) VALUES (?, ?, ?, ?, ?, ?)',
                        [file, title, artist, duration, filePath, null], // null for system-added files
                        function(err) {
                            if (err) reject(err);
                            else {
                                console.log(`Added: ${title} by ${artist}`);
                                resolve(this.lastID);
                            }
                        }
                    );
                });
                
            } catch (fileError) {
                console.error(`Error processing file ${file}:`, fileError.message);
            }
        }
        
        console.log('Music directory scan completed');
        
    } catch (error) {
        console.error('Error scanning music directory:', error);
    }
}

// Scan music directory on startup
scanMusicDirectory();

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.sendStatus(401);
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

// File upload configuration
const storage = multer.diskStorage({
    destination: UPLOAD_PATH,
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const name = path.basename(file.originalname, ext);
        cb(null, `${name}-${Date.now()}${ext}`);
    }
});

const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['.mp3', '.wav', '.flac', '.m4a', '.ogg'];
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, allowedTypes.includes(ext));
    },
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Routes

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Debug endpoint (remove in production)
app.get('/api/debug/token', authenticateToken, (req, res) => {
    res.json({ 
        user: req.user,
        message: 'Token is valid'
    });
});

// User registration - FIXED
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        
        db.run('INSERT INTO users (username, password_hash) VALUES (?, ?)', 
            [username, hashedPassword], 
            function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE constraint failed')) {
                        return res.status(409).json({ error: 'Username already exists' });
                    }
                    return res.status(500).json({ error: 'Registration failed' });
                }
                
                // FIXED: Use consistent property name
                const token = jwt.sign({ userId: this.lastID, username }, JWT_SECRET);
                res.json({ token, username, userId: this.lastID });
            }
        );
    } catch (error) {
        res.status(500).json({ error: 'Registration failed' });
    }
});

// User login - FIXED
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
        if (err || !user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        try {
            const validPassword = await bcrypt.compare(password, user.password_hash);
            if (!validPassword) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }
            
            // FIXED: Use consistent property name
            const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET);
            res.json({ token, username: user.username, userId: user.id });
        } catch (error) {
            res.status(500).json({ error: 'Login failed' });
        }
    });
});

// Get all songs
app.get('/api/songs', (req, res) => {
    const query = `
        SELECT s.*, 
               COUNT(v.id) as vote_count,
               CASE WHEN p.song_id IS NOT NULL THEN 1 ELSE 0 END as in_playlist
        FROM songs s
        LEFT JOIN votes v ON s.id = v.song_id
        LEFT JOIN playlist p ON s.id = p.song_id
        GROUP BY s.id
        ORDER BY vote_count DESC, s.title
    `;
    
    db.all(query, (err, rows) => {
        if (err) {
            console.error('Error fetching songs:', err);
            return res.status(500).json({ error: 'Failed to fetch songs' });
        }
        res.json(rows);
    });
});

// Vote endpoint - ENHANCED with better error handling
app.post('/api/vote', authenticateToken, (req, res) => {
    const { songId } = req.body;
    const userId = req.user.userId;
    
    if (!songId) {
        return res.status(400).json({ error: 'Song ID is required' });
    }
    
    // Check if song exists first
    db.get('SELECT id FROM songs WHERE id = ?', [songId], (err, song) => {
        if (err) {
            console.error('Database error checking song:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!song) {
            return res.status(404).json({ error: 'Song not found' });
        }
        
        // Check if user has already voted for this song
        db.get('SELECT * FROM votes WHERE user_id = ? AND song_id = ?', 
            [userId, songId], 
            (err, existingVote) => {
                if (err) {
                    console.error('Error checking existing vote:', err);
                    return res.status(500).json({ error: 'Vote check failed' });
                }
                
                if (existingVote) {
                    // Toggle off - remove vote
                    db.run('DELETE FROM votes WHERE user_id = ? AND song_id = ?', 
                        [userId, songId], 
                        function(err) {
                            if (err) {
                                console.error('Error removing vote:', err);
                                return res.status(500).json({ error: 'Vote removal failed' });
                            }
                            
                            updatePlaylist(songId);
                            res.json({ message: 'Vote removed', action: 'removed' });
                        }
                    );
                } else {
                    // Add vote
                    db.run('INSERT INTO votes (user_id, song_id) VALUES (?, ?)', 
                        [userId, songId], 
                        function(err) {
                            if (err) {
                                console.error('Error adding vote:', err);
                                return res.status(500).json({ error: 'Vote failed' });
                            }
                            
                            // Update playlist
                            updatePlaylist(songId);
                            
                            // If nothing is currently playing, start playing
                            if (!musicPlayer.isPlaying) {
                                setTimeout(() => musicPlayer.playNext(), 1000);
                            }
                            
                            res.json({ message: 'Vote recorded', voteId: this.lastID, action: 'added' });
                        }
                    );
                }
            }
        );
    });
});

// Remove vote
app.delete('/api/vote/:songId', authenticateToken, (req, res) => {
    const songId = req.params.songId;
    const userId = req.user.userId;
    
    db.run('DELETE FROM votes WHERE user_id = ? AND song_id = ?', 
        [userId, songId], 
        function(err) {
            if (err) {
                console.error('Error removing vote:', err);
                return res.status(500).json({ error: 'Vote removal failed' });
            }
            
            updatePlaylist(songId);
            res.json({ message: 'Vote removed' });
        }
    );
});

// Get current playlist
app.get('/api/playlist', (req, res) => {
    const query = `
        SELECT p.*, s.title, s.artist, s.duration, s.file_path,
               COUNT(v.id) as vote_count
        FROM playlist p
        JOIN songs s ON p.song_id = s.id
        LEFT JOIN votes v ON s.id = v.song_id
        GROUP BY p.id
        ORDER BY vote_count DESC, p.added_at
    `;
    
    db.all(query, (err, rows) => {
        if (err) {
            console.error('Error fetching playlist:', err);
            return res.status(500).json({ error: 'Failed to fetch playlist' });
        }
        res.json(rows);
    });
});

// Get now playing
app.get('/api/now-playing', (req, res) => {
    const status = musicPlayer.getCurrentStatus();
    res.json(status.currentSong || null);
});

// Upload music file
app.post('/api/upload', authenticateToken, upload.single('music'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    
    try {
        // Extract metadata using ffprobe
        const { stdout } = await execAsync(`ffprobe -v quiet -print_format json -show_format "${req.file.path}"`);
        const metadata = JSON.parse(stdout);
        
        const title = metadata.format.tags?.title || path.basename(req.file.originalname, path.extname(req.file.originalname));
        const artist = metadata.format.tags?.artist || 'Unknown Artist';
        const duration = Math.floor(metadata.format.duration);
        
        // Add to database
        db.run('INSERT INTO songs (filename, title, artist, duration, file_path, added_by) VALUES (?, ?, ?, ?, ?, ?)',
            [req.file.filename, title, artist, duration, req.file.path, req.user.userId],
            function(err) {
                if (err) {
                    console.error('Error saving song:', err);
                    return res.status(500).json({ error: 'Failed to save song info' });
                }
                
                res.json({
                    id: this.lastID,
                    title,
                    artist,
                    duration,
                    message: 'Song uploaded successfully'
                });
            }
        );
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Failed to process uploaded file' });
    }
});

// Manual rescan endpoint
app.post('/api/rescan', authenticateToken, async (req, res) => {
    try {
        await scanMusicDirectory();
        res.json({ message: 'Music directory rescanned successfully' });
    } catch (error) {
        console.error('Rescan error:', error);
        res.status(500).json({ error: 'Failed to rescan music directory' });
    }
});

// Music player control endpoints

// Get current player status
app.get('/api/player/status', (req, res) => {
    const status = musicPlayer.getCurrentStatus();
    res.json(status);
});

// Get current playlist (using music player method)
app.get('/api/player/playlist', async (req, res) => {
    try {
        const playlist = await musicPlayer.getCurrentPlaylist();
        res.json(playlist);
    } catch (error) {
        console.error('Error fetching playlist:', error);
        res.status(500).json({ error: 'Failed to fetch playlist' });
    }
});

// Skip current song (requires authentication)
app.post('/api/player/skip', authenticateToken, (req, res) => {
    if (musicPlayer.isPlaying) {
        musicPlayer.stopCurrentSong();
        res.json({ message: 'Song skipped' });
    } else {
        res.json({ message: 'No song currently playing' });
    }
});

// Set volume (requires authentication)
app.post('/api/player/volume', authenticateToken, (req, res) => {
    const { volume } = req.body;
    if (typeof volume === 'number' && volume >= 0 && volume <= 100) {
        musicPlayer.setVolume(volume);
        res.json({ message: 'Volume updated', volume: musicPlayer.volume });
    } else {
        res.status(400).json({ error: 'Volume must be a number between 0 and 100' });
    }
});

// Start playing manually (requires authentication)
app.post('/api/player/start', authenticateToken, async (req, res) => {
    if (!musicPlayer.isPlaying) {
        await musicPlayer.playNext();
        res.json({ message: 'Playback started' });
    } else {
        res.json({ message: 'Already playing' });
    }
});

// Helper function to update playlist based on votes
function updatePlaylist(songId) {
    // Get current vote count
    db.get('SELECT COUNT(*) as vote_count FROM votes WHERE song_id = ?', 
        [songId], 
        (err, result) => {
            if (err) {
                console.error('Error getting vote count:', err);
                return;
            }
            
            const voteCount = result.vote_count;
            console.log(`updatePlaylist called for songId=${songId}, voteCount=${voteCount}`); // Debug log
            
            if (voteCount > 0) {
                // Add or update in playlist
                db.run(`INSERT OR REPLACE INTO playlist (song_id, vote_count, added_at) 
                        VALUES (?, ?, CURRENT_TIMESTAMP)`, 
                    [songId, voteCount],
                    (err) => {
                        if (err) console.error('Error updating playlist:', err);
                    }
                );
            } else {
                // Remove from playlist if no votes
                db.run('DELETE FROM playlist WHERE song_id = ?', [songId], (err) => {
                    if (err) console.error('Error removing from playlist:', err);
                });
            }
        }
    );
}

// Serve the main app
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Jukebox server running on port ${PORT}`);
    console.log(`Music path: ${MUSIC_PATH}`);
    console.log(`Database: ${DB_PATH}`);
    console.log(`Upload path: ${UPLOAD_PATH}`);
});
