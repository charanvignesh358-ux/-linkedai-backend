# Use the official Playwright image — has Chromium + all deps pre-installed
FROM mcr.microsoft.com/playwright:v1.41.0-jammy

# Create app directory
WORKDIR /app

# Switch to root for permissions
USER root

# Copy package files first (better layer caching)
COPY package*.json ./

# Install Node dependencies (skip Playwright browser download — already in image)
RUN npm install --omit=dev

# Copy all backend source code
COPY . .

# Set environment variables
ENV PORT=8080
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Expose the port Railway uses
EXPOSE 8080

# Start the server
CMD ["node", "server.js"]
