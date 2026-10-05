# Stage 1: build the ops app (React) into static files.
FROM node:24-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Stage 2: the core. No build step for the server; Node runs the TypeScript directly.
FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY migrations ./migrations
COPY fixtures ./fixtures
COPY config ./config
COPY --from=web /web/dist ./web/dist
ENV WEB_DIST=/app/web/dist
USER node
EXPOSE 8080
CMD ["node", "src/server.ts"]
