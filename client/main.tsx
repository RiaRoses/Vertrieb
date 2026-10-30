import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowDown, ArrowRight, ArrowUpRight, BarChart3, Bell, BriefcaseBusiness, Check, CheckCheck, ChevronDown, ChevronRight, Circle, CircleHelp, Command, ExternalLink, LayoutDashboard, ListTodo, LoaderCircle, MessageSquare, MoreHorizontal, PanelRightClose, Plus, RefreshCw, Search, Send, Settings2, ShieldCheck, Sparkles, Target, Unplug, Users, X } from 'lucide-react';
import type { Action, Mapping, Pending, RecordItem, Role, Source } from '../server/domain';
import { api, dateLabel, money, today } from './api';
import { demoRecords } from './demo';
import './style.css';

type Settings = { connected: boolean; aiConnected: boolean; workspace?: string; model: string; mappings: Mapping[]; messages: Message[]; pending: Pending[] };
type Message = { role: 'user' | 'assistant'; content: string };
type Page = 'Übersicht' | 'Kontakte' | 'Pipeline' | 'Aufgaben' | 'Portfolio';
const emptySettings: Settings = { connected: false, aiConnected: false, model: 'gpt-4.1-mini', mappings: [], messages: [], pending: [] };
const initialMessage: Message = { role: 'assistant', content: 'Hallo! Ich helfe dir, im Vertrieb den Überblick zu behalten. Was möchtest du heute angehen?' };
const roleLabel: Record<Role, string> = { leads: 'Leads', prospects: 'Prospects', tasks: 'Aufgaben' };
const fieldLabels: Record<string, string> = { name: 'Titel', company: 'Unternehmen', status: 'Status', value: 'Deal-Wert', date: 'Fällig am', email: 'E-Mail', phone: 'Telefon', relation: 'Verknüpfte Kontakte' };
const initials = (s: string) => s.split(' ').slice(0, 2).map(x => x[0]).join('').toUpperCase();
function App() {
  const [settings, setSettings] = useState<Settings>(emptySettings);
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [page, setPage] = useState<Page>('Übersicht');
  const [filter, setFilter] = useState('Alle');
  const [search, setSearch] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showChat, setShowChat] = useState(() => window.innerWidth >= 1000);
  const [selected, setSelected] = useState<RecordItem | null>(null);
  const [createRole, setCreateRole] = useState<Role | null>(null);
  const [messages, setMessages] = useState<Message[]>([initialMessage]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [chatText, setChatText] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncedAt, setSyncedAt] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [applying, setApplying] = useState('');
  const chatEnd = useRef<HTMLDivElement>(null);
  const demo = !settings.connected;
  const data = demo ? demoRecords : records;
  const contacts = data.filter(r => r.role !== 'tasks');
  const tasks = data.filter(r => r.role === 'tasks');
  const openTasks = tasks.filter(r => !r.done).sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  const pipeline = contacts.reduce((s, r) => s + r.value, 0);
  const visible = data.filter(r => (page === 'Aufgaben' ? r.role === 'tasks' : r.role !== 'tasks') && (filter === 'Alle' || r.role === (filter === 'Leads' ? 'leads' : 'prospects')) && `${r.name} ${r.company} ${r.status}`.toLowerCase().includes(search.toLowerCase()));
  async function refresh() {
    setSyncing(true); setError('');
    try {
      const s = await api<Settings>('/settings'); setSettings(s); setPending(s.pending);
      setMessages(s.messages.length ? s.messages : [initialMessage]);
      if (!s.mappings.length) setRecords([]);
      if (s.connected) {
        const src = await api<Source[]>('/sources'); setSources(src);
        const result = await api('/records'); setRecords(result.records); setSyncedAt(result.syncedAt);
      } else { setSources([]); setRecords([]); setSyncedAt(''); }
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); setSyncing(false); }
  }
  useEffect(() => { void refresh(); }, []);
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [messages, pending, chatBusy]);
  useEffect(() => { if (notice) { const t = setTimeout(() => setNotice(''), 5000); return () => clearTimeout(t); } }, [notice]);
  function create(role: Role) { if (demo || !settings.mappings.some(m => m.role === role)) { setShowSettings(true); return; } setCreateRole(role); }
  async function sendChat(text = chatText) {
    if (!text.trim() || chatBusy) return;
    setChatText(''); setMessages(m => [...m, { role: 'user', content: text }]);
    if (demo || !settings.aiConnected) {
      setMessages(m => [...m, { role: 'assistant', content: demo ? 'Du siehst gerade Beispieldaten. Verbinde zuerst deinen Notion-Workspace in den Einstellungen. Danach kann ich deine echten Leads und Aufgaben lesen und Änderungen vorbereiten.' : 'Notion ist verbunden. Hinterlege noch deinen OpenAI API-Schlüssel in den Einstellungen, um mit mir über deine Daten zu arbeiten.' }]); return;
    }
    setChatBusy(true);
    try { const result = await api('/chat', { message: text }); setMessages(m => [...m, { role: 'assistant', content: result.reply }]); setPending(p => [...p, ...result.pending]); }
    catch (e) { setMessages(m => [...m, { role: 'assistant', content: (e as Error).message }]); }
    finally { setChatBusy(false); }
  }
  async function apply(p: Pending, cancel = false) {
    if (applying) return;
    setApplying(p.id); setError('');
    try { await api(`/proposals/${p.id}/${cancel ? 'cancel' : 'apply'}`, {}); setPending(items => items.filter(i => i.id !== p.id)); if (!cancel) { setNotice('In Notion gespeichert.'); await refresh(); } }
    catch (e) { await refresh(); setError((e as Error).message); }
    finally { setApplying(''); }
  }
  async function toggleTask(r: RecordItem) {
    if (demo) { setShowSettings(true); return; }
    const mapping = settings.mappings.find(m => m.sourceId === r.sourceId);
    const source = sources.find(s => s.id === r.sourceId);
    const prop = source?.properties.find(p => p.name === mapping?.status);
    if (!mapping || !prop) { setSelected(r); return; }
    const status = prop.type === 'checkbox' ? (r.done ? 'Offen' : 'Erledigt') : r.done ? prop.options?.find(o => !mapping.completedStatuses.includes(o.name))?.name : mapping.completedStatuses[0];
    if (!status) { setSelected(r); return; }
    try { const p = await api<Pending>('/proposals', { operation: 'update', sourceId: r.sourceId, pageId: r.id, fields: { status } }); setPending(items => [...items, p]); setShowChat(true); }
    catch (e) { setError((e as Error).message); }
  }
  const nav = [{ name: 'Übersicht', icon: LayoutDashboard }, { name: 'Kontakte', icon: Users }, { name: 'Pipeline', icon: BarChart3 }, { name: 'Aufgaben', icon: ListTodo }, { name: 'Portfolio', icon: BriefcaseBusiness }] as const;
  return <div className={`app ${showChat ? '' : 'chat-hidden'}`}>
    <aside className="sidebar">
      <a className="brand" href="#" onClick={e => { e.preventDefault(); setPage('Übersicht'); }}><span className="brand-symbol"><BarChart3 size={23}/></span>vertrieb<span className="brand-dot">.</span></a>
      <button className="workspace-switch" onClick={() => setShowSettings(true)}><span className="workspace-avatar">R</span><span><strong>{settings.workspace || 'Mein Workspace'}</strong><small>Vertriebszentrale</small></span><ChevronDown size={14}/></button>
      <div className="nav-label">WORKSPACE</div>
      <nav>{nav.map(({ name, icon: Icon }) => <button key={name} aria-label={name} className={`nav-item ${page === name ? 'active' : ''}`} onClick={() => { setPage(name); setFilter('Alle'); setSearch(''); }}><Icon size={19}/>{name}{name === 'Aufgaben' && <span className="nav-count">{openTasks.length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="notion-status"><span className="notion-icon">N</span><div><strong>Notion Workspace</strong><small><i className={demo ? 'dot amber' : 'dot'}/>{demo ? 'Noch nicht verbunden' : 'Verbunden'}</small></div><button title="Verbindung verwalten" aria-label="Notion-Verbindung verwalten" onClick={() => setShowSettings(true)}><Settings2 size={15}/></button></div>
      <button className="nav-item" onClick={() => setShowSettings(true)}><Settings2 size={18}/>Einstellungen</button><button className="nav-item" onClick={() => { setNotice('Starte mit „Notion verbinden“. Wähle dann deine Datenbanken und Felder aus. Für den Agenten benötigst du zusätzlich einen OpenAI API-Schlüssel.'); }}><CircleHelp size={18}/>Hilfe & erste Schritte</button>
      <div className="profile"><span className="profile-avatar">ME</span><div><strong>Mein Vertrieb</strong><small>Persönlicher Workspace</small></div><span className="online-dot"/></div></div>
    </aside>
    <div className="workspace-main">
      <header className="topbar"><div className="breadcrumb">Workspace<ChevronRight size={13}/><strong>{page}</strong></div><div className="top-actions"><span className={`sync-status ${demo ? 'is-demo' : ''}`}><i className={demo ? 'dot amber' : 'dot'}/>{demo ? 'Demo-Ansicht' : syncing ? 'Synchronisiert …' : 'Mit Notion verbunden'}</span><button className="icon-button" aria-label="Daten aktualisieren" onClick={() => void refresh()} disabled={syncing}><RefreshCw size={17} className={syncing ? 'spin' : ''}/></button><span className="separator"/><button className={`icon-button ${showChat ? 'selected' : ''}`} title="Agent öffnen oder schließen" aria-label="Agent öffnen oder schließen" onClick={() => setShowChat(v => !v)}><Sparkles size={18}/></button></div></header>
      <main>
        {error && <div className="alert error" role="alert">{error}<button aria-label="Meldung schließen" onClick={() => setError('')}><X size={16}/></button></div>}
        {notice && <div className="alert success" role="status">{notice}<button aria-label="Meldung schließen" onClick={() => setNotice('')}><X size={16}/></button></div>}
        <div className="page-heading"><div><div className="eyebrow">DEIN VERTRIEB. ALLES IM BLICK.</div><h1>{page === 'Übersicht' ? 'Gute Geschäfte beginnen hier.' : page === 'Kontakte' ? 'Aus Kontakten werden Chancen.' : page === 'Pipeline' ? 'Deine nächsten Abschlüsse.' : page === 'Aufgaben' ? 'Kleine Schritte. Große Wirkung.' : 'Dein Netzwerk hat Potenzial.'}</h1><p>{page === 'Übersicht' ? 'Deine Kontakte, Chancen und nächsten Schritte – an einem Ort.' : page === 'Kontakte' ? 'Alle Leads und Prospects aus deinem Notion-Workspace.' : page === 'Pipeline' ? 'Verfolge deine Chancen vom ersten Kontakt bis zum Abschluss.' : page === 'Aufgaben' ? 'Was ansteht, was wichtig ist und was du schon geschafft hast.' : 'Entdecke die Unternehmen und Menschen in deinem Vertrieb.'}</p></div><button className="primary" onClick={() => create(page === 'Aufgaben' ? 'tasks' : 'leads')}><Plus size={17}/>{page === 'Aufgaben' ? 'Neue Aufgabe' : 'Neuer Kontakt'}</button></div>
        {demo && <div className="demo-banner"><span className="demo-spark"><Sparkles size={16}/></span><span><strong>Dein Workspace wartet auf dich.</strong> Entdecke die Demo oder verbinde deine echten Notion-Daten.</span><button onClick={() => setShowSettings(true)}>Notion verbinden<ArrowRight size={15}/></button></div>}
        {!demo && !settings.mappings.length && <div className="demo-banner"><span>Notion ist verbunden. Wähle jetzt deine Datenbanken und Felder aus.</span><button onClick={() => setShowSettings(true)}>Daten zuordnen<ArrowRight size={15}/></button></div>}
        {loading ? <div className="empty"><LoaderCircle className="spin"/>Workspace wird geladen …</div> : <>
        <section className="metrics" aria-label="Vertriebskennzahlen">
          {[{ name: 'Leads', number: String(contacts.filter(r => r.role === 'leads').length).padStart(2, '0'), icon: Users, sub: 'Neue Beziehungen aufbauen', color: 'orange' }, { name: 'Prospects', number: String(contacts.filter(r => r.role === 'prospects').length).padStart(2, '0'), icon: Target, sub: 'Chancen weiterentwickeln', color: 'purple' }, { name: 'Pipeline-Wert', number: money(pipeline), icon: BarChart3, sub: 'Summe zugeordneter Deal-Werte', color: 'green' }, { name: 'Offene Aufgaben', number: String(openTasks.length).padStart(2, '0'), icon: ListTodo, sub: `${openTasks.filter(r => r.date && r.date < today()).length} davon überfällig`, color: 'blue' }].map(m => <div className="metric-card" key={m.name}><div className="metric-top"><span>{m.name}</span><span className={`metric-icon ${m.color}`}><m.icon size={17}/></span></div><strong>{m.number}</strong><small>{m.sub}</small></div>)}
        </section>
        {(page === 'Übersicht' || page === 'Pipeline') && <section className="panel pipeline-panel"><div className="panel-heading"><div><h2>Deine Pipeline<span className="subtle-pill">{contacts.length} Kontakte</span></h2><p>Jede Beziehung beginnt mit einem ersten Schritt.</p></div>{page === 'Übersicht' && <button className="text-button" onClick={() => setPage('Pipeline')}>Pipeline ansehen<ArrowUpRight size={16}/></button>}</div><Pipeline records={contacts} onSelect={setSelected}/></section>}
        {page === 'Übersicht' && <div className="overview-grid"><section className="panel"><div className="panel-heading"><h2>Nächste Schritte<span className="subtle-pill">{openTasks.length}</span></h2><button className="icon-button" title="Aufgabe anlegen" aria-label="Aufgabe anlegen" onClick={() => create('tasks')}><Plus size={18}/></button></div><div className="task-list">{openTasks.slice(0, 4).map(r => <TaskRow key={r.id} item={r} onToggle={toggleTask} onSelect={setSelected}/>)}{!openTasks.length && <Empty text="Alles erledigt. Zeit für neue Chancen."/>}</div><button className="panel-footer" onClick={() => setPage('Aufgaben')}>Alle Aufgaben ansehen<ArrowRight size={15}/></button></section><section className="focus-card"><div className="focus-top"><span className="focus-icon"><Sparkles size={21}/></span><span>DEIN VERTRIEBSASSISTENT</span></div><h2>Mehr Zeit für <br/>gute Beziehungen.</h2><p>Lass deinen Agenten Follow-ups vorbereiten, Aufgaben erstellen und deinen nächsten Schritt finden.</p><button onClick={() => { setShowChat(true); void sendChat('Welche nächsten Schritte empfiehlst du mir für meine Kontakte?'); }}>Gemeinsam loslegen<ArrowUpRight size={17}/></button><div className="focus-art" aria-hidden="true"><span/><span/><span/><Target size={65}/></div></section></div>}
        {(page === 'Übersicht' || page === 'Kontakte') && <section className="panel contacts-panel"><div className="panel-heading"><h2>{page === 'Übersicht' ? 'Kontakte im Fokus' : 'Deine Kontakte'}<span className="subtle-pill">{contacts.length}</span></h2><label className="search-box"><Search size={16}/><input aria-label="Kontakte suchen" placeholder="Kontakte suchen …" value={search} onChange={e => setSearch(e.target.value)}/></label></div><div className="tabs">{['Alle', 'Leads', 'Prospects'].map(t => <button className={filter === t ? 'active' : ''} key={t} onClick={() => setFilter(t)}>{t}<span>{t === 'Alle' ? contacts.length : contacts.filter(r => r.role === (t === 'Leads' ? 'leads' : 'prospects')).length}</span></button>)}</div><div className="table-scroll"><table><thead><tr><th>Kontakt</th><th>Status</th><th>Deal-Wert</th><th>Nächster Kontakt</th><th/></tr></thead><tbody>{(page === 'Übersicht' ? visible.slice(0, 5) : visible).map((r, i) => <tr key={r.id} onClick={() => setSelected(r)}><td><button className="contact-cell" onClick={e => { e.stopPropagation(); setSelected(r); }}><span className={`contact-avatar avatar-${i % 5}`}>{initials(r.name)}</span><span><strong>{r.name}</strong><small>{r.company || roleLabel[r.role]}</small></span></button></td><td><Status name={r.status || 'Ohne Status'}/></td><td className="value-cell">{r.value ? money(r.value) : '—'}</td><td><span className={r.date && r.date < today() ? 'overdue' : 'muted'}>{dateLabel(r.date)}</span></td><td><ChevronRight size={15} className="muted"/></td></tr>)}</tbody></table>{!visible.length && <Empty text={search ? 'Keine Kontakte für diese Suche.' : 'Hier erscheinen deine Notion-Kontakte.'}/>}</div></section>}
        {page === 'Aufgaben' && <section className="panel"><div className="panel-heading"><h2>Deine Aufgaben<span className="subtle-pill">{tasks.length}</span></h2><label className="search-box"><Search size={16}/><input aria-label="Aufgaben suchen" placeholder="Aufgaben suchen …" value={search} onChange={e => setSearch(e.target.value)}/></label></div><div className="task-list full">{visible.sort((a,b) => Number(a.done) - Number(b.done) || (a.date || '9999').localeCompare(b.date || '9999')).map(r => <TaskRow key={r.id} item={r} onToggle={toggleTask} onSelect={setSelected}/>)}{!visible.length && <Empty text="Keine Aufgaben gefunden. Erstelle deinen nächsten Schritt."/>}</div></section>}
        {page === 'Portfolio' && <section><div className="section-heading"><h2>Menschen hinter den Chancen</h2><span className="muted">{contacts.length} Kontakte</span></div><div className="portfolio-grid">{contacts.map((r, i) => <button className="portfolio-card" key={r.id} onClick={() => setSelected(r)}><div className="portfolio-card-top"><span className={`company-avatar avatar-${i % 5}`}>{initials(r.company || r.name)}</span><ArrowUpRight size={18}/></div><h3>{r.company || r.name}</h3><p>{r.name}</p><Status name={r.status || roleLabel[r.role]}/><div className="portfolio-bottom"><span>Potenzial</span><strong>{money(r.value)}</strong></div></button>)}</div>{!contacts.length && <Empty text="Dein Portfolio wächst mit deinen Notion-Kontakten."/>}</section>}
        <footer className="main-footer"><span><span className="notion-icon small">N</span>{demo ? 'Beispieldaten · Keine echten Notion-Daten' : syncedAt ? `Zuletzt abgerufen um ${new Date(syncedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}` : 'Daten aus deinem Notion-Workspace'}</span><span>Mit Fokus auf das Wesentliche.</span></footer></>}
      </main>
    </div>
    {showChat && <aside className="agent-panel"><div className="agent-header"><span className="agent-avatar"><Sparkles size={20}/></span><div><h2>Dein Agent<span className="beta">BETA</span></h2><small><i className={settings.aiConnected ? 'dot' : 'dot amber'}/>{demo ? 'Lerne mich kennen' : settings.aiConnected ? 'Bereit für deinen nächsten Schritt' : 'API-Schlüssel benötigt'}</small></div><button className="icon-button" aria-label="Agent schließen" onClick={() => setShowChat(false)}><PanelRightClose size={18}/></button></div>
      <div className="agent-context"><span className="notion-icon small">N</span><span>{demo ? 'Demo · Noch keine Daten verbunden' : `${settings.mappings.length} Notion-Datenquellen verbunden`}</span><ShieldCheck size={14}/></div>
      <div className="chat-messages"><div className="chat-intro"><div className="intro-spark"><Sparkles size={26}/></div><h3>Ein guter Tag für<br/>deinen Vertrieb.</h3><p>Den Überblick behalten.<br/>Den nächsten Schritt machen.</p></div>{messages.map((m, i) => <div className={`message ${m.role}`} key={i}>{m.role === 'assistant' && <span className="message-icon"><Sparkles size={14}/></span>}<div>{m.content}</div></div>)}
      {messages.length < 3 && <div className="suggestions">{['Was sollte ich heute angehen?', 'Welche Prospects brauchen ein Follow-up?', 'Erstelle eine Aufgabe für einen Kontakt'].map(s => <button key={s} onClick={() => void sendChat(s)}>{s}<ArrowUpRight size={14}/></button>)}</div>}
      {chatBusy && <div className="agent-thinking"><LoaderCircle size={15} className="spin"/>Ich schaue in deinen Workspace …</div>}
      {pending.map(p => <div className="proposal" key={p.id}><div className="proposal-label"><span><ShieldCheck size={15}/>Änderung prüfen</span><span>NOTION</span></div><strong>{p.label}</strong>{p.action.pageId && <small>{records.find(r => r.id === p.action.pageId)?.name || p.action.pageId}</small>}<dl>{Object.entries(p.action.fields).map(([k, v]) => <React.Fragment key={k}><dt>{fieldLabels[k] || k}</dt><dd>{k === 'relation' ? (v as string[]).map(id => records.find(r => r.id === id)?.name || id).join(', ') : v === null || v === '' ? 'Leeren' : k === 'value' ? money(Number(v)) : String(v)}</dd></React.Fragment>)}</dl><div className="proposal-buttons"><button className="primary" disabled={!!applying} onClick={() => void apply(p)}>{applying === p.id ? <LoaderCircle size={14} className="spin"/> : <Check size={14}/>}In Notion speichern</button><button className="text-button" disabled={!!applying} onClick={() => void apply(p, true)}>Verwerfen</button></div></div>)}<div ref={chatEnd}/></div>
      <form className="chat-composer" onSubmit={e => { e.preventDefault(); void sendChat(); }}><div className="composer-input"><textarea aria-label="Nachricht an deinen Agenten" value={chatText} onChange={e => setChatText(e.target.value)} placeholder="Was möchtest du angehen?" rows={3} maxLength={4000} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendChat(); } }}/><div><span><span className="mini-spark">✦</span>{demo ? 'Demo-Ansicht' : 'Notion als Datenquelle'}</span><button className="send-button" aria-label="Nachricht senden" disabled={chatBusy || !chatText.trim()}><ArrowRight size={18}/></button></div></div><p><ShieldCheck size={12}/>Änderungen erst nach deiner Freigabe.</p></form>
    </aside>}
    {showSettings && <SettingsModal settings={settings} sources={sources} onClose={() => setShowSettings(false)} onRefresh={refresh} onSources={setSources} onError={setError}/>}
    {(selected || createRole) && <RecordModal record={selected} role={createRole} settings={settings} sources={sources} contacts={contacts} demo={demo} onClose={() => { setSelected(null); setCreateRole(null); }} onConnect={() => { setSelected(null); setCreateRole(null); setShowSettings(true); }} onPrepared={p => { setPending(items => [...items, p]); setSelected(null); setCreateRole(null); setShowChat(true); }}/>}
  </div>;
}
function Empty({ text }: { text: string }) { return <div className="empty"><Circle size={22}/><p>{text}</p></div>; }
function Status({ name }: { name: string }) { const n = name.toLowerCase(); const cls = /angebot|qualifi/.test(n) ? 'purple' : /verhand|gewonnen|erledigt|done/.test(n) ? 'green' : /kontakt|arbeit/.test(n) ? 'blue' : 'orange'; return <span className={`status ${cls}`}><i/>{name}</span>; }
function TaskRow({ item: r, onToggle, onSelect }: { item: RecordItem; onToggle: (r: RecordItem) => void; onSelect: (r: RecordItem) => void }) { return <div className={`task-row ${r.done ? 'is-done' : ''}`}><button className="task-check" aria-label={`Status ändern: ${r.name}`} onClick={() => onToggle(r)}>{r.done && <Check size={13}/>}</button><button className="task-title" onClick={() => onSelect(r)}><strong>{r.name}</strong><small>{r.company || 'Notion-Aufgabe'}</small></button><span className={`task-date ${r.date && r.date < today() && !r.done ? 'overdue' : ''}`}>{dateLabel(r.date)}</span></div>; }
function Pipeline({ records, onSelect }: { records: RecordItem[]; onSelect: (r: RecordItem) => void }) {
  const groups = [...new Set(records.map(r => r.status || 'Ohne Status'))].map(status => ({ status, items: records.filter(r => (r.status || 'Ohne Status') === status) }));
  const colors = ['#ef976c', '#8baff4', '#b29be0', '#80bfa6', '#e5bb72'];
  return <><div className="pipeline-bar">{groups.map((g, i) => <div title={`${g.status}: ${g.items.length}`} key={g.status} style={{ flex: g.items.length, background: colors[i % colors.length] }}/>)}</div><div className="pipeline-stages">{groups.map((g, i) => <div key={g.status}><div className="stage-name"><i style={{ background: colors[i % colors.length] }}/>{g.status}<span>{g.items.length}</span></div><strong>{money(g.items.reduce((s,r) => s + r.value, 0))}</strong><button onClick={() => onSelect(g.items[0])}>{g.items[0].company || g.items[0].name}<ArrowUpRight size={12}/></button></div>)}</div>{!groups.length && <Empty text="Deine Pipeline füllt sich mit deinen Notion-Kontakten."/>}</>;
}
function SettingsModal({ settings, sources, onClose, onRefresh, onSources }: { settings: Settings; sources: Source[]; onClose: () => void; onRefresh: () => Promise<void>; onSources: (s: Source[]) => void; onError: (s: string) => void }) {
  const [token, setToken] = useState(''); const [key, setKey] = useState(''); const [model, setModel] = useState(settings.model);
  const [mappings, setMappings] = useState<Mapping[]>(settings.mappings); const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [success, setSuccess] = useState('');
  async function run(name: string, fn: () => Promise<void>) { setBusy(name); setError(''); setSuccess(''); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setBusy(''); } }
  function selectSource(role: Role, sourceId: string) {
    const src = sources.find(s => s.id === sourceId);
    const find = (types: string[], hints: RegExp) => src?.properties.find(p => types.includes(p.type) && hints.test(p.name))?.name || src?.properties.find(p => types.includes(p.type))?.name || '';
    const m: Mapping = { role, sourceId, status: find(['status', 'select', 'checkbox'], /status|phase|stage/i), company: src?.properties.find(p => p.type === 'rich_text' && /company|firma|unternehmen/i.test(p.name))?.name || '', value: find(['number'], /wert|value|umsatz|amount/i), date: find(['date'], /due|fällig|follow|datum|date/i), email: find(['email'], /mail/i), phone: find(['phone_number'], /phone|telefon/i), relation: find(['relation'], /kontakt|lead|prospect|contact/i), prospectStatuses: [], completedStatuses: [] };
    setMappings(items => [...items.filter(m => m.role !== role), ...(sourceId ? [m] : [])]);
  }
  const types: Record<string, string[]> = { status: ['status', 'select', 'checkbox'], company: ['rich_text'], value: ['number'], date: ['date'], email: ['email'], phone: ['phone_number'], relation: ['relation'] };
  function patch(role: Role, field: string, value: any) { setMappings(items => items.map(m => m.role === role ? { ...m, [field]: value } : m)); }
  return <Modal title="Dein Workspace, deine Daten." subtitle="Verbinde Notion und richte deinen Vertriebsassistenten ein." onClose={onClose} wide>
    {error && <div className="alert error" role="alert">{error}</div>}{success && <div className="alert success" role="status">{success}</div>}
    <section className="settings-section"><div className="settings-title"><span className="notion-icon">N</span><div><h3>Notion verbinden</h3><p>{settings.connected ? `Verbunden mit ${settings.workspace}` : 'Deine vorhandenen Datenbanken bleiben die Datenquelle.'}</p></div>{settings.connected && <span className="connected-tag"><Check size={13}/>Verbunden</span>}</div>
      <p className="help-text">Erstelle eine interne Integration unter <a href="https://www.notion.so/profile/integrations" target="_blank" rel="noreferrer">Notion Integrationen <ExternalLink size={11}/></a> mit Lese-, Einfüge- und Änderungsrechten. Gib dann deine Datenbanken in Notion über „Verbindungen“ für diese Integration frei.</p>
      <form className="inline-form" onSubmit={e => { e.preventDefault(); void run('notion', async () => { await api('/connect', { token }); setToken(''); setMappings([]); await onRefresh(); setSuccess('Notion verbunden. Wähle unten deine Datenquellen.'); }); }}><label className="grow">Integration-Token<input type="password" autoComplete="off" placeholder={settings.connected ? 'Token ersetzen …' : 'ntn_…'} value={token} onChange={e => setToken(e.target.value)} required/></label><button className="primary" disabled={!!busy || !token}>{busy === 'notion' ? <LoaderCircle className="spin" size={15}/> : <Plus size={15}/>}Verbinden</button></form>
      {settings.connected && <div className="settings-actions"><button className="text-button" disabled={!!busy} onClick={() => void run('sources', async () => { onSources(await api('/sources')); setSuccess('Datenquellen aktualisiert.'); })}><RefreshCw size={14}/>Datenquellen neu laden</button><button className="text-button danger" disabled={!!busy} onClick={() => void run('disconnect', async () => { await api('/disconnect', {}); setMappings([]); await onRefresh(); })}><Unplug size={14}/>Verbindung trennen</button></div>}
    </section>
    {settings.connected && <section className="settings-section"><h3>Datenbanken zuordnen</h3><p className="help-text">Ordne deine Datenquellen den Bereichen zu. Der Seitentitel wird automatisch als Name verwendet. Optionale Felder kannst du leer lassen. Für eine gemeinsame CRM-Datenbank wähle nur „Leads“ und lege darunter die Prospect-Statuswerte fest.</p>
      {!sources.length && <div className="alert">Keine freigegebenen Datenquellen gefunden. Prüfe die Verbindung direkt in deinen Notion-Datenbanken und lade die Liste neu.</div>}
      {(['leads', 'prospects', 'tasks'] as Role[]).map(role => { const m = mappings.find(m => m.role === role); const source = sources.find(s => s.id === m?.sourceId); const statusProp = source?.properties.find(p => p.name === m?.status); return <div className="mapping-card" key={role}><label>{roleLabel[role]}<select value={m?.sourceId || ''} onChange={e => selectSource(role, e.target.value)}><option value="">Nicht zugeordnet</option>{sources.map(s => <option key={s.id} value={s.id} disabled={mappings.some(m => m.role !== role && m.sourceId === s.id)}>{s.name}</option>)}</select></label>{m && source && <><div className="mapping-fields">{Object.entries(types).map(([field, valid]) => <label key={field}>{fieldLabels[field]}<select value={String(m[field as keyof Mapping] || '')} onChange={e => patch(role, field, e.target.value)}><option value="">Nicht verwenden</option>{source.properties.filter(p => valid.includes(p.type)).map(p => <option value={p.name} key={p.id}>{p.name}</option>)}</select></label>)}</div>{role === 'leads' && statusProp?.options && <label className="status-mapping-label">Diese Statuswerte als Prospects anzeigen<div className="option-checks">{statusProp.options.map(o => <label key={o.name}><input type="checkbox" checked={m.prospectStatuses.includes(o.name)} onChange={e => patch(role, 'prospectStatuses', e.target.checked ? [...m.prospectStatuses, o.name] : m.prospectStatuses.filter(n => n !== o.name))}/>{o.name}</label>)}</div></label>}{role === 'tasks' && statusProp?.options && <label className="status-mapping-label">Welche Statuswerte bedeuten „Erledigt“?<div className="option-checks">{statusProp.options.map(o => <label key={o.name}><input type="checkbox" checked={m.completedStatuses.includes(o.name)} onChange={e => patch(role, 'completedStatuses', e.target.checked ? [...m.completedStatuses, o.name] : m.completedStatuses.filter(n => n !== o.name))}/>{o.name}</label>)}</div></label>}</>}</div>; })}
      <button className="primary" disabled={!!busy} onClick={() => void run('mapping', async () => { await api('/mappings', { mappings }); await onRefresh(); setSuccess('Zuordnung gespeichert. Deine Daten sind jetzt im Workspace.'); })}>{busy === 'mapping' ? <LoaderCircle size={15} className="spin"/> : <Check size={15}/>}Zuordnung speichern</button>
    </section>}
    <section className="settings-section"><div className="settings-title"><span className="agent-avatar"><Sparkles size={19}/></span><div><h3>Dein Vertriebsagent</h3><p>{settings.aiConnected ? 'OpenAI-Schlüssel hinterlegt' : 'Für Gespräche und Notion-Änderungsvorschläge.'}</p></div></div><p className="help-text">Der Agent sendet deine Nachricht und die zugeordneten Notion-Felder an die OpenAI API. Pro Datenquelle erhält er maximal die 150 zuletzt bearbeiteten Einträge. Es entstehen API-Kosten in deinem OpenAI-Konto.</p><form onSubmit={e => { e.preventDefault(); void run('ai', async () => { await api('/ai', { key: key || undefined, model }); setKey(''); await onRefresh(); setSuccess('Agent verbunden.'); }); }}><div className="ai-fields"><label>OpenAI API-Schlüssel<input type="password" value={key} onChange={e => setKey(e.target.value)} autoComplete="off" placeholder={settings.aiConnected ? 'Gespeichert · leer lassen zum Beibehalten' : 'sk-…'}/></label><label>Modell<input value={model} onChange={e => setModel(e.target.value)} required/></label></div><div className="settings-actions"><button className="primary" disabled={!!busy || (!key && !settings.aiConnected)}>{busy === 'ai' ? <LoaderCircle size={15} className="spin"/> : <Sparkles size={15}/>}Agent verbinden</button>{settings.aiConnected && <button type="button" className="text-button danger" disabled={!!busy} onClick={() => void run('removeAi', async () => { await api('/ai', {}, 'DELETE'); await onRefresh(); setSuccess('OpenAI-Schlüssel entfernt.'); })}>Schlüssel entfernen</button>}</div></form></section>
    <p className="security-note"><ShieldCheck size={15}/>Schlüssel werden serverseitig verschlüsselt gespeichert und nicht an den Browser zurückgegeben. Die Verbindung gilt für diesen Browser.</p>
  </Modal>;
}
function RecordModal({ record, role, settings, sources, contacts, demo, onClose, onConnect, onPrepared }: { record: RecordItem | null; role: Role | null; settings: Settings; sources: Source[]; contacts: RecordItem[]; demo: boolean; onClose: () => void; onConnect: () => void; onPrepared: (p: Pending) => void }) {
  const mapping = settings.mappings.find(m => record ? m.sourceId === record.sourceId : m.role === role);
  const source = sources.find(s => s.id === mapping?.sourceId);
  const [values, setValues] = useState<Record<string, any>>({ name: record?.name || '', company: record?.company || '', status: record?.status || '', value: record?.value || '', date: record?.date || '', email: record?.email || '', phone: record?.phone || '', relation: record?.relations || [] });
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (demo || !mapping) return onConnect();
    setBusy(true); setError('');
    try {
      const fields: Record<string, any> = {};
      for (const [key, value] of Object.entries(values)) {
        if (key !== 'name' && !mapping[key as keyof Mapping]) continue;
        const parsed = key === 'value' ? value === '' ? null : Number(value) : key === 'date' ? value || null : value;
        const before = record ? key === 'relation' ? record.relations : record[key as keyof RecordItem] : undefined;
        if (record && JSON.stringify(parsed) === JSON.stringify(before)) continue;
        if (!record && (parsed === '' || parsed === null || Array.isArray(parsed) && !parsed.length)) continue;
        fields[key] = parsed;
      }
      if (!Object.keys(fields).length) throw new Error('Es gibt keine Änderungen.');
      const action: Action = { operation: record ? 'update' : 'create', sourceId: mapping.sourceId, pageId: record?.id || null, fields };
      onPrepared(await api<Pending>('/proposals', action));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const set = (key: string, value: any) => setValues(v => ({ ...v, [key]: value }));
  return <Modal title={record ? record.name : role === 'tasks' ? 'Ein nächster Schritt.' : 'Eine neue Beziehung.'} subtitle={demo ? 'Beispieldatensatz · Verbinde Notion für echte Änderungen.' : `${source?.name || 'Notion'} · Änderungen werden zur Freigabe vorbereitet.`} onClose={onClose}>
    {error && <div className="alert error" role="alert">{error}</div>}
    <form className="record-form" onSubmit={submit}><label>{role === 'tasks' || record?.role === 'tasks' ? 'Aufgabe' : 'Name'}<input value={values.name} onChange={e => set('name', e.target.value)} required maxLength={250}/></label>
      {(['company', 'status', 'value', 'date', 'email', 'phone'] as const).filter(key => demo ? ['company','status','value','date'].includes(key) : mapping?.[key]).map(key => { const prop = source?.properties.find(p => p.name === mapping?.[key]); return <label key={key}>{fieldLabels[key]}{key === 'status' ? <select value={values.status} onChange={e => set('status', e.target.value)}><option value="" disabled>Status wählen</option>{(demo ? ['Neu', 'Kontaktiert', 'Qualifiziert', 'Angebot', 'Verhandlung'] : prop?.type === 'checkbox' ? ['Offen', 'Erledigt'] : prop?.options?.map(o => o.name) || []).map(s => <option key={s}>{s}</option>)}</select> : <input type={key === 'value' ? 'number' : key === 'date' ? 'date' : key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text'} min={key === 'value' ? '0' : undefined} step={key === 'value' ? '0.01' : undefined} value={values[key]} onChange={e => set(key, e.target.value)}/>}</label>; })}
      {!demo && mapping?.relation && <label>Verknüpfte Kontakte<select multiple value={values.relation} onChange={e => set('relation', [...e.target.selectedOptions].map(o => o.value))}>{contacts.filter(c => c.id !== record?.id).map(c => <option value={c.id} key={c.id}>{c.name}{c.company ? ` · ${c.company}` : ''}</option>)}</select><small>Mehrere Kontakte mit Strg / Cmd auswählen.</small></label>}
      <div className="modal-actions">{record?.url && <a className="text-button" href={record.url} target="_blank" rel="noreferrer">In Notion öffnen<ExternalLink size={14}/></a>}<button className="primary" disabled={busy}>{busy ? <LoaderCircle size={15} className="spin"/> : <ArrowRight size={15}/>} {demo ? 'Notion verbinden' : 'Änderung prüfen'}</button></div>
    </form>
  </Modal>;
}
function Modal({ title, subtitle, onClose, children, wide }: { title: string; subtitle: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement; const old = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const focusable = () => [...(ref.current?.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex="0"]') || [])].filter(e => !e.hasAttribute('disabled'));
    focusable()[0]?.focus();
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); if (e.key === 'Tab') { const items = focusable(); const first = items[0], last = items.at(-1); if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } } };
    document.addEventListener('keydown', handler);
    return () => { document.body.style.overflow = old; document.removeEventListener('keydown', handler); before?.focus(); };
  }, []);
  return <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}><div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title" ref={ref}><div className="modal-header"><div><div className="eyebrow">DEIN VERTRIEBS-WORKSPACE</div><h2 id="modal-title">{title}</h2><p>{subtitle}</p></div><button className="icon-button" aria-label="Dialog schließen" onClick={onClose}><X size={20}/></button></div>{children}</div></div>;
}

createRoot(document.getElementById('root')!).render(<App/>);
