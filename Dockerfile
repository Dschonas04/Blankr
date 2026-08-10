# --- Build stage ---
FROM node:22-alpine AS build
WORKDIR /app
COPY client/package*.json ./client/
RUN cd client && npm install
# shared/ enthaelt den CRDT-Kern und wird vom Client mit eingebunden
COPY shared/ ./shared/
COPY client/ ./client/
RUN cd client && npm run build

# --- Production stage ---
FROM node:22-alpine
WORKDIR /app
COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev
COPY shared/ ./shared/
COPY server/ ./server/
COPY --from=build /app/client/dist ./client/dist

# Boards liegen hier -- als Volume einbinden, sonst sind sie beim
# naechsten Image-Build weg.
ENV BLANKR_DATA=/data
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:8080/healthz >/dev/null || exit 1
CMD ["node", "server/index.js"]
