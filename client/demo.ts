import type { RecordItem } from '../server/domain';
const day = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv-SE'); };
export const demoRecords: RecordItem[] = [
  ['1', 'leads', 'Mara Hoffmann', 'Studio Nord', 'Neu', 4800, 1],
  ['2', 'prospects', 'Felix Weber', 'Weber & Co.', 'Angebot', 12500, 0],
  ['3', 'prospects', 'Lea Bergmann', 'Bloom Collective', 'Verhandlung', 8400, 2],
  ['4', 'leads', 'Jonas Fischer', 'Atelier Fischer', 'Kontaktiert', 3200, -1],
  ['5', 'prospects', 'Sofia Richter', 'Forma Design', 'Qualifiziert', 6700, 3],
  ['6', 'leads', 'Ben Schneider', 'Kraftwerk Digital', 'Neu', 5800, 1],
  ['7', 'tasks', 'Angebot mit Felix besprechen', 'Weber & Co.', 'Offen', 0, 0],
  ['8', 'tasks', 'Follow-up an Jonas senden', 'Atelier Fischer', 'Offen', 0, -1],
  ['9', 'tasks', 'Erstgespräch vorbereiten', 'Studio Nord', 'In Arbeit', 0, 0],
  ['10', 'tasks', 'Portfolio für Lea zusammenstellen', 'Bloom Collective', 'Offen', 0, 1],
].map(([id, role, name, company, status, value, date]) => ({ id: String(id), sourceId: 'demo', role: role as RecordItem['role'], name: String(name), company: String(company), status: String(status), value: Number(value), date: day(Number(date)), email: '', phone: '', url: '', editedAt: new Date().toISOString(), relations: [], done: false }));
