# Pi Jukebox - Collaborative Music Voting App

A containerized jukebox application for Raspberry Pi that allows users to create profiles, vote on music, and collaboratively build playlists from locally stored music files.

## Features

- 🎵 **User Authentication**: Register and login system
- 🗳️ **Music Voting**: Vote for songs to add them to the playlist
- 📱 **Responsive Web Interface**: Works on phones, tablets, and desktops
- 📁 **File Upload**: Add new music directly through the web interface
- 🎧 **Real-time Updates**: Auto-refresh to show current playlist and voting status
- 🐳 **Containerized**: Easy deployment with Docker
- 💾 **Local Storage**: All music and data stored locally on your Pi

## Quick Start

### Prerequisites

- Raspberry Pi 5 with Raspberry Pi OS
- Docker and Docker Compose installed
- Music files in MP3, WAV, FLAC, M4A, or OGG format

### Installation

1. **Clone/Create the project directory:**
```bash
mkdir pi-jukebox && cd pi-jukebox
```

2. **Create the project structure:**
```bash
mkdir -p music data uploads public database
```

3. **Create the files** (use the provided Dockerfile, docker-compose.yml, server.js, package.json)

4. **Copy your music files:**
```bash
# Copy your music collection to the music directory
cp -r /path/to/your/music/* ./music/
```

5. **Set up environment:**
```bash
# Create .env file
cat > .env << EOF
JWT_SECRET=your-super-secret-jwt-key-change-this-to-something-secure
NODE_ENV=production
EOF
```

6. **Build and run:**
```bash
# Build and start the containers
docker-compose up -d

# Check if it's running
docker-compose ps
```

7. **Access the app:**
   - Open your browser and go to `http://your-pi-ip:3000`
   - Or `http://localhost:3000` if accessing from the Pi itself

### Directory Structure

```
pi-jukebox/
├── Dockerfile
├── docker-compose.yml
├── server.js
├── package.json
├── public/
│   └── index.html
├── music/           # Your music collection (read-only)
├── data/            # App data storage
├── uploads/         # User uploaded music
└── database/        # SQLite database
```

## Usage

### First Time Setup

1. **Access the web interface** at `http://your-pi-ip:3000`
2. **Register** a new user account
3. **Upload music** or vote on existing songs
4. **Watch the playlist** update based on votes!

### Adding Music

**Option 1: Copy files directly**
```bash
# Copy music files to the music directory
cp /path/to/your/songs/* ./music/
# Restart the container to scan new files
docker-compose restart
```

**Option 2: Upload through web interface**
- Use the "Upload Music" tab in the web app
- Supports drag-and-drop and multiple file selection
- Automatically extracts metadata (title, artist, duration)

### Managing the App

```bash
# View logs
docker-compose logs -f

# Stop the app
docker-compose down

# Update the app (after making changes)
docker-compose down
docker-compose up -d --build

# Backup your data
tar -czf jukebox-backup-$(date +%Y%m%d).tar.gz data/ database/ uploads/

# View database (optional)
sqlite3 database/jukebox.db
```

## Configuration

### Environment Variables

Edit `docker-compose.yml` to customize:

- `JWT_SECRET`: Secret key for user authentication
- `MAX_VOTES_PER_USER`: Limit votes per user (default: 5)
- `PLAYLIST_MAX_SIZE`: Maximum playlist size (default: 50)

### Network Access

To access from other devices on your network:

1. **Find your Pi's IP address:**
```bash
ip addr show | grep 'inet ' | grep -v '127.0.0.1'
```

2. **Access from other devices:**
   - `http://192.168.1.XXX:3000` (replace with your Pi's IP)

3. **Optional: Set up port forwarding** on your router for external access

## API Endpoints

The app provides a REST API:

- `POST /api/register` - Register new user
- `POST /api/login` - User login
- `GET /api/songs` - Get all songs with vote counts
- `POST /api/vote` - Vote for a song
- `DELETE /api/vote/:songId` - Remove vote
- `GET /api/playlist` - Get current playlist
- `GET /api/now-playing` - Get currently playing song
- `POST /api/upload` - Upload music file

## Troubleshooting

### Common Issues

**Container won't start:**
```bash
# Check logs
docker-compose logs

# Check disk space
df -h

# Rebuild container
docker-compose down
docker-compose up -d --build
```

**Can't access from other devices:**
- Check Pi's firewall: `sudo ufw status`
- Ensure Pi is on same network
- Try `http://pi-ip:3000` instead of `localhost`

**Music files not showing:**
- Check file permissions: `ls -la music/`
- Supported formats: MP3, WAV, FLAC, M4A, OGG
- Restart container after adding files

**Database errors:**
```bash
# Check database directory permissions
ls -la database/

# Reset database (WARNING: deletes all users and votes)
rm database/jukebox.db
docker-compose restart
```

### Performance Tips

**For better performance on Pi 5:**
- Use high-quality SD card (Class 10 or better)
- Consider USB 3.0 storage for large music collections
- Limit concurrent users (5-10 recommended)
- Use compressed audio formats (MP3) for faster loading

## Security Notes

- Change the default JWT secret in production
- Consider adding HTTPS with the included nginx configuration
- Limit network access if needed
- Regularly backup your database and uploads

## Development

To modify the app:

1. **Edit files** as needed
2. **Rebuild container:**
```bash
docker-compose down
docker-compose up -d --build
```

3. **For development:**
```bash
# Run without Docker
npm install
node server.js
```

## License

MIT License - feel free to modify and distribute!

---

Enjoy your collaborative jukebox! 🎵
