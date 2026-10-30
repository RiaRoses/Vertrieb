import { fetch, EnvHttpProxyAgent } from 'undici';
import { buildProperties, normalizePage, richText, type Mapping, type Source, type Action } from './domain.ts';
export const dispatcher = new EnvHttpProxyAgent();
export class ApiError extends Error { constructor(message: string, public status = 400) { super(message); } }
export async function jsonRequest(url: string, token: string, body?: unknown, method = body ? 'POST' : 'GET', headers: Record<string, string> = {}) {
  let response;
  try { response = await fetch(url, { method, dispatcher, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000) }); }
  catch { throw new ApiError('Dienst nicht erreichbar oder Zeitlimit überschritten. Bei Schreibaktionen den Stand in Notion prüfen, bevor du eine neue Aktion erstellst.', 502); }
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    const service = url.includes('api.notion.com') ? 'Notion' : 'OpenAI';
    const descriptions: Record<number, string> = { 401: 'Zugangsschlüssel ungültig.', 403: 'Keine Berechtigung. Integration und Seitenfreigaben prüfen.', 404: 'Nicht gefunden oder nicht für die Integration freigegeben.', 429: 'Anfragelimit oder Kontingent erreicht. Bitte später erneut versuchen.' };
    throw new ApiError(`${service}: ${descriptions[response.status] || 'Anfrage abgelehnt. Feldzuordnung und Modell prüfen.'}`, response.status === 401 ? 400 : response.status);
  }
  return data;
}
let notionQueue: Promise<void> = Promise.resolve();
export class Notion {
  constructor(private token: string) {}
  async request(path: string, body?: unknown, method?: string) {
    const ready = notionQueue.then(() => new Promise<void>(resolve => setTimeout(resolve, 350)));
    notionQueue = ready; await ready;
    return jsonRequest(`https://api.notion.com/v1${path}`, this.token, body, method, { 'Notion-Version': '2025-09-03' });
  }
  async all(path: string, body: object = {}) {
    const items: any[] = []; let cursor: string | undefined;
    do {
      const result = await this.request(path, { ...body, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
      items.push(...result.results); cursor = result.has_more ? result.next_cursor : undefined;
      if (cursor && items.length >= 5000) throw new ApiError('Mehr als 5.000 Einträge. Bitte eine kleinere Notion-Datenquelle verwenden; es werden keine unvollständigen Kennzahlen angezeigt.');
      if (cursor) await new Promise(r => setTimeout(r, 350));
    } while (cursor);
    return items;
  }
  async sources(): Promise<Source[]> {
    const results = await this.all('/search', { filter: { property: 'object', value: 'data_source' } });
    return results.map(sourceInfo);
  }
  async source(id: string): Promise<Source> { return sourceInfo(await this.request(`/data_sources/${id}`)); }
  async records(mapping: Mapping) {
    const pages = await this.all(`/data_sources/${mapping.sourceId}/query`, { sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }] });
    return pages.filter(p => !p.archived && !p.in_trash).map(p => normalizePage(p, mapping));
  }
  async validate(action: Action, mapping: Mapping) {
    const source = await this.source(mapping.sourceId);
    const properties = buildProperties(action, mapping, source);
    let page;
    if (action.operation === 'update') {
      page = await this.request(`/pages/${action.pageId}`);
      if (page.parent?.data_source_id !== mapping.sourceId || page.archived || page.in_trash) throw new ApiError('Diese Seite gehört nicht zur gewählten Datenquelle oder wurde archiviert.');
    }
    return { properties, page, source };
  }
}
function sourceInfo(s: any): Source {
  return { id: s.id, name: richText(s.title) || 'Unbenannte Datenquelle', url: s.url || '', properties: Object.entries(s.properties ?? {}).map(([name, p]: [string, any]) => ({ id: p.id, name, type: p.type, options: p[p.type]?.options?.map((o: any) => ({ name: o.name, color: o.color })) })) };
}
