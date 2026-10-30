import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir = mkdtempSync(path.join(os.tmpdir(), 'vertrieb-test-'));
process.env.DATA_DIR = dir;
process.env.NODE_ENV = 'production';
const { createApp } = await import('../server/index.ts');
const { MockAgent } = await import('undici');
const { Notion, dispatcher } = await import('../server/notion.ts');
const sid = '11111111-1111-4111-8111-111111111111';
const pid = '22222222-2222-4222-8222-222222222222';
const properties = { Name: { id: 'title', type: 'title' }, Status: { id: 's', type: 'select', select: { options: [{ name: 'Offen' }, { name: 'Erledigt' }] } } };

test('Notion-Verbindung, Zuordnung, Vorschau, Freigabe, Isolation und Konfliktschutz', async t => {
 let edited = '2026-10-30T10:00:00.000Z', writes = 0;
 const original = Notion.prototype.request;
 Notion.prototype.request = async function(endpoint: string, body?: any, method?: string) {
   if (endpoint === '/users/me') return { name: 'Integration', bot: { workspace_name: 'Test CRM' } };
   if (endpoint === '/search') return { results: [{ id: sid, title: [{ plain_text: 'Aufgaben' }], properties }], has_more: false };
   if (endpoint === `/data_sources/${sid}`) return { id: sid, title: [{ plain_text: 'Aufgaben' }], properties };
   if (endpoint.endsWith('/query')) return { results: [{ id: pid, url: 'https://notion.so/' + pid, parent: { data_source_id: sid }, last_edited_time: edited, properties: { Name: { type: 'title', title: [{ plain_text: 'Follow-up' }] }, Status: { type: 'select', select: { name: 'Offen' } } } }], has_more: false };
   if (endpoint === `/pages/${pid}` && !method) return { id: pid, last_edited_time: edited, parent: { data_source_id: sid } };
   if (endpoint === '/pages' || method === 'PATCH') { writes++; return { id: pid, url: 'https://notion.so/' + pid }; }
   throw new Error('Unexpected mock endpoint: ' + endpoint);
 };
 const app = await createApp();
 const server = app.listen(0, '127.0.0.1');
 await new Promise<void>(resolve => server.once('listening', resolve));
 const address = server.address() as { port: number };
 const url = `http://127.0.0.1:${address.port}`;
 let cookie = '';
 async function call(endpoint: string, body?: unknown, ownCookie = cookie, extra: Record<string, string> = {}) {
   const r = await fetch(url + '/api' + endpoint, { method: body === undefined ? 'GET' : 'POST', headers: { ...(ownCookie ? { Cookie: ownCookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
   if (!cookie && r.headers.get('set-cookie')) cookie = r.headers.get('set-cookie')!.split(';')[0];
   return { status: r.status, data: await r.json() as any };
 }
 try {
  await t.test('Schlüssel werden nicht zurückgegeben und verschlüsselt gespeichert', async () => {
   assert.equal((await call('/settings')).data.connected, false);
   assert.equal((await call('/connect', { token: 'ntn_test_secret_never_echo' })).status, 200);
   const s = await call('/settings'); assert.equal(s.data.workspace, 'Test CRM'); assert.equal(JSON.stringify(s.data).includes('ntn_test'), false);
   const encrypted = readdirSync(dir).filter(f => f.endsWith('.enc')); assert.equal(encrypted.length, 1);
   assert.equal(readFileSync(path.join(dir, encrypted[0])).includes(Buffer.from('ntn_test_secret_never_echo')), false);
  });
  await t.test('Zuordnung und echte Adapter-Normalisierung lesen Daten', async () => {
   assert.equal((await call('/mappings', { mappings: [{ sourceId: sid, role: 'tasks', status: 'Status', completedStatuses: ['Erledigt'] }] })).status, 200);
   assert.equal((await call('/records')).data.records[0].name, 'Follow-up');
  });
  let proposal: string;
  await t.test('Vorschlag schreibt nichts; eine andere Sitzung kann ihn nicht ausführen', async () => {
   const p = await call('/proposals', { operation: 'update', sourceId: sid, pageId: pid, fields: { status: 'Erledigt' } });
   assert.equal(p.status, 200); proposal = p.data.id; assert.equal(writes, 0);
   assert.equal((await call(`/proposals/${proposal}/apply`, {}, '')).status, 409); assert.equal(writes, 0);
  });
  await t.test('Freigabe schreibt genau einmal; doppelte Freigabe wird verhindert', async () => {
   assert.equal((await call(`/proposals/${proposal}/apply`, {})).status, 200); assert.equal(writes, 1);
   assert.equal((await call(`/proposals/${proposal}/apply`, {})).status, 409); assert.equal(writes, 1);
  });
  await t.test('Zwischenzeitliche Änderungen verhindern das Überschreiben', async () => {
   const p = await call('/proposals', { operation: 'update', sourceId: sid, pageId: pid, fields: { name: 'Geändert' } });
   edited = '2026-10-30T11:00:00.000Z';
   const result = await call(`/proposals/${p.data.id}/apply`, {}); assert.equal(result.status, 409); assert.match(result.data.error, /seit der Vorschau/); assert.equal(writes, 1);
  });
  await t.test('Erstellen und Verwerfen sowie nicht zugeordnete Quellen', async () => {
   const p = await call('/proposals', { operation: 'create', sourceId: sid, fields: { name: 'Neu' } });
   assert.equal((await call(`/proposals/${p.data.id}/cancel`, {})).status, 200);
   assert.equal((await call(`/proposals/${p.data.id}/apply`, {})).status, 409);
   assert.equal((await call('/proposals', { operation: 'create', sourceId: pid, fields: { name: 'Fremd' } })).status, 400);
   const q = await call('/proposals', { operation: 'create', sourceId: sid, fields: { name: 'Neue Aufgabe' } });
   assert.equal((await call(`/proposals/${q.data.id}/apply`, {})).status, 200); assert.equal(writes, 2);
  });
  await t.test('Agent liest Kontext und bereitet Tool-Aufruf vor, ohne zu schreiben', async () => {
   const remote = new MockAgent(); remote.disableNetConnect();
   const dispatchMock = mock.method(dispatcher, 'dispatch', remote.dispatch.bind(remote));
   try {
    remote.get('https://api.openai.com').intercept({ path: '/v1/models/gpt-4.1-mini', method: 'GET' }).reply(200, { id: 'gpt-4.1-mini' });
    assert.equal((await call('/ai', { key: 'sk_test_not_real', model: 'gpt-4.1-mini' })).status, 200);
    remote.get('https://api.openai.com').intercept({ path: '/v1/responses', method: 'POST' }).reply(200, { output: [{ type: 'function_call', name: 'propose_change', call_id: 'call_1', arguments: JSON.stringify({ operation: 'create', sourceId: sid, fields: { name: 'Agent-Aufgabe' } }) }] });
    remote.get('https://api.openai.com').intercept({ path: '/v1/responses', method: 'POST' }).reply(200, { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Die Aufgabe liegt zur Freigabe bereit.' }] }] });
    const response = await call('/chat', { message: 'Erstelle eine Aufgabe' });
    assert.equal(response.status, 200); assert.equal(response.data.pending.length, 1); assert.equal(writes, 2);
    assert.match(response.data.reply, /Freigabe/);
    assert.equal((await call('/settings')).data.messages.length, 2);
    remote.assertNoPendingInterceptors();
   } finally { dispatchMock.mock.restore(); await remote.close(); }
  });
  await t.test('CSRF, Chat ohne Schlüssel und Trennen', async () => {
   assert.equal((await call('/disconnect', {}, cookie, { Origin: 'https://evil.example' })).status, 403);
   assert.equal((await call('/chat', { message: '' })).status, 400);
   assert.equal((await call('/disconnect', {})).status, 200);
   assert.equal((await call('/records')).status, 400);
  });
 } finally {
  Notion.prototype.request = original;
  await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
  rmSync(dir, { recursive: true, force: true });
 }
});

test('Notion-Paginierung ruft alle Seiten ab', async () => {
 const notion = new Notion('test'); let requests = 0;
 notion.request = async (_path: string, body: any) => { requests++; return body.start_cursor ? { results: [{ id: 'last' }], has_more: false } : { results: [{ id: 'first' }], has_more: true, next_cursor: 'next' }; };
 assert.equal((await notion.all('/search')).length, 2); assert.equal(requests, 2);
});
