# Sentinel AI Safety Systems

## Local full-stack development

1. Run `npm install`.
2. Run `npm run dev:full`. The first run creates `.env` and prints a generated admin password.
3. Open `https://127.0.0.1:6116` and accept the local development certificate warning once.

To configure the environment manually, copy `.env.example` to `.env` and set `JWT_SECRET`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD`.

The frontend runs over HTTPS on port `6116` on all network interfaces; the API runs on localhost port `8787` and is reached through the encrypted frontend proxy. On another device on the same network, open `https://<computer-ip>:6116` and accept the development certificate warning. Internet-wide access should use the Vercel/Render deployment below, which provides trusted HTTPS certificates automatically. The API uses SQLite and creates the initial administrator on first start. The browser app uses the API token for login and sends incidents to the API. Operators can access their own incidents; administrators can review all incidents and create or disable users.

## Universal deployment

- Push this repository to GitHub without committing `.env` or any secret values.
- Import the repository into Vercel and deploy the frontend using the included `vercel.json`.
- Create the API as a Render web service using `render.yaml`.
- In Render, set `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `CLIENT_ORIGIN` to the final Vercel URL, for example `https://your-app.vercel.app`.
- In Vercel, set `VITE_API_URL` to the final Render API URL, for example `https://sentinel-api.onrender.com`.
- Redeploy Vercel after setting `VITE_API_URL`.
- Keep `JWT_SECRET`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` only in the hosting providers' secret environment variables.
- Vercel and Render provide HTTPS automatically; use the generated `https://` URLs, not `http://`.

After deployment, the public app is available at the Vercel URL from any network. Verify the API at `https://your-api.onrender.com/api/health`.

## Remote camera foundation

Authenticated users can register camera metadata through the API:

- `GET /api/cameras` lists the caller's cameras; administrators receive all cameras.
- `POST /api/cameras` registers `{ "name", "streamUrl?", "description?", "location?", "sourceType?" }`. `sourceType` is `publisher` (default) or `local`.
- `PATCH /api/cameras/:id` updates metadata and `DELETE /api/cameras/:id` removes a camera. Owners and administrators may manage cameras.

The API also exposes a lightweight signaling relay at
`ws(s)://<api-host>/api/signaling?cameraId=<id>&token=<jwt>`. It authenticates the JWT and camera access, then relays bounded `offer`, `answer`, and `ice` messages between connected peers for that camera. This is signaling only: no remote camera publisher, WebRTC negotiation, TURN service, media storage, or live video playback is implemented yet. Existing browser/local camera support remains unchanged.

Telegram bot tokens must be rotated before public deployment if they have ever been placed in a frontend `VITE_*` variable, because Vite embeds those values into browser JavaScript.

SQLite is stored on the Render persistent disk configured in `render.yaml`. This is suitable for an initial single-region deployment; migrate to a managed database before scaling the API horizontally.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh
