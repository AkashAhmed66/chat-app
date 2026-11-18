# Chat App

Real-time chat with authentication, presence, friend requests, notifications, and audio / video calls.

| Layer | Tech |
|---|---|
| Frontend | Next.js (App Router), React, Socket.IO client, LiveKit components |
| Backend | Node.js, Express, Socket.IO, JWT (httpOnly cookie), zod |
| Database | PostgreSQL 16 (migrations run automatically on backend start) |
| Calls | LiveKit server (WebRTC media); signalling goes through Socket.IO |
| Packaging | Docker Compose: `postgres`, `backend`, `app`, `livekit` |

## Quick start

```bash
# 1. (optional) review / change secrets - a working .env with random secrets is included
cp .env.example .env     # only if you want to start fresh

# 2. build and run everything
docker compose up --build
```

Open **http://localhost:5000**, register two accounts (use two different browsers or one normal + one private window), send a friend request from one, accept it from the other, then chat and call.

| Service | URL |
|---|---|
| Web app | http://localhost:5000 |
| Backend API / WebSocket | http://localhost:4000 (`/health` for status) |
| LiveKit | ws://localhost:7880 |

Reset all data: `docker compose down -v`.

## Features

- **Authentication** - register / login / logout; bcrypt password hashes; JWT in an httpOnly, SameSite=Lax cookie shared by REST and WebSocket.
- **Presence** - live online/offline dots everywhere (multi-tab aware, `last_seen_at` stored).
- **All users + search** - paginated directory with case-insensitive search by name or username, showing your relationship to each person.
- **Friend requests** - send, accept, decline, cancel. Sending a request to someone who already requested you accepts it. Chat and calls are limited to friends.
- **Real-time notifications** - friend request / accepted / missed call; stored in Postgres (so offline users see them later), pushed instantly over WebSocket, shown as toasts, a bell with unread count, and optional desktop notifications.
- **Real-time messaging** - persisted in Postgres; optimistic sending, sent / delivered / read ticks, typing indicator, unread badges, last-message previews, history pagination, resync after reconnect.
- **Calls** - from any chat: audio call or video call.
  - Caller sees *Calling...* then *Ringing...* once the callee's device confirms delivery.
  - Callee gets an incoming-call dialog with a ringtone. **Audio call:** `Accept audio`. **Video call:** `Accept video` or `Answer audio only`, plus `Decline`.
  - Caller can cancel; unanswered calls time out after 30 s. Cancelled / unanswered / offline calls leave a *missed call* notification.
  - Busy detection, multi-device dismiss (answering on one device clears the ring on others), and automatic hang-up if a participant drops offline.
  - Every call is logged in the `calls` table.

## Architecture

```
Browser ──REST + Socket.IO (cookie auth)──▶ backend ──▶ postgres
   │                                           │
   └──────────── WebRTC (LiveKit) ◀── token ───┘  (backend mints a per-call, 1 h token
                    ▼                               only after the callee accepts)
                 livekit
```

Socket events: `presence:*`, `message:send|new|self|read|delivered`, `typing`, `notification:new`, `friend:update`, `call:start|incoming|delivered|ringing|accept|accepted|reject|rejected|cancel|cancelled|missed|end|ended|handled`.

```
app/ components/ lib/      Next.js frontend
server/src/                Backend (routes/, socket.ts = chat + call signalling)
server/migrations/*.sql    Database schema
livekit/livekit.yaml       LiveKit config (keys come from .env)
```

## Configuration (`.env`)

| Variable | Purpose |
|---|---|
| `POSTGRES_USER/PASSWORD/DB` | Database credentials (use a URL-safe password) |
| `JWT_SECRET` | >= 32 chars. `openssl rand -hex 32` |
| `COOKIE_SECURE` | `true` when served over HTTPS |
| `CLIENT_ORIGIN` | Browser origin(s) of the web app, for CORS |
| `NEXT_PUBLIC_API_URL` | Backend URL **as the browser sees it**; baked in at build time - rebuild after changing |
| `LIVEKIT_PUBLIC_URL` | LiveKit URL as the browser sees it |
| `LIVEKIT_API_KEY/SECRET` | Shared by the backend and LiveKit |

## Notes for going beyond localhost

- **HTTPS is required** for camera/microphone on anything except `localhost`. Put a TLS reverse proxy in front, set `COOKIE_SECURE=true`, and use `https://` / `wss://` URLs. Keep the web app and backend on the same registrable domain (e.g. `app.example.com` and `api.example.com`) so the SameSite cookie is sent.
- **LiveKit from other machines:** set `use_external_ip: true` (or `rtc.node_ip`) in `livekit/livekit.yaml` and open UDP 50000-50100, TCP 7881, UDP 3478.
- **Scaling the backend:** presence and ring timers live in process memory, so run a single backend instance, or add the Socket.IO Redis adapter and move presence/timers to Redis.
- Auth endpoints are rate-limited per IP (100 / 15 min). Behind a reverse proxy add `app.set("trust proxy", 1)` in `server/src/index.ts`.
- Dependency lockfiles: run `npm install` in the project root and in `server/` once and commit the resulting `package-lock.json` files (the Dockerfiles fall back to `npm install` when a lockfile is missing or stale).

## Local development without Docker for the apps

```bash
docker compose up postgres livekit        # uncomment the postgres "ports" in docker-compose.yml first
cd server && npm install
DATABASE_URL=postgres://chat:<password>@localhost:5432/chat JWT_SECRET=<32+ chars> \
LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=<secret> npm run dev
# in another terminal, from the project root
npm install && npm run dev                 # http://localhost:5000
```
