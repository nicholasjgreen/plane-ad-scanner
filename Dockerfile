FROM node:20-alpine

WORKDIR /app

# Install dependencies first (cached layer)
COPY package*.json ./
RUN npm ci

# Copy source
COPY tsconfig.json vitest.config.ts eslint.config.js .prettierrc ./
COPY src/ ./src/
COPY tests/ ./tests/
COPY profiles/ ./profiles/

# Runtime data directory (airports.csv committed to git)
RUN mkdir -p data
COPY data/airports.csv ./data/airports.csv

EXPOSE 3000

# Default: web server + scheduler
CMD ["npm", "start"]
