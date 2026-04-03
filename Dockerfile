FROM node:20-alpine

WORKDIR /app

# Install dependencies first (cached layer)
COPY package*.json ./
RUN npm ci

# Copy source
COPY tsconfig.json vitest.config.ts eslint.config.js .prettierrc ./
COPY src/ ./src/
COPY tests/ ./tests/

# Runtime data directory
RUN mkdir -p data

EXPOSE 3000

# Default: web server + scheduler
CMD ["npm", "start"]
