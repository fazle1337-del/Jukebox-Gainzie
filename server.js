const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { spawn } = require('child_process');
const ffprobe = require('ffprobe-static');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// Middleware
app.use(express.json());

// CORS middleware (in case you're accessing from different origins)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// API routes first (before static files)
// Debug endpoint
app.get('/api/debug', (req, res) => {
  console.log('Debug endpoint called');
  res.json({ 
    message: 'API is working',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV
  });
});

// Health check
app.get('/health', (req, res) => {
  console.log('Health check called');
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Static files AFTER API routes
app.use(express.static('public'));

// Initialize SQLite database
const db = new sqlite3.Database('./database/jukebox.db');

// Create tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS songs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    filepath TEXT NOT NULL,
    title TEXT,
    artist TEXT,
    album TEXT,
    duration INTEGER,
    file_size INTEGER,
    mime_type TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    song_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id),
    FOREIGN KEY (song_id) REFERENCES songs (id),
    UNIQUE(user_id, song_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS playlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    song_id INTEGER NOT NULL,
    position INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (song_id) REFERENCES songs (id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS playback_state (
    id INTEGER PRIMARY KEY,
    current_song_id INTEGER,
    position_seconds REAL DEFAULT 0,
    is_playing BOOLEAN DEFAULT false,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (current_song_id) REFERENCES songs (id)
  )`);
});

// Audio playback state management
let currentPlayback = {
  songId: null,
  startTime: null,
  duration: 0,
  isPlaying: false,
  ffmpegProcess: null
};

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, './uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['audio/mpeg', 'audio/wav', 'audio/flac', 'audio/mp4', 'audio/ogg'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed'), false);
    }
  },
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit
  }
});

// Authentication middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

// Extract metadata using ffprobe (similar to Jellyfin)
async function extractMetadata(filePath) {
  return new Promise((resolve, reject) => {
    const ffprobeCmd = spawn(ffprobe, [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath
    ]);

    let output = '';
    ffprobeCmd.stdout.on('data', (data) => {
      output += data.toString();
    });

    ffprobeCmd.on('close', (code) => {
      if (code === 0) {
        try {
          const metadata = JSON.parse(output);
          const audioStream = metadata.streams.find(s => s.codec_type === 'audio');
          
          resolve({
            title: metadata.format.tags?.title || path.basename(filePath, path.extname(filePath)),
            artist: metadata.format.tags?.artist || 'Unknown Artist',
            album: metadata.format.tags?.album || 'Unknown Album',
            duration: parseFloat(metadata.format.duration) || 0,
            bitrate: parseInt(metadata.format.bit_rate) || 0,
            codec: audioStream?.codec_name || 'unknown'
          });
        } catch (err) {
          reject(err);
        }
      } else {
        reject(new Error(`ffprobe failed with code ${code}`));
      }
    });
  });
}

// Scan music directory and populate database
async function scanMusicDirectory() {
  try {
    const musicDir = './music';
    const files = await fs.readdir(musicDir, { recursive: true });
    
    for (const file of files) {
      const filePath = path.join(musicDir, file);
      const stats = await fs.stat(filePath);
      
      if (stats.isFile() && /\.(mp3|wav|flac|m4a|ogg)$/i.test(file)) {
        // Check if song already exists
        const existing = await new Promise((resolve, reject) => {
          db.get('SELECT id FROM songs WHERE filepath = ?', [filePath], (err, row) => {
            if (err) reject(err);
            else resolve(row);
          });
        });

        if (!existing) {
          try {
            const metadata = await extractMetadata(filePath);
            const mimeType = getMimeType(path.extname(file));
            
            db.run(
              'INSERT INTO songs (filename, filepath, title, artist, album, duration, file_size, mime_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
              [file, filePath, metadata.title, metadata.artist, metadata.album, metadata.duration, stats.size, mimeType]
            );
            
            console.log(`Added: ${metadata.title} by ${metadata.artist}`);
          } catch (err) {
            console.warn(`Could not extract metadata for ${file}:`, err.message);
            // Add without metadata
            db.run(
              'INSERT INTO songs (filename, filepath, title, file_size, mime_type) VALUES (?, ?, ?, ?, ?)',
              [file, filePath, path.basename(file, path.extname(file)), stats.size, getMimeType(path.extname(file))]
            );
          }
        }
      }
    }
  } catch (err) {
    console.error('Error scanning music directory:', err);
  }
}

function getMimeType(ext) {
  const types = {
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.flac': 'audio/flac',
    '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg'
  };
  return types[ext.toLowerCase()] || 'audio/mpeg';
}

// Audio streaming endpoint (Jellyfin-style)
app.get('/api/audio/:songId', async (req, res) => {
  const songId = parseInt(req.params.songId);
  
  db.get('SELECT * FROM songs WHERE id = ?', [songId], async (err, song) => {
    if (err || !song) {
      return res.status(404).json({ error: 'Song not found' });
    }

    try {
      const stats = await fs.stat(song.filepath);
      const range = req.headers.range;

      if (range) {
        // Handle range requests for seeking
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
        const chunksize = (end - start) + 1;

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stats.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunksize,
          'Content-Type': song.mime_type || 'audio/mpeg',
        });

        const stream = fsSync.createReadStream(song.filepath, { start, end });
        stream.pipe(res);
      } else {
        // Full file
        res.writeHead(200, {
          'Content-Length': stats.size,
          'Content-Type': song.mime_type || 'audio/mpeg',
          'Accept-Ranges': 'bytes',
        });

        const stream = fsSync.createReadStream(song.filepath);
        stream.pipe(res);
      }
    } catch (err) {
      res.status(500).json({ error: 'Failed to stream audio' });
    }
  });
});

// Transcoded streaming (for unsupported formats)
app.get('/api/audio/:songId/transcode', (req, res) => {
  const songId = parseInt(req.params.songId);
  
  db.get('SELECT * FROM songs WHERE id = ?', [songId], (err, song) => {
    if (err || !song) {
      return res.status(404).json({ error: 'Song not found' });
    }

    // Use ffmpeg to transcode to MP3 on-the-fly (Jellyfin approach)
    const ffmpeg = spawn('ffmpeg', [
      '-i', song.filepath,
      '-acodec', 'libmp3lame',
      '-ab', '192k',
      '-ar', '44100',
      '-f', 'mp3',
      '-'
    ]);

    res.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'Transfer-Encoding': 'chunked'
    });

    ffmpeg.stdout.pipe(res);

    ffmpeg.stderr.on('data', (data) => {
      console.error(`FFmpeg stderr: ${data}`);
    });

    ffmpeg.on('close', (code) => {
      if (code !== 0) {
        console.error(`FFmpeg process exited with code ${code}`);
      }
    });

    req.on('close', () => {
      ffmpeg.kill('SIGKILL');
    });
  });
});

// Register user
app.post('/api/register', async (req, res) => {
  console.log('Register endpoint called with:', req.body);
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
          if (err.code === 'SQLITE_CONSTRAINT') {
            return res.status(400).json({ error: 'Username already exists' });
          }
          return res.status(500).json({ error: 'Failed to create user' });
        }
        
        const token = jwt.sign({ id: this.lastID, username }, JWT_SECRET);
        res.json({ token, user: { id: this.lastID, username } });
      }
    );
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Login user
app.post('/api/login', (req, res) => {
  console.log('Login endpoint called with:', req.body);
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
    if (err || !user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    try {
      const isValid = await bcrypt.compare(password, user.password_hash);
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET);
      res.json({ token, user: { id: user.id, username: user.username } });
    } catch (err) {
      res.status(500).json({ error: 'Server error' });
    }
  });
});

// Get all songs with vote counts
app.get('/api/songs', (req, res) => {
  const query = `
    SELECT s.*, 
           COUNT(v.id) as vote_count,
           GROUP_CONCAT(u.username) as voters
    FROM songs s
    LEFT JOIN votes v ON s.id = v.song_id
    LEFT JOIN users u ON v.user_id = u.id
    GROUP BY s.id
    ORDER BY vote_count DESC, s.title ASC
  `;
  
  db.all(query, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch songs' });
    }
    
    const songs = rows.map(song => ({
      ...song,
      voters: song.voters ? song.voters.split(',') : []
    }));
    
    res.json(songs);
  });
});

// Vote for a song
app.post('/api/vote', authenticateToken, (req, res) => {
  const { songId } = req.body;
  const userId = req.user.id;
  
  db.run('INSERT OR IGNORE INTO votes (user_id, song_id) VALUES (?, ?)',
    [userId, songId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to vote' });
      }
      
      if (this.changes === 0) {
        return res.status(400).json({ error: 'Already voted for this song' });
      }
      
      res.json({ success: true });
    }
  );
});

// Remove vote
app.delete('/api/vote/:songId', authenticateToken, (req, res) => {
  const songId = parseInt(req.params.songId);
  const userId = req.user.id;
  
  db.run('DELETE FROM votes WHERE user_id = ? AND song_id = ?',
    [userId, songId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to remove vote' });
      }
      res.json({ success: true });
    }
  );
});

// Get current playlist (sorted by votes)
app.get('/api/playlist', (req, res) => {
  const query = `
    SELECT s.*, COUNT(v.id) as vote_count
    FROM songs s
    LEFT JOIN votes v ON s.id = v.song_id
    GROUP BY s.id
    HAVING vote_count > 0
    ORDER BY vote_count DESC, s.title ASC
    LIMIT 50
  `;
  
  db.all(query, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Failed to fetch playlist' });
    }
    res.json(rows);
  });
});

// Get currently playing song
app.get('/api/now-playing', (req, res) => {
  if (!currentPlayback.songId) {
    return res.json({ currentSong: null, isPlaying: false });
  }

  db.get('SELECT * FROM songs WHERE id = ?', [currentPlayback.songId], (err, song) => {
    if (err || !song) {
      return res.json({ currentSong: null, isPlaying: false });
    }

    const elapsed = currentPlayback.isPlaying && currentPlayback.startTime 
      ? (Date.now() - currentPlayback.startTime) / 1000 
      : 0;

    res.json({
      currentSong: song,
      isPlaying: currentPlayback.isPlaying,
      elapsed: elapsed,
      duration: currentPlayback.duration
    });
  });
});

// Upload music
app.post('/api/upload', authenticateToken, upload.single('music'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    const metadata = await extractMetadata(req.file.path);
    
    db.run(
      'INSERT INTO songs (filename, filepath, title, artist, album, duration, file_size, mime_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [req.file.filename, req.file.path, metadata.title, metadata.artist, metadata.album, metadata.duration, req.file.size, req.file.mimetype],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Failed to save song' });
        }
        
        res.json({
          id: this.lastID,
          filename: req.file.filename,
          title: metadata.title,
          artist: metadata.artist,
          album: metadata.album,
          duration: metadata.duration
        });
      }
    );
  } catch (err) {
    res.status(500).json({ error: 'Failed to process uploaded file' });
  }
});

// Playback control endpoints (for future use)
app.post('/api/play/:songId', authenticateToken, (req, res) => {
  const songId = parseInt(req.params.songId);
  
  currentPlayback.songId = songId;
  currentPlayback.startTime = Date.now();
  currentPlayback.isPlaying = true;
  
  // Update database state
  db.run('INSERT OR REPLACE INTO playback_state (id, current_song_id, is_playing, last_updated) VALUES (1, ?, ?, ?)',
    [songId, true, new Date().toISOString()]);
  
  res.json({ success: true });
});

app.post('/api/pause', authenticateToken, (req, res) => {
  currentPlayback.isPlaying = false;
  
  db.run('UPDATE playback_state SET is_playing = false WHERE id = 1');
  
  res.json({ success: true });
});

app.post('/api/stop', authenticateToken, (req, res) => {
  currentPlayback = {
    songId: null,
    startTime: null,
    duration: 0,
    isPlaying: false,
    ffmpegProcess: null
  };
  
  db.run('UPDATE playback_state SET current_song_id = NULL, is_playing = false WHERE id = 1');
  
  res.json({ success: true });
});

// Initialize server
async function startServer() {
  // Ensure directories exist
  await fs.mkdir('./music', { recursive: true });
  await fs.mkdir('./uploads', { recursive: true });
  await fs.mkdir('./database', { recursive: true });
  
  // Scan music directory on startup
  console.log('Scanning music directory...');
  await scanMusicDirectory();
  
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🎵 Jukebox server running on port ${PORT}`);
    console.log(`🌐 Access the jukebox at http://localhost:${PORT}`);
  });
}

startServer().catch(console.error);