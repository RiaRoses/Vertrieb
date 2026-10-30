import { z } from 'zod';

export const roles = ['leads', 'prospects', 'tasks'] as const;
export type Role = typeof roles[number];
export const mappingSchema = z.object({
  sourceId: z.string().uuid(), role: z.enum(roles),
  status: z.string().default(''), company: z.string().default(''),
  value: z.string().default(''), date: z.string().default(''),
  email: z.string().default(''), phone: z.string().default(''),
  relation: z.string().default(''),
  prospectStatuses: z.array(z.string()).default([]),
  completedStatuses: z.array(z.string()).default([]),
});
export type Mapping = z.infer<typeof mappingSchema>;
export type Property = { id: string; name: string; type: string; options?: { name: string; color?: string }[] };
export type Source = { id: string; name: string; url: string; properties: Property[] };
export type RecordItem = {
  id: string; sourceId: string; role: Role; name: string; company: string; status: string;
  value: number; date: string; email: string; phone: string; url: string;
  editedAt: string; relations: string[]; done: boolean;
};
export const fieldsSchema = z.object({
  name: z.string().trim().min(1).max(250).optional(),
  company: z.string().max(500).optional(), status: z.string().max(100).optional(),
  value: z.number().nonnegative().max(1e12).nullable().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, 'Ungültiges Datum').nullable().optional(),
  email: z.union([z.email(), z.literal('')]).optional(), phone: z.string().max(100).optional(),
  relation: z.array(z.string().uuid()).max(30).optional(),
}).strict().refine(v => Object.keys(v).length > 0, 'Mindestens ein Feld angeben.');
export const actionSchema = z.object({
  operation: z.enum(['create', 'update']), sourceId: z.string().uuid(),
  pageId: z.string().uuid().nullable().default(null), fields: fieldsSchema,
}).strict().superRefine((v, ctx) => {
  if (v.operation === 'update' && !v.pageId) ctx.addIssue({ code: 'custom', message: 'Seite zum Aktualisieren fehlt.' });
  if (v.operation === 'create' && !v.fields.name) ctx.addIssue({ code: 'custom', message: 'Titel für neue Seite fehlt.' });
  if (v.operation === 'create' && v.pageId) ctx.addIssue({ code: 'custom', message: 'Neue Seite darf keine pageId haben.' });
});
export type Action = z.infer<typeof actionSchema>;
export type Pending = { id: string; action: Action; label: string; createdAt: string; editedAt?: string; state: 'pending' | 'applying' | 'applied' | 'cancelled' | 'failed'; resultUrl?: string };

export function richText(value: any): string {
  return Array.isArray(value) ? value.map(t => t.plain_text ?? t.text?.content ?? '').join('') : '';
}
export function propValue(p: any): any {
  if (!p) return '';
  switch (p.type) {
    case 'title': return richText(p.title);
    case 'rich_text': return richText(p.rich_text);
    case 'select': case 'status': return p[p.type]?.name ?? '';
    case 'number': return p.number ?? 0;
    case 'date': return p.date?.start?.slice(0, 10) ?? '';
    case 'email': case 'phone_number': case 'url': return p[p.type] ?? '';
    case 'checkbox': return p.checkbox;
    case 'people': return p.people?.map((x: any) => x.name).join(', ') ?? '';
    case 'relation': return p.relation?.map((x: any) => x.id) ?? [];
    case 'formula': return propValue({ type: p.formula?.type, ...p.formula });
    default: return '';
  }
}
export function normalizePage(page: any, mapping: Mapping): RecordItem {
  const props = page.properties ?? {};
  const get = (key: 'status' | 'company' | 'value' | 'date' | 'email' | 'phone' | 'relation') => propValue(props[mapping[key]]);
  const status = String(get('status'));
  const statusProp = props[mapping.status];
  // Notion status groups use stable IDs, resolved to option names by the adapter.
  const done = statusProp?.type === 'checkbox' ? !!statusProp.checkbox : mapping.completedStatuses.includes(status);
  return {
    id: page.id, sourceId: mapping.sourceId, role: mapping.role === 'leads' && mapping.prospectStatuses.includes(status) ? 'prospects' : mapping.role,
    name: String(propValue(Object.values(props).find((p: any) => p.type === 'title'))) || 'Ohne Titel',
    company: String(get('company')), status: statusProp?.type === 'checkbox' ? (done ? 'Erledigt' : 'Offen') : status,
    value: Number(get('value')) || 0, date: String(get('date')), email: String(get('email')), phone: String(get('phone')),
    relations: Array.isArray(get('relation')) ? get('relation') : [], url: page.url, editedAt: page.last_edited_time, done,
  };
}
export function buildProperties(action: Action, mapping: Mapping, source: Source): Record<string, any> {
  const result: Record<string, any> = {};
  const types: Record<string, string[]> = { name: ['title'], company: ['rich_text'], status: ['status', 'select', 'checkbox'], value: ['number'], date: ['date'], email: ['email'], phone: ['phone_number'], relation: ['relation'] };
  for (const [field, value] of Object.entries(action.fields)) {
    const name = field === 'name' ? source.properties.find(p => p.type === 'title')?.name : mapping[field as 'status' | 'company' | 'value' | 'date' | 'email' | 'phone' | 'relation'];
    const prop = source.properties.find(p => p.name === name);
    if (!prop || !types[field]?.includes(prop.type)) throw new Error(`Das Feld „${field}“ ist nicht passend mit Notion verknüpft.`);
    switch (prop.type) {
      case 'title': case 'rich_text': result[prop.name] = { [prop.type]: value ? [{ text: { content: String(value) } }] : [] }; break;
      case 'status': case 'select':
        if (!prop.options?.some(o => o.name === value)) throw new Error(`Status „${value}“ ist in Notion nicht vorhanden.`);
        result[prop.name] = { [prop.type]: { name: value } }; break;
      case 'checkbox':
        if (!['Offen', 'Erledigt'].includes(String(value))) throw new Error('Checkbox-Status muss Offen oder Erledigt sein.');
        result[prop.name] = { checkbox: value === 'Erledigt' }; break;
      case 'date': result[prop.name] = { date: value ? { start: value } : null }; break;
      case 'number': result[prop.name] = { number: value }; break;
      case 'email': case 'phone_number': result[prop.name] = { [prop.type]: value || null }; break;
      case 'relation': result[prop.name] = { relation: (value as string[]).map(id => ({ id })) }; break;
    }
  }
  return result;
}
