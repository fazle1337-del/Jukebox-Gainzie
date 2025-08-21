const { spawn } = require('child_process');
const path = require('path');
const EventEmitter = require('events');

class MusicPlayer extends EventEmitter {
    constructor(db) {
        super();
        this.db = db;
        this.currentProcess = null;
        this.currentSong = null;
        this.isPlaying = false;
        this.volume = 50; // Default volume (0-100)
        
        // Start the playlist manager
        this.startPlaylistManager();
    }

    async getCurrentPlaylist() {
        return new Promise((resolve, reject) => {
            const query = `
                SELECT s.*, COUNT(v.id) as votes 
                FROM songs s 
                INNER JOIN votes v ON s.id = v.song_id 
                GROUP BY s.id
                ORDER BY votes DESC, s.title ASC
            `;
            this.db.all(query, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    }

    async getNextSong() {
        const playlist = await this.getCurrentPlaylist();
        return playlist.length > 0 ? playlist[0] : null;
    }

    async playSong(song) {
        if (this.currentProcess) {
            this.stopCurrentSong();
        }

        this.currentSong = song;
        const songPath = song.file_path; // Use the full file_path from database
        
        // Use mpg123 for MP3 files, or sox/ffplay for other formats
        // Install these in your Dockerfile: RUN apt-get update && apt-get install -y mpg123 sox ffmpeg
        let player;
        const ext = path.extname(song.filename).toLowerCase();
        
        if (ext === '.mp3') {
            player = spawn('mpg123', ['-q', '--gain', this.volume.toString(), songPath]);
        } else {
            // For other formats, use ffplay (part of ffmpeg)
            player = spawn('ffplay', ['-nodisp', '-autoexit', '-volume', this.volume.toString(), songPath]);
        }

        this.currentProcess = player;
        this.isPlaying = true;

        console.log(`Now playing: ${song.title} by ${song.artist}`);
        this.emit('songStarted', song);

        player.on('close', (code) => {
            console.log(`Song finished: ${song.title}`);
            this.isPlaying = false;
            this.currentProcess = null;
            this.currentSong = null;
            
            // Remove all votes for this song since it's finished playing
            this.removeAllVotesForSong(song.id);
            
            this.emit('songFinished', song);
            
            // Auto-play next song
            setTimeout(() => this.playNext(), 1000);
        });

        player.on('error', (error) => {
            console.error(`Error playing song: ${error}`);
            this.emit('songError', song, error);
            this.playNext();
        });
    }

    stopCurrentSong() {
        if (this.currentProcess) {
            this.currentProcess.kill('SIGTERM');
            this.currentProcess = null;
            this.isPlaying = false;
            this.emit('songStopped', this.currentSong);
        }
    }

    async playNext() {
        const nextSong = await this.getNextSong();
        if (nextSong) {
            await this.playSong(nextSong);
        } else {
            console.log('Playlist is empty, waiting for votes...');
            this.emit('playlistEmpty');
        }
    }

    removeAllVotesForSong(songId) {
        return new Promise((resolve, reject) => {
            this.db.run('DELETE FROM votes WHERE song_id = ?', [songId], function(err) {
                if (err) {
                    console.error('Error removing votes:', err);
                    reject(err);
                } else {
                    console.log(`Removed ${this.changes} votes for song ID ${songId}`);
                    resolve(this.changes);
                }
            });
        });
    }

    setVolume(newVolume) {
        this.volume = Math.max(0, Math.min(100, newVolume));
        console.log(`Volume set to: ${this.volume}%`);
        // Note: This won't affect currently playing song, only future ones
        // For real-time volume control, you'd need a different approach
    }

    async startPlaylistManager() {
        // Check for new songs to play every 5 seconds if nothing is playing
        setInterval(async () => {
            if (!this.isPlaying) {
                const nextSong = await this.getNextSong();
                if (nextSong) {
                    await this.playSong(nextSong);
                }
            }
        }, 5000);
    }

    getCurrentStatus() {
        return {
            isPlaying: this.isPlaying,
            currentSong: this.currentSong,
            volume: this.volume
        };
    }
}

module.exports = MusicPlayer;
