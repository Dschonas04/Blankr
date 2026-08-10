# --- Frontend bauen ---
FROM node:22-alpine AS client
WORKDIR /app
COPY client/package*.json ./client/
RUN cd client && npm ci
# shared/ enthaelt den CRDT-Kern und wird vom Client mit eingebunden
COPY shared/ ./shared/
COPY client/ ./client/
RUN cd client && npm run build

# --- Server bauen ---
FROM golang:1.25-alpine AS server
WORKDIR /src
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY shared/ ../shared/
COPY server/ ./
# Statisch gelinkt, damit das Ergebnis ohne libc auskommt und in ein
# leeres Image passt.
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /blankr .

# --- Auslieferung ---
FROM alpine:3.21
RUN apk add --no-cache ca-certificates wget && adduser -D -u 10001 blankr
COPY --from=server /blankr /usr/local/bin/blankr
COPY --from=client /app/client/dist /srv/client/dist

# Boards liegen hier -- als Volume einbinden, sonst sind sie beim
# naechsten Image-Build weg.
ENV BLANKR_DATA=/data \
    BLANKR_STATIC=/srv/client/dist \
    PORT=8080
RUN mkdir -p /data && chown blankr:blankr /data
VOLUME ["/data"]
USER blankr

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD wget -qO- http://localhost:8080/healthz >/dev/null || exit 1
ENTRYPOINT ["/usr/local/bin/blankr"]
