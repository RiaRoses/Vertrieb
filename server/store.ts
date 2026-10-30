import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { Mapping, Pending } from './domain.ts';
export type Session = { notionToken?: string; aiKey?: string; model?: string; workspace?: string; mappings: Mapping[]; pending: Pending[]; messages: { role: 'user' | 'assistant'; content: string }[] };
const root = path.resolve(process.env.DATA_DIR || '.local');
mkdirSync(root, { recursive: true, mode: 0o700 });
const keyFile = path.join(root, 'encryption.key');
if (!existsSync(keyFile)) writeFileSync(keyFile, randomBytes(32), { mode: 0o600, flag: 'wx' });
const key = readFileSync(keyFile);
function filename(id: string) {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Ungültige Sitzung.');
  return path.join(root, id + '.enc');
}
export function readSession(id: string): Session {
  const file = filename(id);
  if (!existsSync(file)) return { mappings: [], pending: [], messages: [] };
  const data = readFileSync(file);
  const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString());
}
export function writeSession(id: string, state: Session) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(state)), cipher.final()]);
  const file = filename(id), temporary = file + '.tmp';
  writeFileSync(temporary, Buffer.concat([iv, cipher.getAuthTag(), encrypted]), { mode: 0o600 });
  renameSync(temporary, file);
}
export function changeSession(id: string, change: (state: Session) => void) {
  const state = readSession(id); change(state); writeSession(id, state); return state;
}
