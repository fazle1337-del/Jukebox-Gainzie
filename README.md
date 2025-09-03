# Pi Jukebox - Collaborative Music Voting App with Role-Based Access

A containerized jukebox application for Raspberry Pi featuring a comprehensive three-role system (Admin/Player/User) that allows users to create profiles, vote on music, and collaboratively build playlists from locally stored music files.

## Features

- 🎵 **User Authentication**: Register and login system
- 👥 **Three-Role System**: Admin, Player, and User roles with different permissions
- 🗳️ **Music Voting**: Vote for songs to add them to the playlist
- 📱 **Responsive Web Interface**: Works on phones, tablets, and desktops
- 📁 **File Upload**: Add new music directly through the web interface
- 🎧 **Real-time Updates**: Auto-refresh to show current playlist and voting status
- 🐳 **Containerized**: Easy deployment with Docker
- 💾 **Local Storage**: All music and data stored locally on your Pi
- 🛡️ **Admin Panel**: Complete user and song management interface

## 👥 User Roles & Permissions

The Jukebox implements a comprehensive three-role system with different permission levels:

### 🟥 Admin Users
**Full system control and management capabilities:**
- ✅ Vote on songs and upload music files
- ✅ Control music playback (play, pause, skip)
- ✅ Access admin panel with full system control
- ✅ Manage all users (change roles, delete accounts)
- ✅ Manage all songs (delete, clear votes, force play)
- ✅ Force play any song, reset player, clear all votes
- ✅ View comprehensive system statistics
- ✅ Create and manage player accounts

### 🟦 Player Users
**Music playback control specialists:**
- ❌ Cannot vote on songs or upload music files
- ✅ Can control music playback (play, pause, skip)
- ❌ No admin functions or user management
- ✅ Can view songs and playlist
- ✅ Perfect for DJs or dedicated music controllers

### 🟩 Regular Users
**Standard music voting and contribution:**
- ✅ Can vote on songs and upload music files
- ❌ Cannot control music playback
- ❌ No admin functions or user management
- ✅ Can view songs and playlist
- ✅ Perfect for general users and music contributors

### Role Management
- **Default Role**: New users automatically get "User" role
- **Role Changes**: Only admins can change user roles
- **Visual Indicators**: Role badges displayed next to usernames
- **Permission Enforcement**: Both client-side (UX) and server-side (security) validation

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

8. **Create admin user** (see Admin Setup section below)

## 📁 Project Structure

```
Jukebox-Gainzie/
├── 🐳 Dockerfile              # Container configuration
├── 🐳 docker-compose.yml      # Multi-container orchestration
├── 🚀 setup.sh                # Automated setup script
├── ⚙️ server.js               # Backend Node.js application with role system
├── 📦 package.json            # Node.js dependencies
├── 📖 README.md               # This file
├── 🌐 public/
│   └── index.html             # Frontend web interface with admin panel
├── 🎵 music/                  # Your music collection (read-only)
├── 💾 data/                   # Application data storage
├── 📤 uploads/                # User uploaded music files
└── 🗄️ database/              # SQLite database with role-based schema
```

### Key Components
- **Role-Based Authentication**: Server-side middleware validates user permissions
- **Admin Panel**: Complete web interface for user and song management
- **Permission System**: Three-tier role system (Admin/Player/User)
- **Security**: Database-backed role validation with JWT tokens

## 🎮 How to Use

### First Time Setup
1. **Open your browser** and go to `http://your-pi-ip:3000`
2. **Create an account** using the register form (automatically gets "User" role)
3. **Create an admin user** (see Admin Setup below)
4. **Start voting** on existing songs or upload new ones!

### Default Accounts Setup
**Both admin and player accounts are automatically created on first startup!**

When you start the server for the first time, it will automatically create:

**👑 Admin Account:**
- **Username:** `admin`
- **Password:** `admin123`
- **Role:** `admin` (full system control)

**🎧 Player Account:**
- **Username:** `dj_player`
- **Password:** `player123`
- **Role:** `player` (music playback control)

```bash
# Start the server (both accounts will be created automatically)
node server.js

# Or with Docker
docker-compose up -d
```

**⚠️ IMPORTANT SECURITY STEPS:**
1. **Login immediately** with both accounts
2. **Change the default passwords** in user profiles
3. **Consider changing usernames** for better security
4. **Use the admin account** to manage user roles

### Manual Account Creation (Alternative)
If you need to create additional accounts:

```bash
# Generate password hash
node -e "const bcrypt = require('bcryptjs'); bcrypt.hash('your_password', 10).then(h => console.log(h));"

# Create additional accounts in database
sqlite3 database/jukebox.db
INSERT INTO users (username, password, role, email, created_at)
VALUES ('newadmin', '$2a$10$your_hash_here', 'admin', 'admin@example.com', datetime('now')),
       ('dj_backup', '$2a$10$your_hash_here', 'player', 'dj@example.com', datetime('now'));
.exit
```

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
- **Vote for songs** to add them to the playlist (Users & Admins only)
- **Higher voted songs** appear first in the queue
- **Remove your vote** by clicking the vote button again
- **Upload new music** through the web interface (Users & Admins only)
- **Control playback** with play/pause/skip buttons (Players & Admins only)
- **View the playlist** to see what's coming up next
- **Access Admin Panel** for system management (Admins only)

### Role-Based Features
- **User Role Badge**: Displayed next to your username showing your current role
- **Dynamic UI**: Tabs and features show/hide based on your permissions
- **Permission Messages**: Clear feedback when trying to access restricted features
- **Admin Panel**: Complete management interface for user and song administration

### Admin Panel Features
The Admin Panel provides comprehensive system management:

#### User Management
- View all registered users with their roles and activity
- Change user roles (User ↔ Player ↔ Admin)
- Delete user accounts (with safety confirmations)
- View user voting statistics and join dates

#### Song Management
- View all songs with voting statistics
- Delete songs and associated files
- Clear votes for specific songs
- Force play any song immediately
- View upload statistics

#### System Controls
- Clear all votes system-wide
- Reset player state
- View comprehensive system statistics
- Monitor user activity and song popularity

#### System Statistics
- Total users by role (Admin/Player/User)
- Total songs and uploaded songs
- Total votes across the system
- Real-time player status

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
# http://YOUR_PI_IP:3000
```

### Integration with Umbrel/Home Server
If you're running this on a Pi with Umbrel or other services:

1. **Add to your dashboard** (Dashy, Homer, etc.)
2. **Set up reverse proxy** through nginx-proxy-manager
3. **Create subdomain** like `jukebox.yourdomain.com`

### Firewall Configuration
```bash
# Allow access through UFW (if enabled)
sudo ufw allow 3000
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
sudo netstat -tlnp | grep :3000

# Test local access first
curl http://localhost:3000/health
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

**👥 Role-related issues**
```bash
# Check user roles in database
sqlite3 database/jukebox.db "SELECT username, role FROM users;"

# Update user role manually
sqlite3 database/jukebox.db "UPDATE users SET role='admin' WHERE username='your_username';"

# Clear browser cache if role changes don't show
# Browser Dev Tools → Application → Storage → Clear storage
```

**🔐 Permission errors**
```bash
# Check JWT token contains role information
# Login again to refresh token if role was changed

# Verify middleware is applied to endpoints
docker-compose logs jukebox | grep "requireAdmin\|requirePlayer\|requireUser"
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
ss -tlnp | grep :3000
```

## 🔒 Security Considerations

### Important Security Settings

1. **Change the JWT secret:**
```bash
# Edit .env file
JWT_SECRET="your-unique-secret-key-here-make-it-long-and-random"
```

2. **Role-based security:**
   - Admin accounts should use strong, unique passwords
   - Regularly audit user roles and permissions
   - Limit admin account creation to trusted users only
   - Monitor admin actions through application logs

3. **Network security:**
   - Only expose to trusted networks
   - Consider VPN access for remote admin use
   - Use HTTPS in production (via reverse proxy)

4. **File permissions:**
```bash
# Secure your directories
chmod 755 data/ database/ uploads/
chmod 644 .env
```

### Role System Security
- **Server-side validation**: All permissions are validated server-side, not just client-side
- **Database-backed roles**: User roles are stored in database and validated on each request
- **JWT token security**: Tokens include role information but expire appropriately
- **Admin restrictions**: Admins cannot delete themselves or demote their own roles
- **Audit trail**: All admin actions are logged for security monitoring

## 🚀 Advanced Configuration

### Custom Domains with Reverse Proxy

If you have nginx-proxy-manager or similar:

1. **Create new proxy host**
2. **Forward to:** `localhost:3000`
3. **Domain:** `jukebox.yourdomain.com`
4. **Enable SSL** (Let's Encrypt)

### Environment Variables Reference

```bash
# .env file options
JWT_SECRET=your-secret-key              # Authentication secret (REQUIRED)
NODE_ENV=production                     # Environment mode
DB_PATH=/app/database/jukebox.db        # Database location
MUSIC_PATH=/app/music                   # Music directory
UPLOAD_PATH=/app/uploads                # Upload directory
MAX_VOTES_PER_USER=5                    # Vote limit per user
PLAYLIST_MAX_SIZE=50                    # Max playlist size
PORT=3000                               # Internal port

# Role System Configuration
DEFAULT_USER_ROLE=user                  # Default role for new users
ALLOW_ROLE_CHANGES=true                 # Allow admins to change roles
ADMIN_SESSION_TIMEOUT=3600000           # Admin session timeout (ms)
```

## 🛡️ API Reference

The jukebox provides a RESTful API for integration:

### Public Endpoints
| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| `/api/register` | POST | Register new user | ❌ |
| `/api/login` | POST | User login | ❌ |
| `/api/songs` | GET | Get all songs with vote counts | ❌ |
| `/api/playlist` | GET | Get current playlist | ❌ |
| `/api/now-playing` | GET | Get currently playing song | ❌ |
| `/health` | GET | Health check | ❌ |

### User/Admin Endpoints
| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| `/api/vote` | POST | Vote for a song | ✅ |
| `/api/vote/:songId` | DELETE | Remove vote | ✅ |
| `/api/my-votes` | GET | Get user's votes | ✅ |
| `/api/upload` | POST | Upload music file | ✅ |

### Player/Admin Endpoints
| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| `/api/play-next` | POST | Start next song | ✅ |
| `/api/pause` | POST | Pause/resume playback | ✅ |
| `/api/skip` | POST | Skip current song | ✅ |
| `/api/song-finished` | POST | Mark song as finished | ✅ |

### Admin Only Endpoints
| Endpoint | Method | Description | Auth Required |
|----------|--------|-------------|---------------|
| `/api/admin/users` | GET | List all users | ✅ |
| `/api/admin/users/:id/role` | PUT | Change user role | ✅ |
| `/api/admin/users/:id` | DELETE | Delete user | ✅ |
| `/api/admin/songs/:id` | DELETE | Delete song | ✅ |
| `/api/admin/songs/:id/votes` | DELETE | Clear song votes | ✅ |
| `/api/admin/stats` | GET | Get system statistics | ✅ |
| `/api/admin/play-song/:id` | POST | Force play song | ✅ |
| `/api/admin/votes` | DELETE | Clear all votes | ✅ |
| `/api/admin/reset-player` | POST | Reset player state | ✅ |

### Example API Usage

```bash
# Register a new user (automatically gets 'user' role)
curl -X POST http://localhost:3000/api/register \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"testpass"}'

# Login and get JWT token
curl -X POST http://localhost:3000/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"testpass"}'

# Vote for a song (Users & Admins only)
curl -X POST http://localhost:3000/api/vote \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{"songId":1}'

# Control playback (Players & Admins only)
curl -X POST http://localhost:3000/api/play-next \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Admin: Change user role
curl -X PUT http://localhost:3000/api/admin/users/123/role \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ADMIN_JWT_TOKEN" \
  -d '{"role":"player"}'

# Admin: Get system statistics
curl -X GET http://localhost:3000/api/admin/stats \
  -H "Authorization: Bearer ADMIN_JWT_TOKEN"
```

## 📈 Roadmap & Future Features

### ✅ Implemented Features
- 👥 **User roles** - Three-role system (Admin, Player, User) with permissions
- 🛡️ **Admin Panel** - Complete user and song management interface
- 🎨 **Role-based UI** - Dynamic interface based on user permissions
- 📊 **System Statistics** - Comprehensive admin dashboard

### Planned Features
- 🎵 **Audio streaming** - Enhanced music playback controls
- 🎚️ **Volume control** - Adjust playback volume
- 🔀 **Shuffle mode** - Random playlist ordering
- 📱 **PWA support** - Install as a mobile app
- 🎨 **Themes** - Customizable UI themes
- 📊 **Advanced Analytics** - Detailed voting and usage statistics
- 🔄 **Auto-DJ mode** - Automatic playlist management
- 👥 **Role Customization** - Custom permission sets
- 📱 **Mobile App** - Native mobile applications

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

- **Node.js & Express** - Backend framework with JWT authentication
- **SQLite** - Lightweight database with role-based schema
- **bcryptjs** - Secure password hashing
- **Docker** - Containerization platform
- **Raspberry Pi Foundation** - Amazing hardware
- **Three-Role System** - Comprehensive permission management
- **Admin Panel** - Full-featured user and system management
- **The open-source community** - For inspiration and tools

## 📞 Support & Community

- 🐛 **Bug Reports**: [GitHub Issues](https://github.com/fazle1337-del/Jukebox-Gainzie/issues)
- 💬 **Discussions**: [GitHub Discussions](https://github.com/fazle1337-del/Jukebox-Gainzie/discussions)
- 📖 **Documentation**: This README and code comments
- ⭐ **Star the repo** if you find it useful!

---

**Happy listening!** 🎵 Enjoy your collaborative jukebox experience!
