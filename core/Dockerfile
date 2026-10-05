FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY migrations ./migrations
COPY fixtures ./fixtures
USER node
EXPOSE 8080
CMD ["sh", "-c", "node src/migrate.ts && node src/seed.ts && node src/server.ts"]
