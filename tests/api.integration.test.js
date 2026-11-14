import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { after, before, test } from 'node:test';
import WebSocket from 'ws';

const root = path.resolve(import.meta.dirname, '..');
const adminEmail = 'admin@example.test';
const adminPassword = 'temporary-test-admin-password';
let baseUrl;
let temporaryDirectory;
let apiProcess;
let output = '';

const reservePort = async () => {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
};

const request = async (route, { token, ...options } = {}) => {
  const response = await fetch(`${baseUrl}${route}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const body = response.status === 204 ? null : await response.json();
  return { response, body };
};

const login = async (email, password) => {
  const { response, body } = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  return { status: response.status, ...body };
};

const openSocket = async (cameraId, token) => {
  const socket = new WebSocket(`${baseUrl.replace('http', 'ws')}/api/signaling?cameraId=${cameraId}&token=${encodeURIComponent(token)}`);
  await once(socket, 'open');
  return socket;
};

const nextSocketMessage = (socket, predicate = () => true) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    socket.off('message', onMessage);
    reject(new Error('Timed out waiting for signaling message'));
  }, 5000);
  const onMessage = (raw) => {
    const message = JSON.parse(raw.toString());
    if (!predicate(message)) return;
    clearTimeout(timeout);
    socket.off('message', onMessage);
    resolve(message);
  };
  socket.on('message', onMessage);
});

before(async () => {
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'sentinel-api-tests-'));
  const port = await reservePort();
  baseUrl = `http://127.0.0.1:${port}`;
  apiProcess = spawn(process.execPath, ['server/index.js'], {
    cwd: root,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      JWT_SECRET: 'integration-test-secret-do-not-use-in-production',
      ADMIN_EMAIL: adminEmail,
      ADMIN_PASSWORD: adminPassword,
      SQLITE_PATH: path.join(temporaryDirectory, 'sentinel.sqlite'),
      CLIENT_ORIGIN: 'http://127.0.0.1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  apiProcess.stdout.on('data', (chunk) => { output += chunk.toString(); });
  apiProcess.stderr.on('data', (chunk) => { output += chunk.toString(); });

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (apiProcess.exitCode !== null) throw new Error(`Test API exited early:\n${output}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  throw new Error(`Test API did not become ready:\n${output}`);
});

after(async () => {
  if (apiProcess && apiProcess.exitCode === null) {
    apiProcess.kill();
    await once(apiProcess, 'exit');
  }
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
});

test('authentication, role boundaries, ownership, and signaling', async (t) => {
  const health = await request('/api/health');
  assert.equal(health.response.status, 200);
  assert.equal(health.body.status, 'ok');

  const unauthenticatedUsers = await request('/api/users');
  assert.equal(unauthenticatedUsers.response.status, 401);

  const admin = await login(adminEmail, adminPassword);
  assert.equal(admin.status, 200);
  assert.equal(admin.user.role, 'admin');
  assert.equal((await login(adminEmail, 'invalid-password')).status, 401);

  const operatorCreate = await request('/api/users', {
    token: admin.token,
    method: 'POST',
    body: JSON.stringify({ email: 'operator@example.test', password: 'operator-test-password', role: 'operator' }),
  });
  assert.equal(operatorCreate.response.status, 201);

  const viewerCreate = await request('/api/users', {
    token: admin.token,
    method: 'POST',
    body: JSON.stringify({ email: 'viewer@example.test', password: 'viewer-test-password', role: 'viewer' }),
  });
  assert.equal(viewerCreate.response.status, 201);

  const operator = await login('operator@example.test', 'operator-test-password');
  const viewer = await login('viewer@example.test', 'viewer-test-password');
  assert.equal(operator.user.role, 'operator');
  assert.equal((await request('/api/users', { token: operator.token })).response.status, 403);

  const camera = await request('/api/cameras', {
    token: operator.token,
    method: 'POST',
    body: JSON.stringify({ name: 'Integration camera', location: 'test room' }),
  });
  assert.equal(camera.response.status, 201);
  const cameraId = camera.body.camera.id;
  assert.equal((await request('/api/cameras', { token: viewer.token })).body.cameras.length, 0);
  assert.equal((await request('/api/cameras', { token: admin.token })).body.cameras.length, 1);
  assert.equal((await request(`/api/cameras/${cameraId}`, { token: viewer.token, method: 'DELETE' })).response.status, 403);

  const incident = {
    id: 'integration-owned-incident',
    timestamp: Date.now(),
    type: 'test',
    confidence: 99,
    details: 'ownership regression test',
  };
  assert.equal((await request('/api/incidents', { token: operator.token, method: 'POST', body: JSON.stringify(incident) })).response.status, 201);
  const spoofedIncident = await request('/api/incidents', {
    token: viewer.token,
    method: 'POST',
    body: JSON.stringify({ ...incident, type: 'ownership takeover' }),
  });
  assert.equal(spoofedIncident.response.status, 403);
  assert.equal((await request('/api/incidents', { token: operator.token })).body.incidents[0].type, 'test');
  assert.equal((await request('/api/incidents', { token: viewer.token })).body.incidents.length, 0);
  assert.equal((await request('/api/incidents', { token: admin.token })).body.incidents.length, 1);

  const publisherSocket = await openSocket(cameraId, operator.token);
  t.after(() => publisherSocket.close());
  const publisherReady = nextSocketMessage(publisherSocket, (message) => message.type === 'ready');
  assert.equal((await publisherReady).cameraId, cameraId);
  const viewerSocket = await openSocket(cameraId, admin.token);
  t.after(() => viewerSocket.close());
  const offerReceived = nextSocketMessage(viewerSocket, (message) => message.type === 'offer');
  const answerReceived = nextSocketMessage(publisherSocket, (message) => message.type === 'answer');
  publisherSocket.send(JSON.stringify({ type: 'offer', sdp: 'test-offer' }));
  assert.equal((await offerReceived).sdp, 'test-offer');
  viewerSocket.send(JSON.stringify({ type: 'answer', sdp: 'test-answer' }));
  assert.equal((await answerReceived).sdp, 'test-answer');
  publisherSocket.close();
  viewerSocket.close();

  assert.equal((await request(`/api/cameras/${cameraId}`, { token: operator.token, method: 'DELETE' })).response.status, 204);
  assert.equal((await request(`/api/users/${operator.user.id}/status`, {
    token: admin.token,
    method: 'PATCH',
    body: JSON.stringify({ active: false }),
  })).response.status, 200);
  assert.equal((await login('operator@example.test', 'operator-test-password')).status, 401);
  assert.ok(temporaryDirectory.includes('sentinel-api-tests-'));
});
