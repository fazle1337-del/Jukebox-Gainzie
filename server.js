const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this';

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files
app.use(express.static('public'));

// Global player state
let currentlyPlaying = {
  songId: null,
  startTime: null,
  duration: null,
  isPlaying: false,
  pausedAt: null
};

let playTimeout;

// Database setup
const dbPath = './database/jukebox.db';

// Create directories if they don't exist
const dirs = ['./music', './uploads', './database', './public'];
dirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err);
    process.exit(1);
  }
  console.log('Connected to SQLite database');
});

// Create tables
db.serialize(() => {
  // Users table
  db.run(`DROP TABLE IF EXISTS users`);
  db.run(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Songs table
  db.run(`DROP TABLE IF EXISTS songs`); 
  db.run(`
    CREATE TABLE songs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      artist TEXT DEFAULT 'Unknown Artist',
      album TEXT DEFAULT 'Unknown Album',
      duration INTEGER DEFAULT 0,
      is_upload BOOLEAN DEFAULT FALSE,
      uploaded_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (uploaded_by) REFERENCES users(id)
    )
  `);

  // Votes table
  db.run(`DROP TABLE IF EXISTS votes`); 
  db.run(`
    CREATE TABLE votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      song_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
      UNIQUE(user_id, song_id)
    )
  `);

  console.log('Database tables created/verified');
});

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, './uploads');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['.mp3', '.wav', '.flac', '.m4a', '.ogg'];
  const ext = path.extname(file.originalname).toLowerCase();
  
  if (allowedTypes.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only MP3, WAV, FLAC, M4A, and OGG files are allowed.'));
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit
  }
});

// JWT Authentication middleware
const authenticateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
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
};

// Scan music files function
function scanMusicFiles() {
  console.log('Scanning music files...');
  const supportedFormats = ['.mp3', '.wav', '.flac', '.m4a', '.ogg'];
  
  // Scan music directory
  if (fs.existsSync('./music')) {
    const files = fs.readdirSync('./music');
    
    files.forEach(file => {
      const ext = path.extname(file).toLowerCase();
      if (supportedFormats.includes(ext)) {
        // Check if song already exists
        db.get('SELECT id FROM songs WHERE filename = ?', [file], (err, existingSong) => {
          if (err) {
            console.error('Database error:', err);
            return;
          }
          
          if (!existingSong) {
            const title = path.basename(file, ext);
            
            db.run(
              'INSERT INTO songs (filename, title, artist, album, is_upload) VALUES (?, ?, ?, ?, ?)',
              [file, title, 'Unknown Artist', 'Unknown Album', false],
              function(insertErr) {
                if (insertErr) {
                  console.error(`Error inserting ${file}:`, insertErr);
                } else {
                  console.log(`Added: ${title}`);
                }
              }
            );
          }
        });
      }
    });
  }
  
  // Scan uploads directory
  if (fs.existsSync('./uploads')) {
    const files = fs.readdirSync('./uploads');
    
    files.forEach(file => {
      const ext = path.extname(file).toLowerCase();
      if (supportedFormats.includes(ext)) {
        // Check if song already exists
        db.get('SELECT id FROM songs WHERE filename = ?', [file], (err, existingSong) => {
          if (err) {
            console.error('Database error:', err);
            return;
          }
          
          if (!existingSong) {
            const title = path.basename(file, ext);
            
            db.run(
              'INSERT INTO songs (filename, title, artist, album, is_upload) VALUES (?, ?, ?, ?, ?)',
              [file, title, 'Unknown Artist', 'Unknown Album', true],
              function(insertErr) {
                if (insertErr) {
                  console.error(`Error inserting ${file}:`, insertErr);
                } else {
                  console.log(`Added upload: ${title}`);
                }
              }
            );
          }
        });
      }
    });
  }
}

// Function to play next song in playlist
function playNextSong(callback) {
  const query = `
    SELECT s.* FROM songs s
    LEFT JOIN votes v ON s.id = v.song_id
    GROUP BY s.id
    HAVING COUNT(v.id) > 0
    ORDER BY COUNT(v.id) DESC, s.id ASC
    LIMIT 1
  `;

  db.get(query, [], (err, song) => {
    if (err) {
      console.error('Database error:', err);
      return callback(null);
    }

    if (!song) {
      currentlyPlaying = {
        songId: null,
        startTime: null,
        duration: null,
        isPlaying: false,
        pausedAt: null
      };
      return callback(null);
    }

    currentlyPlaying = {
      songId: song.id,
      startTime: Date.now(),
      duration: song.duration,
      isPlaying: true,
      pausedAt: null
    };

    callback(song);

    // Set timeout for next song
    if (song.duration) {
      playTimeout = setTimeout(() => {
        playNextSong(() => {});
      }, song.duration * 1000);
    }
  });
}


// API Routes

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    player: {
      playing: currentlyPlaying.isPlaying,
      songId: currentlyPlaying.songId
    }
  });
});

// User registration
app.post('/api/register', async (req, res) => {
  const { username, password, email } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    
    db.run(
      'INSERT INTO users (username, password, email) VALUES (?, ?, ?)',
      [username, hashedPassword, email],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(409).json({ error: 'Username already exists' });
          }
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Registration failed' });
        }
        
        const token = jwt.sign({ id: this.lastID, username }, JWT_SECRET, { expiresIn: '7d' });
        res.status(201).json({ 
          message: 'User registered successfully',
          token,
          user: { id: this.lastID, username }
        });
      }
    );
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// User login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  
  db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Login failed' });
    }
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    try {
      const isValidPassword = await bcrypt.compare(password, user.password);
      
      if (!isValidPassword) {
        return res.status(401).json({ error: 'Invalid username or password' });
      }
      
      const token = jwt.sign(
        { id: user.id, username: user.username },
        JWT_SECRET,
        { expiresIn: '7d' }
      );
      
      res.json({
        message: 'Login successful',
        token,
        user: {
          id: user.id,
          username: user.username
        }
      });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ error: 'Login failed' });
    }
  });
});

// Get all songs with vote counts
app.get('/api/songs', (req, res) => {
  const query = `
    SELECT 
      s.id,
      s.title,
      s.artist,
      s.album,
      s.filename,
      s.duration,
      s.is_upload,
      COUNT(v.id) as votes,
      CASE WHEN s.id = ? THEN 'playing' ELSE 'available' END as status
    FROM songs s 
    LEFT JOIN votes v ON s.id = v.song_id 
    GROUP BY s.id, s.title, s.artist, s.album, s.filename, s.duration, s.is_upload
    ORDER BY s.title ASC
  `;
  
  db.all(query, [currentlyPlaying.songId], (err, rows) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows);
  });
});

// Get current playlist (songs with votes, ordered by vote count)
app.get('/api/playlist', (req, res) => {
  const query = `
    SELECT 
      s.id,
      s.title,
      s.artist,
      s.album,
      s.filename,
      s.duration,
      COUNT(v.id) as votes,
      CASE WHEN s.id = ? THEN 'playing' ELSE 'queued' END as status
    FROM songs s 
    LEFT JOIN votes v ON s.id = v.song_id 
    GROUP BY s.id, s.title, s.artist, s.album, s.filename, s.duration
    HAVING COUNT(v.id) > 0
    ORDER BY
      CASE WHEN s.id = ? THEN 0 ELSE 1 END,
      COUNT(v.id) DESC, 
      s.id ASC
  `;
  
  db.all(query, [currentlyPlaying.songId, currentlyPlaying.songId], (err, rows) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows);
  });
});

// Vote for a song
app.post('/api/vote', authenticateJWT, (req, res) => {
  const { songId } = req.body;
  const userId = req.user.id;
  
  if (!songId) {
    return res.status(400).json({ error: 'Song ID is required' });
  }
  
  // Check if song exists
  db.get('SELECT id FROM songs WHERE id = ?', [songId], (err, song) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!song) {
      return res.status(404).json({ error: 'Song not found' });
    }
    
    // Add vote
    db.run(
      'INSERT INTO votes (user_id, song_id) VALUES (?, ?)',
      [userId, songId],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(409).json({ error: 'You have already voted for this song' });
          }
          console.error('Database error:', err);
          return res.status(500).json({ error: 'Voting failed' });
        }
        
        res.json({ message: 'Vote added successfully' });

        // Auto-start playlist if nothing is playing
        setTimeout(() => {
          if (!currentlyPlaying.isPlaying && !currentlyPlaying.songId) {
            console.log('Auto-starting playlist due to new vote...');
            playNextSong((song) => {
              if (song) {
                console.log(`Auto-playing: ${song.title} by ${song.artist}`);
              }
            });
          }
        }, 500);
      }
    );
  });
});

// Remove vote
app.delete('/api/vote/:songId', authenticateJWT, (req, res) => {
  const songId = req.params.songId;
  const userId = req.user.id;
  
  db.run(
    'DELETE FROM votes WHERE user_id = ? AND song_id = ?',
    [userId, songId],
    function(err) {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Vote not found' });
      }
      
      res.json({ message: 'Vote removed successfully' });
    }
  );
});

// Upload music file
app.post('/api/upload', authenticateJWT, upload.single('musicFile'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  
  const filename = req.file.filename;
  const originalName = req.file.originalname;
  const title = path.basename(originalName, path.extname(originalName));
  
  // Insert into database
  const query = `
    INSERT INTO songs (filename, title, artist, album, is_upload, uploaded_by) 
    VALUES (?, ?, ?, ?, ?, ?)
  `;
  
  db.run(query, [filename, title, 'Unknown Artist', 'Unknown Album', true, req.user.id], function(err) {
    if (err) {
      console.error('Database error:', err);
      // Clean up uploaded file on database error
      fs.unlink(req.file.path, (unlinkErr) => {
        if (unlinkErr) console.error('Error deleting file:', unlinkErr);
      });
      return res.status(500).json({ error: 'Database error' });
    }
    
    res.json({ 
      message: 'File uploaded successfully',
      song: {
        id: this.lastID,
        title: title,
        artist: 'Unknown Artist',
        album: 'Unknown Album',
        filename
      }
    });
  });
});

// MUSIC PLAYER ENDPOINTS

// Serve audio files with range support
app.get('/api/stream/:filename', (req, res) => {
  const filename = req.params.filename;
  
  // Try uploads directory first, then music directory
  let musicPath = path.join(__dirname, 'uploads', filename);
  if (!fs.existsSync(musicPath)) {
    musicPath = path.join(__dirname, 'music', filename);
  }
  
  // Security check
  const uploadsDir = path.resolve(__dirname, 'uploads');
  const musicDir = path.resolve(__dirname, 'music');
  const resolvedPath = path.resolve(musicPath);
  
  if (!fs.existsSync(resolvedPath) || 
      (!resolvedPath.startsWith(uploadsDir) && !resolvedPath.startsWith(musicDir))) {
    return res.status(404).json({ error: 'File not found' });
  }
  
  // Get file stats for range requests
  const stat = fs.statSync(resolvedPath);
  const fileSize = stat.size;
  const range = req.headers.range;
  
  if (range) {
    // Handle range requests for audio streaming
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(resolvedPath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'public, max-age=3600'
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    // Full file request
    const head = {
      'Content-Length': fileSize,
      'Content-Type': 'audio/mpeg',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600'
    };
    res.writeHead(200, head);
    fs.createReadStream(resolvedPath).pipe(res);
  }
});

// Get currently playing song with time info
app.get('/api/now-playing', (req, res) => {
  if (!currentlyPlaying.songId) {
    return res.json({ playing: false });
  }
  
  const query = `SELECT * FROM songs WHERE id = ?`;
  
  db.get(query, [currentlyPlaying.songId], (err, song) => {
    if (err || !song) {
      return res.json({ playing: false });
    }
    
    const now = Date.now();
    let currentTime = 0;
    
    if (currentlyPlaying.startTime) {
      if (currentlyPlaying.pausedAt) {
        currentTime = Math.floor((currentlyPlaying.pausedAt - currentlyPlaying.startTime) / 1000);
      } else {
        currentTime = Math.floor((now - currentlyPlaying.startTime) / 1000);
      }
    }
    
    const remainingTime = Math.max(0, (song.duration || 0) - currentTime);
    
    res.json({
      playing: currentlyPlaying.isPlaying,
      song: song,
      currentTime: Math.max(0, currentTime),
      remainingTime: remainingTime,
      duration: song.duration,
      startedAt: currentlyPlaying.startTime
    });
  });
});

// Start playing next song
app.post('/api/play-next', authenticateJWT, (req, res) => { //red curly bracket
  playNextSong((song) => {    
    if (!song) {
      return res.json({ error: 'No songs in playlist' });
    }
    
    res.json({
      message: 'Now playing',
      song: song,
      streamUrl: `/api/stream/${song.filename}`
    });
  });
});

// Pause/Resume playback
app.post('/api/pause', authenticateJWT, (req, res) => { //red curly bracket
  if (!currentlyPlaying.songId) {
    return res.status(400).json({ error: 'Nothing currently playing' });
  }
  const now = Date.now();

  if (currentlyPlaying.isPlaying) {
    // Pause
    currentlyPlaying.isPlaying = false;
    currentlyPlaying.pausedAt = now;
    if (playTimeout) {
      clearTimeout(playTimeout);
      playTimeout = null;
    }
  } else {
    // Resume
    currentlyPlaying.isPlaying = true;
    if (currentlyPlaying.pausedAt && currentlyPlaying.startTime) {
      const pauseDuration = currentlyPlaying.pausedAt - currentlyPlaying.startTime;
      currentlyPlaying.startTime = now - pauseDuration;
    }
    currentlyPlaying.pausedAt = null;

    // Set timeout for remaining time 
    if (currentlyPlaying.duration) {
      const elapsed = (now - currentlyPlaying.startTime) / 1000;
      const remaining = (currentlyPlaying.duration - elapsed) * 1000;
      if (remaining > 0) {
        playTimeout = setTimeout(() => {
          playNextSong(() => {});
        }, remaining);
      }
    }
  }
  
  res.json({ 
    playing: currentlyPlaying.isPlaying,
    message: currentlyPlaying.isPlaying ? 'Resumed' : 'Paused'
  });
});

// Skip to next song
app.post('/api/skip', authenticateJWT, (req, res) => {
  if (!currentlyPlaying.songId) {
    return res.json({ error: 'Nothing currently playing' });
  }

  const songId = currentlyPlaying.songId;

  //Clear timeout
  if (playTimeout) {
    clearTimeout(playTimeout);
    playTimeout = null;
  }

  // Remove all votes for current song
  db.run('DELETE FROM votes WHERE song_id = ?', [songId], (err) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    // Clear current playing
    currentlyPlaying = {
      songId: null,
      startTime: null,
      duration: null,
      isPlaying: false,
      pausedAt: null
    };

    res.json({ message: 'Song skipped, votes removed' });
  });
});

// Song finished
app.post('/api/song-finished', authenticateJWT, (req, res) => {
  if (!currentlyPlaying.songId) {
    return res.json({ error: 'Nothing currently playing' });
  }

  const songId = currentlyPlaying.songId;

  // Clear timeout
  if (playTimeout) {
    clearTimeout(playTimeout);
    playTimeout = null;
  }

  // Remove all votes for finished song
  db.run('DELETE FROM votes WHERE song_id = ?', [songId], (err) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
  
    // Clear current playing
    currentlyPlaying = {
      songId: null,
      startTime: null,
      duration: null,
      isPlaying: false,
      pausedAt: null
    };
 
    res.json({ message: 'Song finished, votes removed' });
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 50MB.' });
    }
    return res.status(400).json({ error: 'File upload error: ' + error.message });
  }
  
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Initialize and start server
console.log('🎵 Starting Jukebox server...');

// Scan for music files
setTimeout(() => {
  scanMusicFiles();
}, 1000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎵 Jukebox server running on port ${PORT}`);
  console.log(`🌐 Access at: http://localhost:${PORT}`);
  console.log(`📁 Music directory: ./music`);
  console.log(`📤 Uploads directory: ./uploads`);
  console.log(`🗄️ Database: ${dbPath}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  db.close((err) => {
    if (err) console.error('Error closing database:', err);
    else console.log('Database connection closed');
    process.exit(0);
  });
});