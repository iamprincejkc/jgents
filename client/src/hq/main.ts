// JGENTS HQ: the CEO console (client/hq.html, /hq). You talk to the CEO only, by typing or by voice (hold Space; M for
// always listening), and the CEO briefs the departments. Home shows the company at a glance (pulse, the ring of
// departments around the CEO, the open request, your questions, the latest deliverables); the other tabs are the
// departments in detail, the reports (your requests and the CEO's answers), the deliverables (the company outbox) and
// the settings (voice). Data: the crew (GET /api/crew + its SSE stream) and the company (GET /api/crew/company).
import '@fontsource/silkscreen/400.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import './hq.css';
import type { CompanyFileText, CrewAgent, CrewAgentState, CrewCompany, CrewMessage, CrewQuestion, CrewSnapshot } from '../../../shared/crew';
import type { AgentInfo } from '../../../shared/types';
import { call, connect } from '../crew/api';
import { h } from '../ui/dom';
import { renderMarkdown } from '../ui/markdown';
import { ago, bytes, currentTicket, deptLine, hourly, pulse, shortName, sparkPoints, speakable, usd, type DeptLine, type DeptStatus, type Ticket } from './model';
import { portrait } from './portrait';
import { Speaker, Voice, type ListenMode } from './voice';

// ---------------------------------------------------------------- settings (this browser)

interface Settings {
  /** Read the CEO's replies aloud. */
  reply: boolean;
  voiceName: string;
  rate: number;
  mode: ListenMode;
  /** Always listening: how quiet a voice still counts (0..1). */
  sensitivity: number;
  /** What you say goes to the CEO at once (else it lands in the box for you to check). */
  autoSend: boolean;
}

const SETTINGS_KEY = 'jgents.hq.settings';
const DEFAULTS: Settings = { reply: true, voiceName: '', rate: 1, mode: 'push', sensitivity: 0.5, autoSend: true };

function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Settings>;
    return { ...DEFAULTS, ...raw, mode: raw.mode === 'always' || raw.mode === 'off' ? raw.mode : 'push' };
  } catch {
    return { ...DEFAULTS };
  }
}

const settings = loadSettings();

function saveSettings(): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // private mode: this visit only
  }
}

// ---------------------------------------------------------------- state

type Tab = 'home' | 'departments' | 'reports' | 'deliverables' | 'settings';
const TABS: { id: Tab; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'departments', label: 'Departments' },
  { id: 'reports', label: 'Reports' },
  { id: 'deliverables', label: 'Deliverables' },
  { id: 'settings', label: 'Settings' },
];

const S = {
  enabled: true,
  reason: '',
  agents: new Map<string, CrewAgent>(),
  states: new Map<string, CrewAgentState>(),
  messages: [] as CrewMessage[],
  questions: new Map<string, CrewQuestion>(),
  company: undefined as CrewCompany | undefined,
  loaded: false,
  live: false,
  tab: 'home' as Tab,
  fileName: '',
  file: undefined as CompanyFileText | { name: string; error: string } | undefined,
  /** CEO replies already read aloud, or that were there before this page opened. */
  spoken: new Set<string>(),
  sending: false,
};

const ceoAgent = (): CrewAgent | undefined => S.company?.ceo ?? [...S.agents.values()].find((a) => a.kind === 'ceo');
const departments = (): CrewAgent[] => [...S.agents.values()].filter((a) => a.kind === 'department');
const memberOf = (id: string): AgentInfo | undefined => S.company?.members.find((m) => m.id === `company:${id}` || (id === ceoAgent()?.id && m.id === 'company:ceo'));
const openQuestions = (): CrewQuestion[] => [...S.questions.values()].filter((q) => q.status === 'open').sort((a, b) => a.at - b.at);
const companyIds = (): Set<string> => new Set([ceoAgent()?.id, ...departments().map((d) => d.id)].filter((x): x is string => !!x));

// ---------------------------------------------------------------- helpers

function fmtTime(at: number): string {
  const d = new Date(at);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(text: string, bad = false): void {
  document.querySelector('.toast')?.remove();
  clearTimeout(toastTimer);
  const el = h('div', { class: `toast${bad ? ' bad' : ''}`, role: 'status', text });
  document.body.append(el);
  toastTimer = setTimeout(() => el.remove(), bad ? 6000 : 3500);
}

async function act<T>(p: Promise<T>): Promise<T | undefined> {
  try {
    return await p;
  } catch (err) {
    toast((err as Error).message, true);
    return undefined;
  }
}

function md(text: string, cls = 'md'): HTMLElement {
  const box = h('div', { class: cls });
  box.append(renderMarkdown(text));
  return box;
}

const SVG = 'http://www.w3.org/2000/svg';
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, ...children: SVGElement[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  el.append(...children);
  return el;
}

function face(id: string, label = ''): HTMLCanvasElement | HTMLElement {
  const m = memberOf(id);
  return m ? portrait(m, label) : h('span', { class: 'portrait', attrs: { 'aria-hidden': 'true' } });
}

const STATUS_LABEL: Record<DeptStatus | 'briefed', string> = { working: 'Working', waiting: 'Needs you', done: 'Reported', idle: 'Idle', error: 'Error', briefed: 'Briefed' };

function chip(status: DeptStatus | 'briefed', text = STATUS_LABEL[status]): HTMLElement {
  return h('span', { class: `chip s-${status}`, text });
}

function lineOf(a: CrewAgent, ticket: Ticket | undefined): DeptLine {
  return deptLine(a, S.states.get(a.id), openQuestions(), ticket, Date.now());
}

// ---------------------------------------------------------------- the frame

const root = document.getElementById('hq')!;
const liveMark = h('span', { class: 'mark', text: 'J', attrs: { 'aria-hidden': 'true' } });
const statePill = h('span', { class: 'pill', attrs: { role: 'status' } });
const countPill = h('span', { class: 'pill' });
const fullBtn = h('button', { class: 'pill', type: 'button', title: 'Full screen (F)', text: 'Full screen', on: { click: () => toggleFull() } });
const header = h(
  'header',
  { class: 'top' },
  h('a', { class: 'brand', attrs: { href: '/', title: 'Back to the office' } }, liveMark, h('div', {}, h('div', { class: 'px', style: 'font-size:calc(var(--fs) * 0.86)', text: 'HQ' }), h('small', { text: 'CEO console' }))),
  h('h1', { class: 'title' }, h('b', { text: 'J' }), 'GENTS ', h('span', { text: '·' }), ' HQ'),
  h('div', { class: 'right' }, statePill, countPill, h('a', { class: 'pill', attrs: { href: '/' }, text: 'Office' }), h('a', { class: 'pill', attrs: { href: '/crew' }, text: 'Crew chat' }), fullBtn),
);
const tabBtns = new Map<Tab, HTMLButtonElement>();
const tabs = h('nav', { class: 'tabs', role: 'tablist', attrs: { 'aria-label': 'Sections' } });
for (const t of TABS) {
  const b = h('button', { type: 'button', role: 'tab', text: t.label, attrs: { 'aria-selected': 'false', 'aria-controls': 'view' }, on: { click: () => setTab(t.id) } });
  tabBtns.set(t.id, b);
  tabs.append(b);
}
const banner = h('div', { class: 'banner', hidden: true, role: 'alert' });
const view = h('main', { class: 'view', attrs: { id: 'view', role: 'tabpanel' } });

// the talk bar (built once: the box keeps what you type)
const lastMsg = h('div', { class: 'msg' });
const micIco = svg('path', { fill: '#7cc8ff', d: 'M3 0h3v1h1v5H6v1H3V6H2V1h1zM0 4h1v2h1v1h1v1h3V7h1V6h1V4h1v2H8v1H7v1H6v1H5v2H4V9H3V8H2V7H1V6H0z' });
const mic = h('button', { class: 'mic', type: 'button', attrs: { 'aria-label': 'Talk to the CEO (hold Space)' } });
mic.append(svg('svg', { width: 18, height: 22, viewBox: '0 0 9 11', 'shape-rendering': 'crispEdges', 'aria-hidden': 'true' }, micIco));
const input = h('input', { type: 'text', attrs: { placeholder: 'Ask for a report or give a task…', 'aria-label': 'Message to the CEO', autocomplete: 'off', maxlength: 8000 } });
const sendBtn = h('button', { class: 'btn primary', type: 'button', text: 'Send', on: { click: () => void send(input.value) } });
const modeBtns = new Map<ListenMode, HTMLButtonElement>();
const toggles = h('div', { class: 'toggles', role: 'radiogroup', attrs: { 'aria-label': 'Listening' } });
for (const [mode, label] of [
  ['push', 'Push to talk'],
  ['always', 'Always listening'],
  ['off', 'Mic off'],
] as const) {
  const b = h('button', { class: 'pill', type: 'button', role: 'radio', text: label, attrs: { 'data-mode': mode, 'aria-checked': 'false' }, on: { click: () => setMode(mode) } });
  modeBtns.set(mode, b);
  toggles.append(b);
}
const replyBtn = h('button', { class: 'pill', type: 'button', attrs: { 'aria-pressed': 'true' }, on: { click: () => setReply(!settings.reply) } });
toggles.append(replyBtn);

const QUICK: [string, string][] = [
  ['Daily report', "Give me today's report: what the company did, what is in progress, and what needs me."],
  ['Who is working?', 'Who is working right now, and on what?'],
  ['Weekly summary', 'Give me the weekly summary: requests, deliverables, open items and what it cost.'],
];
const quick = h('div', { class: 'quick' });
for (const [label, text] of QUICK) quick.append(h('button', { class: 'btn', type: 'button', text: label, on: { click: () => void send(text) } }));
quick.append(h('button', { class: 'btn', type: 'button', text: 'New task…', on: { click: () => input.focus() } }));

const keys = h(
  'div',
  { class: 'keys', attrs: { 'aria-label': 'Keyboard shortcuts' } },
  h('span', {}, h('kbd', { text: 'Space' }), ' hold to talk'),
  h('span', {}, h('kbd', { text: 'M' }), ' always listening on / off'),
  h('span', {}, h('kbd', { text: 'Esc' }), ' stop listening (and the voice) now'),
  h('span', {}, h('kbd', { text: 'F' }), ' full screen'),
  h('span', { text: 'Your voice is turned into text on this computer (Whisper) and never leaves it.' }),
);
const talk = h(
  'section',
  { class: 'panel gold talk', attrs: { 'aria-label': 'Talk to the CEO' } },
  lastMsg,
  h('div', { class: 'bar' }, mic, input, sendBtn),
  h('div', { class: 'foot' }, quick, toggles),
  keys,
);

root.append(h('div', { class: 'app' }, header, h('div', {}, tabs, banner), view, talk));
root.removeAttribute('aria-busy');

// ---------------------------------------------------------------- Home (built once, updated in place)

const home = (() => {
  const gauges = h('div', { class: 'gauges' });
  const kv = h('div', { class: 'kv' });
  const sparkLine = svg('polyline', { fill: 'none', stroke: '#7cc8ff', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke', points: '' });
  const sparkArea = svg('polygon', { fill: 'rgba(124,200,255,0.12)', points: '' });
  const spark = svg('svg', { class: 'spark', viewBox: '0 0 260 54', preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Requests per hour today' }, sparkArea, sparkLine);
  const sparkTag = h('span', { class: 'tag' });
  const deptCount = h('span', { class: 'tag' });
  const deptList = h('div', { class: 'depts scroll', role: 'list' });
  const left = h(
    'div',
    { class: 'col' },
    h('section', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', { text: 'Company pulse' }), h('span', { class: 'tag', text: 'today' })), gauges, kv),
    h('section', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', { text: 'Requests per hour' }), sparkTag), spark),
    h('section', { class: 'panel grow' }, h('div', { class: 'ph' }, h('h2', { text: 'Departments' }), deptCount), deptList),
  );

  // the stage: rings (kept: recreating them would restart their spin), the CEO, the departments on an oval
  const arc = svg('path', { id: 'hq-arc', d: 'M128,300 a172,172 0 0,0 344,0' });
  const arcText = svg('text', { class: 'arc-text', 'text-anchor': 'middle', style: 'font: 400 11px Silkscreen, system-ui; letter-spacing: 3px; fill: rgba(250,198,101,0.6)' });
  const tp = svg('textPath', { href: '#hq-arc', startOffset: '50%' });
  tp.textContent = 'ASK FOR A REPORT · GIVE A TASK';
  arcText.append(tp);
  const ring = svg(
    'svg',
    { class: 'ring', viewBox: '0 0 600 600', 'aria-hidden': 'true' },
    svg('g', { class: 'spin' }, svg('circle', { cx: 300, cy: 300, r: 214, fill: 'none', stroke: 'rgba(124,200,255,0.28)', 'stroke-width': 2, 'stroke-dasharray': '4 10' })),
    svg('g', { class: 'spin rev' }, svg('circle', { cx: 300, cy: 300, r: 132, fill: 'none', stroke: 'rgba(250,198,101,0.35)', 'stroke-width': 3, 'stroke-dasharray': '40 14 8 14' })),
    svg('circle', { cx: 300, cy: 300, r: 250, fill: 'none', stroke: 'rgba(160,176,210,0.10)', 'stroke-width': 1 }),
    svg('defs', {}, arc),
    arcText,
  );
  const ceoFace = h('div', {});
  const ceoName = h('div', { class: 'name', text: 'CEO' });
  const ceoSay = h('div', { class: 'say' });
  const ceo = h('div', { class: 'ceo' }, ceoFace, ceoName, ceoSay);
  const stage = h('div', { class: 'stage' }, ring, ceo);
  const stageBox = h('div', { class: 'stage-box' }, stage);
  const waveL = h('div', { class: 'wave', attrs: { 'aria-hidden': 'true' } });
  const waveR = h('div', { class: 'wave', attrs: { 'aria-hidden': 'true' } });
  const bars: HTMLElement[] = [];
  for (let i = 0; i < 5; i++) {
    const a = h('i', { style: `animation-delay:${i * 0.15}s` });
    const b = h('i', { style: `animation-delay:${(4 - i) * 0.15}s` });
    waveL.append(a);
    waveR.prepend(b);
    bars.push(a, b);
  }
  const listenText = h('span', { class: 'px' });
  const listen = h('div', { class: 'listen muted' }, waveL, listenText, waveR);
  const ticket = h('div', { class: 'ticket', hidden: true });
  const center = h('div', { class: 'col stage-col' }, h('section', { class: 'panel gold stage-panel', attrs: { 'aria-label': 'The CEO and the departments' } }, stageBox, listen, ticket));

  const clock = h('div', { class: 'clock' });
  const date = h('div', { class: 'date' });
  const qCount = h('span', { class: 'tag' });
  const qList = h('div', { class: 'scroll' });
  const files = h('div', { class: 'files' });
  const right = h(
    'div',
    { class: 'col' },
    h('section', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', { text: 'Today' }), h('span', { class: 'tag', text: 'local' })), clock, date),
    h('section', { class: 'panel amber grow' }, h('div', { class: 'ph' }, h('h2', { text: 'Questions for you' }), qCount), qList),
    h('section', { class: 'panel' }, h('div', { class: 'ph' }, h('h2', { text: 'Deliverables' }), h('span', { class: 'tag', text: 'company/outbox' })), files),
  );
  const el = h('div', { class: 'grid' }, left, center, right);
  const rows = new Map<string, { row: HTMLElement; node: HTMLElement; what: HTMLElement; chip: HTMLElement; lbl: HTMLElement; sig: string }>();
  return { el, gauges, kv, sparkLine, sparkArea, sparkTag, deptCount, deptList, stage, stageBox, ceo, ceoFace, ceoSay, listen, listenText, bars, ticket, clock, date, qCount, qList, files, rows };
})();

function gauge(n: number, total: number, color: string, label: string): HTMLElement {
  const c = 2 * Math.PI * 32;
  const len = total ? (n / total) * c : 0;
  const s = svg(
    'svg',
    { viewBox: '0 0 80 80', role: 'img', 'aria-label': `${n} ${label}` },
    svg('circle', { cx: 40, cy: 40, r: 32, fill: 'none', stroke: 'rgba(160,176,210,0.15)', 'stroke-width': 7 }),
    svg('circle', { cx: 40, cy: 40, r: 32, fill: 'none', stroke: color, 'stroke-width': 7, 'stroke-dasharray': `${len.toFixed(1)} ${(c + 1).toFixed(1)}`, transform: 'rotate(-90 40 40)' }),
  );
  const t = svg('text', { class: 'v', x: 40, y: 47, 'text-anchor': 'middle' });
  t.textContent = String(n);
  s.append(t);
  return h('div', { class: 'gauge' }, s, h('div', { text: label }));
}

function renderHome(): void {
  const c = S.company;
  const now = Date.now();
  // who works and who needs you, from the live crew states (the company snapshot follows a moment later)
  const everyone = [ceoAgent(), ...departments()].filter((a): a is CrewAgent => !!a);
  const live = everyone.map((a) => {
    const s = lineOf(a, undefined).status;
    return { status: s === 'working' ? ('working' as const) : s === 'waiting' ? ('waiting' as const) : ('idle' as const) };
  });
  const p = pulse(live, c?.log ?? [], c?.outbox ?? [], now);
  home.gauges.replaceChildren(gauge(p.working, p.total, '#4fd18b', 'Working'), gauge(p.waiting, p.total, '#ffb547', 'Needs you'), gauge(p.idle, p.total, '#8b98b3', 'Idle'));
  const busiest = p.busiest ? shortName(S.agents.get(p.busiest), memberOf(p.busiest), p.busiest) : '-';
  home.kv.replaceChildren(
    ...[
      ['Requests', String(p.requestsToday)],
      ['Delivered', String(p.deliveredToday)],
      ['Spent today', usd(p.spentToday)],
      ['Busiest', busiest],
    ].flatMap(([k, v]) => [h('span', { text: k }), h('span', { text: v })]),
  );
  const hr = hourly(c?.log ?? [], now);
  const pts = sparkPoints(hr.counts, 260, 54);
  home.sparkLine.setAttribute('points', pts);
  home.sparkArea.setAttribute('points', `0,54 ${pts} 260,54`);
  const hh = (n: number) => `${n % 12 || 12} ${n < 12 ? 'am' : 'pm'}`;
  home.sparkTag.textContent = `${hh(hr.fromHour)} - now`;

  const ticket = currentTicket(c?.log ?? [], S.states, openQuestions());
  const depts = departments();
  home.deptCount.textContent = String(depts.length);
  const seen = new Set<string>();
  depts.forEach((a, i) => {
    seen.add(a.id);
    const line = lineOf(a, ticket);
    const m = memberOf(a.id);
    const sig = `${m?.seed}|${m?.look}|${JSON.stringify(m?.parts ?? {})}`;
    let r = home.rows.get(a.id);
    if (!r || r.sig !== sig) {
      r?.row.remove();
      r?.node.remove();
      const what = h('small', {});
      const ch = h('span', { class: 'chip' });
      const row = h('div', { class: 'dept', role: 'listitem' }, face(a.id), h('div', {}, h('b', { text: a.name }), what), ch);
      const lbl = h('div', { class: 'lbl', text: shortName(a, m, a.id) });
      const node = h('div', { class: 'node idle' }, h('div', { class: 'av' }, face(a.id, a.name)), lbl);
      r = { row, node, what, chip: ch, lbl, sig };
      home.rows.set(a.id, r);
      // on the stage box, not the square stage: the oval spans the whole panel
      home.stageBox.append(node);
    }
    home.deptList.append(r.row);
    r.what.textContent = line.what;
    r.row.title = `${a.name}: ${line.what}`;
    r.chip.className = `chip s-${line.status}`;
    r.chip.textContent = STATUS_LABEL[line.status];
    r.node.className = `node ${line.status}`;
    r.node.title = `${a.name}: ${line.what}`;
    r.lbl.textContent = shortName(a, m, a.id);
    // on an oval across the whole stage: wide screens spread the departments sideways instead of leaving empty bands
    const ang = (i / Math.max(1, depts.length)) * Math.PI * 2 - Math.PI / 2;
    r.node.style.left = `${50 + 44 * Math.cos(ang)}%`;
    r.node.style.top = `${50 + 41 * Math.sin(ang)}%`;
  });
  for (const [id, r] of home.rows) {
    if (seen.has(id)) continue;
    r.row.remove();
    r.node.remove();
    home.rows.delete(id);
  }

  const boss = ceoAgent();
  if (boss) {
    const line = lineOf(boss, undefined);
    const m = memberOf(boss.id);
    const sig = `${m?.seed}|${JSON.stringify(m?.parts ?? {})}`;
    if (home.ceoFace.dataset.sig !== sig) {
      home.ceoFace.dataset.sig = sig;
      home.ceoFace.replaceChildren(face(boss.id, 'The CEO in the navy blazer'));
    }
    home.ceo.className = `ceo ${line.status}`;
    home.stage.classList.toggle('busy', line.status !== 'idle');
    home.stage.parentElement?.parentElement?.classList.toggle('working', line.status === 'working');
    home.ceoSay.textContent = line.status === 'idle' ? `@${boss.id} · ${boss.model || 'default model'}` : line.what;
    home.ceoSay.title = home.ceoSay.textContent;
  }

  if (ticket) {
    home.ticket.hidden = false;
    const chips = ticket.chips.map((x) => {
      const who = shortName(S.agents.get(x.id), memberOf(x.id), x.id);
      const verb = x.status === 'done' ? 'reported' : x.status === 'waiting' ? 'needs you' : x.status === 'error' ? 'failed' : x.status === 'working' ? 'working' : 'briefed';
      return chip(x.status, `${who} ${verb}`);
    });
    const state = ticket.closed ? 'Answered' : ticket.chips.length ? `${ticket.reported} of ${ticket.chips.length} in` : S.states.get(boss?.id ?? '')?.status === 'working' ? 'Planning' : 'Answered';
    home.ticket.replaceChildren(
      h(
        'div',
        {},
        h('div', { class: 'meta px', text: `Latest request · ${fmtTime(ticket.at)}` }),
        h('div', { class: 't', text: ticket.text, title: ticket.text }),
        chips.length ? h('div', { class: 'steps' }, ...chips) : '',
      ),
      chip(ticket.closed ? 'done' : ticket.chips.some((x) => x.status === 'waiting') ? 'waiting' : 'working', state),
    );
  } else home.ticket.hidden = true;

  renderQuestions();
  const out = c?.outbox ?? [];
  home.files.replaceChildren(
    ...(out.length
      ? out.slice(0, 5).map((f) => fileRow(f.name, `${fmtTime(f.at)}`, () => openFile(f.name)))
      : [h('div', { class: 'empty', text: 'Finished work lands here (the company outbox).' })]),
  );
  tickClock();
}

function fileRow(name: string, meta: string, onClick: () => void, current = false): HTMLElement {
  return h('button', { class: 'file', type: 'button', title: name, attrs: { 'aria-current': current ? 'true' : undefined }, on: { click: onClick } }, h('i', { attrs: { 'aria-hidden': 'true' } }), h('span', { text: name }), h('small', { text: meta }));
}

function tickClock(): void {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  home.clock.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  home.date.textContent = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

// ---------------------------------------------------------------- questions (the board, for the company)

function renderQuestions(): void {
  const ids = companyIds();
  const open = openQuestions().filter((q) => ids.has(q.agentId));
  home.qCount.textContent = String(open.length);
  const drafts = new Map<string, string>();
  for (const el of home.qList.querySelectorAll<HTMLInputElement>('input[data-q]')) drafts.set(el.dataset.q!, el.value);
  const focused = (document.activeElement as HTMLElement | null)?.dataset?.q;
  home.qList.replaceChildren(...(open.length ? open.map((q) => questionCard(q, drafts.get(q.id))) : [h('div', { class: 'empty' }, h('b', { text: 'Nothing needs you' }), 'When a department needs a decision or your OK, it shows up here.')]));
  if (focused) home.qList.querySelector<HTMLInputElement>(`input[data-q="${focused}"]`)?.focus();
}

function questionCard(q: CrewQuestion, draft?: string): HTMLElement {
  const a = S.agents.get(q.agentId);
  const answer = (body: Record<string, unknown>) => void act(call('POST', `/api/crew/questions/${q.id}`, body));
  const card = h('div', { class: 'q' }, h('div', { class: 'who', text: `${a?.name ?? q.agentId} · ${q.kind === 'approval' ? 'wants to' : 'asks'}` }), h('p', { text: q.text }));
  if (q.preview) card.append(h('pre', { text: q.preview }));
  if (q.kind === 'approval') {
    card.append(
      h(
        'div',
        { class: 'btns' },
        h('button', { class: 'btn ok', type: 'button', text: 'Allow', on: { click: () => answer({ action: 'allow' }) } }),
        h('button', { class: 'btn', type: 'button', text: 'Always', title: `Allow this and similar calls for ${a?.name ?? 'this department'} from now on`, on: { click: () => answer({ action: 'allow', always: true }) } }),
        h('button', { class: 'btn danger', type: 'button', text: 'Deny', on: { click: () => answer({ action: 'deny' }) } }),
      ),
    );
    return card;
  }
  if (q.options?.length) card.append(h('div', { class: 'btns' }, ...q.options.map((o, i) => h('button', { class: `btn${i === 0 ? ' ok' : ''}`, type: 'button', text: o, on: { click: () => answer({ action: 'answer', answer: o }) } }))));
  const own = h('input', { type: 'text', attrs: { placeholder: q.options?.length ? 'Or your own answer…' : 'Your answer…', 'data-q': q.id, 'aria-label': `Answer ${a?.name ?? ''}` } });
  own.value = draft ?? '';
  const submit = () => own.value.trim() && answer({ action: 'answer', answer: own.value.trim() });
  own.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  });
  card.append(h('div', { class: 'own' }, own, h('button', { class: 'btn', type: 'button', text: 'Answer', on: { click: submit } })));
  return card;
}

// ---------------------------------------------------------------- Departments

function renderDepartments(): HTMLElement {
  const ticket = currentTicket(S.company?.log ?? [], S.states, openQuestions());
  const all = [ceoAgent(), ...departments()].filter((a): a is CrewAgent => !!a);
  const now = Date.now();
  return h(
    'div',
    { class: 'page' },
    h(
      'div',
      { class: 'cards' },
      ...all.map((a) => {
        const st = S.states.get(a.id);
        const line = lineOf(a, a.kind === 'ceo' ? undefined : ticket);
        const card = h(
          'section',
          { class: `panel card${a.kind === 'ceo' ? ' gold' : ''}` },
          face(a.id, a.name),
          h('h3', {}, h('span', { text: a.name }), chip(line.status)),
          h('div', { class: 'role', text: a.role }),
          h('div', { class: 'what', text: line.what }),
          h(
            'div',
            { class: 'stats' },
            h('span', {}, h('b', { text: String(st?.turns ?? 0) }), st?.turns === 1 ? ' turn' : ' turns'),
            h('span', {}, h('b', { text: usd(st?.costUsd ?? 0) }), ' spent'),
            h('span', {}, 'last ', h('b', { text: st?.lastAt ? ago(st.lastAt, now) : 'never' })),
            h('span', {}, h('b', { text: a.model || 'default' })),
          ),
        );
        if (st?.status === 'working' || (st?.queued ?? 0) > 0) {
          card.append(h('div', { class: 'acts' }, h('button', { class: 'btn danger', type: 'button', text: 'Stop', title: `Stop ${a.name}'s turn and drop its queue`, on: { click: () => void act(call('POST', `/api/crew/agents/${a.id}/stop`)) } })));
        }
        return card;
      }),
    ),
  );
}

// ---------------------------------------------------------------- Reports (your requests and the CEO's answers)

function renderReports(): HTMLElement {
  const boss = ceoAgent();
  const ids = companyIds();
  const fromCompany = (m: CrewMessage) => !!m.agentId && ids.has(m.agentId);
  const asks = S.messages.filter((m) => m.kind === 'user' && (fromCompany(m) || S.messages.some((r) => r.replyTo === m.id && fromCompany(r)))).reverse();
  if (!asks.length) {
    return h('div', { class: 'page' }, h('section', { class: 'panel reports' }, h('div', { class: 'empty' }, h('b', { text: 'No reports yet' }), 'Ask the CEO for a report or give a task: your requests and the answers show up here.')));
  }
  return h(
    'div',
    { class: 'page' },
    h(
      'div',
      { class: 'reports' },
      ...asks.map((u) => {
        const replies = S.messages.filter((m) => m.replyTo === u.id && m.kind === 'agent' && fromCompany(m));
        const fromCeo = replies.filter((m) => m.agentId === boss?.id);
        const fromDepts = replies.filter((m) => m.agentId !== boss?.id);
        const card = h('section', { class: 'panel report' }, h('div', { class: 'ask' }, h('p', { text: u.text }), h('time', { text: fmtTime(u.at), attrs: { datetime: new Date(u.at).toISOString() } })));
        for (const r of fromCeo) {
          const body = r.text ? md(r.text) : h('div', { class: 'empty', text: r.status === 'streaming' || r.status === 'queued' ? 'Working on it…' : r.status === 'error' ? 'The turn failed.' : '(no text)' });
          card.append(h('div', { class: 'answer' }, h('div', { class: 'who', text: `CEO · ${fmtTime(r.at)}${r.costUsd ? ` · ${usd(r.costUsd)}` : ''}` }), body));
        }
        if (fromDepts.length) {
          const det = h('details', { attrs: { 'data-for': u.id } }, h('summary', { text: `Department reports (${fromDepts.length})` }));
          for (const r of fromDepts) {
            const a = S.agents.get(r.agentId ?? '');
            det.append(h('div', { class: 'sub' }, h('div', { class: 'who', text: `${a?.name ?? r.agentId} · ${fmtTime(r.at)}` }), r.text ? md(r.text) : h('div', { class: 'empty', text: 'Working on it…' })));
          }
          card.append(det);
        }
        return card;
      }),
    ),
  );
}

// ---------------------------------------------------------------- Deliverables (the company outbox)

function openFile(name: string): void {
  S.fileName = name;
  S.file = undefined;
  setTab('deliverables');
  void call<CompanyFileText>('GET', `/api/crew/company/outbox/${encodeURIComponent(name)}`).then(
    (f) => {
      if (S.fileName === name) S.file = f;
      render();
    },
    (err) => {
      if (S.fileName === name) S.file = { name, error: (err as Error).message };
      render();
    },
  );
}

function renderDeliverables(): HTMLElement {
  const out = S.company?.outbox ?? [];
  if (!S.fileName && out[0]) {
    queueMicrotask(() => openFile(out[0].name));
  }
  const list = h(
    'section',
    { class: 'panel' },
    h('div', { class: 'ph' }, h('h2', { text: 'Outbox' }), h('span', { class: 'tag', text: String(out.length) })),
    out.length ? h('div', { class: 'list' }, ...out.map((f) => fileRow(f.name, `${bytes(f.bytes)} · ${fmtTime(f.at)}`, () => openFile(f.name), f.name === S.fileName))) : h('div', { class: 'empty', text: 'Nothing yet: what the company finishes for you lands in the outbox.' }),
  );
  const f = S.file;
  const folder = S.company ? `${S.company.folder}${S.company.folder.includes('\\') ? '\\' : '/'}outbox` : '';
  let body: HTMLElement;
  if (!S.fileName) body = h('div', { class: 'empty', text: 'Pick a file to read it here.' });
  else if (!f) body = h('div', { class: 'empty', text: 'Opening…' });
  else if ('error' in f) body = h('div', { class: 'empty', text: `Could not open it: ${f.error}` });
  else {
    const path = `${folder}${folder.includes('\\') ? '\\' : '/'}${f.name}`;
    const copy = h('button', { class: 'btn', type: 'button', text: 'Copy path', on: { click: () => void navigator.clipboard?.writeText(path).then(() => toast('Path copied'), () => toast(path)) } });
    const text = /\.(md|markdown)$/i.test(f.name) ? md(f.text) : h('pre', { class: 'raw', text: f.text });
    body = h(
      'div',
      {},
      h('div', { class: 'head' }, h('div', {}, h('h2', { text: f.name }), h('div', { class: 'path', text: `${path} · ${bytes(f.bytes)} · ${fmtTime(f.at)}${f.truncated ? ' · showing the first 512 KB' : ''}` })), copy),
      text,
    );
  }
  return h('div', { class: 'deliver' }, h('div', { class: 'page' }, list), h('section', { class: 'panel viewer page' }, body));
}

// ---------------------------------------------------------------- Settings

let settingsEl: HTMLElement | undefined;
const voiceStatus = h('div', { class: 'status-line' });
const voiceSelect = h('select', { attrs: { id: 'hq-voice' } });

function fillVoices(): void {
  const voices = speaker.voices();
  const cur = settings.voiceName;
  voiceSelect.replaceChildren(h('option', { text: 'Default English voice', attrs: { value: '' } }));
  const sorted = [...voices].sort((a, b) => Number(b.lang.startsWith('en')) - Number(a.lang.startsWith('en')) || a.name.localeCompare(b.name));
  for (const v of sorted) voiceSelect.append(h('option', { text: `${v.name} (${v.lang})${v.localService ? '' : ' · online'}`, attrs: { value: v.name } }));
  voiceSelect.value = voices.some((v) => v.name === cur) ? cur : '';
}

function renderVoiceStatus(): void {
  voiceStatus.className = `status-line ${voice.usable ? 'ok' : 'bad'}`;
  voiceStatus.replaceChildren();
  if (voice.usable) {
    voiceStatus.append('Voice input is ready: the local Whisper turns what you say into text on this computer.');
    return;
  }
  if (!voice.canRecord) {
    voiceStatus.append('This browser cannot record on this page: open the console at http://localhost.');
    return;
  }
  voiceStatus.append('Voice input is off: the local Whisper is not set up. Install ');
  voiceStatus.append(h('code', { text: voice.missing ?? 'whisper-cli, ffmpeg and a model' }));
  voiceStatus.append(', then restart JGENTS (npm run win:restart). Typing works meanwhile.');
}

function renderSettings(): HTMLElement {
  if (settingsEl) {
    renderVoiceStatus();
    return settingsEl;
  }
  const check = (label: string, value: boolean, onChange: (v: boolean) => void): HTMLElement => {
    const box = h('input', { type: 'checkbox' });
    box.checked = value;
    box.addEventListener('change', () => onChange(box.checked));
    return h('label', { class: 'check' }, box, label);
  };
  const range = (id: string, min: number, max: number, step: number, value: number, onInput: (v: number) => void): HTMLInputElement => {
    const r = h('input', { type: 'range', attrs: { id, min, max, step } });
    r.value = String(value);
    r.addEventListener('input', () => onInput(Number(r.value)));
    return r;
  };
  const modeSel = h('select', { attrs: { id: 'hq-mode' } }, h('option', { text: 'Push to talk (hold Space)', attrs: { value: 'push' } }), h('option', { text: 'Always listening', attrs: { value: 'always' } }), h('option', { text: 'Mic off', attrs: { value: 'off' } }));
  modeSel.value = settings.mode;
  modeSel.addEventListener('change', () => setMode(modeSel.value as ListenMode));
  voiceSelect.addEventListener('change', () => {
    settings.voiceName = voiceSelect.value;
    speaker.voiceName = settings.voiceName;
    saveSettings();
  });
  fillVoices();
  renderVoiceStatus();
  settingsEl = h(
    'div',
    { class: 'page' },
    h(
      'div',
      { class: 'settings' },
      h(
        'section',
        { class: 'panel' },
        h('div', { class: 'ph' }, h('h2', { text: 'Talking to the CEO' })),
        h('div', { class: 'field' }, voiceStatus),
        h('div', { class: 'field' }, h('label', { text: 'Listening', attrs: { for: 'hq-mode' } }), modeSel, h('small', { text: 'Push to talk records while you hold Space (or the mic button). Always listening hears every sentence until you press Esc or M.' })),
        h(
          'div',
          { class: 'field' },
          h('label', { text: 'Sensitivity (always listening)', attrs: { for: 'hq-sens' } }),
          range('hq-sens', 0, 1, 0.05, settings.sensitivity, (v) => {
            settings.sensitivity = v;
            voice.setSensitivity(v);
            saveSettings();
          }),
          h('small', { text: 'Higher hears quieter voices, and more of the room. The room noise is learned on its own.' }),
        ),
        h(
          'div',
          { class: 'field' },
          check('Send what I say right away', settings.autoSend, (v) => {
            settings.autoSend = v;
            saveSettings();
          }),
          h('small', { text: 'Off: what you say lands in the box, for you to check and send.' }),
        ),
      ),
      h(
        'section',
        { class: 'panel gold' },
        h('div', { class: 'ph' }, h('h2', { text: "The CEO's voice" })),
        h(
          'div',
          { class: 'field' },
          check('Read the replies aloud', settings.reply, (v) => setReply(v)),
          h('small', { text: speaker.supported() ? 'The browser reads them; the microphone pauses meanwhile, so it never hears the CEO as you.' : 'This browser cannot speak.' }),
        ),
        h('div', { class: 'field' }, h('label', { text: 'Voice', attrs: { for: 'hq-voice' } }), voiceSelect),
        h(
          'div',
          { class: 'field' },
          h('label', { text: 'Speed', attrs: { for: 'hq-rate' } }),
          range('hq-rate', 0.7, 1.5, 0.05, settings.rate, (v) => {
            settings.rate = v;
            speaker.rate = v;
            saveSettings();
          }),
        ),
        h('div', { class: 'field' }, h('button', { class: 'btn', type: 'button', text: 'Test the voice', on: { click: () => speaker.speak('Good to see you. The company is ready: ask me for a report or give me a task.', true) } })),
      ),
      h(
        'section',
        { class: 'panel' },
        h('div', { class: 'ph' }, h('h2', { text: 'Shortcuts' })),
        h(
          'div',
          { class: 'shortcuts' },
          ...[
            ['Space', 'Hold to talk (push to talk)'],
            ['M', 'Always listening on / off'],
            ['Esc', 'Stop listening and stop the voice now'],
            ['F', 'Full screen'],
            ['Enter', 'Send what is in the box'],
          ].flatMap(([k, v]) => [h('kbd', { text: k }), h('span', { text: v })]),
        ),
      ),
      h(
        'section',
        { class: 'panel' },
        h('div', { class: 'ph' }, h('h2', { text: 'The company' })),
        h('div', { class: 'field' }, h('div', { class: 'lbl', text: 'Company folder' }), h('small', { text: 'profile.md (who the company is: fill it in, everyone reads it), outbox/ (finished work) and log.jsonl (what happened).' }), h('code', { text: S.company?.folder ?? '' })),
        h('div', { class: 'field' }, h('a', { class: 'btn', attrs: { href: '/crew' }, text: 'Open the crew chat' })),
      ),
    ),
  );
  return settingsEl;
}

// ---------------------------------------------------------------- the talk bar

function renderTalk(): void {
  const boss = ceoAgent();
  const last = [...S.messages].reverse().find((m) => m.kind === 'agent' && m.agentId === boss?.id && (m.text || m.status === 'streaming' || m.status === 'queued'));
  const asked = last?.replyTo ? S.messages.find((m) => m.id === last.replyTo) : undefined;
  const st = boss ? S.states.get(boss.id) : undefined;
  const thinking = st?.status === 'working' && (!last || last.status !== 'streaming' || !last.text);
  const body = last?.text ? md(last.text, 'body md') : h('div', { class: 'body thinking', text: thinking ? `${st?.activity || 'Thinking'}…`.replace(/……$/, '…') : boss ? 'Ask for a report or give a task: the CEO briefs the right departments and answers you here.' : 'No company yet.' });
  const who = h('div', { class: 'who', text: last ? `CEO · ${fmtTime(last.at)}${last.status === 'streaming' ? ' · writing' : ''}` : 'CEO' });
  if (last?.text && last.text.length > 260) who.append(h('button', { type: 'button', text: 'Full answer', on: { click: () => setTab('reports') } }));
  if (last?.text && speaker.supported()) who.append(h('button', { type: 'button', text: 'Read aloud', on: { click: () => speaker.speak(speakable(last.text), true) } }));
  const faceBox = boss ? face(boss.id) : h('span', {});
  lastMsg.replaceChildren(faceBox, h('div', {}, who, body, asked ? h('div', { class: 'you', text: `You: ${asked.text}`, title: asked.text }) : ''));
  // a long answer fades out at the bottom instead of stopping mid-line (the whole of it is under Reports)
  body.classList.toggle('clipped', body.scrollHeight > body.clientHeight + 2);
  const off = !S.enabled || !boss;
  input.disabled = off;
  sendBtn.disabled = off || S.sending;
}

async function send(text: string): Promise<void> {
  const t = text.trim();
  const boss = ceoAgent();
  if (!t || S.sending) return;
  if (!boss) return toast('Set up the company first.', true);
  S.sending = true;
  renderTalk();
  const r = await act(call<CrewMessage>('POST', '/api/crew/chat', { text: t, agent: boss.id }));
  S.sending = false;
  if (r && text === input.value) input.value = '';
  renderTalk();
}

// ---------------------------------------------------------------- voice

const speaker = new Speaker((on) => {
  voice.pause(on);
  renderVoice();
});
speaker.enabled = settings.reply;
speaker.voiceName = settings.voiceName;
speaker.rate = settings.rate;
if (speaker.supported()) speechSynthesis.addEventListener('voiceschanged', () => settingsEl && fillVoices());

const voice = new Voice({
  change: () => renderVoice(),
  text: (t) => {
    if (settings.autoSend) void send(t);
    else {
      input.value = input.value ? `${input.value} ${t}` : t;
      input.focus();
      toast('Check the text, then press Enter.');
    }
  },
  say: (t, bad) => toast(t, bad),
  level: (v) => {
    for (const [i, b] of home.bars.entries()) b.style.height = `${Math.max(4, Math.min(20, 4 + v * 16 * (1 - (i % 5) * 0.12)))}px`;
  },
});
voice.setSensitivity(settings.sensitivity);
// "Mic off" comes back as it was; "always listening" waits for your first key or click (a browser starts no audio
// before the page was touched)
if (settings.mode === 'off') voice.mode = 'off';
let wantAlways = settings.mode === 'always';
const firstTouch = (): void => {
  removeEventListener('pointerdown', firstTouch, true);
  removeEventListener('keydown', firstTouch, true);
  if (!wantAlways) return;
  wantAlways = false;
  if (voice.usable && voice.mode === 'push') setMode('always');
};
addEventListener('pointerdown', firstTouch, true);
addEventListener('keydown', firstTouch, true);

function setMode(mode: ListenMode): void {
  voice.setMode(mode);
  if (voice.mode === mode) {
    settings.mode = mode;
    saveSettings();
  }
  renderVoice();
}

function setReply(on: boolean): void {
  settings.reply = on;
  speaker.enabled = on;
  if (!on) speaker.stop();
  saveSettings();
  renderVoice();
}

function renderVoice(): void {
  const usable = voice.usable;
  const hot = voice.hot;
  const phase = voice.phase;
  let pill: [string, string];
  let listenCls: string;
  let listenText: string;
  if (speaker.speaking) {
    pill = ['busy', 'CEO speaking'];
    listenCls = 'busy';
    listenText = 'Speaking';
  } else if (!usable) {
    pill = ['offc', 'Voice off'];
    listenCls = 'muted';
    listenText = voice.canRecord ? 'Voice needs Whisper' : 'Type below';
  } else if (voice.mode === 'off') {
    pill = ['offc', 'Mic off'];
    listenCls = 'offm';
    listenText = 'Mic off';
  } else if (phase === 'transcribing' && !hot) {
    pill = ['busy', 'Transcribing'];
    listenCls = 'busy';
    listenText = 'Transcribing';
  } else if (hot) {
    pill = ['live', phase === 'recording' ? 'Listening' : 'Always listening'];
    listenCls = 'hot';
    listenText = phase === 'recording' ? 'Listening' : 'Say something';
  } else {
    pill = ['', 'Push to talk'];
    listenCls = 'muted';
    listenText = 'Hold space to talk';
  }
  statePill.className = `pill ${pill[0]}`.trim();
  statePill.textContent = pill[1];
  home.listen.className = `listen ${listenCls}`;
  home.listenText.textContent = listenText;
  if (listenCls !== 'hot') for (const b of home.bars) b.style.height = '';
  mic.className = `mic${hot ? ' hot' : !usable ? ' na' : voice.mode === 'off' ? ' offm' : ''}`;
  micIco.setAttribute('fill', hot ? '#4fd18b' : !usable || voice.mode === 'off' ? '#ff6b6b' : '#7cc8ff');
  mic.title = !usable ? voice.whyNot() : voice.mode === 'always' ? 'Click: stop always listening' : 'Click: always listening on · press and hold (or hold Space): talk';
  const modeSel = document.getElementById('hq-mode') as HTMLSelectElement | null;
  if (modeSel && document.activeElement !== modeSel) modeSel.value = voice.mode;
  for (const [mode, b] of modeBtns) {
    const on = voice.mode === mode;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
    b.disabled = !usable && mode !== 'off' && mode !== voice.mode;
  }
  replyBtn.textContent = `Voice reply: ${settings.reply ? 'on' : 'off'}`;
  replyBtn.setAttribute('aria-pressed', String(settings.reply));
  replyBtn.disabled = !speaker.supported();
  if (S.tab === 'settings') renderVoiceStatus();
}

// The mic button (as in the mockup): a click turns always listening on or off; pressed and held, it is push to talk
// (on a phone or a tablet, where there is no Space bar).
const HOLD_MS = 250;
let holdTimer: ReturnType<typeof setTimeout> | undefined;
let held = false;
mic.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  mic.setPointerCapture(e.pointerId);
  held = false;
  clearTimeout(holdTimer);
  if (voice.mode !== 'push' || !voice.usable) return;
  holdTimer = setTimeout(() => {
    held = true;
    void voice.pressStart();
  }, HOLD_MS);
});
mic.addEventListener('pointerup', () => {
  clearTimeout(holdTimer);
  if (held) {
    held = false;
    voice.pressEnd();
    return;
  }
  if (!voice.usable) return toast(voice.whyNot(), true);
  setMode(voice.mode === 'always' ? 'push' : 'always');
});
mic.addEventListener('pointercancel', () => {
  clearTimeout(holdTimer);
  if (held) voice.pressEnd();
  held = false;
});

const typing = (): boolean => {
  const el = document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el as HTMLElement).isContentEditable);
};

addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (typing()) (document.activeElement as HTMLElement).blur();
    speaker.stop();
    voice.stop();
    renderVoice();
    return;
  }
  if (e.target === input && e.key === 'Enter' && !e.isComposing) {
    e.preventDefault();
    void send(input.value);
    return;
  }
  if (typing() || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.code === 'Space') {
    if (voice.mode !== 'push') return;
    e.preventDefault();
    if (!e.repeat) void voice.pressStart();
  } else if (e.key === 'm' || e.key === 'M') setMode(voice.mode === 'always' ? 'push' : 'always');
  else if (e.key === 'f' || e.key === 'F') toggleFull();
});
addEventListener('keyup', (e) => {
  if (e.code === 'Space') voice.pressEnd();
});
// a released key the page never sees (the window lost focus) must not leave the microphone recording
addEventListener('blur', () => voice.pressEnd());

function toggleFull(): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.().catch(() => toast('Full screen is not allowed here.', true));
}
document.addEventListener('fullscreenchange', () => {
  fullBtn.textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen';
});

// ---------------------------------------------------------------- rendering

function setTab(tab: Tab): void {
  if (S.tab === tab && view.firstChild) return;
  S.tab = tab;
  try {
    history.replaceState(null, '', tab === 'home' ? location.pathname : `#${tab}`);
  } catch {
    // file:// or a sandbox
  }
  render();
  view.scrollTop = 0;
}

let frame = 0;
function render(): void {
  cancelAnimationFrame(frame);
  frame = 0;
  for (const [id, b] of tabBtns) b.setAttribute('aria-selected', String(id === S.tab));
  const q = openQuestions().filter((x) => companyIds().has(x.agentId)).length;
  const homeTab = tabBtns.get('home')!;
  homeTab.querySelector('.count')?.remove();
  if (q && S.tab !== 'home') homeTab.append(h('span', { class: 'count', text: String(q) }));
  document.title = q ? `(${q}) HQ · JGENTS` : 'HQ · JGENTS';
  liveMark.classList.toggle('live', S.live);
  liveMark.title = S.live ? 'Connected' : 'Reconnecting…';
  countPill.textContent = `${departments().length} departments`;
  banner.hidden = S.enabled;
  banner.textContent = S.enabled ? '' : `The crew is off: ${S.reason || 'unknown reason'}.`;
  if (S.loaded && !ceoAgent()) {
    view.replaceChildren(setupScreen());
    renderTalk();
    renderVoice();
    return;
  }
  if (S.tab === 'home') {
    if (view.firstChild !== home.el) view.replaceChildren(home.el);
    renderHome();
  } else {
    // a live redraw keeps where you were: the scroll and the report sections you opened
    const keep = view.firstElementChild?.getAttribute('data-tab') === S.tab;
    const scrollers = keep ? [...view.querySelectorAll<HTMLElement>('.page')].map((p) => p.scrollTop) : [];
    const opened = keep ? new Set([...view.querySelectorAll<HTMLDetailsElement>('details[data-for]')].filter((d) => d.open).map((d) => d.dataset.for)) : new Set<string | undefined>();
    const el = S.tab === 'departments' ? renderDepartments() : S.tab === 'reports' ? renderReports() : S.tab === 'deliverables' ? renderDeliverables() : renderSettings();
    el.setAttribute('data-tab', S.tab);
    if (view.firstChild !== el) view.replaceChildren(el);
    if (keep) {
      view.querySelectorAll<HTMLElement>('.page').forEach((p, i) => (p.scrollTop = scrollers[i] ?? 0));
      for (const d of view.querySelectorAll<HTMLDetailsElement>('details[data-for]')) if (opened.has(d.dataset.for)) d.open = true;
    }
  }
  renderTalk();
  renderVoice();
}

/** Coalesces bursts of events into one redraw per frame. */
function schedule(): void {
  if (!frame) frame = requestAnimationFrame(() => render());
}

function setupScreen(): HTMLElement {
  const btn = h('button', {
    class: 'btn primary',
    type: 'button',
    text: 'Set up the company',
    on: {
      click: async () => {
        btn.disabled = true;
        const r = await act(call<{ created: string[] }>('POST', '/api/crew/company', {}));
        btn.disabled = false;
        if (r) {
          toast(`The company is in: ${r.created.length} new members.`);
          void loadCompany();
        }
      },
    },
  });
  return h(
    'div',
    { class: 'setup' },
    h(
      'section',
      { class: 'panel gold' },
      h('h2', { text: 'No company yet' }),
      h('p', { text: 'One click adds a CEO and 16 departments (finance, HR, legal, marketing and the rest), all in the same uniform. They stay idle until you ask the CEO for something.' }),
      S.enabled ? btn : h('p', { text: `The crew is off: ${S.reason}` }),
    ),
  );
}

// ---------------------------------------------------------------- data

let loading: Promise<void> | null = null;
let again = false;
async function loadCompany(): Promise<void> {
  if (loading) {
    again = true;
    return loading;
  }
  loading = (async () => {
    try {
      S.company = await call<CrewCompany>('GET', '/api/crew/company');
    } catch {
      // the crew is off or restarting: the next event or poll tries again
    }
    S.loaded = true;
    loading = null;
    schedule();
    if (again) {
      again = false;
      void loadCompany();
    }
  })();
  return loading;
}

/** Reloads the company within `ms`: a throttle, not a debounce (a busy turn sends events all the time). */
let companyTimer: ReturnType<typeof setTimeout> | undefined;
let companyDue = Infinity;
function companySoon(ms = 700): void {
  const due = Date.now() + ms;
  if (companyTimer && due >= companyDue) return;
  clearTimeout(companyTimer);
  companyDue = due;
  companyTimer = setTimeout(() => {
    companyTimer = undefined;
    companyDue = Infinity;
    void loadCompany();
  }, ms);
}

function applySnapshot(s: CrewSnapshot): void {
  S.enabled = s.enabled;
  S.reason = s.reason ?? '';
  S.agents = new Map(s.agents.map((a) => [a.id, a]));
  S.states = new Map(s.states.map((x) => [x.id, x]));
  S.messages = [...s.messages];
  S.questions = new Map(s.questions.map((q) => [q.id, q]));
  // what was already said before this page opened is never read aloud
  for (const m of s.messages) if (m.status !== 'streaming' && m.status !== 'queued') S.spoken.add(m.id);
  schedule();
}

function upsert(m: CrewMessage): void {
  const i = S.messages.findIndex((x) => x.id === m.id);
  if (i >= 0) S.messages[i] = m;
  else S.messages.push(m);
  if (S.messages.length > 400) S.messages.splice(0, S.messages.length - 400);
  const boss = ceoAgent();
  if (m.kind === 'agent' && m.agentId === boss?.id && m.status === 'done' && m.text && !S.spoken.has(m.id)) {
    S.spoken.add(m.id);
    speaker.speak(speakable(m.text));
  }
  if (m.status === 'done' || m.status === 'error' || m.status === 'stopped') companySoon();
  schedule();
}

async function start(): Promise<void> {
  const fromHash = location.hash.replace('#', '') as Tab;
  if (TABS.some((t) => t.id === fromHash)) S.tab = fromHash;
  render();
  void voice.check();
  try {
    applySnapshot(await call<CrewSnapshot>('GET', '/api/crew'));
  } catch (err) {
    S.enabled = false;
    S.reason = (err as Error).message;
  }
  await loadCompany();
  connect(
    {
      snapshot: applySnapshot,
      message: upsert,
      delta: (d) => {
        const m = S.messages.find((x) => x.id === d.id);
        if (!m) return;
        m.text += d.text;
        if (m.agentId === ceoAgent()?.id) renderTalk();
      },
      state: (st) => {
        S.states.set(st.id, st);
        companySoon(1500);
        schedule();
      },
      question: (q) => {
        S.questions.set(q.id, q);
        companySoon();
        schedule();
      },
      agents: (list) => {
        S.agents = new Map(list.map((a) => [a.id, a]));
        companySoon(200);
        schedule();
      },
      cleared: () => {
        S.messages = [];
        schedule();
      },
    },
    (live) => {
      S.live = live;
      if (live) void voice.check();
      schedule();
    },
  );
}

setInterval(() => {
  if (S.tab === 'home') tickClock();
}, 1000);
// the "x min ago" lines and the company, now and then
setInterval(() => {
  void loadCompany();
}, 20_000);
addEventListener('hashchange', () => {
  const t = location.hash.replace('#', '') as Tab;
  setTab(TABS.some((x) => x.id === t) ? t : 'home');
});

void start();
