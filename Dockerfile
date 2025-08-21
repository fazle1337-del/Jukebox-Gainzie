FROM node:18-alpine

WORKDIR /app

# Install audio players and dependencies
RUN apt-get update && apt-get install -y \
    mpg123 \
    sox \
    libsox-fmt-all \
    ffmpeg \
    alsa-utils \
    pulseaudio \
    && rm -rf /var/lib/apt/lists/*

# If you're running on a Raspberry Pi, you might also need:
# RUN apt-get install -y libasound2-dev

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application code
COPY . .

# Create directories for music and data
RUN mkdir -p /app/music /app/data /app/uploads

# Build the app (if using a build step)
RUN npm run build || true

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Run the application
CMD ["npm", "start"]
