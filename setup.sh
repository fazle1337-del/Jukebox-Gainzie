#!/bin/bash

# Pi Jukebox - Automated Setup Script
# This script sets up the Pi Jukebox application with all necessary dependencies

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   log_error "This script should not be run as root"
   exit 1
fi

# Welcome message
echo "🎵 Pi Jukebox Setup Script 🎵"
echo "=================================="
echo ""

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to check system requirements
check_system() {
    log_info "Checking system requirements..."
    
    # Check if we're on a Raspberry Pi
    if grep -q "Raspberry Pi" /proc/cpuinfo 2>/dev/null; then
        log_success "Running on Raspberry Pi"
    else
        log_warning "Not detected as Raspberry Pi, but continuing anyway"
    fi
    
    # Check available disk space (need at least 2GB)
    AVAILABLE_SPACE=$(df . | tail -1 | awk '{print $4}')
    if [ "$AVAILABLE_SPACE" -lt 2097152 ]; then # 2GB in KB
        log_warning "Less than 2GB free space available. Consider freeing up space."
    else
        log_success "Sufficient disk space available"
    fi
    
    # Check if Docker is installed
    if command_exists docker; then
        log_success "Docker is installed"
        
        # Check if Docker daemon is running
        if sudo docker info >/dev/null 2>&1; then
            log_success "Docker daemon is running"
        else
            log_error "Docker daemon is not running. Please start Docker first."
            exit 1
        fi
    else
        log_error "Docker is not installed. Please install Docker first:"
        echo "  curl -fsSL https://get.docker.com -o get-docker.sh"
        echo "  sh get-docker.sh"
        echo "  sudo usermod -aG docker \$USER"
        echo "  newgrp docker"
        exit 1
    fi
    
    # Check if Docker Compose is installed
    if command_exists docker-compose || docker compose version >/dev/null 2>&1; then
        log_success "Docker Compose is available"
    else
        log_error "Docker Compose is not installed. Please install it first:"
        echo "  sudo apt update && sudo apt install docker-compose-plugin"
        exit 1
    fi
}

# Function to create directory structure
create_directories() {
    log_info "Creating directory structure..."
    
    # Create required directories
    mkdir -p music data uploads database public
    
    # Create .gitkeep files for empty directories
    touch music/.gitkeep data/.gitkeep uploads/.gitkeep database/.gitkeep
    
    # Set proper permissions
    chmod 755 music data uploads database public
    
    log_success "Directory structure created"
}

# Function to create environment file
create_env_file() {
    log_info "Creating environment configuration..."
    
    if [ ! -f .env ]; then
        # Generate a random JWT secret
        JWT_SECRET=$(openssl rand -base64 32 2>/dev/null || echo "$(date +%s)-$(whoami)-$(hostname)" | sha256sum | cut -d' ' -f1)
        
        cat > .env << EOF
# Pi Jukebox Configuration
# Generated on $(date)

# Security (IMPORTANT: Keep this secret!)
JWT_SECRET=${JWT_SECRET}

# Application Settings
NODE_ENV=production
DB_PATH=/app/database/jukebox.db
MUSIC_PATH=/app/music
UPLOAD_PATH=/app/uploads

# Limits
MAX_VOTES_PER_USER=5
PLAYLIST_MAX_SIZE=50

# Internal port (don't change unless you know what you're doing)
PORT=3000
EOF
        
        chmod 600 .env  # Restrict permissions
        log_success "Environment file created with secure JWT secret"
    else
        log_info "Environment file already exists, skipping"
    fi
}

# Function to create .gitignore if it doesn't exist
create_gitignore() {
    if [ ! -f .gitignore ]; then
        log_info "Creating .gitignore file..."
        
        cat > .gitignore << EOF
# Dependencies
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Environment
.env.local
.env.*.local

# Data directories
data/*
!data/.gitkeep
database/*.db
uploads/*
!uploads/.gitkeep

# System files
.DS_Store
*.log
Thumbs.db

# IDE files
.vscode/
.idea/
*.swp
*.swo

# Docker
.dockerignore

# Temporary files
tmp/
temp/
EOF
        
        log_success ".gitignore file created"
    fi
}

# Function to add sample music
add_sample_music() {
    if [ -z "$(ls -A music/)" ]; then
        log_info "Music directory is empty. Would you like to add some sample music? (y/N)"
        read -r response
        if [[ "$response" =~ ^[Yy]$ ]]; then
            log_info "You can add your music files to the 'music/' directory"
            log_info "Supported formats: MP3, WAV, FLAC, M4A, OGG"
            log_info "After adding files, restart the jukebox with: docker-compose restart jukebox"
        fi
    else
        MUSIC_COUNT=$(find music/ -type f \( -iname "*.mp3" -o -iname "*.wav" -o -iname "*.flac" -o -iname "*.m4a" -o -iname "*.ogg" \) | wc -l)
        log_success "Found $MUSIC_COUNT music files in music directory"
    fi
}

# Function to build and start the application
start_application() {
    log_info "Building and starting the jukebox..."
    
    # Pull any updates and build
    if command_exists docker-compose; then
        docker-compose pull
        docker-compose up -d --build
    else
        docker compose pull
        docker compose up -d --build
    fi
    
    # Wait a moment for the container to start
    sleep 5
    
    # Check if container is running
    if docker ps | grep -q "pi_jukebox"; then
        log_success "Jukebox is running!"
    else
        log_error "Failed to start jukebox. Checking logs..."
        if command_exists docker-compose; then
            docker-compose logs jukebox
        else
            docker compose logs jukebox
        fi
        exit 1
    fi
}

# Function to display final information
show_completion_info() {
    # Get the local IP address
    LOCAL_IP=$(hostname -I | awk '{print $1}')
    
    echo ""
    echo "🎉 Setup Complete! 🎉"
    echo "==================="
    echo ""
    echo "Your Pi Jukebox is now running and accessible at:"
    echo "  🌐 Local access: http://localhost:3001"
    echo "  🌍 Network access: http://${LOCAL_IP}:3001"
    echo ""
    echo "📁 Directory structure:"
    echo "  🎵 Add music files to: ./music/"
    echo "  📊 Database location: ./database/"
    echo "  📤 User uploads: ./uploads/"
    echo ""
    echo "🔧 Useful commands:"
    echo "  📋 View logs: docker-compose logs -f jukebox"
    echo "  🔄 Restart: docker-compose restart jukebox"
    echo "  🛑 Stop: docker-compose down"
    echo "  📊 Status: docker-compose ps"
    echo ""
    echo "🔐 Security:"
    echo "  🔑 JWT secret has been generated automatically"
    echo "  ⚠️  Keep your .env file secure and don't commit it to git"
    echo ""
    echo "🎵 Happy listening!"
    echo ""
}

# Function to run health check
health_check() {
    log_info "Running health check..."
    
    if curl -f -s http://localhost:3001/health >/dev/null 2>&1; then
        log_success "Health check passed"
        return 0
    else
        log_warning "Health check failed - the service might still be starting"
        return 1
    fi
}

# Main setup function
main() {
    log_info "Starting Pi Jukebox setup..."
    echo ""
    
    # Run setup steps
    check_system
    create_directories
    create_env_file
    create_gitignore
    add_sample_music
    start_application
    
    # Give it a moment to fully start
    log_info "Waiting for services to fully start..."
    sleep 10
    
    # Run health check
    if ! health_check; then
        log_info "Retrying health check in 10 seconds..."
        sleep 10
        health_check || log_warning "Service may still be starting up"
    fi
    
    show_completion_info
}

# Handle script interruption
trap 'log_error "Setup interrupted by user"; exit 1' INT

# Run main function
main

exit 0
