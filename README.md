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

## 📁 Project Structure

```
Jukebox-Gainzie/
├── 🐳 Dockerfile              # Container configuration
├── 🐳 docker-compose.yml      # Multi-container orchestration
├── 🚀 setup.sh                # Automated setup script
├── ⚙️ server.js               # Backend Node.js application
├── 📦 package.json            # Node.js dependencies
├── 📖 README.md               # This file
├── 🌐 public/
│   └── index.html             # Frontend web interface
├── 🎵 music/                  # Your music collection (read-only)
├── 💾 data/                   # Application data storage
├── 📤 uploads/                # User uploaded music files
└── 🗄️ database/              # SQLite database storage
```

## 🎮 How to Use

### First Time Setup
1. **Open your browser** and go to `http://your-pi-ip:3001`
2. **Create an account** using the register form
3. **Start voting** on existing songs or upload new ones!

### Adding Music

**Method 1: Direct file copy (bulk)**
```bash
# Copy music files directly to the music directory
cp /path/to/your/songs/* ./music/
# Restart to scan new files
docker-compose restart jukebox
```

**Method 2: Web upload (individual files)**
- Use the "Upload Music" tab in the web interface
- Drag and drop or select multiple files
- Metadata is extracted automatically

### Using the Jukebox
- **Vote for songs** to add them to the playlist
- **Higher voted songs** appear first in the queue
- **Remove your vote** by clicking the vote button again
- **Upload new music** through the web interface
- **View the playlist** to see what's coming up next

## 🛠️ Management & Maintenance

### Common Commands

```bash
# View logs
docker-compose logs -f jukebox

# Restart the jukebox
docker-compose restart jukebox

# Stop the jukebox
docker-compose down

# Update after making changes
docker-compose down && docker-compose up -d --build

# Check status
docker-compose ps

# View resource usage
docker stats pi_jukebox
```

### Backup Your Data

```bash
# Create a backup
tar -czf jukebox-backup-$(date +%Y%m%d).tar.gz data/ database/ uploads/

# Restore from backup
tar -xzf jukebox-backup-YYYYMMDD.tar.gz
```

### Database Management

```bash
# Access SQLite database directly (optional)
sqlite3 database/jukebox.db

# Common queries:
# .tables                    # List all tables
# SELECT * FROM users;       # View all users
# SELECT * FROM songs;       # View all songs
# SELECT * FROM votes;       # View all votes
```

## 🌐 Network Access & Integration

### Access from Other Devices
```bash
# Find your Pi's IP address
hostname -I | awk '{print $1}'

# Access from any device on your network
# http://YOUR_PI_IP:3001
```

### Integration with Umbrel/Home Server
If you're running this on a Pi with Umbrel or other services:

1. **Add to your dashboard** (Dashy, Homer, etc.)
2. **Set up reverse proxy** through nginx-proxy-manager
3. **Create subdomain** like `jukebox.yourdomain.com`

### Firewall Configuration
```bash
# Allow access through UFW (if enabled)
sudo ufw allow 3001
```

## 🔍 Troubleshooting

### Common Issues

**🐳 Container won't start**
```bash
docker-compose logs jukebox
docker system prune  # Clean up if disk space issues
```

**🌐 Can't access from other devices**
```bash
# Check if service is running
docker-compose ps

# Verify port is open
sudo netstat -tlnp | grep :3001

# Test local access first
curl http://localhost:3001/health
```

**🎵 Music files not showing**
```bash
# Check file permissions
ls -la music/

# Verify supported formats (MP3, WAV, FLAC, M4A, OGG)
file music/*.mp3

# Restart to rescan
docker-compose restart jukebox
```

**📊 Database errors**
```bash
# Check database permissions
ls -la database/

# Reset database (⚠️ WARNING: Deletes all users and votes!)
docker-compose down
rm database/jukebox.db
docker-compose up -d
```

### Performance Optimization

**For Raspberry Pi 5:**
- ✅ Use high-quality SD card (Class 10+)
- ✅ Consider USB 3.0 storage for large music collections
- ✅ Limit concurrent users (5-10 recommended)
- ✅ Use compressed audio formats (MP3) for faster loading
- ✅ Regular cleanup of old uploads

### Getting Help

**Logs are your friend:**
```bash
# Application logs
docker-compose logs -f jukebox

# System resources
htop
df -h

# Network connectivity
ss -tlnp | grep :3001
```

## 🔒 Security Considerations

### Important Security Settings

1. **Change the JWT secret:**
```bash
# Edit .env file
JWT_SECRET="your-unique-secret-key-here-make-it-long-and-random"
```

2. **Network security:**
   - Only expose to trusted networks
   - Consider VPN access for remote use
   - Use HTTPS in production (via reverse proxy)

3. **File permissions:**
```bash
# Secure your directories
chmod 755 data/ database/ uploads/
chmod 644 .env
```

## 🚀 Advanced Configuration

### Custom Domains with Reverse Proxy

If you have nginx-proxy-manager or similar:

1. **Create new proxy host**
2. **Forward to:** `localhost:3001`
3. **Domain:** `jukebox.yourdomain.com`
4. **Enable SSL** (Let's Encrypt)

### Environment Variables Reference

```bash
# .env file options
JWT_SECRET=your-secret-key              # Authentication secret
NODE_ENV=production                     # Environment mode
DB_PATH=/app/database/jukebox.db        # Database location
MUSIC_PATH=/app/music                   # Music directory
UPLOAD_PATH=/app/uploads                # Upload directory
MAX_VOTES_PER_USER=5                    # Vote limit per user
PLAYLIST_MAX_SIZE=50                    # Max playlist size
PORT=3000                               # Internal port
```

## 🛡️ API Reference

The jukebox provides a RESTful API for integration:

| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| `/api/register` | POST | Register new user | ❌ |
| `/api/login` | POST | User login | ❌ |
| `/api/songs` | GET | Get all songs with vote counts | ❌ |
| `/api/vote` | POST | Vote for a song | ✅ |
| `/api/vote/:songId` | DELETE | Remove vote | ✅ |
| `/api/playlist` | GET | Get current playlist | ❌ |
| `/api/now-playing` | GET | Get currently playing song | ❌ |
| `/api/upload` | POST | Upload music file | ✅ |
| `/health` | GET | Health check | ❌ |

### Example API Usage

```bash
# Register a new user
curl -X POST http://localhost:3001/api/register \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"testpass"}'

# Vote for a song
curl -X POST http://localhost:3001/api/vote \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{"songId":1}'
```

## 📈 Roadmap & Future Features

### Planned Features
- 🎵 **Audio streaming** - Play music directly through the web interface
- 🎚️ **Volume control** - Adjust playback volume
- 🔀 **Shuffle mode** - Random playlist ordering
- 📱 **PWA support** - Install as a mobile app
- 👥 **User roles** - Admin controls and permissions
- 🎨 **Themes** - Customizable UI themes
- 📊 **Analytics** - Voting statistics and reports
- 🔄 **Auto-DJ mode** - Automatic playlist management

### Contributing
We welcome contributions! Here's how you can help:

1. 🐛 **Report bugs** via GitHub issues
2. 💡 **Suggest features** via GitHub discussions
3. 🔧 **Submit pull requests** with improvements
4. 📖 **Improve documentation**

## 📜 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

### What this means:
- ✅ Free to use for personal and commercial projects
- ✅ Modify and distribute as you wish
- ✅ No warranty or support guarantees
- ✅ Attribution appreciated but not required

## 🙏 Acknowledgments

- **Node.js & Express** - Backend framework
- **SQLite** - Lightweight database
- **Docker** - Containerization platform
- **Raspberry Pi Foundation** - Amazing hardware
- **The open-source community** - For inspiration and tools

## 📞 Support & Community

- 🐛 **Bug Reports**: [GitHub Issues](https://github.com/fazle1337-del/Jukebox-Gainzie/issues)
- 💬 **Discussions**: [GitHub Discussions](https://github.com/fazle1337-del/Jukebox-Gainzie/discussions)
- 📖 **Documentation**: This README and code comments
- ⭐ **Star the repo** if you find it useful!

---

**Happy listening!** 🎵 Enjoy your collaborative jukebox experience!
