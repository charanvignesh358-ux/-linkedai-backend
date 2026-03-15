# Use the official Playwright image for Ubuntu Jammy
FROM mcr.microsoft.com/playwright:v1.41.0-jammy

# Create app directory
WORKDIR /app

# Switch to root user to fix directory permissions if necessary
USER root

# Copy package.json and package-lock.json first for better caching
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy all the backend code
COPY . .

# Ensure standard node port mapping works for Hugging Face Spaces which runs on 7860
ENV PORT=7860
EXPOSE 7860

# Adjust permissions for any playwright artifacts if needed, though usually handled by the image
RUN npx playwright install chromium

# Start the application
CMD ["npm", "start"]
