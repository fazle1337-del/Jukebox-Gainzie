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

// Database setup
const dbPath = './database/jukebox.db';
const dirs = ['./music', './uploads', './database', './public'];
dirs.forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const db = new sqlite3.Database(dbPath, err => {
  if (err) {
    console.error('Error opening database:', err);
    process.exit(1);
  }
  console.log('Connected to SQLite database');
});

// Automatic migration for missing columns
function ensureColumns() {
  db.all("PRAGMA table_info(users);", (err, rows) => {
    if (!rows.find(r => r.name === 'password')) {
      db.run("ALTER TABLE users ADD COLUMN password TEXT;", err => {
        if (err) console.error("Error adding 'password' column:", err);
        else console.log("Added missing 'password' column to users table");
      });
    }
  });

  db.all("PRAGMA table_info(songs);", (err, rows) => {
    if (!rows.find(r => r.name === 'album')) {
      db.run("ALTER TABLE songs ADD COLUMN album TEXT DEFAULT 'Unknown Album';", err => {
        if (err) console.error("Error adding 'album' column:", err);
        else console.log("Added missing 'album' column to songs table");
      });
    }
  });
}

// Create tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT,
      password TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS songs (
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

  db.run(`
    CREATE TABLE IF NOT EXISTS votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      song_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
      UNIQUE(user_id, song_id)
    )
  `);

  ensureColumns();
  console.log('Database tables created/verified');
});

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, './uploads'),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['.mp3', '.wav', '.flac', '.m4a', '.ogg'];
  const ext = path.extname(file.originalname).toLowerCase();
  cb(allowedTypes.includes(ext) ? null : new Error('Invalid file type'), allowedTypes.includes(ext));
};
const upload = multer({ storage, fileFilter, limits: { fileSize: 50 * 1024 * 1024 } });

// JWT middleware
const authenticateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access token required' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
};

// Scan music files
function scanMusicFiles() {
  const supportedFormats = ['.mp3', '.wav', '.flac', '.m4a', '.ogg'];
  const scanDirs = ['./music', './uploads'];
  scanDirs.forEach(dir => {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach(file => {
      const ext = path.extname(file).toLowerCase();
      if (!supportedFormats.includes(ext)) return;
      db.get('SELECT id FROM songs WHERE filename = ?', [file], (err, row) => {
        if (err) return console.error('Database error:', err);
        if (!row) {
          const title = path.basename(file, ext);
          db.run(
            'INSERT INTO songs (filename, title, artist, album, is_upload) VALUES (?, ?, ?, ?, ?)',
            [file, title, 'Unknown Artist', 'Unknown Album', dir === './uploads'],
            function (insertErr) {
              if (insertErr) console.error(`Error inserting ${file}:`, insertErr);
              else console.log(`Added: ${title}`);
            }
          );
        }
      });
    });
  });
}

// --- Routes ---

// Health
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString(), player: { playing: currentlyPlaying.isPlaying, songId: currentlyPlaying.songId } });
});

// Registration
app.post('/api/register', (req, res) => {
  const { username, password, email } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const cleanUsername = String(username).trim();
  const cleanEmail = email ? String(email).trim() : null;

  db.get('SELECT id FROM users WHERE username = ?', [cleanUsername], (checkErr, row) => {
    if (checkErr) return res.status(500).json({ error: 'Registration failed' });
    if (row) return res.status(409).json({ error: 'Username already exists' });

    try {
      const hashedPassword = bcrypt.hashSync(password, 10);
      db.run('INSERT INTO users (username, password, email) VALUES (?, ?, ?)', [cleanUsername, hashedPassword, cleanEmail], function (insertErr) {
        if (insertErr) return res.status(500).json({ error: 'Registration failed' });
        const token = jwt.sign({ id: this.lastID, username: cleanUsername }, JWT_SECRET, { expiresIn: '7d' });
        res.status(201).json({ message: 'User registered successfully', token, user: { id: this.lastID, username: cleanUsername } });
      });
    } catch (hashErr) {
      return res.status(500).json({ error: 'Registration failed' });
    }
  });
});

// Login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
    if (err) return res.status(500).json({ error: 'Login failed' });
    if (!user) return res.status(401).json({ error: 'Invalid username or password' });
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) return res.status(401).json({ error: 'Invalid username or password' });

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ message: 'Login successful', token, user: { id: user.id, username: user.username } });
  });
});

// Get all songs
app.get('/api/songs', (req, res) => {
  const query = `
    SELECT 
      s.id, s.title, s.artist, s.album, s.filename, s.duration, s.is_upload,
      COUNT(v.id) as votes,
      CASE WHEN s.id = ? THEN 'playing' ELSE 'available' END as status
    FROM songs s
    LEFT JOIN votes v ON s.id = v.song_id
    GROUP BY s.id, s.title, s.artist, s.album, s.filename, s.duration, s.is_upload
    ORDER BY s.title ASC
  `;
  db.all(query, [currentlyPlaying.songId], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(rows);
  });
});

// Get playlist
app.get('/api/playlist', (req, res) => {
  const query = `
    SELECT s.id, s.title, s.artist, s.album, s.filename, s.duration,
           COUNT(v.id) as votes,
           CASE WHEN s.id = ? THEN 'playing' ELSE 'queued' END as status
    FROM songs s
    LEFT JOIN votes v ON s.id = v.song_id
    GROUP BY s.id, s.title, s.artist, s.album, s.filename, s.duration
    HAVING COUNT(v.id) > 0
    ORDER BY COUNT(v.id) DESC, s.id ASC
  `;
  db.all(query, [currentlyPlaying.songId], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(rows);
  });
});

// Vote
app.post('/api/vote', authenticateJWT, (req, res) => {
  const { songId } = req.body;
  const userId = req.user.id;
  if (!songId) return res.status(400).json({ error: 'Song ID required' });

  db.get('SELECT id FROM songs WHERE id = ?', [songId], (err, song) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!song) return res.status(404).json({ error: 'Song not found' });

    db.run('INSERT INTO votes (user_id, song_id) VALUES (?, ?)', [userId, songId], function (err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint failed')) return res.status(409).json({ error: 'Already voted' });
        return res.status(500).json({ error: 'Voting failed' });
      }
      res.json({ message: 'Vote added successfully' });
    });
  });
});

// Remove vote
app.delete('/api/vote/:songId', authenticateJWT, (req, res) => {
  const songId = req.params.songId;
  const userId = req.user.id;
  db.run('DELETE FROM votes WHERE user_id = ? AND song_id = ?', [userId, songId], function (err) {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (this.changes === 0) return res.status(404).json({ error: 'Vote not found' });
    res.json({ message: 'Vote removed successfully' });
  });
});

// Upload music
app.post('/api/upload', authenticateJWT, upload.single('musicFile'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const filename = req.file.filename;
  const title = path.basename(req.file.originalname, path.extname(req.file.originalname));

  db.run('INSERT INTO songs (filename, title, artist, album, is_upload, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)',
    [filename, title, 'Unknown Artist', 'Unknown Album', true, req.user.id],
    function (err) {
      if (err) {
        fs.unlink(req.file.path, () => {});
        return res.status(500).json({ error: 'Database error' });
      }
      res.json({ message: 'File uploaded successfully', song: { id: this.lastID, title, artist: 'Unknown Artist', album: 'Unknown Album', filename } });
    });
});

// Stream audio
app.get('/api/stream/:filename', (req, res) => {
  let musicPath = path.join(__dirname, 'uploads', req.params.filename);
  if (!fs.existsSync(musicPath)) musicPath = path.join(__dirname, 'music', req.params.filename);
  if (!fs.existsSync(musicPath)) return res.status(404).json({ error: 'File not found' });

  const stat = fs.statSync(musicPath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = (end - start) + 1;
    const file = fs.createReadStream(musicPath, { start, end });
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'public, max-age=3600'
    });
    file.pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': fileSize, 'Content-Type': 'audio/mpeg', 'Cache-Control': 'public, max-age=3600' });
    fs.createReadStream(musicPath).pipe(res);
  }
});

// Now playing
app.get('/api/now-playing', (req, res) => {
  if (!currentlyPlaying.songId) return res.json({ playing: false });
  db.get('SELECT * FROM songs WHERE id = ?', [currentlyPlaying.songId], (err, song) => {
    if (err || !song) return res.json({ playing: false });
    const now = Date.now();
    let currentTime = 0;
    if (currentlyPlaying.startTime) {
      currentTime = currentlyPlaying.pausedAt
        ? Math.floor((currentlyPlaying.pausedAt - currentlyPlaying.startTime) / 1000)
        : Math.floor((now - currentlyPlaying.startTime) / 1000);
    }
    const remainingTime = Math.max(0, (song.duration || 0) - currentTime);
    res.json({ playing: currentlyPlaying.isPlaying, song, currentTime, remainingTime, duration: song.duration, startedAt: currentlyPlaying.startTime });
  });
});

// Play next
app.post('/api/play-next', authenticateJWT, (req, res) => {
  const query = `
    SELECT s.* FROM songs s
    LEFT JOIN votes v ON s.id = v.song_id
    GROUP BY s.id
    HAVING COUNT(v.id) > 0
    ORDER BY COUNT(v.id) DESC, s.id ASC
    LIMIT 1
  `;
  db.get(query, [], (err, song) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (!song) return res.json({ error: 'No songs in playlist' });

    currentlyPlaying = { songId: song.id, startTime: Date.now(), duration: song.duration, isPlaying: true, pausedAt: null };
    res.json({ message: 'Now playing', song, streamUrl: `/api/stream/${song.filename}` });
  });
});

// Pause/resume
app.post('/api/pause', authenticateJWT, (req, res) => {
  if (!currentlyPlaying.songId) return res.status(400).json({ error: 'Nothing currently playing' });
  const now = Date.now();
  if (currentlyPlaying.isPlaying) {
    currentlyPlaying.isPlaying = false;
    currentlyPlaying.pausedAt = now;
  } else {
    currentlyPlaying.isPlaying = true;
    if (currentlyPlaying.pausedAt && currentlyPlaying.startTime) {
      const pauseDuration = currentlyPlaying.pausedAt - currentlyPlaying.startTime;
      currentlyPlaying.startTime = now - pauseDuration;
    }
    currentlyPlaying.pausedAt = null;
  }
  res.json({ playing: currentlyPlaying.isPlaying, message: currentlyPlaying.isPlaying ? 'Resumed' : 'Paused' });
});

// Skip song
app.post('/api/skip', authenticateJWT, (req, res) => {
  if (!currentlyPlaying.songId) return res.json({ error: 'Nothing currently playing' });
  const songId = currentlyPlaying.songId;
  db.run('DELETE FROM votes WHERE song_id = ?', [songId], err => {
    if (err) return res.status(500).json({ error: 'Database error' });
    currentlyPlaying = { songId: null, startTime: null, duration: null, isPlaying: false, pausedAt: null };
    res.json({ message: 'Song skipped, votes removed' });
  });
});

// Song finished
app.post('/api/song-finished', authenticateJWT, (req, res) => {
  if (!currentlyPlaying.songId) return res.json({ error: 'Nothing currently playing' });
  const songId = currentlyPlaying.songId;
  db.run('DELETE FROM votes WHERE song_id = ?', [songId], err => {
    if (err) return res.status(500).json({ error: 'Database error' });
    currentlyPlaying = { songId: null, startTime: null, duration: null, isPlaying: false, pausedAt: null };
    res.json({ message: 'Song finished, votes removed' });
  });
});

// Error handler
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File too large. Max 50MB.' });
    return res.status(400).json({ error: 'File upload error: ' + error.message });
  }
  res.status(500).json({ error: 'Internal server error' });
});

// 404
app.use((req, res) => res.status(404).json({ error: 'Endpoint not found' }));

// Scan files after 1 second
setTimeout(scanMusicFiles, 1000);

// Start server
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
  db.close(err => {
    if (err) console.error('Error closing database:', err);
    else console.log('Database connection closed');
    process.exit(0);
  });
});
