import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import initSqlJs from 'sql.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '0.0.0.0';
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) throw new Error('JWT_SECRET is required');

const databasePath = path.resolve(__dirname, '..', process.env.SQLITE_PATH || './data/sentinel.sqlite');
fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const SQL = await initSqlJs({ locateFile: (file) => path.resolve(__dirname, '..', 'node_modules', 'sql.js', 'dist', file) });
const database = fs.existsSync(databasePath) ? new SQL.Database(new Uint8Array(fs.readFileSync(databasePath))) : new SQL.Database();
const saveDatabase = () => fs.writeFileSync(databasePath, Buffer.from(database.export()));
const databaseApi = {
  exec: (sql) => database.run(sql),
  prepare: (sql) => ({
    get: (...params) => {
      const statement = database.prepare(sql);
      if (params.length) statement.bind(params.length === 1 && typeof params[0] === 'object' ? params[0] : params);
      const result = statement.step() ? statement.getAsObject() : undefined;
      statement.free();
      return result;
    },
    all: (...params) => {
      const statement = database.prepare(sql);
      if (params.length) statement.bind(params.length === 1 && typeof params[0] === 'object' ? params[0] : params);
      const result = [];
      while (statement.step()) result.push(statement.getAsObject());
      statement.free();
      return result;
    },
    run: (...params) => {
      const statement = database.prepare(sql);
      if (params.length) statement.bind(params.length === 1 && typeof params[0] === 'object' ? params[0] : params);
      statement.step();
      const result = { lastInsertRowid: database.exec('SELECT last_insert_rowid() AS id')[0]?.values[0]?.[0] };
      statement.free();
      saveDatabase();
      return result;
    },
  }),
};
databaseApi.exec('PRAGMA foreign_keys = ON');
databaseApi.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'operator', 'viewer')),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS incidents (
    id TEXT PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES users(id),
    timestamp INTEGER NOT NULL,
    type TEXT NOT NULL,
    confidence INTEGER NOT NULL,
    location TEXT,
    details TEXT,
    image TEXT,
    video_path TEXT
  );
  CREATE TABLE IF NOT EXISTS password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS cameras (
    id TEXT PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    description TEXT,
    stream_url TEXT,
    location TEXT,
    source_type TEXT NOT NULL DEFAULT 'publisher' CHECK (source_type IN ('publisher', 'local')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);
try { databaseApi.exec('ALTER TABLE cameras ADD COLUMN stream_url TEXT'); } catch { /* Existing databases already have the column. */ }

const adminEmail = process.env.ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD;
if (adminEmail && adminPassword && !databaseApi.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail)) {
  const passwordHash = bcrypt.hashSync(adminPassword, 12);
  databaseApi.prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)').run(adminEmail, passwordHash, 'admin');
  console.log(`Created initial admin account for ${adminEmail}`);
}

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN?.split(',') || true }));
app.use(express.json({ limit: '2mb' }));

const issueToken = (user) => jwt.sign({ sub: user.id, role: user.role, email: user.email }, jwtSecret, { expiresIn: '8h' });
const userFromRequest = (request) => {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  try { return jwt.verify(token, jwtSecret); } catch { return null; }
};
const requireAuth = (request, response, next) => {
  const tokenUser = userFromRequest(request);
  if (!tokenUser) return response.status(401).json({ error: 'Authentication required' });
  const user = databaseApi.prepare('SELECT id, email, role, active FROM users WHERE id = ?').get(tokenUser.sub);
  if (!user?.active) return response.status(401).json({ error: 'Account is inactive' });
  request.user = user;
  return next();
};
const requireAdmin = (request, response, next) => {
  if (request.user.role !== 'admin') return response.status(403).json({ error: 'Administrator access required' });
  return next();
};

app.get('/api/health', (_request, response) => response.json({ status: 'ok', service: 'sentinel-api' }));
app.post('/api/auth/login', (request, response) => {
  const email = String(request.body.email || '').trim().toLowerCase();
  const password = String(request.body.password || '');
  const user = databaseApi.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !user.active || !bcrypt.compareSync(password, user.password_hash)) {
    return response.status(401).json({ error: 'Invalid email or password' });
  }
  return response.json({ token: issueToken(user), user: { id: user.id, email: user.email, role: user.role } });
});
app.get('/api/auth/me', requireAuth, (request, response) => response.json({ user: request.user }));

app.get('/api/users', requireAuth, requireAdmin, (_request, response) => {
  const users = databaseApi.prepare('SELECT id, email, role, active, created_at FROM users ORDER BY created_at DESC').all();
  return response.json({ users });
});
app.post('/api/users', requireAuth, requireAdmin, (request, response) => {
  const email = String(request.body.email || '').trim().toLowerCase();
  const password = String(request.body.password || '');
  const role = ['admin', 'operator', 'viewer'].includes(request.body.role) ? request.body.role : 'operator';
  if (!email || password.length < 10) return response.status(400).json({ error: 'Email and password of at least 10 characters are required' });
  try {
    const result = databaseApi.prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)').run(email, bcrypt.hashSync(password, 12), role);
    return response.status(201).json({ id: result.lastInsertRowid, email, role });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return response.status(409).json({ error: 'A user with that email already exists' });
    throw error;
  }
});
app.patch('/api/users/:id/status', requireAuth, requireAdmin, (request, response) => {
  const active = request.body.active ? 1 : 0;
  databaseApi.prepare('UPDATE users SET active = ? WHERE id = ?').run(active, request.params.id);
  return response.json({ active: Boolean(active) });
});

const cameraSelect = `
  SELECT   cameras.id, cameras.name, cameras.description, cameras.stream_url, cameras.location,
    cameras.source_type, cameras.created_at, cameras.updated_at,
    cameras.owner_id, users.email AS owner_email
  FROM cameras JOIN users ON users.id = cameras.owner_id
`;
const canAccessCamera = (user, camera) => user.role === 'admin' || camera?.owner_id === user.id;

app.get('/api/cameras', requireAuth, (request, response) => {
  const cameras = request.user.role === 'admin'
    ? databaseApi.prepare(`${cameraSelect} ORDER BY cameras.created_at DESC`).all()
    : databaseApi.prepare(`${cameraSelect} WHERE cameras.owner_id = ? ORDER BY cameras.created_at DESC`).all(request.user.id);
  return response.json({ cameras });
});
app.post('/api/cameras', requireAuth, (request, response) => {
  const name = String(request.body.name || '').trim();
  const description = String(request.body.description || '').trim() || null;
  const streamUrl = String(request.body.streamUrl || '').trim() || null;
  const location = String(request.body.location || '').trim() || null;
  const sourceType = request.body.sourceType === 'local' ? 'local' : 'publisher';
  if (!name || name.length > 120) return response.status(400).json({ error: 'A camera name of 1-120 characters is required' });
  const id = crypto.randomUUID();
  databaseApi.prepare(`
    INSERT INTO cameras (id, owner_id, name, description, stream_url, location, source_type)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, request.user.id, name, description, streamUrl, location, sourceType);
  return response.status(201).json({
    camera: databaseApi.prepare(`${cameraSelect} WHERE cameras.id = ?`).get(id),
  });
});
app.patch('/api/cameras/:id', requireAuth, (request, response) => {
  const camera = databaseApi.prepare('SELECT * FROM cameras WHERE id = ?').get(request.params.id);
  if (!camera) return response.status(404).json({ error: 'Camera not found' });
  if (!canAccessCamera(request.user, camera)) return response.status(403).json({ error: 'Camera access denied' });
  const name = request.body.name === undefined ? camera.name : String(request.body.name).trim();
  if (!name || name.length > 120) return response.status(400).json({ error: 'A camera name of 1-120 characters is required' });
  const description = request.body.description === undefined ? camera.description : String(request.body.description || '').trim() || null;
  const streamUrl = request.body.streamUrl === undefined ? camera.stream_url : String(request.body.streamUrl || '').trim() || null;
  const location = request.body.location === undefined ? camera.location : String(request.body.location || '').trim() || null;
  databaseApi.prepare(`
    UPDATE cameras SET name = ?, description = ?, stream_url = ?, location = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(name, description, streamUrl, location, request.params.id);
  return response.json({ camera: databaseApi.prepare(`${cameraSelect} WHERE cameras.id = ?`).get(request.params.id) });
});
app.delete('/api/cameras/:id', requireAuth, (request, response) => {
  const camera = databaseApi.prepare('SELECT * FROM cameras WHERE id = ?').get(request.params.id);
  if (!camera) return response.status(404).json({ error: 'Camera not found' });
  if (!canAccessCamera(request.user, camera)) return response.status(403).json({ error: 'Camera access denied' });
  databaseApi.prepare('DELETE FROM cameras WHERE id = ?').run(request.params.id);
  return response.status(204).end();
});

app.get('/api/incidents', requireAuth, (request, response) => {
  const query = request.user.role === 'admin'
    ? databaseApi.prepare('SELECT * FROM incidents ORDER BY timestamp DESC').all()
    : databaseApi.prepare('SELECT * FROM incidents WHERE owner_id = ? ORDER BY timestamp DESC').all(request.user.id);
  return response.json({ incidents: query });
});
app.post('/api/incidents', requireAuth, (request, response) => {
  const incident = request.body;
  if (!incident?.id || !incident.type || !Number.isFinite(Number(incident.timestamp))) return response.status(400).json({ error: 'Incident id, type, and timestamp are required' });
  databaseApi.prepare(`
    INSERT OR REPLACE INTO incidents (id, owner_id, timestamp, type, confidence, location, details, image, video_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    incident.id,
    request.user.id,
    Number(incident.timestamp),
    incident.type,
    Number(incident.confidence || 0),
    incident.location || null,
    incident.details || null,
    incident.image || null,
    incident.videoPath || null,
  );
  return response.status(201).json({ id: incident.id });
});

app.post('/api/auth/password-reset/request', (request, response) => {
  const email = String(request.body.email || '').trim().toLowerCase();
  const user = databaseApi.prepare('SELECT id FROM users WHERE email = ? AND active = 1').get(email);
  if (user) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    databaseApi.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(crypto.createHash('sha256').update(rawToken).digest('hex'), user.id, Date.now() + 15 * 60 * 1000);
    console.log(`Password reset token generated for ${email}: ${rawToken}`);
  }
  return response.json({ message: 'If that account exists, reset instructions have been generated.' });
});

const httpServer = createServer(app);
const signalingServer = new WebSocketServer({ noServer: true });
const signalingRooms = new Map();

const removeSignalingClient = (cameraId, socket) => {
  const room = signalingRooms.get(cameraId);
  if (!room) return;
  room.delete(socket);
  if (!room.size) signalingRooms.delete(cameraId);
};

signalingServer.on('connection', (socket, request, context) => {
  const { cameraId } = context;
  const room = signalingRooms.get(cameraId) || new Set();
  room.add(socket);
  signalingRooms.set(cameraId, room);
  socket.send(JSON.stringify({ type: 'ready', cameraId }));
  socket.on('message', (raw) => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (!['offer', 'answer', 'ice', 'ready'].includes(message.type)) return;
    const payload = JSON.stringify({ ...message, cameraId, senderId: context.user.id });
    room.forEach((peer) => {
      if (peer !== socket && peer.readyState === WebSocket.OPEN) peer.send(payload);
    });
  });
  socket.on('close', () => removeSignalingClient(cameraId, socket));
  socket.on('error', () => removeSignalingClient(cameraId, socket));
});

httpServer.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname !== '/api/signaling') {
    socket.destroy();
    return;
  }
  const token = url.searchParams.get('token');
  const cameraId = url.searchParams.get('cameraId');
  let tokenUser;
  try { tokenUser = token ? jwt.verify(token, jwtSecret) : null; } catch { tokenUser = null; }
  const camera = cameraId && databaseApi.prepare('SELECT * FROM cameras WHERE id = ?').get(cameraId);
  const user = tokenUser && databaseApi.prepare('SELECT id, email, role, active FROM users WHERE id = ?').get(tokenUser.sub);
  if (!user?.active || !camera || !canAccessCamera(user, camera)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  signalingServer.handleUpgrade(request, socket, head, (client) => {
    signalingServer.emit('connection', client, request, { user, cameraId });
  });
});

httpServer.listen(port, host, () => console.log(`Sentinel API listening on ${host}:${port}`));
