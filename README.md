# Sentinel AI Safety Systems

Sentinel is a browser-based safety monitoring platform with AI object detection, multi-camera monitoring, incident history, role-based access, secure authentication, and remote WebRTC camera publishing.

## Features

- Separate command dashboard, recording workspace, and incident history
- Light, dark, and system appearance modes
- Browser camera wall with focus-camera selection and fullscreen support
- COCO-SSD object detection across active local cameras
- Automatic incident capture for fire indicators, crowding, vehicle collisions, and object movement
- Manual WebM recording with download support
- JWT authentication with bcrypt password hashing
- Admin, operator, and viewer roles
- Admin user management
- Ownership-based incident access
- Camera registry with admin access to all registered cameras
- WebRTC remote camera publisher and viewer flow
- HTTPS local development and Vercel/Render deployment configuration

## Requirements

- Node.js 20 or newer
- npm
- A modern browser with camera and WebRTC support
- Camera permission for local or publisher devices

## Local development

Install dependencies:

```bash
npm install
```

Start the secure frontend and API together:

```bash
npm run dev:full
```

The setup command creates `.env` automatically on first run and prints a generated admin password:

```bash
npm run setup
```

Open the single local entry point:

```text
https://127.0.0.1:6116
```

The local certificate is self-signed, so accept the browser warning once. The frontend is served on port `6116`; API requests are proxied through the frontend to the local API on port `8787`.

For another device on the same private network, use:

```text
https://<computer-ip>:6116
```

This local URL is not an internet URL. Devices on different networks require the public deployment described below.

## Environment

For manual configuration, copy `.env.example` to `.env`:

```env
PORT=8787
HOST=127.0.0.1
CLIENT_ORIGIN=https://localhost:6116,https://127.0.0.1:6116
JWT_SECRET=replace-with-a-long-random-secret
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=replace-before-first-start
SQLITE_PATH=./data/sentinel.sqlite
VITE_API_URL=
```

Never commit `.env`, passwords, JWT secrets, bot tokens, or private keys. The repository ignores local environment files.

## Default local login

The first-run setup generates the administrator password and prints it in the terminal. Use the displayed password with the configured `ADMIN_EMAIL`.

Do not use development credentials in production. Change the administrator password before exposing the application publicly.

## Camera workflows

### Local cameras

1. Open the recording workspace.
2. Allow camera access.
3. Click **Start all cameras**.
4. Select a camera tile to focus it.
5. Start or stop manual recording as needed.

AI detection continues independently across active local cameras.

### Remote cameras

1. An authenticated user registers a camera from the dashboard.
2. Open the camera's **Publish** route on the device where the camera is connected.
3. Allow camera access and keep the publisher page open.
4. Open the recording workspace as an authorized user or administrator.
5. The remote camera appears when the WebRTC connection is established.

The remote flow requires an active publisher browser, a public HTTPS deployment, and suitable WebRTC connectivity. A TURN server is recommended for users behind restrictive NAT or firewalls. Remote video is streamed live; persistent server-side video storage requires a separate media-storage service.

## API overview

- `GET /api/health` — service health
- `POST /api/auth/login` — authenticate a user
- `GET /api/auth/me` — get the current user
- `GET /api/users` — list users as an administrator
- `POST /api/users` — create a user as an administrator
- `PATCH /api/users/:id/status` — enable or disable a user
- `GET /api/incidents` — list incidents allowed for the current user
- `POST /api/incidents` — save an incident
- `GET /api/cameras` — list owned cameras, or all cameras for administrators
- `POST /api/cameras` — register a camera
- `PATCH /api/cameras/:id` — update camera metadata
- `DELETE /api/cameras/:id` — remove a camera
- `WS /api/signaling` — authenticated WebRTC signaling relay

## Public deployment: Vercel + Render

This is the recommended way to access Sentinel securely from different networks without exposing a home computer or forwarding router ports.

1. Push the repository to GitHub without committing `.env` or secrets.
2. Import the repository into Vercel. The included `vercel.json` configures the frontend build.
3. Create the API as a Render web service using `render.yaml`.
4. In Render, set:
   - `JWT_SECRET` to a strong unique secret
   - `ADMIN_EMAIL`
   - `ADMIN_PASSWORD`
   - `CLIENT_ORIGIN` to the final Vercel HTTPS URL
5. In Vercel, set `VITE_API_URL` to the final Render HTTPS API URL.
6. Redeploy the frontend after setting `VITE_API_URL`.

Vercel and Render provide trusted HTTPS certificates automatically. Use the generated `https://` URLs.
The Render service is configured to listen on `0.0.0.0`, as required by Render's public routing. Do not copy the local `HOST=127.0.0.1` value into Render.

Verify the API with:

```text
https://<render-service>.onrender.com/api/health
```

SQLite uses the Render persistent disk configured in `render.yaml`. This is suitable for an initial single-instance deployment; use a managed database before scaling horizontally.

## Security notes

- Rotate any Telegram bot token that has ever been exposed in frontend `VITE_*` variables, because Vite embeds those values into browser JavaScript.
- Keep production secrets only in Vercel and Render environment settings.
- Use a TURN service for reliable cross-network WebRTC.
- Restrict `CLIENT_ORIGIN` to the deployed frontend origin.
- Do not expose the local API port directly to the internet.

## Validation commands

```bash
npm run lint
npm run build
node --check server/index.js
```

## Project scripts

- `npm run dev` — start Vite development server
- `npm run server` — start the API server
- `npm run setup` — create or repair local environment defaults
- `npm run dev:full` — start frontend and API together
- `npm run lint` — run ESLint
- `npm run build` — create a production frontend build
