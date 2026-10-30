import { test, expect } from '@playwright/test';

test('Demo ist erkennbar; Navigation, Suche und Portfolio funktionieren', async ({ page }, info) => {
 const errors: string[] = [];
 page.on('pageerror', error => errors.push(error.message));
 await page.goto('/');
 await expect(page.getByRole('heading', { name: 'Gute Geschäfte beginnen hier.' })).toBeVisible();
 await expect(page.getByText('Demo-Ansicht', { exact: true }).first()).toBeVisible();
 if (info.project.name === 'desktop') await page.getByRole('button', { name: 'Agent schließen', exact: true }).click();
 await page.getByRole('button', { name: 'Kontakte', exact: true }).click();
 await page.getByRole('textbox', { name: 'Kontakte suchen' }).fill('Mara');
 await expect(page.getByRole('button', { name: /Mara Hoffmann/ })).toBeVisible();
 await expect(page.getByRole('button', { name: /Felix Weber/ })).toHaveCount(0);
 await page.getByRole('button', { name: 'Portfolio', exact: true }).click();
 await expect(page.getByRole('heading', { name: 'Studio Nord', exact: true })).toBeVisible();
 await page.getByRole('button', { name: /Studio Nord Mara Hoffmann/ }).click();
 await expect(page.getByRole('dialog')).toBeVisible();
 await expect(page.getByRole('dialog').getByRole('button', { name: 'Notion verbinden', exact: true })).toBeVisible();
 await page.keyboard.press('Escape');
 expect(errors).toEqual([]);
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('Notion-Verbindung erklärt Einrichtung und zeigt ungültige Tokens als Fehler', async ({ page }, info) => {
 await page.goto('/');
 if (info.project.name === 'desktop') await page.getByRole('button', { name: 'Agent schließen', exact: true }).click();
 await page.getByRole('button', { name: 'Notion verbinden', exact: true }).click();
 await expect(page.getByRole('dialog')).toBeVisible();
 await expect(page.getByRole('link', { name: /Notion Integrationen/ })).toBeVisible();
 await page.route('**/api/connect', route => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Notion: Zugangsschlüssel ungültig.' }) }));
 await page.getByLabel('Integration-Token').fill('ntn_invalid_test');
 await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
 await expect(page.getByRole('alert')).toContainText('Zugangsschlüssel ungültig');
 await page.keyboard.press('Escape');
 await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('Agent unterscheidet Demo und echte Verbindung', async ({ page }, info) => {
 await page.goto('/');
 if (info.project.name === 'mobile') await page.getByRole('button', { name: 'Agent öffnen oder schließen' }).click();
 await page.getByRole('textbox', { name: 'Nachricht an deinen Agenten' }).fill('Lege eine Aufgabe an');
 await page.getByRole('button', { name: 'Nachricht senden' }).click();
 await expect(page.getByText(/Du siehst gerade Beispieldaten/)).toBeVisible();
 await expect(page.getByRole('button', { name: 'In Notion speichern' })).toHaveCount(0);
});

test('Screenshot der Übersicht', async ({ page }, info) => {
 await page.goto('/');
 await expect(page.getByRole('heading', { name: 'Gute Geschäfte beginnen hier.' })).toBeVisible();
 await page.screenshot({ path: `test-results/${info.project.name}-workspace.png`, fullPage: true });
});

test('Verbundene Aufgabe wird erst nach sichtbarer Freigabe gespeichert', async ({ page }) => {
 const sourceId = '11111111-1111-4111-8111-111111111111';
 const mapping = { sourceId, role: 'tasks', status: 'Erledigt', company: '', value: '', date: 'Fällig', email: '', phone: '', relation: '', prospectStatuses: [], completedStatuses: [] };
 const source = { id: sourceId, name: 'Meine Aufgaben', properties: [{ id: 't', name: 'Name', type: 'title' }, { id: 's', name: 'Erledigt', type: 'checkbox' }, { id: 'd', name: 'Fällig', type: 'date' }] };
 let proposals: any[] = [], saves = 0;
 await page.route('**/api/**', async route => {
   const pathname = new URL(route.request().url()).pathname;
   let data: unknown = {};
   if (pathname === '/api/settings') data = { connected: true, aiConnected: false, workspace: 'Mein Notion', model: 'gpt-4.1-mini', mappings: [mapping], messages: [], pending: proposals };
   else if (pathname === '/api/sources') data = [source];
   else if (pathname === '/api/records') data = { records: [], syncedAt: new Date().toISOString() };
   else if (pathname === '/api/proposals') {
     const action = route.request().postDataJSON();
     proposals.push({ id: 'proposal-1', action, label: 'Anlegen · Meine Aufgaben', createdAt: new Date().toISOString(), state: 'pending' }); data = proposals[0];
   } else if (pathname === '/api/proposals/proposal-1/apply') { saves++; proposals = []; data = { ok: true }; }
   else throw new Error('Unerwartete API-Anfrage: ' + pathname);
   await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
 });
 await page.goto('/');
 await expect(page.getByText('Mit Notion verbunden', { exact: true })).toBeVisible();
 if (await page.getByRole('button', { name: 'Agent schließen', exact: true }).isVisible()) await page.getByRole('button', { name: 'Agent schließen', exact: true }).click();
 await page.getByRole('button', { name: 'Aufgaben', exact: true }).click();
 await page.getByRole('button', { name: 'Neue Aufgabe', exact: true }).click();
 await page.getByLabel('Aufgabe', { exact: true }).fill('Mara morgen anrufen');
 await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('Offen');
 await page.getByRole('button', { name: 'Änderung prüfen' }).click();
 await expect(page.getByRole('button', { name: 'In Notion speichern' })).toBeVisible();
 expect(saves).toBe(0); expect(proposals[0].action.fields.name).toBe('Mara morgen anrufen');
 await page.getByRole('button', { name: 'In Notion speichern' }).click();
 await expect(page.getByRole('status')).toContainText('In Notion gespeichert');
 expect(saves).toBe(1);
});
