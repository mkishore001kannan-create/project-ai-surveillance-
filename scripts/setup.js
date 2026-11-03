import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

const readValue = (key) => {
  const match = existing.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return match?.[1]?.trim() || '';
};
const password = readValue('ADMIN_PASSWORD');
const adminPassword = password && !password.startsWith('replace-')
  ? password
  : crypto.randomBytes(12).toString('base64url');
const values = {
  PORT: readValue('PORT') || '8787',
  HOST: readValue('HOST') || '127.0.0.1',
  CLIENT_ORIGIN: readValue('CLIENT_ORIGIN') || 'https://localhost:6116,https://127.0.0.1:6116',
  JWT_SECRET: readValue('JWT_SECRET') && !readValue('JWT_SECRET').startsWith('replace-')
    ? readValue('JWT_SECRET')
    : crypto.randomBytes(32).toString('hex'),
  ADMIN_EMAIL: readValue('ADMIN_EMAIL') || 'admin@example.com',
  ADMIN_PASSWORD: adminPassword,
  SQLITE_PATH: readValue('SQLITE_PATH') || './data/sentinel.sqlite',
};

const managedKeys = new Set(Object.keys(values));
const preservedLines = existing
  .split(/\r?\n/)
  .filter((line) => {
    const key = line.match(/^([A-Z0-9_]+)=/)?.[1];
    return !key || !managedKeys.has(key);
  })
  .filter(Boolean);
const env = [
  ...Object.entries(values).map(([key, value]) => `${key}=${value}`),
  ...preservedLines,
  '',
].join('\n');
fs.writeFileSync(envPath, env);

console.log(`Sentinel setup complete. Admin email: ${values.ADMIN_EMAIL}`);
if (!password || password.startsWith('replace-')) {
  console.log(`Generated admin password: ${adminPassword}`);
  console.log('Save this password before closing the terminal.');
}
