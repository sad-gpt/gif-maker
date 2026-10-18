import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
if (!fs.existsSync('.env')) fs.copyFileSync('.env.example', '.env');
let env = fs.readFileSync('.env', 'utf8');
if (/^SESSION_SECRET=\s*$/m.test(env)) {
  env = env.replace(/^SESSION_SECRET=\s*$/m, `SESSION_SECRET=${randomBytes(48).toString('base64url')}`);
  fs.writeFileSync('.env', env, { mode: 0o600 });
}
console.log('Local environment is ready. GitHub credentials belong in .env; they are never printed.');
