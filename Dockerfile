FROM node:20-bookworm-slim
WORKDIR /app

# Install C++ build tools for better-sqlite3 native bindings
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY server/ ./server/

EXPOSE 3001
CMD ["node", "server/server.js"]
