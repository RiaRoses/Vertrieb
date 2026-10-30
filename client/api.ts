export async function api<T = any>(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  const response = await fetch('/api' + path, { method, headers: body !== undefined ? { 'Content-Type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Anfrage fehlgeschlagen.');
  return data;
}
export const money = (n: number) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
export const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
export const dateLabel = (value: string) => !value ? 'Kein Datum' : value === today() ? 'Heute' : new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: 'short' }).format(new Date(value + 'T12:00:00'));
