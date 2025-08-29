const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Import music metadata library for duration extraction
let mm;
try {
  mm = require('music-metadata');
} catch (error) {
  console.warn('music-metadata not installed. Run: npm install music-metadata');
}

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this';

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      mediaSrc: ["'self'"],
      connectSrc: ["'self'"]
    }
  }
}));

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api/', limiter);

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
const dbPath = process.env.DB_PATH || './database/jukebox.db';
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
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Songs table
  db.run(`
    CREATE TABLE IF NOT EXISTS songs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      artist TEXT,
      album TEXT,
      duration INTEGER DEFAULT 0,
      is_upload BOOLEAN DEFAULT FALSE,
      uploaded_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (uploaded_by) REFERENCES users(id)
    )
  `);

  // Votes table
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

  // Play history table
  db.run(`
    CREATE TABLE IF NOT EXISTS play_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      song_id INTEGER NOT NULL,
      user_id INTEGER,
      played_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      duration_played INTEGER DEFAULT 0,
      completed BOOLEAN DEFAULT FALSE,
      FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  // Player state table
  db.run(`
    CREATE TABLE IF NOT EXISTS player_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      current_song_id INTEGER,
      started_at DATETIME,
      paused_at DATETIME,
      is_playing BOOLEAN DEFAULT FALSE,
      volume REAL DEFAULT 0.7,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (current_song_id) REFERENCES songs(id) ON DELETE SET NULL
    )
  `);

  // Insert initial player state
  db.run('INSERT OR IGNORE INTO player_state (id, is_playing, volume) VALUES (1, FALSE, 0.7)');

  // Add duration column if it doesn't exist (for existing databases)
  db.run('ALTER TABLE songs ADD COLUMN duration INTEGER DEFAULT 0', (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding duration column:', err);
    }
  });
});

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = './uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
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

// Utility Functions
async function getAudioDuration(filePath) {
  if (!mm) {
    console.warn('music-metadata not available, using default duration');
    return 0;
  }
  
  try {
    const metadata = await mm.parseFile(filePath);
    return Math.floor(metadata.format.duration) || 0;
  } catch (error) {
    console.error(`Error reading metadata for ${filePath}:`, error.message);
    return 0;
  }
}

async function extractAudioMetadata(filePath) {
  if (!mm) {
    const filename = path.basename(filePath);
    const title = path.basename(filename, path.extname(filename));
    return {
      title,
      artist: 'Unknown Artist',
      album: 'Unknown Album',
      duration: 0
    };
  }
  
  try {
    const metadata = await mm.parseFile(filePath);
    const filename = path.basename(filePath);
    const title = metadata.common.title || path.basename(filename, path.extname(filename));
    
    return {
      title,
      artist: metadata.common.artist || 'Unknown Artist',
      album: metadata.common.album || 'Unknown Album',
      duration: Math.floor(metadata.format.duration) || 0
    };
  } catch (error) {
    console.error(`Error reading metadata for ${filePath}:`, error.message);
    const filename = path.basename(filePath);
    const title = path.basename(filename, path.extname(filename));
    return {
      title,
      artist: 'Unknown Artist',
      album: 'Unknown Album',
      duration: 0
    };
  }
}

// Music file scanning function
async function scanMusicFiles() {
  const musicDir = './music';
  const uploadsDir = './uploads';
  const supportedFormats = ['.mp3', '.wav', '.flac', '.m4a', '.ogg'];
  
  console.log('Scanning music files...');
  
  // Function to scan a directory
  async function scanDirectory(directory, isUpload = false) {
    if (!fs.existsSync(directory)) {
      console.log(`Directory ${directory} does not exist, skipping...`);
      return;
    }
    
    try {
      const files = fs.readdirSync(directory);
      console.log(`Found ${files.length} files in ${directory}`);
      
      for (const file of files) {
        const filePath = path.join(directory, file);
        const stat = fs.statSync(filePath);
        
        if (stat.isFile()) {
          const ext = path.extname(file).toLowerCase();
          
          if (supportedFormats.includes(ext)) {
            // Check if song already exists
            const existingSong = await new Promise((resolve, reject) => {
              db.get('SELECT id FROM songs WHERE filename = ?', [file], (err, row) => {
                if (err) reject(err);
                else resolve(row);
              });
            });
            
            if (!existingSong) {
              try {
                const metadata = await extractAudioMetadata(filePath);
                
                // Insert new song
                await new Promise((resolve, reject) => {
                  const insertQuery = `
                    INSERT INTO songs (filename, title, artist, album, duration, is_upload) 
                    VALUES (?, ?, ?, ?, ?, ?)
                  `;
                  
                  db.run(insertQuery, [
                    file, 
                    metadata.title, 
                    metadata.artist, 
                    metadata.album, 
                    metadata.duration, 
                    isUpload
                  ], function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                  });
                });
                
                const durationDisplay = metadata.duration > 0 ? 
                  `(${Math.floor(metadata.duration / 60)}:${String(metadata.duration % 60).padStart(2, '0')})` : 
                  '(duration unknown)';
                
                console.log(`Added: ${metadata.title} by ${metadata.artist} ${durationDisplay}`);
              } catch (error) {
                console.error(`Error processing ${file}:`, error);
              }
            }
          }
        }
      }
    } catch (error) {
      console.error(`Error scanning directory ${directory}:`, error);
    }
  }
  
  // Scan both directories
  await scanDirectory(musicDir, false);
  await scanDirectory(uploadsDir, true);
  
  console.log('Music scan complete');
}

// Update song durations for existing songs
async function updateSongDurations() {
  console.log('Starting duration update for all songs...');
  
  const songs = await new Promise((resolve, reject) => {
    db.all('SELECT id, filename, is_upload FROM songs WHERE duration = 0 OR duration IS NULL', [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
  
  console.log(`Found ${songs.length} songs to update`);
  
  for (const song of songs) {
    const filePath = song.is_upload ? 
      path.join('./uploads', song.filename) : 
      path.join('./music', song.filename);
    
    if (fs.existsSync(filePath)) {
      const duration = await getAudioDuration(filePath);
      
      await new Promise((resolve, reject) => {
        db.run('UPDATE songs SET duration = ? WHERE id = ?', [duration, song.id], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      
      const durationDisplay = duration > 0 ? 
        `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}` : 
        'unknown';
      
      console.log(`Updated ${song.filename}: ${durationDisplay}`);
    } else {
      console.warn(`File not found: ${song.filename}`);
    }
  }
  
  console.log('Duration update complete');
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
          username: user.username,
          role: user.role
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
    ORDER BY COUNT(v.id) DESC, s.id ASC
  `;
  
  db.all(query, [currentlyPlaying.songId], (err, rows) => {
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
app.post('/api/upload', authenticateJWT, upload.single('musicFile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  
  try {
    const filePath = req.file.path;
    const filename = req.file.filename;
    
    // Extract metadata
    const metadata = await extractAudioMetadata(filePath);
    
    // Insert into database
    const query = `
      INSERT INTO songs (filename, title, artist, album, duration, is_upload, uploaded_by) 
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    
    db.run(query, [
      filename, 
      metadata.title, 
      metadata.artist, 
      metadata.album, 
      metadata.duration, 
      true, 
      req.user.id
    ], function(err) {
      if (err) {
        console.error('Database error:', err);
        // Clean up uploaded file on database error
        fs.unlink(filePath, (unlinkErr) => {
          if (unlinkErr) console.error('Error deleting file:', unlinkErr);
        });
        return res.status(500).json({ error: 'Database error' });
      }
      
      res.json({ 
        message: 'File uploaded successfully',
        song: {
          id: this.lastID,
          title: metadata.title,
          artist: metadata.artist,
          album: metadata.album,
          duration: metadata.duration,
          filename
        }
      });
    });
  } catch (error) {
    console.error('Upload error:', error);
    // Clean up uploaded file on error
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, (unlinkErr) => {
        if (unlinkErr) console.error('Error deleting file:', unlinkErr);
      });
    }
    res.status(500).json({ error: 'Upload failed' });
  }
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
  
  // Security check - ensure file exists and is within allowed directories
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
  
  const query = `
    SELECT 
      s.id,
      s.title,
      s.artist,
      s.album,
      s.filename,
      s.duration
    FROM songs s 
    WHERE s.id = ?
  `;
  
  db.get(query, [currentlyPlaying.songId], (err, song) => {
    if (err || !song) {
      return res.json({ playing: false });
    }
    
    const now = Date.now();
    let currentTime = 0;
    
    if (currentlyPlaying.startTime) {
      if (currentlyPlaying.pausedAt) {
        // Currently paused
        currentTime = Math.floor((currentlyPlaying.pausedAt - currentlyPlaying.startTime) / 1000);
      } else {
        // Currently playing
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
app.post('/api/play-next', authenticateJWT, (req, res) => {
  const query = `
    SELECT 
      s.id,
      s.title,
      s.artist,
      s.album,
      s.filename,
      s.duration
    FROM songs s 
    LEFT JOIN votes v ON s.id = v.song_id 
    GROUP BY s.id, s.title, s.artist, s.album, s.filename, s.duration
    HAVING COUNT(v.id) > 0
    ORDER BY COUNT(v.id) DESC, s.id ASC
    LIMIT 1
  `;
  
  db.get(query, [], (err, song) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (!song) {
      return res.json({ error: 'No songs in playlist' });
    }
    
    // Update currently playing
    currentlyPlaying = {
      songId: song.id,
      startTime: Date.now(),
      duration: song.duration,
      isPlaying: true,
      pausedAt: null
    };
    
    // Update player state in database
    db.run(
      'UPDATE player_state SET current_song_id = ?, started_at = datetime("now"), is_playing = TRUE, updated_at = datetime("now") WHERE id = 1',
      [song.id]
    );
    
    res.json({
      message: 'Now playing',
      song: song,
      streamUrl: `/api/stream/${song.filename}`
    });
  });
});

// Pause/Resume playback
app.post('/api/pause', authenticateJWT, (req, res) => {
  if (!currentlyPlaying.songId) {
    return res.status(400).json({ error: 'Nothing currently playing' });
  }
  
  const now = Date.now();
  
  if (currentlyPlaying.isPlaying) {
    // Pause
    currentlyPlaying.isPlaying = false;
    currentlyPlaying.pausedAt = now;
  } else {
    // Resume
    currentlyPlaying.isPlaying = true;
    if (currentlyPlaying.pausedAt && currentlyPlaying.startTime) {
      // Adjust start time to account for pause duration
      const pauseDuration = currentlyPlaying.pausedAt - currentlyPlaying.startTime;
      currentlyPlaying.startTime = now - pauseDuration;
    }
    currentlyPlaying.pausedAt = null;
  }
  
  // Update player state in database
  db.run(
    'UPDATE player_state SET is_playing = ?, paused_at = ?, updated_at = datetime("now") WHERE id = 1',
    [currentlyPlaying.isPlaying, currentlyPlaying.pausedAt ? new Date(currentlyPlaying.pausedAt).toISOString() : null]
  );
  
  res.json({ 
    playing: currentlyPlaying.isPlaying,
    message: currentlyPlaying.isPlaying ? 'Resumed' : 'Paused'
  });
});

// Skip to next song (removes votes for current song)
app.post('/api/skip', authenticateJWT, (req, res) => {
  if (!currentlyPlaying.songId) {
    return res.json({ error: 'Nothing currently playing' });
  }
  
  const songId = currentlyPlaying.songId;
  
  // Add to play history as incomplete
  db.run(
    'INSERT INTO play_history (song_id, user_id, completed) VALUES (?, ?, FALSE)',
    [songId, req.user.id]
  );
  
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
    
    // Update player state in database
    db.run('UPDATE player_state SET current_song_id = NULL, is_playing = FALSE, updated_at = datetime("now") WHERE id = 1');
    
    res.json({ message: 'Song skipped, votes removed' });
  });
});

// Song finished - automatically remove votes and clear playing status
app.post('/api/song-finished', authenticateJWT, (req, res) => {
  if (!currentlyPlaying.songId) {
    return res.json({ error: 'Nothing currently playing' });
  }
  
  const songId = currentlyPlaying.songId;
  const playDuration = currentlyPlaying.duration || 0;
  
  // Add to play history as complete
  db.run(
    'INSERT INTO play_history (song_id, user_id, duration_played, completed) VALUES (?, ?, ?, TRUE)',
    [songId, req.user.id, playDuration],
    (err) => {
      if (err) {
        console.error('Error adding to play history:', err);
      }
    }
  );
  
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
    
    // Update player state in database
    db.run('UPDATE player_state SET current_song_id = NULL, is_playing = FALSE, updated_at = datetime("now") WHERE id = 1');
    
    res.json({ message: 'Song finished, votes removed' });
  });
});

// Admin endpoints
app.post('/api/admin/scan-music', authenticateJWT, async (req, res) => {
  // You might want to add admin role checking here
  try {
    await scanMusicFiles();
    res.json({ message: 'Music scan started successfully' });
  } catch (error) {
    console.error('Music scan error:', error);
    res.status(500).json({ error: 'Music scan failed' });
  }
});

app.post('/api/admin/update-durations', authenticateJWT, async (req, res) => {
  // You might want to add admin role checking here
  try {
    await updateSongDurations();
    res.json({ message: 'Duration update completed successfully' });
  } catch (error) {
    console.error('Duration update error:', error);
    res.status(500).json({ error: 'Duration update failed' });
  }
});

// Get play history (optional analytics endpoint)
app.get('/api/admin/play-history', authenticateJWT, (req, res) => {
  const query = `
    SELECT 
      ph.id,
      ph.played_at,
      ph.duration_played,
      ph.completed,
      s.title,
      s.artist,
      u.username
    FROM play_history ph
    JOIN songs s ON ph.song_id = s.id
    LEFT JOIN users u ON ph.user_id = u.id
    ORDER BY ph.played_at DESC
    LIMIT 50
  `;
  
  db.all(query, [], (err, rows) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows);
  });
});

// Get user's votes
app.get('/api/my-votes', authenticateJWT, (req, res) => {
  const query = `
    SELECT 
      v.song_id,
      s.title,
      s.artist,
      v.created_at
    FROM votes v
    JOIN songs s ON v.song_id = s.id
    WHERE v.user_id = ?
    ORDER BY v.created_at DESC
  `;
  
  db.all(query, [req.user.id], (err, rows) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows);
  });
});

// Search songs
app.get('/api/search', (req, res) => {
  const { q } = req.query;
  
  if (!q || q.trim().length === 0) {
    return res.status(400).json({ error: 'Search query is required' });
  }
  
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
    WHERE s.title LIKE ? OR s.artist LIKE ? OR s.album LIKE ?
    GROUP BY s.id, s.title, s.artist, s.album, s.filename, s.duration, s.is_upload
    ORDER BY COUNT(v.id) DESC, s.title ASC
    LIMIT 50
  `;
  
  const searchTerm = `%${q}%`;
  db.all(query, [currentlyPlaying.songId, searchTerm, searchTerm, searchTerm], (err, rows) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows);
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

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err);
    } else {
      console.log('Database connection closed');
    }
    process.exit(0);
  });
});

// Initialize application
async function initializeApp() {
  try {
    // Create required directories
    const dirs = ['./music', './uploads', './database', './public'];
    dirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`Created directory: ${dir}`);
      }
    });
    
    // Load player state from database on startup
    db.get('SELECT * FROM player_state WHERE id = 1', [], (err, state) => {
      if (err) {
        console.error('Error loading player state:', err);
      } else if (state && state.current_song_id) {
        // Restore player state if there was a song playing
        currentlyPlaying = {
          songId: state.current_song_id,
          startTime: state.started_at ? new Date(state.started_at).getTime() : null,
          duration: null,
          isPlaying: false, // Always start paused after server restart
          pausedAt: state.paused_at ? new Date(state.paused_at).getTime() : null
        };
        console.log(`Restored player state: Song ID ${state.current_song_id}`);
      }
    });
    
    // Scan for music files on startup
    console.log('Scanning for music files...');
    await scanMusicFiles();
    
    // Start server
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🎵 Jukebox server running on port ${PORT}`);
      console.log(`🌐 Access at: http://localhost:${PORT}`);
      console.log(`📁 Music directory: ./music`);
      console.log(`📤 Uploads directory: ./uploads`);
      console.log(`🗄️ Database: ${dbPath}`);
      
      if (!mm) {
        console.warn('⚠️  music-metadata not installed. Audio duration extraction disabled.');
        console.warn('   Install with: npm install music-metadata');
      }
    });
    
  } catch (error) {
    console.error('Failed to initialize app:', error);
    process.exit(1);
  }
}

// Export functions for external use
module.exports = {
  app,
  db,
  scanMusicFiles,
  updateSongDurations,
  getAudioDuration
};

// Start the application
if (require.main === module) {
  initializeApp();
}