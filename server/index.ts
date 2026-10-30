import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z, ZodError } from 'zod';
import { mappingSchema } from './domain.ts';
import { readSession, writeSession, changeSession } from './store.ts';
import { ApiError, Notion, jsonRequest } from './notion.ts';
import { chat, prepareAction } from './agent.ts';

export async function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: process.env.NODE_ENV === 'production' ? { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], upgradeInsecureRequests: null } } : false, strictTransportSecurity: process.env.COOKIE_SECURE === 'true' ? undefined : false }));
  app.use('/api', rateLimit({ windowMs: 60000, limit: 90, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Zu viele Anfragen. Bitte eine Minute warten.' } }));
  app.use(express.json({ limit: '24kb' }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(req.method)) {
      if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Fremder Ursprung abgelehnt.' });
      const origin = req.headers.origin;
      const expected = process.env.APP_ORIGIN || `${req.protocol}://${req.get('host')}`;
      if (origin && origin !== expected) return res.status(403).json({ error: 'Ursprung stimmt nicht mit APP_ORIGIN überein.' });
      if (!req.is('application/json')) return res.status(415).json({ error: 'JSON erforderlich.' });
    }
    let id = /(?:^|;\s*)vertrieb_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
    if (!id) {
      id = randomBytes(32).toString('hex');
      res.cookie('vertrieb_session', id, { httpOnly: true, sameSite: 'strict', secure: process.env.COOKIE_SECURE === 'true', maxAge: 30 * 24 * 3600000, path: '/' });
    }
    res.locals.sessionId = id; next();
  });
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/settings', (_req, res) => {
    const s = readSession(res.locals.sessionId);
    res.json({ connected: !!s.notionToken, aiConnected: !!s.aiKey, workspace: s.workspace, model: s.model || 'gpt-4.1-mini', mappings: s.mappings, messages: s.messages, pending: s.pending.filter(p => p.state === 'pending') });
  });
  app.post('/api/connect', async (req, res) => {
    const { token } = z.object({ token: z.string().trim().min(10).max(500) }).parse(req.body);
    const notion = new Notion(token);
    const me = await notion.request('/users/me');
    changeSession(res.locals.sessionId, s => { s.notionToken = token; s.workspace = me.bot?.workspace_name || me.name || 'Notion Workspace'; s.mappings = []; s.pending = []; s.messages = []; });
    res.json({ ok: true });
  });
  app.post('/api/disconnect', (_req, res) => {
    changeSession(res.locals.sessionId, s => { delete s.notionToken; delete s.workspace; s.mappings = []; s.pending = []; s.messages = []; });
    res.json({ ok: true });
  });
  app.post('/api/ai', async (req, res) => {
    const { key, model } = z.object({ key: z.string().trim().max(500).optional(), model: z.string().trim().min(1).max(100) }).parse(req.body);
    const current = readSession(res.locals.sessionId);
    const apiKey = key || current.aiKey;
    if (!apiKey) throw new ApiError('OpenAI API-Schlüssel fehlt.');
    await jsonRequest(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`, apiKey);
    changeSession(res.locals.sessionId, s => { s.aiKey = apiKey; s.model = model; });
    res.json({ ok: true });
  });
  app.delete('/api/ai', (_req, res) => { changeSession(res.locals.sessionId, s => { delete s.aiKey; }); res.json({ ok: true }); });
  const notionFor = (id: string) => { const s = readSession(id); if (!s.notionToken) throw new ApiError('Notion ist noch nicht verbunden.'); return new Notion(s.notionToken); };
  app.get('/api/sources', async (_req, res) => res.json(await notionFor(res.locals.sessionId).sources()));
  app.post('/api/mappings', async (req, res) => {
    const mappings = z.array(mappingSchema).max(3).parse(req.body.mappings);
    if (new Set(mappings.map(m => m.role)).size !== mappings.length || new Set(mappings.map(m => m.sourceId)).size !== mappings.length) throw new ApiError('Jede Rolle und Datenquelle darf nur einmal zugeordnet sein.');
    const notion = notionFor(res.locals.sessionId);
    for (const m of mappings) {
      const source = await notion.source(m.sourceId);
      const allowed: Record<string, string[]> = { status: ['status', 'select', 'checkbox'], company: ['rich_text'], value: ['number'], date: ['date'], email: ['email'], phone: ['phone_number'], relation: ['relation'] };
      for (const [field, types] of Object.entries(allowed)) {
        const name = m[field as 'status' | 'company' | 'value' | 'date' | 'email' | 'phone' | 'relation'];
        if (name && !source.properties.some(p => p.name === name && types.includes(p.type))) throw new ApiError(`Feld „${name}“ hat nicht den passenden Notion-Typ.`);
      }
    }
    changeSession(res.locals.sessionId, s => { s.mappings = mappings; s.pending = s.pending.map(p => p.state === 'pending' ? { ...p, state: 'cancelled' } : p); });
    res.json({ ok: true });
  });
  app.get('/api/records', async (_req, res) => {
    const s = readSession(res.locals.sessionId); const notion = notionFor(res.locals.sessionId);
    const records = [];
    for (const m of s.mappings) records.push(...await notion.records(m));
    res.json({ records, syncedAt: new Date().toISOString() });
  });
  app.post('/api/proposals', async (req, res) => res.json(await prepareAction(res.locals.sessionId, req.body)));
  app.post('/api/proposals/:id/cancel', (req, res) => {
    changeSession(res.locals.sessionId, s => {
      const p = s.pending.find(p => p.id === req.params.id);
      if (!p || p.state !== 'pending') throw new ApiError('Vorschlag nicht mehr verfügbar.', 409);
      p.state = 'cancelled';
    }); res.json({ ok: true });
  });
  app.post('/api/proposals/:id/apply', async (req, res) => {
    const id = res.locals.sessionId;
    const state = readSession(id);
    const proposal = state.pending.find(p => p.id === req.params.id);
    if (!proposal || proposal.state !== 'pending') throw new ApiError('Vorschlag wurde bereits bearbeitet oder ist nicht verfügbar.', 409);
    if (Date.now() - Date.parse(proposal.createdAt) > 3600000) throw new ApiError('Vorschlag ist älter als eine Stunde. Bitte neu vorbereiten.', 409);
    proposal.state = 'applying'; writeSession(id, state);
    try {
      const m = state.mappings.find(m => m.sourceId === proposal.action.sourceId);
      if (!m) throw new ApiError('Datenquelle nicht mehr zugeordnet.');
      const notion = notionFor(id);
      const { properties, page } = await notion.validate(proposal.action, m);
      if (page && page.last_edited_time !== proposal.editedAt) throw new ApiError('Die Seite wurde seit der Vorschau geändert. Bitte Daten aktualisieren und einen neuen Vorschlag erstellen.', 409);
      const result = proposal.action.operation === 'create'
        ? await notion.request('/pages', { parent: { type: 'data_source_id', data_source_id: m.sourceId }, properties })
        : await notion.request(`/pages/${proposal.action.pageId}`, { properties }, 'PATCH');
      changeSession(id, s => { const p = s.pending.find(p => p.id === proposal.id)!; p.state = 'applied'; p.resultUrl = result.url; });
      res.json({ ok: true, url: result.url });
    } catch (error) {
      changeSession(id, s => { const p = s.pending.find(p => p.id === proposal.id); if (p) p.state = 'failed'; });
      throw error;
    }
  });
  app.post('/api/chat', rateLimit({ windowMs: 60000, limit: 8, message: { error: 'Bitte kurz warten, bevor du weitere Nachrichten sendest.' } }), async (req, res) => {
    const { message } = z.object({ message: z.string().trim().min(1).max(4000) }).parse(req.body);
    res.json(await chat(res.locals.sessionId, message));
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpunkt nicht gefunden.' }));
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve('dist')));
    app.get('/{*path}', (_req, res) => res.sendFile(path.resolve('dist/index.html')));
  } else {
    const { createServer } = await import('vite');
    const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  }
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof ZodError) return res.status(400).json({ error: err.issues.map(i => i.message).join(' ') });
    res.status(err instanceof ApiError ? err.status : err.status === 400 ? 400 : 500).json({ error: err instanceof ApiError ? err.message : 'Die Anfrage konnte nicht verarbeitet werden. Bitte erneut prüfen.' });
  });
  return app;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const app = await createApp();
  const port = Number(process.env.PORT || 3000);
  app.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Vertrieb läuft auf Port ${port}`));
}
