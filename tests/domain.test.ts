import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionSchema, buildProperties, mappingSchema, normalizePage, type Source } from '../server/domain.ts';
const sourceId = '11111111-1111-4111-8111-111111111111';
const mapping = mappingSchema.parse({ sourceId, role: 'leads', status: 'Phase', value: 'Wert', date: 'Datum', company: 'Firma', prospectStatuses: ['Angebot'] });
const source: Source = { id: sourceId, name: 'CRM', url: '', properties: [{ id: 'title', name: 'Kontakt', type: 'title' }, { id: 's', name: 'Phase', type: 'select', options: [{ name: 'Angebot' }] }, { id: 'n', name: 'Wert', type: 'number' }, { id: 'd', name: 'Datum', type: 'date' }, { id: 'r', name: 'Firma', type: 'rich_text' }] };
test('CRM-Seiten werden anhand der zugeordneten Statuswerte zu Prospects', () => {
 const record = normalizePage({ id: 'p', properties: { Kontakt: { type: 'title', title: [{ plain_text: 'Mara' }] }, Phase: { type: 'select', select: { name: 'Angebot' } }, Wert: { type: 'number', number: 4200 } } }, mapping);
 assert.equal(record.name, 'Mara'); assert.equal(record.role, 'prospects'); assert.equal(record.value, 4200); assert.equal(record.company, '');
});
test('Select-Status erledigt nur mit expliziter Zuordnung; Checkbox direkt', () => {
 const m = mappingSchema.parse({ sourceId, role: 'tasks', status: 'Status', completedStatuses: ['Fertig'] });
 assert.equal(normalizePage({ properties: { Status: { type: 'select', select: { name: 'Fertig' } } } }, m).done, true);
 assert.equal(normalizePage({ properties: { Status: { type: 'select', select: { name: 'Offen' } } } }, m).done, false);
 assert.equal(normalizePage({ properties: { Status: { type: 'checkbox', checkbox: true } } }, m).done, true);
});
test('Schreibvorschläge erhalten typisierte Notion-Eigenschaften und können Werte leeren', () => {
 const action = actionSchema.parse({ operation: 'create', sourceId, fields: { name: 'Mara', status: 'Angebot', value: null, date: null, company: '' } });
 assert.deepEqual(buildProperties(action, mapping, source), { Kontakt: { title: [{ text: { content: 'Mara' } }] }, Phase: { select: { name: 'Angebot' } }, Wert: { number: null }, Datum: { date: null }, Firma: { rich_text: [] } });
});
test('Fremde Felder, unzulässige Statuswerte und falsche Notion-Typen werden abgewiesen', () => {
 assert.throws(() => buildProperties(actionSchema.parse({ operation: 'create', sourceId, fields: { name: 'A', status: 'Erfunden' } }), mapping, source), /nicht vorhanden/);
 assert.throws(() => buildProperties(actionSchema.parse({ operation: 'create', sourceId, fields: { name: 'A', email: 'a@b.de' } }), mapping, source), /nicht passend/);
 assert.equal(actionSchema.safeParse({ operation: 'create', sourceId, fields: { name: 'A', secret: 'x' } }).success, false);
});
test('Leere Änderungen, ungültige IDs, Daten und Update ohne Ziel sind ungültig', () => {
 for (const raw of [ { operation: 'update', sourceId, fields: { name: 'A' } }, { operation: 'create', sourceId, fields: {} }, { operation: 'create', sourceId, fields: { name: 'A', date: '2026-02-30' } }, { operation: 'create', sourceId: '../../etc', fields: { name: 'A' } }, { operation: 'create', sourceId, fields: { name: 'A', value: -5 } } ]) assert.equal(actionSchema.safeParse(raw).success, false);
});
