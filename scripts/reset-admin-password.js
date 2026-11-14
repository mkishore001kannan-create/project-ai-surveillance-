import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import initSqlJs from 'sql.js';
import 'dotenv/config';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
if (!email) throw new Error('ADMIN_EMAIL must be configured before resetting the admin password.');

const databasePath = path.resolve(root, process.env.SQLITE_PATH || './data/sentinel.sqlite');
if (!fs.existsSync(databasePath)) throw new Error(`Sentinel database not found at ${databasePath}.`);

const SQL = await initSqlJs({
  locateFile: (file) => path.join(root, 'node_modules', 'sql.js', 'dist', file),
});
const database = new SQL.Database(new Uint8Array(fs.readFileSync(databasePath)));
const userQuery = database.prepare('SELECT id FROM users WHERE email = ?');
userQuery.bind([email]);
const userExists = userQuery.step();
userQuery.free();
if (!userExists) {
  database.close();
  throw new Error(`Configured admin account ${email} does not exist in the database.`);
}

const password = crypto.randomBytes(18).toString('base64url');
const passwordHash = bcrypt.hashSync(password, 12);
const update = database.prepare('UPDATE users SET password_hash = ?, active = 1, role = ? WHERE email = ?');
update.run([passwordHash, 'admin', email]);
update.free();
fs.writeFileSync(databasePath, Buffer.from(database.export()));
database.close();

const envPath = path.join(root, '.env');
const envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
const updatedEnv = /^ADMIN_PASSWORD=.*$/m.test(envContent)
  ? envContent.replace(/^ADMIN_PASSWORD=.*$/m, `ADMIN_PASSWORD=${password}`)
  : `${envContent.trimEnd()}\nADMIN_PASSWORD=${password}\n`;
fs.writeFileSync(envPath, updatedEnv);

console.log(`Admin password reset for ${email}.`);
console.log(`New password: ${password}`);
console.log('Save this password now; it is shown only once.');
