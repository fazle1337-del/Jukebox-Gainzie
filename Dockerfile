FROM node:18-alpine

WORKDIR /app

# Install system dependencies for audio processing
RUN apk add --no-cache \
    ffmpeg \
    python3 \
    make \
    g++ \
    sqlite

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

# Create entrypoint script
RUN echo '#!/bin/sh' > /app/entrypoint.sh && \
    echo 'mkdir -p /app/database' >> /app/entrypoint.sh && \
    echo 'chown -R node:node /app/database' >> /app/entrypoint.sh && \
    echo 'exec "$@"' >> /app/entrypoint.sh && \
    chmod +x /app/entrypoint.sh

# Clear votes on startup and run the application
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["sh", "-c", "node clear_votes.js && npm start"]
